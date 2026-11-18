import type { NextFunction, Request, Response } from 'express';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { schools } from '../db/schema.ts';
import { ensureInitialTenantsSeeded } from '../db/seed.ts';
import { getOrCreateUser, getUserProfileByUid } from '../db/users.ts';
import { isLocalSessionToken, verifySessionToken } from '../lib/passwordAuth.ts';
import { createSupabaseServerClient } from '../lib/supabase.ts';
import type { AuthSessionProfile, SchoolTenant, UserRole } from '../types.ts';
import { normalizeUserRole } from '../utils/rbac.ts';

export interface AuthRequest extends Request {
  user?: SupabaseUser;
  dbUser?: AuthSessionProfile;
  schoolId?: string;
  school?: SchoolTenant;
}

export async function checkSchoolSubscriptionGate(
  schoolId: string | null
): Promise<{ allowed: boolean; expired?: boolean; suspended?: boolean; reason?: string }> {
  if (!schoolId) {
    return {
      allowed: false,
      reason: 'No school tenant is assigned to this account. Contact Platform Support.',
    };
  }

  const rows = await db
    .select({
      name: schools.name,
      status: schools.status,
      subscriptionStatus: schools.subscriptionStatus,
      licenseExpiresAt: schools.licenseExpiresAt,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  const school = rows[0];
  if (!school) {
    return {
      allowed: false,
      reason: 'Assigned school record not found. Contact SchuleFlow Support.',
    };
  }

  const effectiveStatus = school.subscriptionStatus || school.status;
  if (effectiveStatus === 'suspended') {
    return {
      allowed: false,
      suspended: true,
      reason: `${school.name} subscription is currently suspended. Please contact SchuleFlow Support to restore access.`,
    };
  }

  const isExpiredByDate =
    school.licenseExpiresAt instanceof Date && school.licenseExpiresAt.getTime() < Date.now();
  if (effectiveStatus === 'expired' || isExpiredByDate) {
    return {
      allowed: false,
      expired: true,
      reason: `${school.name} subscription has expired. Choose a package in the Subscription Portal to restore access.`,
    };
  }

  return { allowed: true };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  try {
    await ensureInitialTenantsSeeded();

    let dbUser: AuthSessionProfile | null = null;

    if (isLocalSessionToken(token)) {
      const session = verifySessionToken(token);
      if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Session expired. Please sign in again.' });
      }
      dbUser = await getUserProfileByUid(session.uid);
      if (!dbUser) {
        return res.status(401).json({ error: 'Unauthorized: User account no longer exists.' });
      }
    } else {
      const supabaseServer = createSupabaseServerClient();
      const { data, error } = await supabaseServer.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
      }

      req.user = data.user;
      const email = data.user.email ?? `${data.user.id}@schuleflow.local`;
      const meta = data.user.user_metadata as Record<string, unknown> | undefined;
      const displayName =
        typeof meta?.full_name === 'string'
          ? meta.full_name
          : typeof meta?.name === 'string'
            ? meta.name
            : undefined;

      dbUser = await getOrCreateUser(data.user.id, email, displayName);
    }

    if (!dbUser.active) {
      return res.status(403).json({
        error: 'Account deactivated. Please contact your School Administrator.',
      });
    }

    // Subscription Gatekeeper for school-level accounts:
    // Suspended schools are blocked everywhere; expired schools may enter ONLY the subscription portal routes
    if (dbUser.globalRole !== 'super_admin') {
      const gate = await checkSchoolSubscriptionGate(dbUser.schoolId);
      if (!gate.allowed && !gate.expired) {
        return res.status(403).json({
          error: gate.reason || 'Account not assigned to an active school workspace.',
        });
      }
    }

    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error('Error verifying session token:', error);
    const errMsg = error instanceof Error ? error.message : '';
    const isAccountScopeError =
      errMsg.includes('Account deactivated') ||
      errMsg.includes('Account not assigned to an active school workspace') ||
      errMsg.includes('No active school staff account');

    return res.status(isAccountScopeError ? 403 : 401).json({
      error: isAccountScopeError ? errMsg : 'Unauthorized: Invalid or expired session token',
    });
  }
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.dbUser || req.dbUser.globalRole !== 'super_admin') {
    return res.status(403).json({
      error: 'Forbidden: Platform Super Admin privileges required.',
    });
  }
  next();
};

export const requireRoles = (...allowedRoles: UserRole[]) => {
  const normalizedAllowed = new Set(allowedRoles.map((r) => normalizeUserRole(r)));
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const dbUser = req.dbUser;
    if (!dbUser) {
      return res.status(401).json({ error: 'Unauthorized: Missing session profile.' });
    }
    if (dbUser.globalRole === 'super_admin') {
      return res.status(403).json({
        error:
          'Forbidden: Platform Super Admin workspace is strictly isolated from school-level academic and financial operations.',
      });
    }
    const effectiveRole = normalizeUserRole(dbUser.schoolRole);
    if (!normalizedAllowed.has(effectiveRole)) {
      return res.status(403).json({
        error: 'Forbidden: Your role does not permit this operation.',
      });
    }
    next();
  };
};

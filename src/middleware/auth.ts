import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { schools } from '../db/schema.ts';
import { ensureInitialTenantsSeeded } from '../db/seed.ts';
import { getAuthContextByUid } from '../db/users.ts';
import { isLocalSessionToken, verifySessionToken } from '../lib/passwordAuth.ts';
import type { AuthSessionProfile, GlobalRole, SchoolTenant, UserRole } from '../types.ts';
import { normalizeUserRole } from '../utils/rbac.ts';

export const SESSION_COOKIE_NAME = 'sf_session';

export interface AuthTokenContext {
  userId?: number;
  uid: string;
  staffId?: string;
  schoolId: string | null;
  role: UserRole;
  globalRole: GlobalRole;
}

export interface SubscriptionGateResult {
  allowed: boolean;
  expired?: boolean;
  suspended?: boolean;
  reason?: string;
}

export interface AuthRequest extends Request {
  user?: AuthTokenContext;
  dbUser?: AuthSessionProfile;
  schoolId?: string;
  school?: SchoolTenant;
  subscriptionGate?: SubscriptionGateResult;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function evaluateSchoolSubscriptionGate(
  school: Pick<SchoolTenant, 'name' | 'status' | 'subscriptionStatus' | 'licenseExpiresAt'> | null
): SubscriptionGateResult {
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

  const expiresMs = Date.parse(school.licenseExpiresAt);
  const isExpiredByDate = Number.isFinite(expiresMs) && expiresMs < Date.now();
  if (effectiveStatus === 'expired' || isExpiredByDate) {
    return {
      allowed: false,
      expired: true,
      reason: `${school.name} subscription has expired. Choose a package in the Subscription Portal to restore access.`,
    };
  }

  return { allowed: true };
}

export async function checkSchoolSubscriptionGate(
  schoolId: string | null
): Promise<SubscriptionGateResult> {
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

  return evaluateSchoolSubscriptionGate({
    name: school.name,
    status: school.status as SchoolTenant['status'],
    subscriptionStatus: (school.subscriptionStatus || school.status) as SchoolTenant['subscriptionStatus'],
    licenseExpiresAt: school.licenseExpiresAt.toISOString(),
  });
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  try {
    await ensureInitialTenantsSeeded();

    if (!isLocalSessionToken(token)) {
      return res.status(401).json({ error: 'Unauthorized: Session expired. Please sign in again.' });
    }

    const session = verifySessionToken(token);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Session expired. Please sign in again.' });
    }

    const authCtx = await getAuthContextByUid(session.uid);
    const dbUser = authCtx?.profile ?? null;
    const sessionSchoolId = session.schoolId;
    const sessionUserId = session.userId;
    const sessionStaffId = session.staffId;
    const sessionRole = session.role;

    if (!dbUser || !authCtx) {
      return res.status(401).json({ error: 'Unauthorized: User account no longer exists.' });
    }

    if (
      authCtx.sessionValidAfterMs !== null &&
      (typeof session.iat !== 'number' || session.iat < authCtx.sessionValidAfterMs)
    ) {
      return res.status(401).json({
        error: 'Unauthorized: Session has been revoked. Please sign in again.',
      });
    }

    if (!dbUser.active) {
      return res.status(403).json({
        error: 'Account deactivated. Please contact your School Administrator.',
      });
    }

    // Strict school binding check between verified token and PostgreSQL record
    if (
      dbUser.globalRole !== 'super_admin' &&
      sessionSchoolId !== dbUser.schoolId
    ) {
      return res.status(403).json({
        error: 'Session tenant mismatch detected. Please sign in again.',
      });
    }

    // Subscription Gatekeeper for school-level accounts:
    // Suspended schools are blocked everywhere; expired schools may enter ONLY the subscription portal routes
    if (dbUser.globalRole !== 'super_admin') {
      const gate = evaluateSchoolSubscriptionGate(authCtx.school);
      if (!gate.allowed && !gate.expired) {
        return res.status(403).json({
          error: gate.reason || 'Account not assigned to an active school workspace.',
        });
      }
      req.school = authCtx.school ?? undefined;
      req.subscriptionGate = gate;
    }

    req.user = {
      userId: sessionUserId ?? dbUser.userId,
      uid: dbUser.uid,
      staffId: sessionStaffId ?? dbUser.staffId,
      schoolId: dbUser.globalRole === 'super_admin' ? null : sessionSchoolId,
      role: normalizeUserRole(sessionRole ?? dbUser.schoolRole),
      globalRole: dbUser.globalRole,
    };
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

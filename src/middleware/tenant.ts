import type { NextFunction, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { schools, staffTeachers } from '../db/schema.ts';
import type {
  BillingStatus,
  CurriculumScope,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
} from '../types.ts';
import { checkSchoolSubscriptionGate, type AuthRequest } from './auth.ts';

export function requireTenantScopeWithOptions(options: { allowExpired?: boolean } = {}) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const requestedSchoolId = req.params.schoolId;
    const headerSchoolId = req.headers['x-school-id'];

    if (!requestedSchoolId) {
      return res.status(400).json({ error: 'Missing school tenant identifier in route.' });
    }

    if (typeof headerSchoolId === 'string' && headerSchoolId && headerSchoolId !== requestedSchoolId) {
      return res.status(403).json({
        error: 'Tenant header mismatch detected. Please refresh your school workspace.',
      });
    }

    const dbUser = req.dbUser;
    if (!dbUser) {
      return res.status(401).json({ error: 'Unauthorized: User session not loaded.' });
    }

    // Strict Platform Super Admin Isolation: super_admin has school_id = null and cannot access internal school data
    if (dbUser.globalRole === 'super_admin') {
      return res.status(403).json({
        error:
          'Platform Super Admins cannot inspect or modify internal school academic records.',
      });
    }

    // Strict Tenant Isolation Guard: school users may only access their assigned school
    if (!dbUser.schoolId) {
      return res.status(403).json({
        error: 'Account not assigned to an active school workspace. Contact your School Administrator.',
      });
    }

    if (dbUser.schoolId !== requestedSchoolId) {
      return res.status(403).json({
        error: 'You are not authorized to access records for another school.',
      });
    }

    try {
      const cleanEmail = dbUser.email.trim().toLowerCase();
      const staffRows = await db
        .select({ active: staffTeachers.active })
        .from(staffTeachers)
        .where(
          and(
            eq(staffTeachers.schoolId, requestedSchoolId),
            sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
          )
        )
        .limit(1);

      if (staffRows[0] && !staffRows[0].active) {
        return res.status(403).json({
          error: 'Account deactivated. Please contact your School Administrator.',
        });
      }

      const gate = await checkSchoolSubscriptionGate(requestedSchoolId);
      const allowExpiredHere = Boolean(options.allowExpired && gate.expired && !gate.suspended);
      if (!gate.allowed && !allowExpiredHere) {
        return res.status(403).json({
          error: gate.reason || 'School subscription is inactive.',
        });
      }

      const rows = await db
        .select()
        .from(schools)
        .where(eq(schools.id, requestedSchoolId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return res.status(404).json({ error: 'School tenant not found.' });
      }

      const school: SchoolTenant = {
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        ministryRegNo: row.ministryRegNo,
        subCounty: row.subCounty,
        motto: row.motto,
        logoUrl: row.logoUrl,
        primaryColor: row.primaryColor,
        secondaryColor: row.secondaryColor,
        address: row.address,
        phone: row.phone,
        email: row.email,
        district: row.district,
        region: row.region,
        status: row.status as SchoolStatus,
        subscriptionStatus: (row.subscriptionStatus || row.status) as SchoolStatus,
        licenseExpiresAt: row.licenseExpiresAt.toISOString(),
        plan: row.plan as SubscriptionPlan,
        curriculumScope: row.curriculumScope as CurriculumScope,
        studentQuota: row.studentQuota,
        termFeePerStudentUgx: row.termFeePerStudentUgx,
        billingStatus: row.billingStatus as BillingStatus,
        nextBillingDate: row.nextBillingDate,
        academicYear: row.academicYear,
        termName: row.termName,
        principalName: row.principalName,
        dosName: row.dosName,
        reportsGeneratedCount: row.reportsGeneratedCount,
        createdAt: row.createdAt.toISOString(),
      };

      req.schoolId = requestedSchoolId;
      req.school = school;
      next();
    } catch (error) {
      console.error('Tenant guard query failed:', error);
      return res.status(500).json({ error: 'Failed to validate school tenant workspace.' });
    }
  };
}

export const requireTenantScope = requireTenantScopeWithOptions();

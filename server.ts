import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addStudentsWithQuotaCheck,
  bulkPromoteTenantStudents,
  bulkUpsertTenantStaff,
  deleteSchoolTenant,
  deleteTenantCombination,
  getSchoolSubscriptionOverview,
  getTenantDatabase,
  incrementTenantReportsGenerated,
  listAllSchoolsWithStats,
  listPlatformAuditLogs,
  publishAllApprovedTenantMarksheets,
  recordAuditLog,
  updateSchoolSubscription,
  updateTenantSettingsAndGrading,
  updateTenantStudent,
  upsertTenantClass,
  upsertTenantCombination,
  upsertTenantExam,
  upsertTenantMarksheet,
  upsertTenantStaffMember,
  upsertTenantStudentRemark,
  upsertTenantSubject,
} from './src/db/repository.ts';
import {
  ensureInitialTenantsSeeded,
  provisionNewSchoolTenant,
  type OnboardSchoolInput,
} from './src/db/seed.ts';
import {
  AuthValidationError,
  authenticateWithCredentials,
  lookupRecoverableAccount,
  lookupSchoolByCode,
  resetPasswordWithRecoveryToken,
  verifyRecoveryIdentity,
} from './src/db/users.ts';
import { signSessionToken, verifyRecoveryToken } from './src/lib/passwordAuth.ts';
import {
  SESSION_COOKIE_NAME,
  checkSchoolSubscriptionGate,
  requireAuth,
  requireRoles,
  requireSuperAdmin,
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  requireTenantScope,
  requireTenantScopeWithOptions,
} from './src/middleware/tenant.ts';
import type {
  ExaminationPeriod,
  MarksheetRecord,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  StudentTermRemarks,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
} from './src/types.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

  /* ------------------------------------------------------------------------ */
  /* Auth & Session Context Routes (Pure PostgreSQL + HttpOnly Cookie/Bearer) */
  /* ------------------------------------------------------------------------ */
  app.get('/api/v1/auth/school-lookup', async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const rawCode = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      if (!rawCode) {
        return res.status(400).json({ error: 'School Code is required.' });
      }
      const school = await lookupSchoolByCode(rawCode);
      if (!school) {
        return res.status(404).json({ error: 'No registered school matches that School Code.' });
      }
      res.json({ school });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to verify school code.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();

      const { schoolCode, identifier, password, mode } = req.body as {
        schoolCode?: string;
        identifier?: string;
        password?: string;
        mode?: 'school' | 'super_admin';
      };

      const resolvedMode: 'school' | 'super_admin' = mode === 'super_admin' ? 'super_admin' : 'school';

      if (resolvedMode === 'school' && !schoolCode?.trim()) {
        return res.status(400).json({
          error: 'School Code is required for school staff login.',
        });
      }

      if (!identifier?.trim() || !password) {
        return res.status(400).json({
          error:
            resolvedMode === 'super_admin'
              ? 'Super Admin email and password are required.'
              : 'Staff ID or email and password are required.',
        });
      }

      const dbUser = await authenticateWithCredentials({
        schoolCode,
        identifier,
        password,
        mode: resolvedMode,
      });

      if (!dbUser) {
        return res.status(401).json({
          error:
            resolvedMode === 'super_admin'
              ? 'Invalid Platform Super Admin email or password.'
              : 'Invalid Staff ID / email or personal password for this school.',
        });
      }

      // Subscription Gatekeeper: block suspended schools; allow expired schools solely into the subscription portal
      if (dbUser.globalRole !== 'super_admin') {
        const gate = await checkSchoolSubscriptionGate(dbUser.schoolId);
        if (!gate.allowed && !gate.expired) {
          await recordAuditLog({
            userId: dbUser.uid,
            userEmail: dbUser.email,
            userRole: dbUser.schoolRole,
            schoolId: dbUser.schoolId,
            action: 'LOGIN_BLOCKED_SUBSCRIPTION',
            details: gate.reason || 'Subscription gatekeeper denied login.',
          });
          return res.status(403).json({
            error: gate.reason || 'School subscription is suspended.',
          });
        }
      }

      const token = signSessionToken({
        userId: dbUser.userId,
        uid: dbUser.uid,
        staffId: dbUser.staffId,
        email: dbUser.email,
        name: dbUser.name,
        globalRole: dbUser.globalRole,
        schoolId: dbUser.globalRole === 'super_admin' ? null : dbUser.schoolId,
        role: dbUser.schoolRole,
        schoolRole: dbUser.schoolRole,
      });

      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const allSchools = await listAllSchoolsWithStats();
      const accessibleSchools =
        dbUser.globalRole === 'super_admin'
          ? allSchools
          : allSchools.filter((s) => s.id === dbUser.schoolId);

      await recordAuditLog({
        userId: dbUser.uid,
        userEmail: dbUser.email,
        userRole: dbUser.globalRole === 'super_admin' ? 'super_admin' : dbUser.schoolRole,
        schoolId: dbUser.globalRole === 'super_admin' ? null : dbUser.schoolId,
        action: 'USER_LOGIN',
        details: `${dbUser.name}${dbUser.staffId ? ` (${dbUser.staffId})` : ''} signed in (${dbUser.globalRole === 'super_admin' ? 'Platform Super Admin' : dbUser.schoolRole}).`,
      });

      res.json({
        token,
        user: dbUser,
        schools: accessibleSchools,
      });
    } catch (error: unknown) {
      if (error instanceof AuthValidationError) {
        return res.status(error.status).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : 'Login failed.';
      const status = message.includes('deactivated') ? 403 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/v1/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/v1/auth/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const allSchools = await listAllSchoolsWithStats();
      const accessibleSchools =
        dbUser.globalRole === 'super_admin'
          ? allSchools
          : allSchools.filter((s) => s.id === dbUser.schoolId);

      await recordAuditLog({
        userId: dbUser.uid,
        userEmail: dbUser.email,
        userRole: dbUser.globalRole === 'super_admin' ? 'super_admin' : dbUser.schoolRole,
        schoolId: dbUser.globalRole === 'super_admin' ? null : dbUser.schoolId,
        action: 'SESSION_AUTHENTICATED',
        details: `${dbUser.name} authenticated session (${dbUser.globalRole === 'super_admin' ? 'super_admin' : dbUser.schoolRole}).`,
      });

      res.json({
        user: dbUser,
        schools: accessibleSchools,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to synchronize session.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/lookup', async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const { identifier, schoolCode, fullName } = req.body as {
        identifier?: string;
        schoolCode?: string;
        fullName?: string;
      };

      if (!identifier?.trim() && !(schoolCode?.trim() && fullName?.trim())) {
        return res.status(400).json({
          error:
            'Enter your Staff ID, email, or phone — or enter your School Code and full name.',
        });
      }

      const found = await lookupRecoverableAccount({ identifier, schoolCode, fullName });
      if (!found) {
        return res.status(404).json({
          error: 'No matching account was found. Double-check your details or contact your School Administrator.',
        });
      }

      res.json(found);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Account lookup failed.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/verify', async (req, res) => {
    try {
      const { recoveryToken, verification } = req.body as {
        recoveryToken?: string;
        verification?: string;
      };

      if (!recoveryToken || !verification?.trim()) {
        return res.status(400).json({
          error: 'Verification details are required to unlock your login information.',
        });
      }

      const result = await verifyRecoveryIdentity(recoveryToken, verification);
      if (!result) {
        return res.status(401).json({
          error: 'Verification did not match our records for this account.',
        });
      }

      await recordAuditLog({
        userId: result.account.email,
        userEmail: result.account.email,
        userRole: result.account.roleLabel,
        schoolId: result.account.schoolId,
        action: 'LOGIN_INFO_RECOVERED',
        details: `${result.account.name} verified identity and recovered login information.`,
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Identity verification failed.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/reset-password', async (req, res) => {
    try {
      const { resetToken, newPassword } = req.body as {
        resetToken?: string;
        newPassword?: string;
      };

      if (!resetToken || !newPassword) {
        return res.status(400).json({ error: 'Reset token and new password are required.' });
      }

      const updated = await resetPasswordWithRecoveryToken(resetToken, newPassword);
      if (!updated) {
        return res.status(401).json({
          error: 'Recovery session expired. Please restart account recovery.',
        });
      }

      await recordAuditLog({
        userId: updated.uid,
        userEmail: updated.email,
        userRole: updated.role,
        schoolId: updated.schoolId,
        action: 'PASSWORD_RESET_COMPLETED',
        details: `Password reset completed via self-service login recovery for ${updated.email}.`,
      });

      res.json({
        ok: true,
        email: updated.email,
        phone: updated.phone,
        username: updated.username,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reset password.';
      const status = message.includes('at least 6') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/request-admin', async (req, res) => {
    try {
      const { recoveryToken, note } = req.body as {
        recoveryToken?: string;
        note?: string;
      };
      const payload = recoveryToken ? verifyRecoveryToken(recoveryToken, 'lookup_verify') : null;
      if (!payload) {
        return res.status(401).json({ error: 'Recovery session expired. Please search again.' });
      }

      await recordAuditLog({
        userId: payload.email,
        userEmail: payload.email,
        userRole: 'recovery_requester',
        schoolId: payload.schoolId,
        action: 'ACCOUNT_RECOVERY_REQUESTED',
        details: `User requested administrator-assisted credential recovery for ${payload.email}${note?.trim() ? `: ${note.trim()}` : '.'}`,
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to submit recovery request.';
      res.status(500).json({ error: message });
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Platform Super Admin Routes (Strictly Isolated to Onboarding & Licenses) */
  /* ------------------------------------------------------------------------ */
  app.get(
    '/api/v1/platform/schools',
    requireAuth,
    requireSuperAdmin,
    async (_req: AuthRequest, res) => {
      try {
        await ensureInitialTenantsSeeded();
        const schoolsList = await listAllSchoolsWithStats();
        res.json({ schools: schoolsList });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load schools.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/platform/schools',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthRequest, res) => {
      try {
        const body = req.body as OnboardSchoolInput;
        if (!body.name || !body.subdomain || !body.adminEmail || !body.adminName) {
          return res.status(400).json({
            error: 'School name, subdomain, and primary School Administrator details are required.',
          });
        }
        const created = await provisionNewSchoolTenant(body);
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: 'super_admin',
          schoolId: created.id,
          action: 'SCHOOL_ONBOARDED',
          details: `Onboarded ${created.name} (Reg: ${created.ministryRegNo}, ${created.district}), status: ${created.subscriptionStatus}, primary admin: ${body.adminEmail.trim().toLowerCase()}.`,
        });
        res.status(201).json({ school: created });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to onboard school.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.patch(
    '/api/v1/platform/schools/:targetSchoolId',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { targetSchoolId } = req.params;
        const updated = await updateSchoolSubscription(targetSchoolId, req.body);
        if (!updated) {
          return res.status(404).json({ error: 'School tenant not found.' });
        }
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: 'super_admin',
          schoolId: updated.id,
          action: 'LICENSE_UPDATED',
          details: `Updated ${updated.name}: status=${updated.subscriptionStatus}, plan=${updated.plan}, expires=${updated.licenseExpiresAt.slice(0, 10)}.`,
        });
        res.json({ school: updated });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update school.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/platform/schools/:targetSchoolId',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { targetSchoolId } = req.params;
        const deleted = await deleteSchoolTenant(targetSchoolId);
        if (!deleted) {
          return res.status(404).json({ error: 'School tenant not found.' });
        }
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: 'super_admin',
          schoolId: null,
          action: 'SCHOOL_DELETED',
          details: `Permanently deleted school "${deleted.name}" (${deleted.subdomain}.schuleflow.ug, Reg: ${deleted.ministryRegNo}) and all associated tenant records.`,
        });
        res.json({ ok: true, deleted });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete school.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    '/api/v1/platform/audit-logs',
    requireAuth,
    requireSuperAdmin,
    async (_req: AuthRequest, res) => {
      try {
        const logs = await listPlatformAuditLogs(80);
        res.json({ logs });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load audit logs.';
        res.status(500).json({ error: message });
      }
    }
  );

  /* ------------------------------------------------------------------------ */
  /* Tenant-Scoped Operational Routes (/api/v1/schools/:schoolId/...)         */
  /* ------------------------------------------------------------------------ */
  app.get(
    '/api/v1/schools/:schoolId/bootstrap',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'class_teacher', 'teacher', 'bursar', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const tenantDb = await getTenantDatabase(schoolId);
        res.json({
          school: req.school,
          db: tenantDb,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to load school workspace.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/students',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const payload = req.body as { students?: StudentProfile[]; student?: StudentProfile };
        const items = payload.students ?? (payload.student ? [payload.student] : []);
        const saved = await addStudentsWithQuotaCheck(schoolId, items);
        res.status(201).json({ students: saved });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to register student(s).';
        const status = message.includes('quota') ? 402 : 500;
        res.status(status).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/students/:studentId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher', 'bursar'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const stu = req.body as StudentProfile;
        const updated = await updateTenantStudent(schoolId, {
          ...stu,
          id: req.params.studentId,
        });
        res.json({ student: updated });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update student.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/students/promote',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const { studentIds, targetClassId } = req.body as {
          studentIds: string[];
          targetClassId: string;
        };
        await bulkPromoteTenantStudents(schoolId, studentIds ?? [], targetClassId);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to promote students.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/classes',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const { cls, attachToExamId } = req.body as {
          cls: StreamClass;
          attachToExamId?: string;
        };
        await upsertTenantClass(schoolId, cls, attachToExamId);
        res.json({ cls });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save class.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/subjects',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const sub = req.body as SubjectDefinition;
        await upsertTenantSubject(schoolId, sub);
        res.json({ subject: sub });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save subject.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/combinations',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos'),
    async (req: AuthRequest, res) => {
      try {
        const schoolId = req.schoolId!;
        const combo = req.body as SubjectCombination;
        await upsertTenantCombination(schoolId, combo);
        res.json({ combination: combo });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save combination.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/schools/:schoolId/combinations/:comboId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos'),
    async (req: AuthRequest, res) => {
      try {
        await deleteTenantCombination(req.schoolId!, req.params.comboId);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete combination.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/examinations',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const ex = req.body as ExaminationPeriod;
        await upsertTenantExam(req.schoolId!, ex);
        res.json({ exam: ex });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save examination.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/marksheets',
    requireAuth,
    requireTenantScope,
    requireRoles('teacher', 'class_teacher', 'dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const ms = req.body as MarksheetRecord;
        await upsertTenantMarksheet(req.schoolId!, ms);
        res.json({ marksheet: ms });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save marksheet.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/examinations/:examId/publish',
    requireAuth,
    requireTenantScope,
    requireRoles('dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const dbUser = req.dbUser!;
        await publishAllApprovedTenantMarksheets(req.schoolId!, req.params.examId, {
          id: dbUser.uid,
          name: dbUser.name,
          role: dbUser.schoolRole,
        });
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to publish exam.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/remarks',
    requireAuth,
    requireTenantScope,
    requireRoles('class_teacher', 'dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const { examId, studentId, field, value } = req.body as {
          examId: string;
          studentId: string;
          field: keyof StudentTermRemarks;
          value: string;
        };
        await upsertTenantStudentRemark(req.schoolId!, examId, studentId, field, value);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save remark.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/settings',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const updatedSettings = req.body as SchoolSettings;
        const schoolBranding = await updateTenantSettingsAndGrading(
          req.schoolId!,
          updatedSettings
        );
        res.json({ settings: updatedSettings, schoolBranding });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save settings.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/staff',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const staff = req.body as UserAccount;
        const saved = await upsertTenantStaffMember(req.schoolId!, staff);
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: req.dbUser!.schoolRole,
          schoolId: req.schoolId!,
          action: 'STAFF_ACCOUNT_SAVED',
          details: `Saved staff user ${saved.email} (${saved.staffId ?? saved.id}, ${saved.role}) within ${req.school?.name ?? req.schoolId}.`,
        });
        res.json({ staff: saved });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save staff account.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/staff/bulk',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const { staff } = req.body as { staff: UserAccount[] };
        const saved = await bulkUpsertTenantStaff(req.schoolId!, staff ?? []);
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: req.dbUser!.schoolRole,
          schoolId: req.schoolId!,
          action: 'STAFF_BULK_IMPORTED',
          details: `Imported ${saved.length} staff user(s) into ${req.school?.name ?? req.schoolId}.`,
        });
        res.status(201).json({
          staff: saved.map((s) => ({ ...s, password: '********' })),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to import staff accounts.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/reports/track',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'class_teacher', 'teacher', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const { count } = req.body as { count: number };
        await incrementTenantReportsGenerated(req.schoolId!, Number(count) || 1);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update report count.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/billing/invoices',
    requireAuth,
    requireTenantScope,
    (_req: AuthRequest, res) => {
      res.status(403).json({
        error: 'Only the Platform Super Admin can manage school subscription packages and licensing.',
      });
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/billing/invoices/:invoiceId/pay',
    requireAuth,
    requireTenantScope,
    (_req: AuthRequest, res) => {
      res.status(403).json({
        error: 'Only the Platform Super Admin can manage school subscription packages and licensing.',
      });
    }
  );

  // Subscription Portal Route (View-only for schools, accessible even when subscription is expired)
  app.get(
    '/api/v1/schools/:schoolId/subscription',
    requireAuth,
    requireTenantScopeWithOptions({ allowExpired: true }),
    requireRoles('school_admin', 'dos', 'class_teacher', 'teacher', 'bursar', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const overview = await getSchoolSubscriptionOverview(req.schoolId!);
        res.json({
          school: req.school,
          activeStudentsCount: overview.activeStudentsCount,
          invoices: overview.invoices,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to load subscription portal.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/subscription/subscribe',
    requireAuth,
    requireTenantScopeWithOptions({ allowExpired: true }),
    (_req: AuthRequest, res) => {
      res.status(403).json({
        error: 'Only the Platform Super Admin can change or renew school subscription packages.',
      });
    }
  );

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

/* ------------------------------------------------------------------------ */
/* Server Startup (Local Dev & Cloud Run — Skipped on Netlify / Vercel)     */
/* ------------------------------------------------------------------------ */
function resolveRealPath(target: string): string {
  try {
    return fs.realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

const currentFilePath =
  typeof import.meta !== 'undefined' && import.meta.url
    ? resolveRealPath(fileURLToPath(import.meta.url))
    : '';
const entryFilePath = process.argv[1] ? resolveRealPath(process.argv[1]) : '';
const isDirectExecution = Boolean(
  currentFilePath && entryFilePath && currentFilePath === entryFilePath
);
const isServerlessRuntime = Boolean(process.env.NETLIFY || process.env.VERCEL);

async function startServer() {
  if (isServerlessRuntime || !isDirectExecution) {
    return;
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const currentDir = currentFilePath ? path.dirname(currentFilePath) : process.cwd();
    const distPath = path.resolve(currentDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SchuleFlow multi-tenant server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!isServerlessRuntime && isDirectExecution) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}

export default app;

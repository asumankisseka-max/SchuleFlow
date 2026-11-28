import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConflictError,
  PermissionError,
  ValidationAppError,
  addStudentsWithQuotaCheck,
  approveMarksheetCorrectionRequest,
  archiveOrDeleteTenantClass,
  archiveOrDeleteTenantExam,
  archiveOrDeleteTenantSubject,
  bulkPromoteTenantStudents,
  bulkUpsertTenantStaff,
  createMarksheetCorrectionRequest,
  deleteSchoolTenant,
  deleteTenantCombination,
  deleteTenantStudent,
  generateTermlyInvoiceForSchool,
  getSchoolMediaStorageSummary,
  getSchoolSubscriptionOverview,
  getTenantDatabase,
  incrementTenantReportsGenerated,
  listAllSchoolsWithStats,
  listPlatformAuditLogs,
  migrateSchoolMediaToSupabase,
  publishAllApprovedTenantMarksheets,
  queryTenantMarksheetsFiltered,
  queryTenantStudentsPaginated,
  recordAuditLog,
  rejectMarksheetCorrectionRequest,
  resetTenantStaffPasswordByAdmin,
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
  resetCloudDatabaseToPreviewBaseline,
  type OnboardSchoolInput,
} from './src/db/seed.ts';
import {
  AuthValidationError,
  authenticateWithCredentials,
  changeAuthenticatedUserPassword,
  lookupRecoverableAccount,
  lookupSchoolByCode,
  resetPasswordWithRecoveryToken,
  verifyRecoveryIdentity,
} from './src/db/users.ts';
import { signSessionToken, verifyRecoveryToken, verifySessionToken } from './src/lib/passwordAuth.ts';
import { uploadMediaToSupabase } from './src/lib/supabaseStorage.ts';
import {
  bulkStaffSchema,
  changePasswordSchema,
  combinationSchema,
  correctionRequestCreateSchema,
  correctionRequestReviewSchema,
  createStudentsBodySchema,
  examSchema,
  loginSchema,
  marksheetSchema,
  mediaUploadSchema,
  onboardSchoolSchema,
  parseWithSchema,
  promoteStudentsSchema,
  recoveryLookupSchema,
  recoveryRequestAdminSchema,
  recoveryResetPasswordSchema,
  recoveryVerifySchema,
  remarkSchema,
  schoolSettingsSchema,
  staffSchema,
  streamClassPayloadSchema,
  studentProfileSchema,
  subjectSchema,
  trackReportsSchema,
  updateSchoolSubscriptionSchema,
} from './src/lib/validationSchemas.ts';
import {
  SESSION_COOKIE_NAME,
  checkSchoolSubscriptionGate,
  extractSessionToken,
  requireAuth,
  requireRoles,
  requireSuperAdmin,
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  apiMutationRateLimiter,
  loginRateLimiter,
  lookupRateLimiter,
  recoveryRateLimiter,
} from './src/middleware/rateLimit.ts';
import { revokeUserSessionsByUid } from './src/db/users.ts';
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
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
} from './src/types.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

function isSecureRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const fwdProto = req.headers['x-forwarded-proto'];
  if (typeof fwdProto === 'string' && fwdProto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  const host = (req.hostname || '').toLowerCase();
  return process.env.NODE_ENV === 'production' && host !== 'localhost' && host !== '127.0.0.1';
}

function getSessionCookieOptions(req: express.Request, maxAge?: number) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    secure,
    ...(secure ? { partitioned: true } : {}),
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

// Security Headers Middleware (safe for AI Studio iframe & Cloud Run preview domains)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

// Origin / CSRF Defense Middleware on /api/v1/* state-changing requests
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api/v1', apiMutationRateLimiter, (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const expectedHost = (
    (typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : '') ||
    req.headers.host ||
    ''
  ).toLowerCase();

  const configuredOrigin = process.env.CORS_ORIGIN?.trim().toLowerCase();
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';

  const isAllowedOrigin = (rawOrigin: string): boolean => {
    try {
      const parsed = new URL(rawOrigin);
      if (configuredOrigin && parsed.origin.toLowerCase() === configuredOrigin) {
        return true;
      }
      return Boolean(expectedHost && parsed.host.toLowerCase() === expectedHost);
    } catch {
      return false;
    }
  };

  if (originHeader && originHeader !== 'null') {
    if (!isAllowedOrigin(originHeader)) {
      return res.status(403).json({
        error: 'Forbidden: Cross-origin state-changing request rejected.',
      });
    }
  } else if (originHeader === 'null') {
    return res.status(403).json({
      error: 'Forbidden: Untrusted null origin rejected.',
    });
  }

  // If authenticated via cookie without Bearer token and without trusted custom header, require matching Origin/Referer
  const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
  const hasCookie = Boolean(req.headers.cookie?.includes(`${SESSION_COOKIE_NAME}=`));
  const hasCustomClientHeader = req.headers['x-requested-with'] === 'SchuleFlow-Client';
  if (hasCookie && !hasBearer && !hasCustomClientHeader && !originHeader) {
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';
    if (!referer || !isAllowedOrigin(referer)) {
      return res.status(403).json({
        error: 'Forbidden: Missing CSRF verification header or trusted origin.',
      });
    }
  }

  next();
});

  /* ------------------------------------------------------------------------ */
  /* Auth & Session Context Routes (Pure PostgreSQL + HttpOnly Cookie/Bearer) */
  /* ------------------------------------------------------------------------ */
  app.get('/api/v1/auth/school-lookup', lookupRateLimiter, async (req, res) => {
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

  app.post('/api/v1/auth/login', loginRateLimiter, async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();

      const parsed = parseWithSchema(loginSchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      const { schoolCode, identifier, password } = parsed.data;

      const dbUser = await authenticateWithCredentials({
        schoolCode: schoolCode?.trim() ? schoolCode : undefined,
        identifier,
        password,
      });

      if (!dbUser) {
        return res.status(401).json({
          error: 'Invalid login credentials. Check your ID/email and password.',
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

      res.cookie(
        SESSION_COOKIE_NAME,
        token,
        getSessionCookieOptions(req, 7 * 24 * 60 * 60 * 1000)
      );

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
        return res.status(error.status).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      const message = error instanceof Error ? error.message : 'Login failed.';
      const status = message.includes('deactivated') ? 403 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/v1/auth/logout', async (req, res) => {
    const token = extractSessionToken(req);
    if (token) {
      const session = verifySessionToken(token);
      if (session?.uid) {
        await revokeUserSessionsByUid(session.uid);
      }
    }
    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
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

  app.post('/api/v1/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = parseWithSchema(changePasswordSchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      const dbUser = req.dbUser!;
      const updatedUser = await changeAuthenticatedUserPassword({
        uid: dbUser.uid,
        email: dbUser.email,
        schoolId: dbUser.globalRole === 'super_admin' ? null : dbUser.schoolId,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      });

      const refreshedToken = signSessionToken({
        userId: updatedUser.userId,
        uid: updatedUser.uid,
        staffId: updatedUser.staffId,
        email: updatedUser.email,
        name: updatedUser.name,
        globalRole: updatedUser.globalRole,
        schoolId: updatedUser.globalRole === 'super_admin' ? null : updatedUser.schoolId,
        role: updatedUser.schoolRole,
        schoolRole: updatedUser.schoolRole,
        iat: Math.max(Date.now(), updatedUser.sessionValidAfterMs + 1),
      });

      res.cookie(
        SESSION_COOKIE_NAME,
        refreshedToken,
        getSessionCookieOptions(req, 7 * 24 * 60 * 60 * 1000)
      );

      await recordAuditLog({
        userId: updatedUser.uid,
        userEmail: updatedUser.email,
        userRole: updatedUser.globalRole === 'super_admin' ? 'super_admin' : updatedUser.schoolRole,
        schoolId: updatedUser.globalRole === 'super_admin' ? null : updatedUser.schoolId,
        action: 'PASSWORD_CHANGED',
        details: `${updatedUser.name} updated their personal account password.`,
      });

      res.json({ token: refreshedToken, user: updatedUser });
    } catch (error: unknown) {
      if (error instanceof AuthValidationError) {
        return res.status(error.status).json({ error: error.message });
      }
      const message = error instanceof Error ? error.message : 'Failed to update password.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/lookup', recoveryRateLimiter, async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const parsed = parseWithSchema(recoveryLookupSchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const { identifier, schoolCode, fullName } = parsed.data;

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

  app.post('/api/v1/auth/recover/verify', recoveryRateLimiter, async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const parsed = parseWithSchema(recoveryVerifySchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'Verification details are required to unlock your login information.',
        });
      }
      const { recoveryToken, verification } = parsed.data;

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

  app.post('/api/v1/auth/recover/reset-password', recoveryRateLimiter, async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const parsed = parseWithSchema(recoveryResetPasswordSchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const { resetToken, newPassword } = parsed.data;

      const updated = await resetPasswordWithRecoveryToken(resetToken, newPassword);
      if (!updated) {
        return res.status(401).json({
          error: 'Recovery session expired or already used. Please restart account recovery.',
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
      const status =
        message.includes('at least') || message.includes('must include') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/v1/auth/recover/request-admin', recoveryRateLimiter, async (req, res) => {
    try {
      await ensureInitialTenantsSeeded();
      const parsed = parseWithSchema(recoveryRequestAdminSchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }
      const { recoveryToken, note } = parsed.data;
      const payload = verifyRecoveryToken(recoveryToken, 'lookup_verify');
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
        const parsed = parseWithSchema(onboardSchoolSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const body = parsed.data as OnboardSchoolInput;
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

  app.post(
    '/api/v1/platform/schools/:targetSchoolId/invoices/generate',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { targetSchoolId } = req.params;
        const invoice = await generateTermlyInvoiceForSchool(targetSchoolId);
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: 'super_admin',
          schoolId: targetSchoolId,
          action: 'TERM_INVOICE_ISSUED',
          details: `Issued ${invoice.termName} ${invoice.academicYear} invoice (${invoice.id}) for ${invoice.activeStudentsCount} active students (UGX ${invoice.totalAmountUgx.toLocaleString()}).`,
        });
        res.status(201).json({ invoice });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to generate term invoice.';
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
        const parsed = parseWithSchema(updateSchoolSubscriptionSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const { targetSchoolId } = req.params;
        const updated = await updateSchoolSubscription(targetSchoolId, parsed.data);
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

  app.post(
    '/api/v1/platform/reset-baseline',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthRequest, res) => {
      try {
        const confirmText =
          typeof req.body?.confirmText === 'string' ? req.body.confirmText.trim().toUpperCase() : '';
        if (confirmText !== 'RESET') {
          return res.status(400).json({
            error: 'Please type RESET exactly to confirm resetting the database to the preview baseline.',
          });
        }
        const result = await resetCloudDatabaseToPreviewBaseline();
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: 'super_admin',
          schoolId: result.schoolId,
          action: 'DATABASE_RESET_TO_PREVIEW_BASELINE',
          details: `Reset Cloud SQL database to clean preview baseline (${result.schoolName}, ${result.schoolCode}).`,
        });
        res.json({ ok: true, ...result });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to reset database to baseline.';
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

  app.get(
    '/api/v1/schools/:schoolId/students',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher', 'class_teacher', 'teacher', 'bursar'),
    async (req: AuthRequest, res) => {
      try {
        const result = await queryTenantStudentsPaginated(req.schoolId!, {
          page: req.query.page ? Number(req.query.page) : 1,
          limit: req.query.limit ? Number(req.query.limit) : 50,
          classId: typeof req.query.classId === 'string' ? req.query.classId : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        });
        res.json(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to query students.';
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
        const parsed = parseWithSchema(createStudentsBodySchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const items = (
          parsed.data.students ?? (parsed.data.student ? [parsed.data.student] : [])
        ) as StudentProfile[];
        const saved = await addStudentsWithQuotaCheck(schoolId, items);
        res.status(201).json({ students: saved });
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
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
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(studentProfileSchema, {
          ...(req.body as Record<string, unknown>),
          id: req.params.studentId,
        });
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const updated = await updateTenantStudent(schoolId, parsed.data as StudentProfile);
        res.json({ student: updated });
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to update student.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/schools/:schoolId/students/:studentId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        await deleteTenantStudent(req.schoolId!, req.params.studentId);
        res.json({ ok: true });
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to delete student.';
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
        const parsed = parseWithSchema(promoteStudentsSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const result = await bulkPromoteTenantStudents(schoolId, parsed.data.studentIds, {
          targetClassId: parsed.data.targetClassId,
          targetAcademicYear: parsed.data.targetAcademicYear,
          targetStatus: parsed.data.targetStatus,
          updateSchoolYear: parsed.data.updateSchoolYear,
          resetElectives: parsed.data.resetElectives,
        });
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: req.dbUser!.schoolRole,
          schoolId,
          action: 'STUDENTS_PROMOTED',
          details: `${req.dbUser!.name} promoted/updated ${result.updatedCount} student(s)${
            result.targetClassName ? ` to ${result.targetClassName}` : ''
          }${result.targetAcademicYear ? ` (${result.targetAcademicYear})` : ''}${
            result.targetStatus ? ` [status: ${result.targetStatus}]` : ''
          }.`,
        });
        res.json({ ok: true, ...result });
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to promote students.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/classes',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(streamClassPayloadSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const cls = parsed.data.cls as StreamClass;
        const savedCls = await upsertTenantClass(schoolId, cls, parsed.data.attachToExamId);
        res.json({ cls: savedCls });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save class.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/schools/:schoolId/classes/:classId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const rawMode = typeof req.query.mode === 'string' ? req.query.mode : 'delete';
        const mode =
          rawMode === 'archive' || rawMode === 'restore' ? rawMode : 'delete';
        const result = await archiveOrDeleteTenantClass(
          req.schoolId!,
          req.params.classId,
          mode
        );
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to update class.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/subjects',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(subjectSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const sub = parsed.data as SubjectDefinition;
        await upsertTenantSubject(schoolId, sub);
        res.json({ subject: sub });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to save subject.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/schools/:schoolId/subjects/:subjectId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const rawMode = typeof req.query.mode === 'string' ? req.query.mode : 'delete';
        const mode =
          rawMode === 'archive' || rawMode === 'restore' ? rawMode : 'delete';
        const result = await archiveOrDeleteTenantSubject(
          req.schoolId!,
          req.params.subjectId,
          mode
        );
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to update subject.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.put(
    '/api/v1/schools/:schoolId/combinations',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(combinationSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const schoolId = req.schoolId!;
        const combo = parsed.data as SubjectCombination;
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
    requireRoles('school_admin', 'dos', 'headteacher'),
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
        const parsed = parseWithSchema(examSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const ex = parsed.data as ExaminationPeriod;
        await upsertTenantExam(req.schoolId!, ex);
        res.json({ exam: ex });
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to save examination.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/v1/schools/:schoolId/examinations/:examId',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const rawMode = typeof req.query.mode === 'string' ? req.query.mode : 'delete';
        const mode =
          rawMode === 'archive' || rawMode === 'restore' ? rawMode : 'delete';
        const result = await archiveOrDeleteTenantExam(
          req.schoolId!,
          req.params.examId,
          mode
        );
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to update examination.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    '/api/v1/schools/:schoolId/marksheets',
    requireAuth,
    requireTenantScope,
    requireRoles('teacher', 'class_teacher', 'dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const result = await queryTenantMarksheetsFiltered(req.schoolId!, {
          examId: typeof req.query.examId === 'string' ? req.query.examId : undefined,
          classId: typeof req.query.classId === 'string' ? req.query.classId : undefined,
          subjectId: typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          page: req.query.page ? Number(req.query.page) : 1,
          limit: req.query.limit ? Number(req.query.limit) : 100,
        });
        res.json(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load marksheets.';
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
        const parsed = parseWithSchema(marksheetSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const dbUser = req.dbUser!;
        const saved = await upsertTenantMarksheet(
          req.schoolId!,
          parsed.data as MarksheetRecord,
          {
            uid: dbUser.uid,
            email: dbUser.email,
            staffId: dbUser.staffId,
            name: dbUser.name,
            role: dbUser.schoolRole,
          }
        );
        res.json({ marksheet: saved });
      } catch (error: unknown) {
        if (
          error instanceof ConflictError ||
          error instanceof PermissionError ||
          error instanceof ValidationAppError
        ) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to save marksheet.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/marksheets/correction-requests',
    requireAuth,
    requireTenantScope,
    requireRoles('teacher', 'class_teacher', 'dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(correctionRequestCreateSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const dbUser = req.dbUser!;
        const result = await createMarksheetCorrectionRequest(
          req.schoolId!,
          parsed.data,
          {
            uid: dbUser.uid,
            email: dbUser.email,
            staffId: dbUser.staffId,
            name: dbUser.name,
            role: dbUser.schoolRole,
          }
        );
        await recordAuditLog({
          userId: dbUser.uid,
          userEmail: dbUser.email,
          userRole: dbUser.schoolRole,
          schoolId: req.schoolId!,
          action: 'CORRECTION_REQUEST_SUBMITTED',
          details: `${dbUser.name} requested DOS approval to re-correct ${parsed.data.classId} / ${parsed.data.subjectId} (${parsed.data.assessmentScope}): ${parsed.data.reason}`,
        });
        res.status(201).json(result);
      } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : 'Failed to submit correction request.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/correction-requests/:requestId/approve',
    requireAuth,
    requireTenantScope,
    requireRoles('dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(correctionRequestReviewSchema, req.body ?? {});
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const dbUser = req.dbUser!;
        const result = await approveMarksheetCorrectionRequest(
          req.schoolId!,
          req.params.requestId,
          {
            uid: dbUser.uid,
            email: dbUser.email,
            staffId: dbUser.staffId,
            name: dbUser.name,
            role: dbUser.schoolRole,
          },
          parsed.data.reviewNote
        );
        await recordAuditLog({
          userId: dbUser.uid,
          userEmail: dbUser.email,
          userRole: dbUser.schoolRole,
          schoolId: req.schoolId!,
          action: 'CORRECTION_REQUEST_APPROVED',
          details: `${dbUser.name} approved correction request ${req.params.requestId} for ${result.request.requestedByName}. Marksheet unlocked for resubmission.`,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : 'Failed to approve correction request.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/correction-requests/:requestId/reject',
    requireAuth,
    requireTenantScope,
    requireRoles('dos', 'headteacher', 'school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(correctionRequestReviewSchema, req.body ?? {});
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const dbUser = req.dbUser!;
        const result = await rejectMarksheetCorrectionRequest(
          req.schoolId!,
          req.params.requestId,
          {
            uid: dbUser.uid,
            email: dbUser.email,
            staffId: dbUser.staffId,
            name: dbUser.name,
            role: dbUser.schoolRole,
          },
          parsed.data.reviewNote
        );
        await recordAuditLog({
          userId: dbUser.uid,
          userEmail: dbUser.email,
          userRole: dbUser.schoolRole,
          schoolId: req.schoolId!,
          action: 'CORRECTION_REQUEST_DECLINED',
          details: `${dbUser.name} declined correction request ${req.params.requestId} for ${result.request.requestedByName}.`,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : 'Failed to decline correction request.';
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
        const parsed = parseWithSchema(remarkSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const dbUser = req.dbUser!;
        await upsertTenantStudentRemark(
          req.schoolId!,
          parsed.data.examId,
          parsed.data.studentId,
          parsed.data.field,
          parsed.data.value,
          {
            uid: dbUser.uid,
            email: dbUser.email,
            staffId: dbUser.staffId,
            role: dbUser.schoolRole,
          }
        );
        res.json({ ok: true });
      } catch (error: unknown) {
        if (error instanceof PermissionError || error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
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
        const parsed = parseWithSchema(schoolSettingsSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const updatedSettings = parsed.data as SchoolSettings;
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
        const parsed = parseWithSchema(staffSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const saved = await upsertTenantStaffMember(
          req.schoolId!,
          parsed.data as UserAccount
        );
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
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
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
        const parsed = parseWithSchema(bulkStaffSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const saved = await bulkUpsertTenantStaff(
          req.schoolId!,
          parsed.data.staff as UserAccount[]
        );
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
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to import staff accounts.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/staff/:staffRowId/reset-password',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin'),
    async (req: AuthRequest, res) => {
      try {
        const { temporaryPassword } = (req.body ?? {}) as { temporaryPassword?: string };
        const result = await resetTenantStaffPasswordByAdmin(
          req.schoolId!,
          req.params.staffRowId,
          temporaryPassword
        );
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: req.dbUser!.schoolRole,
          schoolId: req.schoolId!,
          action: 'STAFF_PASSWORD_ADMIN_RESET',
          details: `Administrator reset password for ${result.name} (${result.staffId ?? result.email}). Password change forced on next sign-in.`,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : 'Failed to reset staff password.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    '/api/v1/schools/:schoolId/media/status',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher', 'class_teacher', 'teacher'),
    async (req: AuthRequest, res) => {
      try {
        const summary = await getSchoolMediaStorageSummary(req.schoolId!);
        res.json(summary);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to inspect media storage status.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/media/upload',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher', 'class_teacher', 'teacher'),
    async (req: AuthRequest, res) => {
      try {
        const parsed = parseWithSchema(mediaUploadSchema, req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        const uploaded = await uploadMediaToSupabase({
          schoolId: req.schoolId!,
          folder: parsed.data.folder,
          entityId: parsed.data.entityId,
          dataUrl: parsed.data.dataUrl,
        });
        res.status(201).json(uploaded);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to upload media file.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/v1/schools/:schoolId/media/migrate',
    requireAuth,
    requireTenantScope,
    requireRoles('school_admin', 'dos', 'headteacher'),
    async (req: AuthRequest, res) => {
      try {
        const result = await migrateSchoolMediaToSupabase(req.schoolId!);
        await recordAuditLog({
          userId: req.dbUser!.uid,
          userEmail: req.dbUser!.email,
          userRole: req.dbUser!.schoolRole,
          schoolId: req.schoolId!,
          action: 'MEDIA_MIGRATED_TO_SUPABASE',
          details: `Migrated ${result.migratedLogos} logo(s) and ${result.migratedPhotos} student photo(s) to Supabase Storage.`,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof ValidationAppError) {
          return res.status(error.status).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : 'Failed to migrate school media.';
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
        const parsed = parseWithSchema(trackReportsSchema, req.body ?? {});
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        await incrementTenantReportsGenerated(req.schoolId!, parsed.data.count);
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

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
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

  await ensureInitialTenantsSeeded().catch((err) => {
    console.error('Startup database seed warning:', err);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
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

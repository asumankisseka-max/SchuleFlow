import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import app from '../server.ts';
import { closeDbPool, db } from '../src/db/index.ts';
import { deleteSchoolTenant } from '../src/db/repository.ts';
import { users } from '../src/db/schema.ts';
import { ensureInitialTenantsSeeded, provisionNewSchoolTenant } from '../src/db/seed.ts';
import { hashPassword } from '../src/lib/passwordAuth.ts';
import {
  isSupabaseStorageConfigured,
  uploadMediaToSupabase,
} from '../src/lib/supabaseStorage.ts';

process.env.TEST_MODE = 'true';
process.env.DISABLE_RATE_LIMIT = 'true';

let server: http.Server;
let baseUrl = '';
const createdSchoolIds: string[] = [];

async function apiJson<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

describe('Multi-Tenant Security, RBAC, Optimistic Locking & Archival API Integration', () => {
  let schoolAId = '';
  let schoolACode = '';
  let schoolBId = '';
  let schoolBCode = '';
  let adminAToken = '';
  let adminAEmail = '';
  let teacherAToken = '';
  let teacherAId = '';
  let teacherAStaffId = '';
  let superAdminEmail = '';
  let superAdminUid = '';
  let stamp = '';
  let examAId = '';
  let classAId = '';
  let subjectAId = '';
  let unassignedSubjectAId = '';

  before(async () => {
    await ensureInitialTenantsSeeded();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    stamp = Date.now().toString(36);
    superAdminEmail = `test-superadmin-${stamp}@schuleflow.ug`;
    superAdminUid = `test:superadmin:${stamp}`;
    await db.insert(users).values({
      uid: superAdminUid,
      staffId: null,
      email: superAdminEmail,
      username: `sa_${stamp}`,
      passwordHash: hashPassword('SuperAdminPass2026!'),
      name: 'Test Super Admin',
      globalRole: 'super_admin',
      schoolId: null,
      schoolRole: 'school_admin',
      active: true,
    });

    const schoolA = await provisionNewSchoolTenant({
      name: `Test Horizon Academy ${stamp}`,
      subdomain: `tha-${stamp}`,
      motto: 'Integrity First',
      district: 'Kampala',
      region: 'Central',
      address: 'Kampala',
      phone: '+256 772 111222',
      email: `info-${stamp}@tha.ac.ug`,
      principalName: 'Headteacher A',
      dosName: 'DOS A',
      adminName: 'Admin Alpha',
      adminEmail: `admin-${stamp}@tha.ac.ug`,
      adminPhone: '+256 772 333444',
      adminPassword: 'AlphaPass2026!',
      plan: 'standard',
      curriculumScope: 'olevel_only',
      status: 'active',
      academicYear: '2026',
      termName: 'Term III',
    });
    createdSchoolIds.push(schoolA.id);
    schoolAId = schoolA.id;
    schoolACode = schoolA.schoolCode;
    adminAEmail = `admin-${stamp}@tha.ac.ug`;

    const schoolB = await provisionNewSchoolTenant({
      name: `Test Nile College ${stamp}`,
      subdomain: `tnc-${stamp}`,
      motto: 'Knowledge Power',
      district: 'Jinja',
      region: 'Eastern',
      address: 'Jinja',
      phone: '+256 772 555666',
      email: `info-${stamp}@tnc.ac.ug`,
      principalName: 'Headteacher B',
      dosName: 'DOS B',
      adminName: 'Admin Beta',
      adminEmail: `admin-${stamp}@tnc.ac.ug`,
      adminPhone: '+256 772 777888',
      adminPassword: 'BetaPass2026!',
      plan: 'standard',
      curriculumScope: 'olevel_only',
      status: 'active',
      academicYear: '2026',
      termName: 'Term III',
    });
    createdSchoolIds.push(schoolB.id);
    schoolBId = schoolB.id;
    schoolBCode = schoolB.schoolCode;

    // Login Admin A with single-flow identifier + password (no schoolCode or mode required)
    const loginRes = await apiJson<{ token: string; user: { uid: string; schoolId: string | null } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: {
          identifier: adminAEmail,
          password: 'AlphaPass2026!',
        },
      }
    );
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.schoolId, schoolAId);
    adminAToken = loginRes.data.token;

    // Bootstrap School A to obtain seeded IDs
    const bootRes = await apiJson<{
      db: {
        exams: Array<{ id: string }>;
        classes: Array<{ id: string }>;
        subjects: Array<{ id: string }>;
      };
    }>(`/api/v1/schools/${schoolAId}/bootstrap`, { token: adminAToken });
    assert.equal(bootRes.status, 200);
    examAId = bootRes.data.db.exams[0].id;
    classAId = bootRes.data.db.classes[0].id;
    subjectAId = bootRes.data.db.subjects[0].id;
    unassignedSubjectAId = bootRes.data.db.subjects[1].id;

    // Create Teacher A assigned only to classAId & subjectAId
    teacherAId = `${schoolAId}:usr-tch-test`;
    const staffSave = await apiJson<{ staff: { staffId: string; id: string } }>(
      `/api/v1/schools/${schoolAId}/staff`,
      {
        method: 'PUT',
        token: adminAToken,
        body: {
          id: teacherAId,
          name: 'Teacher Test',
          email: `teacher-${stamp}@tha.ac.ug`,
          username: `t_${stamp}`,
          password: 'TeacherPass2026!',
          role: 'teacher',
          active: true,
          phone: '+256 772 909090',
          assignedClassIds: [classAId],
          assignedSubjectIds: [subjectAId],
        },
      }
    );
    assert.equal(staffSave.status, 200);
    teacherAStaffId = staffSave.data.staff.staffId;
    assert.ok(teacherAStaffId.length > 0 && teacherAStaffId.length < 4);

    // Attempting to sign in with bare short numeric ID without School ID requires School ID (409)
    const bareShortLogin = await apiJson<{ code?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: teacherAStaffId,
        password: 'TeacherPass2026!',
      },
    });
    assert.equal(bareShortLogin.status, 409);
    assert.equal(bareShortLogin.data.code, 'SCHOOL_CODE_REQUIRED');

    // Login Teacher A using School ID + short Staff ID (both padded '005' and unpadded '5')
    const shortUnpaddedLogin = await apiJson<{ token: string; user: { schoolId: string | null } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: {
          schoolCode: schoolACode,
          identifier: String(Number(teacherAStaffId)),
          password: 'TeacherPass2026!',
        },
      }
    );
    assert.equal(shortUnpaddedLogin.status, 200);
    assert.equal(shortUnpaddedLogin.data.user.schoolId, schoolAId);

    const teacherLogin = await apiJson<{ token: string; user: { schoolId: string | null } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: {
          schoolCode: schoolACode,
          identifier: teacherAStaffId,
          password: 'TeacherPass2026!',
        },
      }
    );
    assert.equal(teacherLogin.status, 200);
    assert.equal(teacherLogin.data.user.schoolId, schoolAId);
    teacherAToken = teacherLogin.data.token;
  });

  after(async () => {
    if (superAdminUid) {
      await db.delete(users).where(eq(users.uid, superAdminUid)).catch(() => {});
    }
    for (const sid of createdSchoolIds) {
      await deleteSchoolTenant(sid).catch(() => {});
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await closeDbPool();
  });

  it('enforces strict cross-tenant isolation (School A cannot read School B)', async () => {
    const crossBoot = await apiJson(`/api/v1/schools/${schoolBId}/bootstrap`, {
      token: adminAToken,
    });
    assert.equal(crossBoot.status, 403);

    const crossStudents = await apiJson(`/api/v1/schools/${schoolBId}/students`, {
      token: adminAToken,
    });
    assert.equal(crossStudents.status, 403);
  });

  it('supports streamless classes, archiving/restoring, and safe delete', async () => {
    const streamlessId = `${schoolAId}:cls-nostream`;
    const createCls = await apiJson<{ cls: { id: string; name: string; stream?: string } }>(
      `/api/v1/schools/${schoolAId}/classes`,
      {
        method: 'PUT',
        token: adminAToken,
        body: {
          cls: {
            id: streamlessId,
            gradeLevel: 'S.3',
            level: 'olevel',
            classTeacherId: '',
            subjectIds: [subjectAId],
            subjectTeacherMap: {},
          },
        },
      }
    );
    assert.equal(createCls.status, 200);
    assert.equal(createCls.data.cls.name, 'S.3');

    const archiveRes = await apiJson<{ archived: boolean }>(
      `/api/v1/schools/${schoolAId}/classes/${encodeURIComponent(streamlessId)}?mode=archive`,
      { method: 'DELETE', token: adminAToken }
    );
    assert.equal(archiveRes.status, 200);
    assert.equal(archiveRes.data.archived, true);

    const restoreRes = await apiJson<{ archived: boolean }>(
      `/api/v1/schools/${schoolAId}/classes/${encodeURIComponent(streamlessId)}?mode=restore`,
      { method: 'DELETE', token: adminAToken }
    );
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.data.archived, false);

    const deleteRes = await apiJson<{ mode: string }>(
      `/api/v1/schools/${schoolAId}/classes/${encodeURIComponent(streamlessId)}?mode=delete`,
      { method: 'DELETE', token: adminAToken }
    );
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.data.mode, 'delete');
  });

  it('enforces teacher marksheet RBAC and optimistic locking (409 Conflict)', async () => {
    // Teacher cannot edit an unassigned subject
    const unassignedAttempt = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: `ms-${examAId}-${classAId}-${unassignedSubjectAId}`,
        examId: examAId,
        classId: classAId,
        subjectId: unassignedSubjectAId,
        teacherId: teacherAId,
        status: 'draft',
        entries: {},
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(unassignedAttempt.status, 403);

    // Teacher cannot self-approve a marksheet
    const selfApproveAttempt = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: `ms-${examAId}-${classAId}-${subjectAId}`,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'approved',
        entries: {},
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(selfApproveAttempt.status, 403);

    // First valid save inserts with version = 1
    const firstSave = await apiJson<{ marksheet: { version: number } }>(
      `/api/v1/schools/${schoolAId}/marksheets`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {
          id: `ms-${examAId}-${classAId}-${subjectAId}`,
          examId: examAId,
          classId: classAId,
          subjectId: subjectAId,
          teacherId: teacherAId,
          status: 'draft',
          entries: {},
          lastModified: new Date().toISOString(),
          auditHistory: [],
        },
      }
    );
    assert.equal(firstSave.status, 200);
    assert.equal(firstSave.data.marksheet.version, 1);

    // Second valid save with version = 1 increments to version = 2
    const secondSave = await apiJson<{ marksheet: { version: number } }>(
      `/api/v1/schools/${schoolAId}/marksheets`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {
          id: `ms-${examAId}-${classAId}-${subjectAId}`,
          examId: examAId,
          classId: classAId,
          subjectId: subjectAId,
          teacherId: teacherAId,
          status: 'draft',
          version: 1,
          entries: {},
          lastModified: new Date().toISOString(),
          auditHistory: [],
        },
      }
    );
    assert.equal(secondSave.status, 200);
    assert.equal(secondSave.data.marksheet.version, 2);

    // Submitting stale version: 1 fails with 409 Conflict
    const staleSave = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: adminAToken,
      body: {
        id: `ms-${examAId}-${classAId}-${subjectAId}`,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'draft',
        version: 1,
        entries: {},
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(staleSave.status, 409);
  });

  it('forces mandatory password change after admin temporary password reset', async () => {
    const resetRes = await apiJson<{ temporaryPassword: string; staffId: string }>(
      `/api/v1/schools/${schoolAId}/staff/${encodeURIComponent(teacherAId)}/reset-password`,
      {
        method: 'POST',
        token: adminAToken,
        body: {},
      }
    );
    assert.equal(resetRes.status, 200);
    assert.ok(resetRes.data.temporaryPassword.length >= 8);

    // Sign in with temporary password -> mustChangePassword should be true
    const tempLogin = await apiJson<{
      token: string;
      user: { mustChangePassword?: boolean };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        schoolCode: schoolACode,
        identifier: resetRes.data.staffId,
        password: resetRes.data.temporaryPassword,
        mode: 'school',
      },
    });
    assert.equal(tempLogin.status, 200);
    assert.equal(tempLogin.data.user.mustChangePassword, true);

    // Complete mandatory password change
    const changeRes = await apiJson<{
      token: string;
      user: { mustChangePassword?: boolean };
    }>('/api/v1/auth/change-password', {
      method: 'POST',
      token: tempLogin.data.token,
      body: {
        currentPassword: resetRes.data.temporaryPassword,
        newPassword: 'NewPersonalPass2026!',
      },
    });
    assert.equal(changeRes.status, 200);
    assert.ok(changeRes.data.token);
    assert.equal(changeRes.data.user.mustChangePassword, false);

    // Verify new password signs in cleanly without mustChangePassword flag (and update teacherAToken since reset revoked prior sessions)
    const finalLogin = await apiJson<{ token: string; user: { mustChangePassword?: boolean } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: {
          schoolCode: schoolACode,
          identifier: resetRes.data.staffId,
          password: 'NewPersonalPass2026!',
          mode: 'school',
        },
      }
    );
    assert.equal(finalLogin.status, 200);
    assert.equal(finalLogin.data.user.mustChangePassword, false);
    teacherAToken = finalLogin.data.token;
  });

  it('exposes Supabase media storage status & upload fallback endpoint', async () => {
    const statusRes = await apiJson<{ configured: boolean; bucket: string }>(
      `/api/v1/schools/${schoolAId}/media/status`,
      { token: adminAToken }
    );
    assert.equal(statusRes.status, 200);
    assert.equal(typeof statusRes.data.bucket, 'string');

    const samplePngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const uploadRes = await apiJson<{ url: string; storage: string }>(
      `/api/v1/schools/${schoolAId}/media/upload`,
      {
        method: 'POST',
        token: adminAToken,
        body: {
          folder: 'logos',
          entityId: 'school-logo',
          dataUrl: samplePngDataUrl,
        },
      }
    );
    assert.equal(uploadRes.status, 201);
    assert.ok(uploadRes.data.url.length > 10);

    // Verify interactive upload gracefully falls back to inline storage on Supabase RLS rejection
    const mockRlsClient = {
      storage: {
        listBuckets: async () => ({ data: [{ name: 'schuleflow-media' }], error: null }),
        createBucket: async () => ({ error: null }),
        from: () => ({
          upload: async () => ({
            data: null,
            error: { message: 'new row violates row-level security policy' },
          }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
        }),
      },
    } as unknown as Parameters<typeof uploadMediaToSupabase>[0]['supabaseClientOverride'];

    const rlsFallback = await uploadMediaToSupabase({
      schoolId: schoolAId,
      folder: 'logos',
      entityId: 'school-logo',
      dataUrl: samplePngDataUrl,
      supabaseClientOverride: mockRlsClient,
    });
    assert.equal(rlsFallback.storage, 'inline');
    assert.equal(rlsFallback.url, samplePngDataUrl);

    await assert.rejects(
      () =>
        uploadMediaToSupabase({
          schoolId: schoolAId,
          folder: 'logos',
          entityId: 'school-logo',
          dataUrl: samplePngDataUrl,
          strictSupabase: true,
          supabaseClientOverride: mockRlsClient,
        }),
      /Row-Level Security \(RLS\)/i
    );

    // Verify anon JWT is not misclassified as configured service_role storage
    const prevSupaUrl = process.env.SUPABASE_URL;
    const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fakeAnonHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url'
    );
    const fakeAnonPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = `${fakeAnonHeader}.${fakeAnonPayload}.sig`;
    try {
      assert.equal(isSupabaseStorageConfigured().configured, false);
      const anonUpload = await apiJson<{ url: string; storage: string }>(
        `/api/v1/schools/${schoolAId}/media/upload`,
        {
          method: 'POST',
          token: adminAToken,
          body: {
            folder: 'logos',
            entityId: 'school-logo',
            dataUrl: samplePngDataUrl,
          },
        }
      );
      assert.equal(anonUpload.status, 201);
      assert.equal(anonUpload.data.storage, 'inline');
    } finally {
      if (prevSupaUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevSupaUrl;
      if (prevServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
    }
  });

  it('automatically separates Super Admin from schools via credentials and enforces strict isolation & disambiguation', async () => {
    // 1. Seeded Super Admin & test Super Admin log in using ONLY identifier + password (no mode, no schoolCode)
    const oldSaPwdRejected = await apiJson('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: 'superadmin@schuleflow.ac.ug',
        password: 'admin@schuleflow',
      },
    });
    assert.equal(oldSaPwdRejected.status, 401);

    const defaultSaLogin = await apiJson<{
      token: string;
      user: { email: string; globalRole: string; schoolId: string | null };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: 'superadmin@schuleflow.ac.ug',
        password: '#asu20man',
      },
    });
    assert.equal(defaultSaLogin.status, 200);
    assert.equal(defaultSaLogin.data.user.email, 'superadmin@schuleflow.ac.ug');
    assert.equal(defaultSaLogin.data.user.globalRole, 'super_admin');
    assert.equal(defaultSaLogin.data.user.schoolId, null);

    const saLogin = await apiJson<{
      token: string;
      user: { globalRole: string; schoolId: string | null };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: superAdminEmail,
        password: 'SuperAdminPass2026!',
      },
    });
    assert.equal(saLogin.status, 200);
    assert.equal(saLogin.data.user.globalRole, 'super_admin');
    assert.equal(saLogin.data.user.schoolId, null);

    // Super Admin can access platform endpoints, but is strictly blocked (403) from school tenant routes
    const saPlatform = await apiJson('/api/v1/platform/schools', { token: saLogin.data.token });
    assert.equal(saPlatform.status, 200);
    const saBlockedFromSchool = await apiJson(`/api/v1/schools/${schoolAId}/bootstrap`, {
      token: saLogin.data.token,
    });
    assert.equal(saBlockedFromSchool.status, 403);

    // School Admin is strictly blocked (403) from platform admin routes
    const schoolBlockedFromPlatform = await apiJson('/api/v1/platform/schools', {
      token: adminAToken,
    });
    assert.equal(schoolBlockedFromPlatform.status, 403);

    const schoolBlockedFromReset = await apiJson('/api/v1/platform/reset-baseline', {
      method: 'POST',
      token: adminAToken,
      body: { confirmText: 'RESET' },
    });
    assert.equal(schoolBlockedFromReset.status, 403);

    const invalidResetConfirm = await apiJson('/api/v1/platform/reset-baseline', {
      method: 'POST',
      token: saLogin.data.token,
      body: { confirmText: 'NOPE' },
    });
    assert.equal(invalidResetConfirm.status, 400);

    // 2. Unknown identifier & wrong password return uniform 401
    const unknownRes = await apiJson<{ error: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: `nobody-${stamp}@example.com`,
        password: 'WrongPassword123!',
      },
    });
    const wrongPwdRes = await apiJson<{ error: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: superAdminEmail,
        password: 'WrongPassword123!',
      },
    });
    assert.equal(unknownRes.status, 401);
    assert.equal(wrongPwdRes.status, 401);
    assert.equal(unknownRes.data.error, wrongPwdRes.data.error);

    // 3. Multi-school credential collision safely requires School Code disambiguation (409)
    const loginB = await apiJson<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: `admin-${stamp}@tnc.ac.ug`,
        password: 'BetaPass2026!',
      },
    });
    assert.equal(loginB.status, 200);
    const adminBToken = loginB.data.token;

    const sharedEmail = `shared-${stamp}@educator.ug`;
    const sharedPwd = 'SharedPass2026!';
    const saveSharedA = await apiJson(`/api/v1/schools/${schoolAId}/staff`, {
      method: 'PUT',
      token: adminAToken,
      body: {
        id: `${schoolAId}:usr-shared`,
        name: 'Shared Educator A',
        email: sharedEmail,
        username: `shared_a_${stamp}`,
        password: sharedPwd,
        role: 'teacher',
        active: true,
        assignedClassIds: [],
        assignedSubjectIds: [],
      },
    });
    const saveSharedB = await apiJson(`/api/v1/schools/${schoolBId}/staff`, {
      method: 'PUT',
      token: adminBToken,
      body: {
        id: `${schoolBId}:usr-shared`,
        name: 'Shared Educator B',
        email: sharedEmail,
        username: `shared_b_${stamp}`,
        password: sharedPwd,
        role: 'dos',
        active: true,
        assignedClassIds: [],
        assignedSubjectIds: [],
      },
    });
    assert.equal(saveSharedA.status, 200);
    assert.equal(saveSharedB.status, 200);

    // Without School Code -> refuses ambiguity with 409 SCHOOL_CODE_REQUIRED
    const ambiguousLogin = await apiJson<{ code?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: sharedEmail,
        password: sharedPwd,
      },
    });
    assert.equal(ambiguousLogin.status, 409);
    assert.equal(ambiguousLogin.data.code, 'SCHOOL_CODE_REQUIRED');

    // With School B's code -> signs strictly into School B
    const disambiguatedLogin = await apiJson<{
      user: { schoolId: string | null; schoolCode: string | null; schoolRole: string };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        schoolCode: schoolBCode,
        identifier: sharedEmail,
        password: sharedPwd,
      },
    });
    assert.equal(disambiguatedLogin.status, 200);
    assert.equal(disambiguatedLogin.data.user.schoolId, schoolBId);
    assert.equal(disambiguatedLogin.data.user.schoolCode, schoolBCode);
    assert.equal(disambiguatedLogin.data.user.schoolRole, 'dos');

    // 4. School staff API rejects reserving superadmin email or username
    const reservedAttempt = await apiJson(`/api/v1/schools/${schoolAId}/staff`, {
      method: 'PUT',
      token: adminAToken,
      body: {
        id: `${schoolAId}:usr-reserved`,
        name: 'Should Be Rejected',
        email: 'superadmin@schuleflow.ac.ug',
        username: 'superadmin',
        password: 'ValidPass2026!',
        role: 'teacher',
        active: true,
        assignedClassIds: [],
        assignedSubjectIds: [],
      },
    });
    assert.equal(reservedAttempt.status, 400);

    // 5. Even if a legacy database has a school_user row with the same email/password as a super_admin,
    // Super Admin login without schoolCode succeeds directly instead of returning 409 SCHOOL_CODE_REQUIRED
    const legacySchoolCollisionUid = `test:legacy-collision:${stamp}`;
    await db.insert(users).values({
      uid: legacySchoolCollisionUid,
      staffId: '998',
      email: superAdminEmail,
      username: `sa_school_${stamp}`,
      passwordHash: hashPassword('SuperAdminPass2026!'),
      name: 'Legacy Colliding Row',
      globalRole: 'school_user',
      schoolId: schoolAId,
      schoolRole: 'teacher',
      active: true,
    });
    try {
      const saDirectLogin = await apiJson<{
        user: { globalRole: string; schoolId: string | null };
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: superAdminEmail,
          password: 'SuperAdminPass2026!',
        },
      });
      assert.equal(saDirectLogin.status, 200);
      assert.equal(saDirectLogin.data.user.globalRole, 'super_admin');
      assert.equal(saDirectLogin.data.user.schoolId, null);
    } finally {
      await db.delete(users).where(eq(users.uid, legacySchoolCollisionUid));
    }
  });

  it('logs in and validates sessions in production mode without manual SESSION_SECRET env var', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevTestMode = process.env.TEST_MODE;
    const prevSessionSecret = process.env.SESSION_SECRET;

    process.env.NODE_ENV = 'production';
    delete process.env.TEST_MODE;
    delete process.env.SESSION_SECRET;

    try {
      const prodLogin = await apiJson<{
        token: string;
        user: { email: string; globalRole: string };
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: 'superadmin@schuleflow.ac.ug',
          password: '#asu20man',
        },
      });
      assert.equal(prodLogin.status, 200);
      assert.ok(prodLogin.data.token);
      assert.equal(prodLogin.data.user.globalRole, 'super_admin');

      const syncRes = await apiJson<{ user: { email: string } }>('/api/v1/auth/sync', {
        method: 'POST',
        token: prodLogin.data.token,
        body: {},
      });
      assert.equal(syncRes.status, 200);
      assert.equal(syncRes.data.user.email, 'superadmin@schuleflow.ac.ug');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevTestMode === undefined) delete process.env.TEST_MODE;
      else process.env.TEST_MODE = prevTestMode;
      if (prevSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSessionSecret;
    }
  });

  it('supports direct partial marks submission, correction requests, DOS approval unlock, resubmission, and rejection', async () => {
    // Ensure at least 2 active students offering subjectAId exist in classAId
    const seedStuRes = await apiJson<{
      students: Array<{ id: string; classId: string; offeredSubjectIds?: string[] }>;
    }>(`/api/v1/schools/${schoolAId}/students`, {
      method: 'POST',
      token: adminAToken,
      body: {
        students: [
          {
            id: `${schoolAId}:stu-corr-1`,
            admissionNo: `ADM-${stamp}-1`,
            fullName: 'Student Correction One',
            gender: 'F',
            classId: classAId,
            academicYear: '2026',
            status: 'active',
            offeredSubjectIds: [subjectAId],
          },
          {
            id: `${schoolAId}:stu-corr-2`,
            admissionNo: `ADM-${stamp}-2`,
            fullName: 'Student Correction Two',
            gender: 'M',
            classId: classAId,
            academicYear: '2026',
            status: 'active',
            offeredSubjectIds: [subjectAId],
          },
        ],
      },
    });
    assert.equal(seedStuRes.status, 201);
    assert.deepEqual(seedStuRes.data.students[0].offeredSubjectIds, [subjectAId]);

    // Load latest bootstrap state to get active students in classAId and latest marksheet version
    const bootRes = await apiJson<{
      db: {
        students: Array<{ id: string; classId: string; status: string; offeredSubjectIds?: string[] }>;
        marksheets: Array<{ id: string; examId: string; classId: string; subjectId: string; version?: number }>;
      };
    }>(`/api/v1/schools/${schoolAId}/bootstrap`, { token: teacherAToken });
    assert.equal(bootRes.status, 200);

    const classStudents = bootRes.data.db.students.filter(
      (s) => s.classId === classAId && s.status === 'active'
    );
    assert.ok(classStudents.length >= 2);
    const existingMs = bootRes.data.db.marksheets.find(
      (m) => m.examId === examAId && m.classId === classAId && m.subjectId === subjectAId
    );
    const currentVersion = existingMs?.version ?? 2;

    // 1. Teacher submits results directly even when some assessment marks are still missing
    const partialEntries: Record<string, { u1?: string; u2?: string; u3?: string; eot?: string }> = {
      [classStudents[0].id]: { u1: '84', u2: '79' },
      [classStudents[1].id]: { u1: '68' }, // Missing u2, u3, eot
    };

    const directSubmit = await apiJson<{
      marksheet: { id: string; status: string; version: number; entries: typeof partialEntries };
    }>(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: existingMs?.id ?? `ms-${examAId}-${classAId}-${subjectAId}`,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        submittedBy: teacherAId,
        version: currentVersion,
        entries: partialEntries,
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(directSubmit.status, 200);
    assert.equal(directSubmit.data.marksheet.status, 'submitted');
    assert.equal(directSubmit.data.marksheet.entries[classStudents[0].id].u1, '84');

    // 2. Teacher cannot overwrite a submitted marksheet directly without DOS approval
    const directOverwrite = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: directSubmit.data.marksheet.id,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'submitted',
        version: directSubmit.data.marksheet.version,
        entries: {
          ...partialEntries,
          [classStudents[1].id]: { u1: '68', u2: '72' },
        },
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(directOverwrite.status, 403);

    // 3. Teacher cannot request correction for an unassigned subject
    const unauthorizedReq = await apiJson(
      `/api/v1/schools/${schoolAId}/marksheets/correction-requests`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {
          examId: examAId,
          classId: classAId,
          subjectId: unassignedSubjectAId,
          assessmentScope: 'u2',
          reason: 'Should fail for unassigned subject',
        },
      }
    );
    assert.equal(unauthorizedReq.status, 403);

    // 4. Teacher submits valid correction request to DOS
    const createReq = await apiJson<{
      request: { id: string; status: string; assessmentScope: string };
      marksheet?: { version: number };
    }>(`/api/v1/schools/${schoolAId}/marksheets/correction-requests`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        marksheetId: directSubmit.data.marksheet.id,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        assessmentScope: 'u2',
        reason: 'Need to enter missing U2 score for student after illness',
      },
    });
    assert.equal(createReq.status, 201);
    assert.equal(createReq.data.request.status, 'pending');
    const reqId = createReq.data.request.id;

    // Duplicate pending request is rejected with 400
    const duplicateReq = await apiJson(
      `/api/v1/schools/${schoolAId}/marksheets/correction-requests`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {
          marksheetId: directSubmit.data.marksheet.id,
          examId: examAId,
          classId: classAId,
          subjectId: subjectAId,
          assessmentScope: 'u2',
          reason: 'Duplicate request should be rejected',
        },
      }
    );
    assert.equal(duplicateReq.status, 400);

    // 5. Teacher cannot self-approve correction request
    const selfApprove = await apiJson(
      `/api/v1/schools/${schoolAId}/correction-requests/${encodeURIComponent(reqId)}/approve`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {},
      }
    );
    assert.equal(selfApprove.status, 403);

    // 6. DOS / School Admin approves request -> marksheet immediately unlocks to 'draft'
    const dosApprove = await apiJson<{
      request: { id: string; status: string };
      marksheet?: { id: string; status: string; version: number };
    }>(
      `/api/v1/schools/${schoolAId}/correction-requests/${encodeURIComponent(reqId)}/approve`,
      {
        method: 'POST',
        token: adminAToken,
        body: { reviewNote: 'Approved to fill missing U2 score.' },
      }
    );
    assert.equal(dosApprove.status, 200);
    assert.equal(dosApprove.data.request.status, 'approved');
    assert.equal(dosApprove.data.marksheet?.status, 'draft');

    // 7. Teacher re-edits and resubmits the unlocked marksheet -> request transitions to 'completed'
    const resubmit = await apiJson<{
      marksheet: { status: string; version: number; entries: Record<string, { u1?: string; u2?: string }> };
    }>(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: directSubmit.data.marksheet.id,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        submittedBy: teacherAId,
        version: dosApprove.data.marksheet!.version,
        entries: {
          ...partialEntries,
          [classStudents[1].id]: { u1: '68', u2: '75' },
        },
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(resubmit.status, 200);
    assert.equal(resubmit.data.marksheet.status, 'submitted');
    assert.equal(resubmit.data.marksheet.entries[classStudents[1].id].u2, '75');

    const afterBoot = await apiJson<{
      db: {
        correctionRequests?: Array<{ id: string; status: string }>;
      };
    }>(`/api/v1/schools/${schoolAId}/bootstrap`, { token: teacherAToken });
    assert.equal(afterBoot.status, 200);
    const completedReq = afterBoot.data.db.correctionRequests?.find((r) => r.id === reqId);
    assert.equal(completedReq?.status, 'completed');

    // 8. Subsequent direct edit by teacher is blocked again until another DOS approval
    const postResubmitOverwrite = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: directSubmit.data.marksheet.id,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'submitted',
        version: resubmit.data.marksheet.version,
        entries: partialEntries,
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(postResubmitOverwrite.status, 403);

    // 9. Second request declined by DOS keeps sheet locked
    const req2 = await apiJson<{ request: { id: string } }>(
      `/api/v1/schools/${schoolAId}/marksheets/correction-requests`,
      {
        method: 'POST',
        token: teacherAToken,
        body: {
          marksheetId: directSubmit.data.marksheet.id,
          examId: examAId,
          classId: classAId,
          subjectId: subjectAId,
          assessmentScope: 'eot',
          reason: 'Requesting EoT edit after deadline',
        },
      }
    );
    assert.equal(req2.status, 201);

    const dosReject = await apiJson<{ request: { status: string } }>(
      `/api/v1/schools/${schoolAId}/correction-requests/${encodeURIComponent(req2.data.request.id)}/reject`,
      {
        method: 'POST',
        token: adminAToken,
        body: { reviewNote: 'Deadline closed.' },
      }
    );
    assert.equal(dosReject.status, 200);
    assert.equal(dosReject.data.request.status, 'rejected');

    const stillLocked = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: teacherAToken,
      body: {
        id: directSubmit.data.marksheet.id,
        examId: examAId,
        classId: classAId,
        subjectId: subjectAId,
        teacherId: teacherAId,
        status: 'submitted',
        version: resubmit.data.marksheet.version,
        entries: partialEntries,
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(stillLocked.status, 403);
  });

  it('supports end-of-year student promotion, elective reset, academic year advance, and graduating finalists', async () => {
    const destClassId = `${schoolAId}:cls-promo-target`;
    const createDest = await apiJson<{ cls: { id: string } }>(
      `/api/v1/schools/${schoolAId}/classes`,
      {
        method: 'PUT',
        token: adminAToken,
        body: {
          cls: {
            id: destClassId,
            gradeLevel: 'S.4',
            stream: 'North',
            level: 'olevel',
            classTeacherId: '',
            subjectIds: [subjectAId, unassignedSubjectAId],
            subjectTeacherMap: {},
          },
        },
      }
    );
    assert.equal(createDest.status, 200);

    const stu1Id = `${schoolAId}:stu-corr-1`;
    const stu2Id = `${schoolAId}:stu-corr-2`;

    // Promote stu1 to S.4 North for 2027, reset custom electives, and advance school year
    const promoRes = await apiJson<{
      updatedCount: number;
      targetClassName?: string;
      targetAcademicYear?: string;
    }>(`/api/v1/schools/${schoolAId}/students/promote`, {
      method: 'POST',
      token: adminAToken,
      body: {
        studentIds: [stu1Id],
        targetClassId: destClassId,
        targetAcademicYear: '2027',
        resetElectives: true,
        updateSchoolYear: true,
      },
    });
    assert.equal(promoRes.status, 200);
    assert.equal(promoRes.data.updatedCount, 1);
    assert.equal(promoRes.data.targetAcademicYear, '2027');

    // Graduate stu2 (mark inactive)
    const gradRes = await apiJson<{ updatedCount: number; targetStatus?: string }>(
      `/api/v1/schools/${schoolAId}/students/promote`,
      {
        method: 'POST',
        token: adminAToken,
        body: {
          studentIds: [stu2Id],
          targetStatus: 'inactive',
          targetAcademicYear: '2027',
        },
      }
    );
    assert.equal(gradRes.status, 200);
    assert.equal(gradRes.data.updatedCount, 1);
    assert.equal(gradRes.data.targetStatus, 'inactive');

    const bootAfter = await apiJson<{
      db: {
        settings: { academicYear: string };
        students: Array<{
          id: string;
          classId: string;
          academicYear: string;
          status: string;
          offeredSubjectIds?: string[];
        }>;
      };
    }>(`/api/v1/schools/${schoolAId}/bootstrap`, { token: adminAToken });
    assert.equal(bootAfter.status, 200);
    assert.equal(bootAfter.data.db.settings.academicYear, '2027');

    const promotedStu1 = bootAfter.data.db.students.find((s) => s.id === stu1Id);
    assert.ok(promotedStu1);
    assert.equal(promotedStu1.classId, destClassId);
    assert.equal(promotedStu1.academicYear, '2027');
    assert.equal(promotedStu1.offeredSubjectIds, undefined);

    const graduatedStu2 = bootAfter.data.db.students.find((s) => s.id === stu2Id);
    assert.ok(graduatedStu2);
    assert.equal(graduatedStu2.status, 'inactive');
    assert.equal(graduatedStu2.academicYear, '2027');
  });

  it('blocks CSRF cross-origin requests, enforces server-side session revocation on logout & password change, and rejects recovery token replay', async () => {
    // 1. Cross-origin state-changing request must be rejected with 403 + nosniff header present
    const csrfCrossOrigin = await fetch(`${baseUrl}/api/v1/schools/${schoolAId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAToken}`,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ schoolName: 'Hijacked School' }),
    });
    assert.equal(csrfCrossOrigin.status, 403);
    assert.equal(csrfCrossOrigin.headers.get('x-content-type-options'), 'nosniff');

    // Cookie-only mutation without Origin or X-Requested-With is blocked with 403
    const csrfCookieOnly = await fetch(`${baseUrl}/api/v1/schools/${schoolAId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sf_session=${adminAToken}`,
      },
      body: JSON.stringify({ schoolName: 'Cookie Hijack' }),
    });
    assert.equal(csrfCookieOnly.status, 403);

    // 2. Session revocation on logout + password change (using a dedicated temporary staff account)
    const revStaffId = `${schoolAId}:usr-rev-test`;
    const createRevStaff = await apiJson<{ staff: { staffId: string } }>(
      `/api/v1/schools/${schoolAId}/staff`,
      {
        method: 'PUT',
        token: adminAToken,
        body: {
          id: revStaffId,
          name: 'Revocation Test Teacher',
          email: `rev-${stamp}@tha.ac.ug`,
          username: `rev_${stamp}`,
          password: 'InitPass2026!',
          role: 'teacher',
          active: true,
          phone: '+256 772 616161',
          assignedClassIds: [classAId],
          assignedSubjectIds: [subjectAId],
        },
      }
    );
    assert.equal(createRevStaff.status, 200);

    const revLogin1 = await apiJson<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        schoolCode: schoolACode,
        identifier: createRevStaff.data.staff.staffId,
        password: 'InitPass2026!',
      },
    });
    assert.equal(revLogin1.status, 200);
    const token1 = revLogin1.data.token;

    await new Promise((r) => setTimeout(r, 15));
    const logoutRes = await apiJson('/api/v1/auth/logout', {
      method: 'POST',
      token: token1,
    });
    assert.equal(logoutRes.status, 200);

    // Token1 must be rejected immediately after logout
    const afterLogoutSync = await apiJson('/api/v1/auth/sync', {
      method: 'POST',
      token: token1,
    });
    assert.equal(afterLogoutSync.status, 401);

    // Log in again and change password -> old token invalid, new token valid
    const revLogin2 = await apiJson<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        schoolCode: schoolACode,
        identifier: createRevStaff.data.staff.staffId,
        password: 'InitPass2026!',
      },
    });
    assert.equal(revLogin2.status, 200);
    const oldToken = revLogin2.data.token;

    await new Promise((r) => setTimeout(r, 15));
    const changePwdRes = await apiJson<{ token: string }>('/api/v1/auth/change-password', {
      method: 'POST',
      token: oldToken,
      body: {
        currentPassword: 'InitPass2026!',
        newPassword: 'UpdatedPass2026!',
      },
    });
    assert.equal(changePwdRes.status, 200);
    const newToken = changePwdRes.data.token;
    assert.ok(newToken);

    const staleTokenCheck = await apiJson('/api/v1/auth/sync', {
      method: 'POST',
      token: oldToken,
    });
    assert.equal(staleTokenCheck.status, 401);

    const freshTokenCheck = await apiJson('/api/v1/auth/sync', {
      method: 'POST',
      token: newToken,
    });
    assert.equal(freshTokenCheck.status, 200);

    // 3. Recovery verification blocks weak 4-digit phone suffix, succeeds on full registered phone, and resetToken is single-use
    const lookupRes = await apiJson<{ recoveryToken: string }>('/api/v1/auth/recover/lookup', {
      method: 'POST',
      body: {
        schoolCode: schoolACode,
        identifier: createRevStaff.data.staff.staffId,
      },
    });
    assert.equal(lookupRes.status, 200);

    const weakSuffixVerify = await apiJson('/api/v1/auth/recover/verify', {
      method: 'POST',
      body: {
        recoveryToken: lookupRes.data.recoveryToken,
        verification: '6161',
      },
    });
    assert.equal(weakSuffixVerify.status, 401);

    const verifyRes = await apiJson<{ resetToken: string }>('/api/v1/auth/recover/verify', {
      method: 'POST',
      body: {
        recoveryToken: lookupRes.data.recoveryToken,
        verification: '+256 772 616161',
      },
    });
    assert.equal(verifyRes.status, 200);

    const firstReset = await apiJson('/api/v1/auth/recover/reset-password', {
      method: 'POST',
      body: {
        resetToken: verifyRes.data.resetToken,
        newPassword: 'RecoveredOnce2026!',
      },
    });
    assert.equal(firstReset.status, 200);

    const replayReset = await apiJson('/api/v1/auth/recover/reset-password', {
      method: 'POST',
      body: {
        resetToken: verifyRes.data.resetToken,
        newPassword: 'HijackedAgain2026!',
      },
    });
    assert.equal(replayReset.status, 401);
  });

  it('rejects cross-tenant foreign IDs and invalid payloads via strict Zod schemas & DB scoping', async () => {
    // Super Admin cannot inspect internal school bootstrap directly (403); use School B Admin to fetch School B IDs
    const [saLogin, adminBLogin] = await Promise.all([
      apiJson<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          identifier: superAdminEmail,
          password: 'SuperAdminPass2026!',
        },
      }),
      apiJson<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          schoolCode: schoolBCode,
          identifier: `admin-${stamp}@tnc.ac.ug`,
          password: 'BetaPass2026!',
        },
      }),
    ]);
    assert.equal(saLogin.status, 200);
    assert.equal(adminBLogin.status, 200);

    const saCrossBoot = await apiJson(`/api/v1/schools/${schoolBId}/bootstrap`, {
      token: saLogin.data.token,
    });
    assert.equal(saCrossBoot.status, 403);

    const bootB = await apiJson<{
      db: { exams: Array<{ id: string }>; classes: Array<{ id: string }>; subjects: Array<{ id: string }> };
    }>(`/api/v1/schools/${schoolBId}/bootstrap`, { token: adminBLogin.data.token });
    assert.equal(bootB.status, 200);
    const schoolBClassId = bootB.data.db.classes[0].id;
    const schoolBExamId = bootB.data.db.exams[0].id;
    const schoolBSubjectId = bootB.data.db.subjects[0].id;

    // 1. Admin A tries to save a marksheet referencing School B's class/exam -> 400
    const crossFkMarksheet = await apiJson(`/api/v1/schools/${schoolAId}/marksheets`, {
      method: 'POST',
      token: adminAToken,
      body: {
        id: `${schoolAId}:ms-cross-fk`,
        examId: schoolBExamId,
        classId: schoolBClassId,
        subjectId: schoolBSubjectId,
        teacherId: teacherAId,
        status: 'draft',
        entries: {},
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
    });
    assert.equal(crossFkMarksheet.status, 400);

    // 2. Admin A tries to register a student with School B's classId -> 400
    const crossFkStudent = await apiJson(`/api/v1/schools/${schoolAId}/students`, {
      method: 'POST',
      token: adminAToken,
      body: {
        students: [
          {
            id: `${schoolAId}:stu-cross-fk`,
            admissionNo: 'FK-01',
            fullName: 'Cross Tenant Student',
            gender: 'F',
            classId: schoolBClassId,
            academicYear: '2026',
            status: 'active',
          },
        ],
      },
    });
    assert.equal(crossFkStudent.status, 400);

    // 3. Invalid negative report count -> 400
    const invalidTrack = await apiJson(`/api/v1/schools/${schoolAId}/reports/track`, {
      method: 'POST',
      token: adminAToken,
      body: { count: -10 },
    });
    assert.equal(invalidTrack.status, 400);

    // 4. Invalid settings schoolName (empty string) -> 400
    const invalidSettings = await apiJson(`/api/v1/schools/${schoolAId}/settings`, {
      method: 'PUT',
      token: adminAToken,
      body: { schoolName: '' },
    });
    assert.equal(invalidSettings.status, 400);
  });

  it('handles 1,000 concurrent multi-school entries simultaneously without data loss or cross-tenant leakage', async () => {
    const saLogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: superAdminEmail,
        password: 'SuperAdminPass2026!',
      },
    });
    assert.equal(saLogin.status, 200);
    const saToken = saLogin.data.token;

    // Raise quotas for high-volume benchmark across both schools
    const [qA, qB, adminBLogin] = await Promise.all([
      apiJson(`/api/v1/platform/schools/${schoolAId}`, {
        method: 'PATCH',
        token: saToken,
        body: { studentQuota: 2000 },
      }),
      apiJson(`/api/v1/platform/schools/${schoolBId}`, {
        method: 'PATCH',
        token: saToken,
        body: { studentQuota: 2000 },
      }),
      apiJson<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          schoolCode: schoolBCode,
          identifier: `admin-${stamp}@tnc.ac.ug`,
          password: 'BetaPass2026!',
        },
      }),
    ]);
    assert.equal(qA.status, 200);
    assert.equal(qB.status, 200);
    assert.equal(adminBLogin.status, 200);
    const adminBToken = adminBLogin.data.token;

    const bootB = await apiJson<{ db: { classes: Array<{ id: string }> } }>(
      `/api/v1/schools/${schoolBId}/bootstrap`,
      { token: adminBToken }
    );
    assert.equal(bootB.status, 200);
    const classBId = bootB.data.db.classes[0].id;

    // Dispatch 1,000 student entries concurrently across School A (500) and School B (500) in parallel waves
    const totalPerSchool = 500;
    const waveSize = 100; // 100 concurrent HTTP requests at a time across both schools
    const statuses: number[] = [];

    for (let offset = 0; offset < totalPerSchool; offset += waveSize) {
      const wavePromises: Array<Promise<{ status: number }>> = [];
      for (let i = 0; i < waveSize; i++) {
        const idx = offset + i;
        wavePromises.push(
          apiJson(`/api/v1/schools/${schoolAId}/students`, {
            method: 'POST',
            token: adminAToken,
            body: {
              students: [
                {
                  id: `${schoolAId}:stu-scale-a-${idx}`,
                  admissionNo: `SCALE-A-${idx}`,
                  fullName: `Scale Student A ${idx}`,
                  gender: idx % 2 === 0 ? 'F' : 'M',
                  classId: classAId,
                  academicYear: '2026',
                  status: 'active',
                },
              ],
            },
          })
        );
        wavePromises.push(
          apiJson(`/api/v1/schools/${schoolBId}/students`, {
            method: 'POST',
            token: adminBToken,
            body: {
              students: [
                {
                  id: `${schoolBId}:stu-scale-b-${idx}`,
                  admissionNo: `SCALE-B-${idx}`,
                  fullName: `Scale Student B ${idx}`,
                  gender: idx % 2 === 0 ? 'M' : 'F',
                  classId: classBId,
                  academicYear: '2026',
                  status: 'active',
                },
              ],
            },
          })
        );
      }
      const waveResults = await Promise.all(wavePromises);
      for (const r of waveResults) {
        statuses.push(r.status);
      }
    }

    assert.equal(statuses.length, 1000);
    const failedCount = statuses.filter((s) => s !== 200 && s !== 201).length;
    assert.equal(failedCount, 0);

    // Verify exact tenant counts and zero cross-tenant leakage
    const [listA, listB] = await Promise.all([
      apiJson<{ total: number; students: Array<{ id: string }> }>(
        `/api/v1/schools/${schoolAId}/students?limit=20&search=SCALE-`,
        { token: adminAToken }
      ),
      apiJson<{ total: number; students: Array<{ id: string }> }>(
        `/api/v1/schools/${schoolBId}/students?limit=20&search=SCALE-`,
        { token: adminBToken }
      ),
    ]);
    assert.equal(listA.status, 200);
    assert.equal(listB.status, 200);
    assert.equal(listA.data.total, 500);
    assert.equal(listB.data.total, 500);
    assert.equal(
      listA.data.students.some((s) => s.id.startsWith(`${schoolBId}:`)),
      false
    );
    assert.equal(
      listB.data.students.some((s) => s.id.startsWith(`${schoolAId}:`)),
      false
    );
  });
});



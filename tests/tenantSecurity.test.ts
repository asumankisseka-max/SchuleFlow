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

    // Login Teacher A using generated Staff ID only + password (auto-resolves School A)
    const teacherLogin = await apiJson<{ token: string; user: { schoolId: string | null } }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: {
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

    // Verify new password signs in cleanly without mustChangePassword flag
    const finalLogin = await apiJson<{ user: { mustChangePassword?: boolean } }>(
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
  });

  it('automatically separates Super Admin from schools via credentials and enforces strict isolation & disambiguation', async () => {
    // 1. Seeded Super Admin & test Super Admin log in using ONLY identifier + password (no mode, no schoolCode)
    const defaultSaLogin = await apiJson<{
      token: string;
      user: { email: string; globalRole: string; schoolId: string | null };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        identifier: 'superadmin@schuleflow.ac.ug',
        password: 'admin@schuleflow',
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
  });
});

import { eq, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_REPORT_CARD_LAYOUT,
  INITIAL_SCHOOL_DATABASE,
} from '../data/sampleData.ts';
import { randomBytes } from 'node:crypto';
import { hashPassword, setRuntimeSessionSecret } from '../lib/passwordAuth.ts';
import type {
  BillingStatus,
  CurriculumScope,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
} from '../types.ts';
import {
  extractSchoolInitials,
  formatStaffId,
  formatStudentId,
  generateNextSchoolCode,
  generateNextStaffId,
  generateNextStudentId,
} from '../utils/idGenerator.ts';
import { normalizeUserRole } from '../utils/rbac.ts';
import { normalizeStoredPhone } from '../utils/validation.ts';
import { createClient, db, ensureReachableDbConnection } from './index.ts';
import {
  auditLogs,
  classesStreams,
  examinations,
  gradingConfigs,
  loginActivity,
  marksheetCorrectionRequests,
  marksheets,
  platformRuntimeConfig,
  schools,
  staffTeachers,
  studentRemarks,
  students,
  subjectCombinations,
  subjects,
  subscriptionInvoices,
  users,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

export interface OnboardSchoolInput {
  name: string;
  subdomain: string;
  ministryRegNo?: string;
  subCounty?: string;
  motto: string;
  district: string;
  region: string;
  address: string;
  phone: string;
  email: string;
  principalName: string;
  dosName: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
  adminUsername?: string;
  adminPassword?: string;
  plan: SubscriptionPlan;
  curriculumScope: CurriculumScope;
  status: SchoolStatus;
  subscriptionStatus?: SchoolStatus;
  licenseExpiresAt?: string;
  academicYear: string;
  termName: string;
}

const PLAN_QUOTAS: Record<SubscriptionPlan, { quota: number; unitFeeUgx: number }> = {
  trial: { quota: 80, unitFeeUgx: 0 },
  starter: { quota: 200, unitFeeUgx: 0 },
  standard: { quota: 500, unitFeeUgx: 0 },
  enterprise: { quota: 1500, unitFeeUgx: 0 },
};

function sanitizeSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * Ensures a cryptographically strong HMAC session signing secret is available
 * across all container instances without requiring manual SESSION_SECRET env setup
 * in Cloud Run deployments. Explicit SESSION_SECRET env var always takes precedence.
 */
async function ensurePersistentSessionSecret(): Promise<void> {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    setRuntimeSessionSecret(configured);
    return;
  }

  try {
    const candidateSecret = randomBytes(48).toString('hex');
    await db
      .insert(platformRuntimeConfig)
      .values({
        key: 'session_secret',
        value: candidateSecret,
      })
      .onConflictDoNothing({ target: platformRuntimeConfig.key });

    const rows = await db
      .select({ value: platformRuntimeConfig.value })
      .from(platformRuntimeConfig)
      .where(eq(platformRuntimeConfig.key, 'session_secret'))
      .limit(1);

    const stored = rows[0]?.value?.trim();
    if (stored && stored.length >= 16) {
      setRuntimeSessionSecret(stored);
    }
  } catch (err) {
    console.warn(
      'Could not load/persist platform_runtime_config session_secret; using fallback secret.',
      err
    );
  }
}

/**
 * Ensures new multi-tenant school_code / staff_id / student_id columns and composite
 * unique constraints exist even on previously provisioned PostgreSQL databases,
 * and backfills existing seeded rows deterministically.
 */
async function ensureSchemaColumnsAndBackfill(): Promise<void> {
  const client = createClient();

  const existingCols = (await client.unsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'schools' AND column_name = 'school_code')
        OR (table_name = 'users' AND column_name = 'staff_id')
        OR (table_name = 'staff_teachers' AND column_name = 'staff_id')
        OR (table_name = 'students' AND column_name = 'student_id')
      )
  `)) as Array<{ table_name: string; column_name: string }>;

  const hasCol = (table: string, col: string) =>
    existingCols.some((c) => c.table_name === table && c.column_name === col);

  const missingColStatements: string[] = [];
  if (!hasCol('schools', 'school_code')) {
    missingColStatements.push('ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_code text;');
  }
  if (!hasCol('users', 'staff_id')) {
    missingColStatements.push('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id text;');
  }
  if (!hasCol('staff_teachers', 'staff_id')) {
    missingColStatements.push('ALTER TABLE staff_teachers ADD COLUMN IF NOT EXISTS staff_id text;');
  }
  if (!hasCol('students', 'student_id')) {
    missingColStatements.push('ALTER TABLE students ADD COLUMN IF NOT EXISTS student_id text;');
  }

  if (missingColStatements.length > 0) {
    try {
      await client.unsafe(missingColStatements.join('\n'));
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== '42501') throw err;
    }
  }

  const schoolRows = (await client.unsafe(
    `SELECT id, name, school_code FROM schools ORDER BY created_at ASC, id ASC`
  )) as Array<{ id: string; name: string; school_code: string | null }>;

  const usedSchoolCodes = schoolRows
    .map((r) => r.school_code)
    .filter((v): v is string => Boolean(v && v.trim()));

  const schoolInitialsById = new Map<string, string>();

  for (const s of schoolRows) {
    schoolInitialsById.set(s.id, extractSchoolInitials(s.name));
    if (!s.school_code || !s.school_code.trim()) {
      const nextCode = generateNextSchoolCode(s.name, usedSchoolCodes);
      usedSchoolCodes.push(nextCode);
      await client.unsafe(`UPDATE schools SET school_code = $1 WHERE id = $2`, [nextCode, s.id]);
    }
  }

  for (const s of schoolRows) {
    const initials = schoolInitialsById.get(s.id) ?? extractSchoolInitials(s.name);

    // Backfill & shorten staff_teachers.staff_id per school to < 4 chars (e.g. 001, 002)
    const staffRows = (await client.unsafe(
      `SELECT id, email, staff_id FROM staff_teachers WHERE school_id = $1 ORDER BY created_at ASC, id ASC`,
      [s.id]
    )) as Array<{ id: string; email: string; staff_id: string | null }>;

    const usedStaffIds: string[] = staffRows
      .map((r) => r.staff_id?.trim() || '')
      .filter((v) => /^\d{1,3}$/.test(v));
    const usedStaffSet = new Set(usedStaffIds);

    for (const st of staffRows) {
      let assignedStaffId = st.staff_id?.trim() || null;
      const legacyMatch = assignedStaffId?.match(/-TCH-(\d+)$/i);
      const isShort = Boolean(assignedStaffId && /^\d{1,3}$/.test(assignedStaffId));

      if (!assignedStaffId || legacyMatch || !isShort) {
        let nextShort: string | null = null;
        if (legacyMatch) {
          const candidate = formatStaffId(initials, Number(legacyMatch[1]));
          if (!usedStaffSet.has(candidate)) {
            nextShort = candidate;
          }
        }
        if (!nextShort) {
          nextShort = generateNextStaffId(initials, usedStaffIds, true);
        }
        assignedStaffId = nextShort;
        usedStaffIds.push(assignedStaffId);
        usedStaffSet.add(assignedStaffId);
        await client.unsafe(`UPDATE staff_teachers SET staff_id = $1 WHERE id = $2`, [
          assignedStaffId,
          st.id,
        ]);
      } else {
        usedStaffSet.add(assignedStaffId);
      }

      // Synchronize users.staff_id for matching local uid or scoped email
      await client.unsafe(
        `UPDATE users SET staff_id = $1
         WHERE (uid = $2 OR (school_id = $3 AND lower(trim(email)) = lower(trim($4))))
           AND (staff_id IS NULL OR trim(staff_id) = '' OR staff_id ~* '-TCH-')`,
        [assignedStaffId, `local:${st.id}`, s.id, st.email]
      );
    }

    // Backfill any school-scoped users row that does not yet have a short staff_id
    const orphanUsers = (await client.unsafe(
      `SELECT id, staff_id FROM users WHERE school_id = $1 AND global_role != 'super_admin' ORDER BY id ASC`,
      [s.id]
    )) as Array<{ id: number; staff_id: string | null }>;

    const usedUserStaffIds = [
      ...usedStaffIds,
      ...orphanUsers
        .map((u) => u.staff_id?.trim() || '')
        .filter((v) => /^\d{1,3}$/.test(v)),
    ];
    const usedUserSet = new Set(usedUserStaffIds);

    for (const u of orphanUsers) {
      const cur = u.staff_id?.trim() || '';
      const legacyUserMatch = cur.match(/-TCH-(\d+)$/i);
      if (!cur || legacyUserMatch || !/^\d{1,3}$/.test(cur)) {
        let nextStaffId: string | null = null;
        if (legacyUserMatch) {
          const candidate = formatStaffId(initials, Number(legacyUserMatch[1]));
          if (!usedUserSet.has(candidate)) {
            nextStaffId = candidate;
          }
        }
        if (!nextStaffId) {
          nextStaffId = generateNextStaffId(initials, usedUserStaffIds, true);
        }
        usedUserStaffIds.push(nextStaffId);
        usedUserSet.add(nextStaffId);
        await client.unsafe(`UPDATE users SET staff_id = $1 WHERE id = $2`, [nextStaffId, u.id]);
      }
    }

    // Backfill students.student_id per school starting at 001
    const studentRows = (await client.unsafe(
      `SELECT id, student_id FROM students WHERE school_id = $1 ORDER BY created_at ASC, id ASC`,
      [s.id]
    )) as Array<{ id: string; student_id: string | null }>;

    const usedStudentIds = studentRows
      .map((r) => r.student_id)
      .filter((v): v is string => Boolean(v && v.trim()));

    for (const stu of studentRows) {
      if (!stu.student_id || !stu.student_id.trim()) {
        const nextStuId = generateNextStudentId(initials, usedStudentIds, true);
        usedStudentIds.push(nextStuId);
        await client.unsafe(`UPDATE students SET student_id = $1 WHERE id = $2`, [
          nextStuId,
          stu.id,
        ]);
      }
    }
  }

  const existingIdx = (await client.unsafe(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'schools_code_idx',
        'users_school_staff_id_idx',
        'staff_school_staff_id_idx',
        'students_school_student_id_idx',
        'students_school_status_idx',
        'marksheets_school_exam_status_idx',
        'correction_req_school_status_idx',
        'audit_logs_school_ts_idx'
      )
  `)) as Array<{ indexname: string }>;

  const hasIdx = (name: string) => existingIdx.some((i) => i.indexname === name);
  const indexStatements: string[] = [];
  if (!hasIdx('schools_code_idx')) {
    indexStatements.push(`CREATE UNIQUE INDEX IF NOT EXISTS schools_code_idx ON schools (school_code);`);
  }
  if (!hasIdx('users_school_staff_id_idx')) {
    indexStatements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_school_staff_id_idx ON users (school_id, staff_id);`
    );
  }
  if (!hasIdx('staff_school_staff_id_idx')) {
    indexStatements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS staff_school_staff_id_idx ON staff_teachers (school_id, staff_id);`
    );
  }
  if (!hasIdx('students_school_student_id_idx')) {
    indexStatements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS students_school_student_id_idx ON students (school_id, student_id);`
    );
  }
  if (!hasIdx('students_school_status_idx')) {
    indexStatements.push(
      `CREATE INDEX IF NOT EXISTS students_school_status_idx ON students (school_id, status);`
    );
  }
  if (!hasIdx('marksheets_school_exam_status_idx')) {
    indexStatements.push(
      `CREATE INDEX IF NOT EXISTS marksheets_school_exam_status_idx ON marksheets (school_id, exam_id, status);`
    );
  }
  if (!hasIdx('correction_req_school_status_idx')) {
    indexStatements.push(
      `CREATE INDEX IF NOT EXISTS correction_req_school_status_idx ON marksheet_correction_requests (school_id, status);`
    );
  }
  if (!hasIdx('audit_logs_school_ts_idx')) {
    indexStatements.push(
      `CREATE INDEX IF NOT EXISTS audit_logs_school_ts_idx ON audit_logs (school_id, timestamp);`
    );
  }

  if (indexStatements.length > 0) {
    try {
      await client.unsafe(indexStatements.join('\n'));
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== '42501') throw err;
    }
  }
}

async function ensureSuperAdminSeeded(): Promise<void> {
  const targetEmail = 'superadmin@schuleflow.ac.ug';
  const targetUsername = 'superadmin';
  const targetPassword = '#asu20man';
  const passwordHash = hashPassword(targetPassword);
  const envUid = `env:super_admin:${targetEmail}`;

  await db.transaction(async (tx) => {
    // 1. Remove any stale school staff rows claiming the reserved platform Super Admin email
    const collidingStaff = await tx
      .select({ id: staffTeachers.id })
      .from(staffTeachers)
      .where(sql`lower(trim(${staffTeachers.email})) = ${targetEmail}`);

    if (collidingStaff.length > 0) {
      for (const st of collidingStaff) {
        await tx.delete(users).where(eq(users.uid, `local:${st.id}`));
        await tx.delete(staffTeachers).where(eq(staffTeachers.id, st.id));
      }
    }

    // 2. Rename any school-scoped username='superadmin' so 'superadmin' resolves solely to Platform Super Admin
    await tx.execute(sql`
      UPDATE staff_teachers
      SET username = username || '_' || substr(md5(id), 1, 4)
      WHERE lower(trim(username)) = ${targetUsername}
    `);
    await tx.execute(sql`
      UPDATE users
      SET username = username || '_' || id::text
      WHERE global_role <> 'super_admin'
        AND lower(trim(COALESCE(username, ''))) = ${targetUsername}
    `);

    // 3. Gather all existing candidate rows for the canonical Super Admin and deduplicate cleanly
    const candidateRows = await tx
      .select()
      .from(users)
      .where(
        sql`lower(trim(${users.email})) = ${targetEmail}
            OR ${users.uid} LIKE 'env:super_admin:%'
            OR (${users.globalRole} = 'super_admin' AND lower(trim(COALESCE(${users.username}, ''))) = ${targetUsername})`
      );

    if (candidateRows.length > 0) {
      const canonical =
        candidateRows.find((r) => r.uid === envUid) ??
        candidateRows.find((r) => r.globalRole === 'super_admin') ??
        candidateRows[0];

      for (const extra of candidateRows) {
        if (extra.id !== canonical.id) {
          await tx.delete(users).where(eq(users.id, extra.id));
        }
      }

      await tx
        .update(users)
        .set({
          uid: envUid,
          staffId: null,
          email: targetEmail,
          username: targetUsername,
          passwordHash,
          name: 'Platform Super Admin',
          globalRole: 'super_admin',
          schoolId: null,
          schoolRole: 'school_admin',
          active: true,
          mustChangePassword: false,
        })
        .where(eq(users.id, canonical.id));
      return;
    }

    await tx
      .insert(users)
      .values({
        uid: envUid,
        staffId: null,
        email: targetEmail,
        username: targetUsername,
        passwordHash,
        name: 'Platform Super Admin',
        globalRole: 'super_admin',
        schoolId: null,
        schoolRole: 'school_admin',
        active: true,
        mustChangePassword: false,
        lastLogin: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          staffId: null,
          email: targetEmail,
          username: targetUsername,
          passwordHash,
          name: 'Platform Super Admin',
          globalRole: 'super_admin',
          schoolId: null,
          schoolRole: 'school_admin',
          active: true,
          mustChangePassword: false,
        },
      });
  });
}

async function ensureSeededStaffCredentials(): Promise<void> {
  const [allSchools, allStaff] = await Promise.all([
    db.select({ id: schools.id, name: schools.name }).from(schools),
    db.select().from(staffTeachers),
  ]);
  if (allStaff.length === 0) return;

  const schoolNameMap = new Map(allSchools.map((s) => [s.id, s.name]));
  const usedStaffIdsBySchool = new Map<string, string[]>();
  for (const st of allStaff) {
    if (!st.staffId) continue;
    const list = usedStaffIdsBySchool.get(st.schoolId) ?? [];
    list.push(st.staffId);
    usedStaffIdsBySchool.set(st.schoolId, list);
  }

  const defaultHash = hashPassword('password123');
  for (const st of allStaff) {
    const cleanEmail = st.email.trim().toLowerCase();
    if (cleanEmail === 'superadmin@schuleflow.ac.ug') continue;
    const cleanUser = st.username.trim().toLowerCase() || cleanEmail.split('@')[0];
    const normRole = normalizeUserRole(st.role);
    const normPhone = normalizeStoredPhone(st.phone);
    const needsHash = !st.passwordHash;
    const needsPhoneNorm = st.phone !== normPhone;

    let assignedStaffId = st.staffId?.trim() || null;
    if (!assignedStaffId) {
      const schoolName = schoolNameMap.get(st.schoolId) ?? 'School';
      const used = usedStaffIdsBySchool.get(st.schoolId) ?? [];
      assignedStaffId = generateNextStaffId(schoolName, used);
      used.push(assignedStaffId);
      usedStaffIdsBySchool.set(st.schoolId, used);
    }

    if (needsHash || needsPhoneNorm || st.staffId !== assignedStaffId) {
      await db
        .update(staffTeachers)
        .set({
          ...(needsHash ? { passwordHash: defaultHash, role: normRole } : {}),
          phone: normPhone,
          staffId: assignedStaffId,
        })
        .where(eq(staffTeachers.id, st.id));
    }

    const existingUsers = await db
      .select({
        id: users.id,
        phone: users.phone,
        staffId: users.staffId,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.uid, `local:${st.id}`))
      .limit(1);

    if (existingUsers.length === 0) {
      await db
        .insert(users)
        .values({
          uid: `local:${st.id}`,
          staffId: assignedStaffId,
          email: cleanEmail,
          username: cleanUser,
          phone: normPhone,
          passwordHash: st.passwordHash ?? defaultHash,
          name: st.name,
          globalRole: 'school_user',
          schoolId: st.schoolId,
          schoolRole: normRole,
          active: st.active,
        })
        .onConflictDoNothing();
    } else if (
      (!existingUsers[0].phone && normPhone) ||
      existingUsers[0].staffId !== assignedStaffId ||
      !existingUsers[0].passwordHash
    ) {
      await db
        .update(users)
        .set({
          ...(!existingUsers[0].phone && normPhone ? { phone: normPhone } : {}),
          ...(assignedStaffId ? { staffId: assignedStaffId } : {}),
          ...(!existingUsers[0].passwordHash ? { passwordHash: st.passwordHash ?? defaultHash } : {}),
        })
        .where(eq(users.id, existingUsers[0].id));
    }
  }
}

export async function ensureInitialTenantsSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        await ensureReachableDbConnection();
        await ensurePersistentSessionSecret();
        await ensureSchemaColumnsAndBackfill();

        const existing = await db.select({ id: schools.id }).from(schools).limit(1);
        if (existing.length === 0) {
          await seedJanguInternational();
        }

        await ensureSuperAdminSeeded();
        await ensureSeededStaffCredentials();
      } catch (error) {
        seedPromise = null;
        console.error('Failed to seed initial multi-tenant database:', error);
        const pgCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';
        if (pgCode === '42P01') {
          throw new Error(
            'Database schema is not initialized (missing tables). Run Drizzle schema push first.',
            { cause: error }
          );
        }
        throw new Error('Failed to initialize multi-school tenant records.', { cause: error });
      }
    })();
  }
  return seedPromise;
}

export async function resetCloudDatabaseToPreviewBaseline(): Promise<{
  schoolId: string;
  schoolCode: string;
  schoolName: string;
}> {
  await ensureReachableDbConnection();
  await ensurePersistentSessionSecret();
  await ensureSchemaColumnsAndBackfill();

  await db.transaction(async (tx) => {
    await tx.delete(marksheetCorrectionRequests);
    await tx.delete(studentRemarks);
    await tx.delete(marksheets);
    await tx.delete(examinations);
    await tx.delete(students);
    await tx.delete(classesStreams);
    await tx.delete(subjectCombinations);
    await tx.delete(subjects);
    await tx.delete(staffTeachers);
    await tx.delete(gradingConfigs);
    await tx.delete(subscriptionInvoices);
    await tx.delete(loginActivity);
    await tx.delete(auditLogs);
    await tx.delete(users).where(ne(users.globalRole, 'super_admin'));
    await tx.delete(schools);
  });

  await seedJanguInternational();
  await ensureSuperAdminSeeded();
  await ensureSeededStaffCredentials();
  seedPromise = Promise.resolve();

  return {
    schoolId: 'sch-jangu-international',
    schoolCode: 'JIS-101',
    schoolName: INITIAL_SCHOOL_DATABASE.settings.schoolName,
  };
}

async function seedJanguInternational() {
  const schoolId = 'sch-jangu-international';
  const base = INITIAL_SCHOOL_DATABASE;
  const initials = extractSchoolInitials(base.settings.schoolName);

  await db.transaction(async (tx) => {
    await tx.insert(schools).values({
      id: schoolId,
      schoolCode: `${initials}-101`,
      name: base.settings.schoolName,
      subdomain: 'janguinternational',
      motto: base.settings.reportLayout.schoolMotto,
      logoUrl: null,
      primaryColor: '#1e3a8a',
      secondaryColor: '#b45309',
      address: base.settings.schoolAddress,
      phone: base.settings.schoolPhone,
      email: base.settings.schoolEmail,
      district: 'Kampala',
      region: 'Central',
      status: 'active',
      plan: 'standard',
      studentQuota: 250,
      termFeePerStudentUgx: 4500,
      billingStatus: 'paid',
      nextBillingDate: '2027-02-01',
      academicYear: base.settings.academicYear,
      termName: base.settings.termName,
      principalName: base.settings.principalName,
      dosName: base.settings.dosName,
      reportsGeneratedCount: base.reportsGeneratedCount,
    });

    await tx.insert(gradingConfigs).values({
      id: `gc-${schoolId}`,
      schoolId,
      cbcConfig: base.settings.cbcConfig,
      alevelPolicy: base.settings.alevelPolicy,
      olevelGradingScale: base.settings.olevelGradingScale,
      alevelGradingScale: base.settings.alevelGradingScale,
      reportLayout: base.settings.reportLayout,
    });

    await tx.insert(staffTeachers).values(
      base.users.map((u, idx) => ({
        id: `${schoolId}:${u.id}`,
        schoolId,
        staffId: formatStaffId(initials, idx + 1),
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        active: u.active,
        phone: normalizeStoredPhone(u.phone),
        assignedClassIds: u.assignedClassIds,
        assignedSubjectIds: u.assignedSubjectIds,
        lastLogin: u.lastLogin ?? null,
      }))
    );

    await tx.insert(subjects).values(
      base.subjects.map((s) => ({
        id: s.id,
        schoolId,
        code: s.code,
        name: s.name,
        level: s.level,
        category: s.category,
        maxMarks: s.maxMarks,
        passMark: s.passMark,
        competencies: s.competencies,
      }))
    );

    await tx.insert(subjectCombinations).values(
      base.combinations.map((c) => ({
        id: c.id,
        schoolId,
        code: c.code,
        name: c.name,
        principalSubjectIds: c.principalSubjectIds,
        subsidiarySubjectIds: c.subsidiarySubjectIds,
      }))
    );

    await tx.insert(classesStreams).values(
      base.classes.map((c) => ({
        id: c.id,
        schoolId,
        name: c.name,
        gradeLevel: c.gradeLevel,
        stream: (c.stream ?? '').trim(),
        level: c.level,
        classTeacherId: `${schoolId}:${c.classTeacherId}`,
        subjectIds: c.subjectIds,
        subjectTeacherMap: Object.fromEntries(
          Object.entries(c.subjectTeacherMap).map(([subId, tid]) => [subId, `${schoolId}:${tid}`])
        ),
      }))
    );

    await tx.insert(students).values(
      base.students.map((stu, idx) => ({
        id: stu.id,
        schoolId,
        studentId: formatStudentId(initials, idx + 1),
        admissionNo: stu.admissionNo,
        fullName: stu.fullName,
        gender: stu.gender,
        dateOfBirth: stu.dateOfBirth ?? null,
        classId: stu.classId,
        academicYear: stu.academicYear,
        status: stu.status,
        combinationId: stu.combinationId ?? null,
        parentName: stu.parentName ?? null,
        parentContact: stu.parentContact ?? null,
        photoDataUrl: stu.photoDataUrl ?? null,
      }))
    );

    await tx.insert(examinations).values(
      base.exams.map((ex) => ({
        id: ex.id,
        schoolId,
        name: ex.name,
        examType: ex.examType,
        term: ex.term,
        academicYear: ex.academicYear,
        levelScope: ex.levelScope,
        classIds: ex.classIds,
        examDate: ex.examDate,
        submissionDeadline: ex.submissionDeadline,
        locked: ex.locked,
        published: ex.published,
        createdAt: ex.createdAt,
      }))
    );

    await tx.insert(marksheets).values(
      base.marksheets.map((m) => ({
        id: `${schoolId}:${m.id}`,
        schoolId,
        examId: m.examId,
        classId: m.classId,
        subjectId: m.subjectId,
        teacherId: `${schoolId}:${m.teacherId}`,
        status: m.status,
        entries: m.entries,
        submittedAt: m.submittedAt ?? null,
        submittedBy: m.submittedBy ? `${schoolId}:${m.submittedBy}` : null,
        approvedAt: m.approvedAt ?? null,
        approvedBy: m.approvedBy ? `${schoolId}:${m.approvedBy}` : null,
        dosComment: m.dosComment ?? null,
        lastModified: m.lastModified,
        auditHistory: m.auditHistory,
      }))
    );

    await tx.insert(subscriptionInvoices).values([
      {
        id: `inv-${schoolId}-2026-t2`,
        schoolId,
        termName: 'Term II',
        academicYear: '2026',
        activeStudentsCount: 28,
        licensedQuota: 250,
        unitFeeUgx: 4500,
        totalAmountUgx: 28 * 4500,
        status: 'paid',
        issuedAt: '2026-05-15',
        paidAt: '2026-05-22',
      },
      {
        id: `inv-${schoolId}-2026-t3`,
        schoolId,
        termName: 'Term III',
        academicYear: '2026',
        activeStudentsCount: base.students.length,
        licensedQuota: 250,
        unitFeeUgx: 4500,
        totalAmountUgx: base.students.length * 4500,
        status: 'paid',
        issuedAt: '2026-09-12',
        paidAt: '2026-09-18',
      },
    ]);

    await tx.insert(loginActivity).values(
      base.loginActivity.map((log) => ({
        id: `${schoolId}:${log.id}`,
        schoolId,
        userId: `${schoolId}:${log.userId}`,
        userName: log.userName,
        role: log.role,
        timestamp: log.timestamp,
        action: log.action,
      }))
    );
  });
}

export async function provisionNewSchoolTenant(input: OnboardSchoolInput): Promise<SchoolTenant> {
  const cleanSub = sanitizeSubdomain(input.subdomain || input.name);
  if (!cleanSub) {
    throw new Error('A valid school subdomain slug is required.');
  }

  const existingSub = await db
    .select({ id: schools.id })
    .from(schools)
    .where(sql`lower(${schools.subdomain}) = ${cleanSub}`)
    .limit(1);

  if (existingSub.length > 0) {
    throw new Error(`Subdomain "${cleanSub}" is already registered to another school.`);
  }

  const existingCodesRows = await db.select({ schoolCode: schools.schoolCode }).from(schools);
  const schoolCode = generateNextSchoolCode(
    input.name.trim(),
    existingCodesRows.map((r) => r.schoolCode)
  );
  const initials = extractSchoolInitials(input.name.trim());
  const adminCode = formatStaffId(initials, 1);
  const dosCode = formatStaffId(initials, 2);
  const classTeacherCode = formatStaffId(initials, 3);
  const bursarCode = formatStaffId(initials, 4);

  const scope: CurriculumScope = input.curriculumScope || 'olevel_alevel';
  const includeOlevel = scope === 'olevel_only' || scope === 'olevel_alevel';
  const includeAlevel = scope === 'alevel_only' || scope === 'olevel_alevel';

  const schoolId = `sch-${cleanSub}-${Date.now().toString(36).slice(-4)}`;
  const { quota, unitFeeUgx } = PLAN_QUOTAS[input.plan] ?? PLAN_QUOTAS.standard;
  const adminStaffRowId = `${schoolId}:usr-admin`;
  const dosStaffRowId = `${schoolId}:usr-dos`;
  const classTeacherStaffRowId = `${schoolId}:usr-classteacher`;
  const bursarStaffRowId = `${schoolId}:usr-bursar`;
  const examId = `${schoolId}:exam-${input.academicYear || '2026'}-t3`;

  const scopedSubjects = INITIAL_SCHOOL_DATABASE.subjects
    .filter(
      (s) =>
        (includeOlevel && s.level === 'olevel') ||
        (includeAlevel && s.level === 'alevel')
    )
    .map((s) => ({
      id: `${schoolId}:${s.id}`,
      schoolId,
      code: s.code,
      name: s.name,
      level: s.level,
      category: s.category,
      maxMarks: s.maxMarks,
      passMark: s.passMark,
      competencies: s.competencies,
    }));

  const olevelSubIds = scopedSubjects
    .filter((s) => s.level === 'olevel')
    .map((s) => s.id);

  const scopedCombinations = includeAlevel
    ? INITIAL_SCHOOL_DATABASE.combinations.map((c) => ({
        id: `${schoolId}:${c.id}`,
        schoolId,
        code: c.code,
        name: c.name,
        principalSubjectIds: c.principalSubjectIds.map((pid) => `${schoolId}:${pid}`),
        subsidiarySubjectIds: c.subsidiarySubjectIds.map((sid) => `${schoolId}:${sid}`),
      }))
    : [];

  const alevelSciSubIds = scopedSubjects
    .filter(
      (s) =>
        s.level === 'alevel' &&
        ['P425', 'P510', 'P525', 'S101', 'S850'].includes(s.code)
    )
    .map((s) => s.id);
  const alevelArtsSubIds = scopedSubjects
    .filter(
      (s) =>
        s.level === 'alevel' &&
        ['P210', 'P220', 'P250', 'S101', 'S475'].includes(s.code)
    )
    .map((s) => s.id);

  const mapTeachers = (subIds: string[]) =>
    Object.fromEntries(subIds.map((id) => [id, dosStaffRowId]));

  const seededClasses = [
    ...(includeOlevel
      ? [
          {
            id: `${schoolId}:cls-s1-east`,
            schoolId,
            name: 'S.1 East',
            gradeLevel: 'S.1',
            stream: 'East',
            level: 'olevel',
            classTeacherId: classTeacherStaffRowId,
            subjectIds: olevelSubIds.slice(0, 6),
            subjectTeacherMap: mapTeachers(olevelSubIds.slice(0, 6)),
          },
          {
            id: `${schoolId}:cls-s2-east`,
            schoolId,
            name: 'S.2 East',
            gradeLevel: 'S.2',
            stream: 'East',
            level: 'olevel',
            classTeacherId: classTeacherStaffRowId,
            subjectIds: olevelSubIds.slice(0, 6),
            subjectTeacherMap: mapTeachers(olevelSubIds.slice(0, 6)),
          },
          {
            id: `${schoolId}:cls-s3-west`,
            schoolId,
            name: 'S.3 West',
            gradeLevel: 'S.3',
            stream: 'West',
            level: 'olevel',
            classTeacherId: dosStaffRowId,
            subjectIds: olevelSubIds,
            subjectTeacherMap: mapTeachers(olevelSubIds),
          },
          {
            id: `${schoolId}:cls-s4-west`,
            schoolId,
            name: 'S.4 West',
            gradeLevel: 'S.4',
            stream: 'West',
            level: 'olevel',
            classTeacherId: dosStaffRowId,
            subjectIds: olevelSubIds,
            subjectTeacherMap: mapTeachers(olevelSubIds),
          },
        ]
      : []),
    ...(includeAlevel
      ? [
          {
            id: `${schoolId}:cls-s5-sci`,
            schoolId,
            name: 'S.5 Science',
            gradeLevel: 'S.5',
            stream: 'Science',
            level: 'alevel',
            classTeacherId: includeOlevel ? dosStaffRowId : classTeacherStaffRowId,
            subjectIds: alevelSciSubIds,
            subjectTeacherMap: mapTeachers(alevelSciSubIds),
          },
          {
            id: `${schoolId}:cls-s6-arts`,
            schoolId,
            name: 'S.6 Arts',
            gradeLevel: 'S.6',
            stream: 'Arts',
            level: 'alevel',
            classTeacherId: dosStaffRowId,
            subjectIds: alevelArtsSubIds,
            subjectTeacherMap: mapTeachers(alevelArtsSubIds),
          },
        ]
      : []),
  ];

  const classIds = seededClasses.map((c) => c.id);

  const effectiveStatus: SchoolStatus = input.subscriptionStatus ?? input.status ?? 'active';
  const defaultDays = effectiveStatus === 'trial' ? 30 : 365;
  const parsedExpiry = input.licenseExpiresAt ? new Date(input.licenseExpiresAt) : null;
  const licenseExpiryDate =
    parsedExpiry && !Number.isNaN(parsedExpiry.getTime())
      ? parsedExpiry
      : new Date(Date.now() + defaultDays * 86400000);

  const adminEmailClean = input.adminEmail.trim().toLowerCase();
  const adminUsernameClean =
    (input.adminUsername?.trim() || adminEmailClean.split('@')[0] || 'schooladmin').toLowerCase();
  if (adminEmailClean === 'superadmin@schuleflow.ac.ug' || adminUsernameClean === 'superadmin') {
    throw new Error('superadmin@schuleflow.ac.ug and username "superadmin" are reserved for the Platform Super Admin.');
  }
  const schoolPhoneClean = normalizeStoredPhone(input.phone) ?? (input.phone.trim() || '+256700000000');
  const adminPhoneClean = normalizeStoredPhone(input.adminPhone) ?? schoolPhoneClean;
  const adminUsedDefaultPwd = !input.adminPassword?.trim();
  const adminPasswordHash = hashPassword(input.adminPassword?.trim() || 'SchuleFlow2026!');
  const defaultStaffHash = hashPassword('SchuleFlow2026!');

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schools).values({
        id: schoolId,
        schoolCode,
        name: input.name.trim(),
        subdomain: cleanSub,
        ministryRegNo: input.ministryRegNo?.trim() || `MoES/SEC/${Date.now().toString().slice(-4)}`,
        subCounty: input.subCounty?.trim() || 'Central Division',
        motto: input.motto.trim() || 'Strive for Excellence & Integrity',
        logoUrl: null,
        primaryColor: '#1e3a8a',
        secondaryColor: '#b45309',
        address: input.address.trim() || `${input.district}, Uganda`,
        phone: schoolPhoneClean,
        email: input.email.trim() || adminEmailClean,
        district: input.district.trim() || 'Kampala',
        region: input.region.trim() || 'Central',
        status: effectiveStatus,
        subscriptionStatus: effectiveStatus,
        licenseExpiresAt: licenseExpiryDate,
        plan: input.plan,
        curriculumScope: scope,
        studentQuota: quota,
        termFeePerStudentUgx: unitFeeUgx,
        billingStatus: (effectiveStatus === 'trial' ? 'pending' : 'paid') as BillingStatus,
        nextBillingDate: licenseExpiryDate.toISOString().slice(0, 10),
        academicYear: input.academicYear || '2026',
        termName: input.termName || 'Term III',
        principalName: input.principalName.trim() || input.adminName.trim(),
        dosName: input.dosName.trim() || input.adminName.trim(),
        reportsGeneratedCount: 0,
      });

      await tx.insert(gradingConfigs).values({
        id: `gc-${schoolId}`,
        schoolId,
        cbcConfig: DEFAULT_CBC_CONFIG,
        alevelPolicy: DEFAULT_ALEVEL_POLICY,
        olevelGradingScale: DEFAULT_OLEVEL_GRADING_SCALE,
        alevelGradingScale: DEFAULT_ALEVEL_GRADING_SCALE,
        reportLayout: {
          ...DEFAULT_REPORT_CARD_LAYOUT,
          schoolMotto: input.motto.trim() || 'Strive for Excellence & Integrity',
          schoolContact: `${input.address.trim() || input.district} · ${schoolPhoneClean}`,
        },
      });

      await tx.insert(staffTeachers).values([
        {
          id: adminStaffRowId,
          schoolId,
          staffId: adminCode,
          name: input.adminName.trim(),
          email: adminEmailClean,
          username: adminUsernameClean,
          passwordHash: adminPasswordHash,
          role: 'school_admin',
          active: true,
          mustChangePassword: adminUsedDefaultPwd,
          phone: adminPhoneClean,
          assignedClassIds: [],
          assignedSubjectIds: [],
        },
        {
          id: dosStaffRowId,
          schoolId,
          staffId: dosCode,
          name: input.dosName.trim() || 'Director of Studies',
          email: `dos@${cleanSub}.ac.ug`,
          username: `dos_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'dos',
          active: true,
          mustChangePassword: true,
          phone: null,
          assignedClassIds: classIds,
          assignedSubjectIds: scopedSubjects.map((s) => s.id),
        },
        {
          id: classTeacherStaffRowId,
          schoolId,
          staffId: classTeacherCode,
          name: 'Class Teacher (Homeroom)',
          email: `classteacher@${cleanSub}.ac.ug`,
          username: `teacher_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'class_teacher',
          active: true,
          mustChangePassword: true,
          phone: null,
          assignedClassIds: classIds.slice(0, 2),
          assignedSubjectIds: scopedSubjects.slice(0, 3).map((s) => s.id),
        },
        {
          id: bursarStaffRowId,
          schoolId,
          staffId: bursarCode,
          name: 'School Bursar',
          email: `bursar@${cleanSub}.ac.ug`,
          username: `bursar_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'bursar',
          active: true,
          mustChangePassword: true,
          phone: null,
          assignedClassIds: [],
          assignedSubjectIds: [],
        },
      ]);

      await tx
        .insert(users)
        .values([
          {
            uid: `local:${adminStaffRowId}`,
            staffId: adminCode,
            email: adminEmailClean,
            username: adminUsernameClean,
            phone: adminPhoneClean,
            passwordHash: adminPasswordHash,
            name: input.adminName.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'school_admin',
            active: true,
            mustChangePassword: adminUsedDefaultPwd,
          },
          {
            uid: `local:${dosStaffRowId}`,
            staffId: dosCode,
            email: `dos@${cleanSub}.ac.ug`,
            username: `dos_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: input.dosName.trim() || 'Director of Studies',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'dos',
            active: true,
            mustChangePassword: true,
          },
          {
            uid: `local:${classTeacherStaffRowId}`,
            staffId: classTeacherCode,
            email: `classteacher@${cleanSub}.ac.ug`,
            username: `teacher_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: 'Class Teacher (Homeroom)',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'class_teacher',
            active: true,
            mustChangePassword: true,
          },
          {
            uid: `local:${bursarStaffRowId}`,
            staffId: bursarCode,
            email: `bursar@${cleanSub}.ac.ug`,
            username: `bursar_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: 'School Bursar',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'bursar',
            active: true,
            mustChangePassword: true,
          },
        ])
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            schoolId,
            active: true,
          },
        });

      if (scopedSubjects.length > 0) {
        await tx.insert(subjects).values(scopedSubjects);
      }

      if (scopedCombinations.length > 0) {
        await tx.insert(subjectCombinations).values(scopedCombinations);
      }

      if (seededClasses.length > 0) {
        await tx.insert(classesStreams).values(seededClasses);
      }

      await tx.insert(examinations).values([
        {
          id: examId,
          schoolId,
          name: `${input.termName || 'Term III'} End of Term`,
          examType: 'End of Term',
          term: input.termName || 'Term III',
          academicYear: input.academicYear || '2026',
          levelScope:
            scope === 'olevel_only'
              ? 'olevel'
              : scope === 'alevel_only'
                ? 'alevel'
                : 'all',
          classIds,
          examDate: new Date().toISOString().slice(0, 10),
          submissionDeadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
          locked: false,
          published: false,
          createdAt: new Date().toISOString(),
        },
      ]);

      await tx.insert(subscriptionInvoices).values([
        {
          id: `inv-${schoolId}-${Date.now().toString(36)}`,
          schoolId,
          termName: input.termName || 'Term III',
          academicYear: input.academicYear || '2026',
          activeStudentsCount: 0,
          licensedQuota: quota,
          unitFeeUgx: unitFeeUgx,
          totalAmountUgx: 0,
          status: effectiveStatus === 'trial' ? 'pending' : 'paid',
          issuedAt: new Date().toISOString().slice(0, 10),
          paidAt: effectiveStatus === 'trial' ? null : new Date().toISOString().slice(0, 10),
        },
      ]);
    });

    const created = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
    const row = created[0];
    return {
      id: row.id,
      schoolCode: row.schoolCode,
      name: row.name,
      subdomain: row.subdomain,
      ministryRegNo: row.ministryRegNo,
      subCounty: row.subCounty,
      motto: row.motto,
      logoUrl: row.logoUrl,
      address: row.address,
      phone: row.phone,
      email: row.email,
      district: row.district,
      region: row.region,
      status: (row.subscriptionStatus || row.status) as SchoolStatus,
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
      activeStudentCount: 0,
      staffCount: 4,
      adminStaffId: adminCode,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to onboard school tenant:', error);
    throw new Error('Failed to provision new school tenant.', { cause: error });
  }
}

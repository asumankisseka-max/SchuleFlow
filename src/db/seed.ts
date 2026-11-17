import { eq, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_REPORT_CARD_LAYOUT,
  INITIAL_SCHOOL_DATABASE,
} from '../data/sampleData.ts';
import { hashPassword } from '../lib/passwordAuth.ts';
import type {
  BillingStatus,
  CurriculumScope,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
} from '../types.ts';
import { normalizeUserRole } from '../utils/rbac.ts';
import { normalizeStoredPhone } from '../utils/validation.ts';
import { db } from './index.ts';
import {
  classesStreams,
  examinations,
  gradingConfigs,
  loginActivity,
  marksheets,
  schools,
  staffTeachers,
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

async function ensureSeededStaffCredentials(): Promise<void> {
  const allStaff = await db.select().from(staffTeachers);
  if (allStaff.length === 0) return;

  const defaultHash = hashPassword('password123');
  for (const st of allStaff) {
    const cleanEmail = st.email.trim().toLowerCase();
    const cleanUser = st.username.trim().toLowerCase() || cleanEmail.split('@')[0];
    const normRole = normalizeUserRole(st.role);
    const normPhone = normalizeStoredPhone(st.phone);
    const needsHash = !st.passwordHash;
    const needsPhoneNorm = st.phone !== normPhone;

    if (needsHash || needsPhoneNorm) {
      await db
        .update(staffTeachers)
        .set({
          ...(needsHash ? { passwordHash: defaultHash, role: normRole } : {}),
          phone: normPhone,
        })
        .where(eq(staffTeachers.id, st.id));
    }

    const existingUsers = await db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(sql`lower(${users.email}) = ${cleanEmail}`)
      .limit(1);

    if (existingUsers.length === 0) {
      await db
        .insert(users)
        .values({
          uid: `local:${st.id}`,
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
    } else if (!existingUsers[0].phone && normPhone) {
      await db
        .update(users)
        .set({ phone: normPhone })
        .where(eq(users.id, existingUsers[0].id));
    }
  }
}

export async function ensureInitialTenantsSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.select({ id: schools.id }).from(schools).limit(1);
        if (existing.length === 0) {
          await seedKampalaHorizon();
          await seedStMarysMbale();
        }
        await ensureSeededStaffCredentials();
      } catch (error) {
        seedPromise = null;
        console.error('Failed to seed initial multi-tenant database:', error);
        throw new Error('Failed to initialize multi-school tenant records.', { cause: error });
      }
    })();
  }
  return seedPromise;
}

async function seedKampalaHorizon() {
  const schoolId = 'sch-kampala-horizon';
  const base = INITIAL_SCHOOL_DATABASE;

  await db.transaction(async (tx) => {
    await tx.insert(schools).values({
      id: schoolId,
      name: base.settings.schoolName,
      subdomain: 'kampalahorizon',
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
      base.users.map((u) => ({
        id: `${schoolId}:${u.id}`,
        schoolId,
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
        stream: c.stream,
        level: c.level,
        classTeacherId: `${schoolId}:${c.classTeacherId}`,
        subjectIds: c.subjectIds,
        subjectTeacherMap: Object.fromEntries(
          Object.entries(c.subjectTeacherMap).map(([subId, tid]) => [subId, `${schoolId}:${tid}`])
        ),
      }))
    );

    await tx.insert(students).values(
      base.students.map((stu) => ({
        id: stu.id,
        schoolId,
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

async function seedStMarysMbale() {
  const schoolId = 'sch-stmarys-mbale';

  await db.transaction(async (tx) => {
    await tx.insert(schools).values({
      id: schoolId,
      name: "St. Mary's College Mbale",
      subdomain: 'stmarysmbale',
      motto: 'Disciplina, Scientia et Fides',
      logoUrl: null,
      primaryColor: '#065f46',
      secondaryColor: '#d97706',
      address: 'P.O. Box 412 Mbale · Republic Street, Eastern Region',
      phone: '+256 454 433 210',
      email: 'dos@stmarysmbale.ac.ug',
      district: 'Mbale',
      region: 'Eastern',
      status: 'trial',
      plan: 'starter',
      studentQuota: 150,
      termFeePerStudentUgx: 5000,
      billingStatus: 'pending',
      nextBillingDate: '2026-12-15',
      academicYear: '2026',
      termName: 'Term III',
      principalName: 'Sr. Beatrice Nabwire',
      dosName: 'Mr. Moses Wanyama',
      reportsGeneratedCount: 14,
    });

    await tx.insert(gradingConfigs).values({
      id: `gc-${schoolId}`,
      schoolId,
      cbcConfig: {
        ...DEFAULT_CBC_CONFIG,
        roundingMode: 'one_decimal',
      },
      alevelPolicy: DEFAULT_ALEVEL_POLICY,
      olevelGradingScale: DEFAULT_OLEVEL_GRADING_SCALE,
      alevelGradingScale: DEFAULT_ALEVEL_GRADING_SCALE,
      reportLayout: {
        ...DEFAULT_REPORT_CARD_LAYOUT,
        style: 'modern',
        accentColor: 'emerald',
        crestType: 'award',
        schoolMotto: 'Disciplina, Scientia et Fides',
        schoolContact: 'P.O. Box 412 Mbale · Republic Street · +256 454 433 210',
        reportTitle: 'Terminal Assessment Transcript',
      },
    });

    await tx.insert(staffTeachers).values([
      {
        id: `${schoolId}:usr-admin`,
        schoolId,
        name: 'Mr. Stephen Wandera',
        email: 'admin@stmarysmbale.ac.ug',
        username: 'wandera',
        role: 'admin',
        active: true,
        phone: '+256772801412',
        assignedClassIds: [],
        assignedSubjectIds: [],
      },
      {
        id: `${schoolId}:usr-dos`,
        schoolId,
        name: 'Mr. Moses Wanyama',
        email: 'dos@stmarysmbale.ac.ug',
        username: 'wanyama',
        role: 'dos',
        active: true,
        phone: '+256701512889',
        assignedClassIds: [`${schoolId}:cls-s1-north`, `${schoolId}:cls-s5-hum`],
        assignedSubjectIds: [],
      },
      {
        id: `${schoolId}:usr-teacher-1`,
        schoolId,
        name: 'Ms. Sarah Nandutu',
        email: 'snandutu@stmarysmbale.ac.ug',
        username: 'nandutu',
        role: 'teacher',
        active: true,
        phone: '+256782440211',
        assignedClassIds: [`${schoolId}:cls-s1-north`, `${schoolId}:cls-s5-hum`],
        assignedSubjectIds: [
          `${schoolId}:sub-math`,
          `${schoolId}:sub-engl`,
          `${schoolId}:sub-econ`,
        ],
      },
    ]);

    await tx.insert(subjects).values([
      {
        id: `${schoolId}:sub-math`,
        schoolId,
        code: 'MATH',
        name: 'Mathematics',
        level: 'olevel',
        category: 'compulsory',
        maxMarks: 100,
        passMark: 50,
        competencies: ['Solves numerical, algebraic and geometric problems accurately'],
      },
      {
        id: `${schoolId}:sub-engl`,
        schoolId,
        code: 'ENGL',
        name: 'English Language',
        level: 'olevel',
        category: 'compulsory',
        maxMarks: 100,
        passMark: 50,
        competencies: ['Writes structured essays and analyses formal comprehension texts'],
      },
      {
        id: `${schoolId}:sub-chem`,
        schoolId,
        code: 'CHEM',
        name: 'Chemistry',
        level: 'olevel',
        category: 'compulsory',
        maxMarks: 100,
        passMark: 50,
        competencies: ['Demonstrates safe laboratory measurement and reaction analysis'],
      },
      {
        id: `${schoolId}:sub-hist`,
        schoolId,
        code: 'P210',
        name: 'History',
        level: 'alevel',
        category: 'principal',
        maxMarks: 100,
        passMark: 45,
        competencies: ['East African & World Constitutional History'],
      },
      {
        id: `${schoolId}:sub-econ`,
        schoolId,
        code: 'P220',
        name: 'Economics',
        level: 'alevel',
        category: 'principal',
        maxMarks: 100,
        passMark: 45,
        competencies: ['Price Theory, Monetary Policy & Economic Growth'],
      },
      {
        id: `${schoolId}:sub-div`,
        schoolId,
        code: 'P245',
        name: 'Divinity',
        level: 'alevel',
        category: 'principal',
        maxMarks: 100,
        passMark: 45,
        competencies: ['Old & New Testament Contextual Analysis'],
      },
      {
        id: `${schoolId}:sub-gp`,
        schoolId,
        code: 'S101',
        name: 'General Paper',
        level: 'alevel',
        category: 'subsidiary',
        maxMarks: 100,
        passMark: 50,
        competencies: ['Critical Logic & Contemporary Essays'],
      },
    ]);

    await tx.insert(subjectCombinations).values([
      {
        id: `${schoolId}:comb-hed`,
        schoolId,
        code: 'HED/GP',
        name: 'History, Economics, Divinity + General Paper',
        principalSubjectIds: [
          `${schoolId}:sub-hist`,
          `${schoolId}:sub-econ`,
          `${schoolId}:sub-div`,
        ],
        subsidiarySubjectIds: [`${schoolId}:sub-gp`],
      },
    ]);

    await tx.insert(classesStreams).values([
      {
        id: `${schoolId}:cls-s1-north`,
        schoolId,
        name: 'S.1 North',
        gradeLevel: 'S.1',
        stream: 'North',
        level: 'olevel',
        classTeacherId: `${schoolId}:usr-teacher-1`,
        subjectIds: [
          `${schoolId}:sub-math`,
          `${schoolId}:sub-engl`,
          `${schoolId}:sub-chem`,
        ],
        subjectTeacherMap: {
          [`${schoolId}:sub-math`]: `${schoolId}:usr-teacher-1`,
          [`${schoolId}:sub-engl`]: `${schoolId}:usr-teacher-1`,
          [`${schoolId}:sub-chem`]: `${schoolId}:usr-dos`,
        },
      },
      {
        id: `${schoolId}:cls-s5-hum`,
        schoolId,
        name: 'S.5 Humanities',
        gradeLevel: 'S.5',
        stream: 'Humanities',
        level: 'alevel',
        classTeacherId: `${schoolId}:usr-dos`,
        subjectIds: [
          `${schoolId}:sub-hist`,
          `${schoolId}:sub-econ`,
          `${schoolId}:sub-div`,
          `${schoolId}:sub-gp`,
        ],
        subjectTeacherMap: {
          [`${schoolId}:sub-hist`]: `${schoolId}:usr-dos`,
          [`${schoolId}:sub-econ`]: `${schoolId}:usr-teacher-1`,
          [`${schoolId}:sub-div`]: `${schoolId}:usr-dos`,
          [`${schoolId}:sub-gp`]: `${schoolId}:usr-teacher-1`,
        },
      },
    ]);

    const mbaleStudents = [
      {
        id: `${schoolId}:stu-1`,
        admissionNo: 'SMCM/26/101',
        fullName: 'Wambwa Derrick',
        gender: 'M',
        classId: `${schoolId}:cls-s1-north`,
        combinationId: null,
      },
      {
        id: `${schoolId}:stu-2`,
        admissionNo: 'SMCM/26/102',
        fullName: 'Namono Juliet',
        gender: 'F',
        classId: `${schoolId}:cls-s1-north`,
        combinationId: null,
      },
      {
        id: `${schoolId}:stu-3`,
        admissionNo: 'SMCM/26/103',
        fullName: 'Masaba Timothy',
        gender: 'M',
        classId: `${schoolId}:cls-s1-north`,
        combinationId: null,
      },
      {
        id: `${schoolId}:stu-4`,
        admissionNo: 'SMCM/26/104',
        fullName: 'Nandudu Esther',
        gender: 'F',
        classId: `${schoolId}:cls-s1-north`,
        combinationId: null,
      },
      {
        id: `${schoolId}:stu-5`,
        admissionNo: 'SMCM/26/501',
        fullName: 'Kakai Priscilla',
        gender: 'F',
        classId: `${schoolId}:cls-s5-hum`,
        combinationId: `${schoolId}:comb-hed`,
      },
      {
        id: `${schoolId}:stu-6`,
        admissionNo: 'SMCM/26/502',
        fullName: 'Wabwire Joel',
        gender: 'M',
        classId: `${schoolId}:cls-s5-hum`,
        combinationId: `${schoolId}:comb-hed`,
      },
    ];

    await tx.insert(students).values(
      mbaleStudents.map((s) => ({
        ...s,
        schoolId,
        academicYear: '2026',
        status: 'active',
      }))
    );

    const examId = `${schoolId}:exam-2026-t3`;
    await tx.insert(examinations).values([
      {
        id: examId,
        schoolId,
        name: 'Term III End of Term',
        examType: 'End of Term',
        term: 'Term III',
        academicYear: '2026',
        levelScope: 'all',
        classIds: [`${schoolId}:cls-s1-north`, `${schoolId}:cls-s5-hum`],
        examDate: '2026-11-12',
        submissionDeadline: '2026-11-22',
        locked: false,
        published: false,
        createdAt: '2026-11-01T08:00:00Z',
      },
    ]);

    await tx.insert(marksheets).values([
      {
        id: `${schoolId}:ms-1`,
        schoolId,
        examId,
        classId: `${schoolId}:cls-s1-north`,
        subjectId: `${schoolId}:sub-math`,
        teacherId: `${schoolId}:usr-teacher-1`,
        status: 'approved',
        entries: {
          [`${schoolId}:stu-1`]: { u1: '2.7', u2: '2.8', u3: '2.9', eot: '88' },
          [`${schoolId}:stu-2`]: { u1: '2.5', u2: '2.4', u3: '2.6', eot: '79' },
          [`${schoolId}:stu-3`]: { u1: '2.1', u2: '2.0', u3: '2.2', eot: '64' },
          [`${schoolId}:stu-4`]: { u1: '2.8', u2: '2.9', u3: '2.7', eot: '91' },
        },
        submittedAt: '2026-11-13T09:00:00Z',
        submittedBy: `${schoolId}:usr-teacher-1`,
        approvedAt: '2026-11-13T14:00:00Z',
        approvedBy: `${schoolId}:usr-dos`,
        lastModified: '2026-11-13T14:00:00Z',
        auditHistory: [],
      },
      {
        id: `${schoolId}:ms-2`,
        schoolId,
        examId,
        classId: `${schoolId}:cls-s1-north`,
        subjectId: `${schoolId}:sub-engl`,
        teacherId: `${schoolId}:usr-teacher-1`,
        status: 'submitted',
        entries: {
          [`${schoolId}:stu-1`]: { u1: '2.4', u2: '2.5', u3: '2.6', eot: '81' },
          [`${schoolId}:stu-2`]: { u1: '2.7', u2: '2.8', u3: '2.7', eot: '86' },
          [`${schoolId}:stu-3`]: { u1: '1.9', u2: '2.1', u3: '2.0', eot: '61' },
          [`${schoolId}:stu-4`]: { u1: '2.6', u2: '2.7', u3: '2.8', eot: '84' },
        },
        submittedAt: '2026-11-13T10:30:00Z',
        submittedBy: `${schoolId}:usr-teacher-1`,
        lastModified: '2026-11-13T10:30:00Z',
        auditHistory: [],
      },
      {
        id: `${schoolId}:ms-3`,
        schoolId,
        examId,
        classId: `${schoolId}:cls-s5-hum`,
        subjectId: `${schoolId}:sub-econ`,
        teacherId: `${schoolId}:usr-teacher-1`,
        status: 'approved',
        entries: {
          [`${schoolId}:stu-5`]: { mark: '82' },
          [`${schoolId}:stu-6`]: { mark: '74' },
        },
        submittedAt: '2026-11-13T11:00:00Z',
        submittedBy: `${schoolId}:usr-teacher-1`,
        approvedAt: '2026-11-13T16:00:00Z',
        approvedBy: `${schoolId}:usr-dos`,
        lastModified: '2026-11-13T16:00:00Z',
        auditHistory: [],
      },
    ]);

    await tx.insert(subscriptionInvoices).values([
      {
        id: `inv-${schoolId}-2026-t3`,
        schoolId,
        termName: 'Term III',
        academicYear: '2026',
        activeStudentsCount: mbaleStudents.length,
        licensedQuota: 150,
        unitFeeUgx: 5000,
        totalAmountUgx: mbaleStudents.length * 5000,
        status: 'pending',
        issuedAt: '2026-11-01',
        paidAt: null,
      },
    ]);
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

  const scope: CurriculumScope = input.curriculumScope || 'olevel_alevel';
  const includeOlevel = scope === 'olevel_only' || scope === 'olevel_alevel';
  const includeAlevel = scope === 'alevel_only' || scope === 'olevel_alevel';

  const schoolId = `sch-${cleanSub}-${Date.now().toString(36).slice(-4)}`;
  const { quota, unitFeeUgx } = PLAN_QUOTAS[input.plan] ?? PLAN_QUOTAS.standard;
  const adminStaffId = `${schoolId}:usr-admin`;
  const dosStaffId = `${schoolId}:usr-dos`;
  const classTeacherStaffId = `${schoolId}:usr-classteacher`;
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
    Object.fromEntries(subIds.map((id) => [id, dosStaffId]));

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
            classTeacherId: classTeacherStaffId,
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
            classTeacherId: classTeacherStaffId,
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
            classTeacherId: dosStaffId,
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
            classTeacherId: dosStaffId,
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
            classTeacherId: includeOlevel ? dosStaffId : classTeacherStaffId,
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
            classTeacherId: dosStaffId,
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
  const schoolPhoneClean = normalizeStoredPhone(input.phone) ?? (input.phone.trim() || '+256700000000');
  const adminPhoneClean = normalizeStoredPhone(input.adminPhone) ?? schoolPhoneClean;
  const adminPasswordHash = hashPassword(input.adminPassword?.trim() || 'SchuleFlow2026!');
  const defaultStaffHash = hashPassword('SchuleFlow2026!');
  const bursarStaffId = `${schoolId}:usr-bursar`;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schools).values({
        id: schoolId,
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
          id: adminStaffId,
          schoolId,
          name: input.adminName.trim(),
          email: adminEmailClean,
          username: adminUsernameClean,
          passwordHash: adminPasswordHash,
          role: 'school_admin',
          active: true,
          phone: adminPhoneClean,
          assignedClassIds: [],
          assignedSubjectIds: [],
        },
        {
          id: dosStaffId,
          schoolId,
          name: input.dosName.trim() || 'Director of Studies',
          email: `dos@${cleanSub}.ac.ug`,
          username: `dos_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'dos',
          active: true,
          phone: null,
          assignedClassIds: classIds,
          assignedSubjectIds: scopedSubjects.map((s) => s.id),
        },
        {
          id: classTeacherStaffId,
          schoolId,
          name: 'Class Teacher (Homeroom)',
          email: `classteacher@${cleanSub}.ac.ug`,
          username: `teacher_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'class_teacher',
          active: true,
          phone: null,
          assignedClassIds: classIds.slice(0, 2),
          assignedSubjectIds: scopedSubjects.slice(0, 3).map((s) => s.id),
        },
        {
          id: bursarStaffId,
          schoolId,
          name: 'School Bursar',
          email: `bursar@${cleanSub}.ac.ug`,
          username: `bursar_${cleanSub}`,
          passwordHash: defaultStaffHash,
          role: 'bursar',
          active: true,
          phone: null,
          assignedClassIds: [],
          assignedSubjectIds: [],
        },
      ]);

      const existingAdminUser = await tx
        .select({ id: users.id, globalRole: users.globalRole })
        .from(users)
        .where(sql`lower(trim(${users.email})) = ${adminEmailClean}`)
        .limit(1);

      if (existingAdminUser[0] && existingAdminUser[0].globalRole !== 'super_admin') {
        await tx
          .update(users)
          .set({
            email: adminEmailClean,
            username: adminUsernameClean,
            phone: adminPhoneClean,
            passwordHash: adminPasswordHash,
            name: input.adminName.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'school_admin',
            active: true,
          })
          .where(eq(users.id, existingAdminUser[0].id));
      }

      await tx
        .insert(users)
        .values([
          ...(existingAdminUser[0]
            ? []
            : [
                {
                  uid: `local:${adminStaffId}`,
                  email: adminEmailClean,
                  username: adminUsernameClean,
                  phone: adminPhoneClean,
                  passwordHash: adminPasswordHash,
                  name: input.adminName.trim(),
                  globalRole: 'school_user',
                  schoolId,
                  schoolRole: 'school_admin',
                  active: true,
                },
              ]),
          {
            uid: `local:${dosStaffId}`,
            email: `dos@${cleanSub}.ac.ug`,
            username: `dos_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: input.dosName.trim() || 'Director of Studies',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'dos',
            active: true,
          },
          {
            uid: `local:${classTeacherStaffId}`,
            email: `classteacher@${cleanSub}.ac.ug`,
            username: `teacher_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: 'Class Teacher (Homeroom)',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'class_teacher',
            active: true,
          },
          {
            uid: `local:${bursarStaffId}`,
            email: `bursar@${cleanSub}.ac.ug`,
            username: `bursar_${cleanSub}`,
            phone: null,
            passwordHash: defaultStaffHash,
            name: 'School Bursar',
            globalRole: 'school_user',
            schoolId,
            schoolRole: 'bursar',
            active: true,
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
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Failed to onboard school tenant:', error);
    throw new Error('Failed to provision new school tenant.', { cause: error });
  }
}

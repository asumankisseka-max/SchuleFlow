import { and, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_REPORT_CARD_LAYOUT,
} from '../data/sampleData.ts';
import { hashPassword } from '../lib/passwordAuth.ts';
import type {
  AuditLogRecord,
  BillingStatus,
  CurriculumScope,
  ExaminationPeriod,
  MarksheetRecord,
  PublicSchoolBranding,
  SchoolDatabase,
  SchoolSettings,
  SchoolStatus,
  SchoolTenant,
  StreamClass,
  StudentProfile,
  StudentTermRemarks,
  SubjectCombination,
  SubjectDefinition,
  SubscriptionInvoice,
  SubscriptionPlan,
  UserAccount,
  UserRole,
} from '../types.ts';
import { normalizeUserRole } from '../utils/rbac.ts';
import {
  DEFAULT_UNIFORM_PRIMARY,
  DEFAULT_UNIFORM_SECONDARY,
  normalizeHexColor,
} from '../utils/schoolTheme.ts';
import { normalizeStoredPhone } from '../utils/validation.ts';
import { db } from './index.ts';
import {
  auditLogs,
  classesStreams,
  examinations,
  gradingConfigs,
  loginActivity,
  marksheets,
  schools,
  staffTeachers,
  studentRemarks,
  students,
  subjectCombinations,
  subjects,
  subscriptionInvoices,
  users,
} from './schema.ts';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Executes a tenant-scoped database operation inside a PostgreSQL transaction
 * setting `app.current_school_id` for session-level RLS context alongside
 * explicit `school_id` predicates on every Drizzle query.
 */
export async function withTenantScope<T>(
  schoolId: string,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}

export async function listAllSchoolsWithStats(): Promise<SchoolTenant[]> {
  try {
    const schoolRows = await db.select().from(schools);
    const studentCounts = await db
      .select({
        schoolId: students.schoolId,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(eq(students.status, 'active'))
      .groupBy(students.schoolId);

    const staffCounts = await db
      .select({
        schoolId: staffTeachers.schoolId,
        count: sql<number>`count(*)::int`,
      })
      .from(staffTeachers)
      .groupBy(staffTeachers.schoolId);

    const studentMap = new Map(studentCounts.map((r) => [r.schoolId, r.count]));
    const staffMap = new Map(staffCounts.map((r) => [r.schoolId, r.count]));

    return schoolRows.map((row) => ({
      id: row.id,
      name: row.name,
      subdomain: row.subdomain,
      ministryRegNo: row.ministryRegNo,
      subCounty: row.subCounty,
      motto: row.motto,
      logoUrl: row.logoUrl,
      primaryColor: row.primaryColor || DEFAULT_UNIFORM_PRIMARY,
      secondaryColor: row.secondaryColor || DEFAULT_UNIFORM_SECONDARY,
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
      activeStudentCount: studentMap.get(row.id) ?? 0,
      staffCount: staffMap.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Failed to list schools:', error);
    throw new Error('Could not load registered schools.', { cause: error });
  }
}

export async function listPublicSchoolBranding(): Promise<PublicSchoolBranding[]> {
  try {
    const rows = await db
      .select({
        id: schools.id,
        name: schools.name,
        subdomain: schools.subdomain,
        district: schools.district,
        logoUrl: schools.logoUrl,
        primaryColor: schools.primaryColor,
        secondaryColor: schools.secondaryColor,
      })
      .from(schools);

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        district: row.district,
        logoUrl: row.logoUrl,
        primaryColor: row.primaryColor || DEFAULT_UNIFORM_PRIMARY,
        secondaryColor: row.secondaryColor || DEFAULT_UNIFORM_SECONDARY,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Failed to list public school branding:', error);
    throw new Error('Could not load school branding list.', { cause: error });
  }
}

export async function updateSchoolSubscription(
  schoolId: string,
  patch: Partial<{
    status: SchoolStatus;
    subscriptionStatus: SchoolStatus;
    licenseExpiresAt: string;
    plan: SubscriptionPlan;
    studentQuota: number;
    termFeePerStudentUgx: number;
    billingStatus: BillingStatus;
    nextBillingDate: string;
  }>
): Promise<SchoolTenant | null> {
  try {
    const [existing] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    if (!existing) return null;

    const nextPlan = patch.plan;
    const planConfig = nextPlan ? PLAN_DETAILS[nextPlan] : undefined;
    const resolvedQuota =
      patch.studentQuota !== undefined
        ? patch.studentQuota
        : planConfig
          ? planConfig.quota
          : existing.studentQuota;

    const nextStatus = patch.subscriptionStatus ?? patch.status;
    const nextExpiry = patch.licenseExpiresAt ? new Date(patch.licenseExpiresAt) : undefined;
    const hasValidExpiry = Boolean(nextExpiry && !Number.isNaN(nextExpiry.getTime()));

    const updateValues: Partial<typeof schools.$inferInsert> = {
      ...(nextPlan ? { plan: nextPlan } : {}),
      ...(nextPlan || patch.studentQuota !== undefined ? { studentQuota: resolvedQuota } : {}),
      ...(patch.termFeePerStudentUgx !== undefined
        ? { termFeePerStudentUgx: patch.termFeePerStudentUgx }
        : {}),
      ...(patch.billingStatus ? { billingStatus: patch.billingStatus } : {}),
      ...(patch.nextBillingDate ? { nextBillingDate: patch.nextBillingDate } : {}),
      ...(nextStatus ? { status: nextStatus, subscriptionStatus: nextStatus } : {}),
      ...(hasValidExpiry && nextExpiry
        ? {
            licenseExpiresAt: nextExpiry,
            nextBillingDate: nextExpiry.toISOString().slice(0, 10),
          }
        : {}),
      updatedAt: new Date(),
    };

    const planChanged = Boolean(nextPlan && nextPlan !== existing.plan);
    const expiryExtended = Boolean(
      hasValidExpiry &&
        nextExpiry &&
        nextExpiry.getTime() > existing.licenseExpiresAt.getTime()
    );

    await db.transaction(async (tx) => {
      await tx.update(schools).set(updateValues).where(eq(schools.id, schoolId));

      if (planChanged || expiryExtended) {
        const countRows = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(students)
          .where(and(eq(students.schoolId, schoolId), eq(students.status, 'active')));
        const activeStudentsCount = countRows[0]?.count ?? 0;
        const effectivePlan = (nextPlan ?? existing.plan) as SubscriptionPlan;
        const pkgLabel = (PLAN_DETAILS[effectivePlan] ?? PLAN_DETAILS.standard).label;
        const todayIso = new Date().toISOString().slice(0, 10);

        await tx.insert(subscriptionInvoices).values({
          id: `sub-${schoolId}-${Date.now().toString(36)}`,
          schoolId,
          termName: `${pkgLabel} Package (${existing.termName})`,
          academicYear: existing.academicYear,
          activeStudentsCount,
          licensedQuota: resolvedQuota,
          unitFeeUgx: 0,
          totalAmountUgx: 0,
          status: 'paid',
          issuedAt: todayIso,
          paidAt: todayIso,
        });
      }
    });

    const all = await listAllSchoolsWithStats();
    return all.find((s) => s.id === schoolId) ?? null;
  } catch (error) {
    console.error('Failed to update school subscription:', error);
    throw new Error('Could not update school subscription status.', { cause: error });
  }
}

export async function deleteSchoolTenant(schoolId: string): Promise<{
  id: string;
  name: string;
  subdomain: string;
  ministryRegNo: string;
} | null> {
  try {
    const existing = await db
      .select({
        id: schools.id,
        name: schools.name,
        subdomain: schools.subdomain,
        ministryRegNo: schools.ministryRegNo,
      })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const target = existing[0];
    if (!target) return null;

    await db.transaction(async (tx) => {
      // Detach historical audit logs before removing the school record
      await tx
        .update(auditLogs)
        .set({ schoolId: null })
        .where(eq(auditLogs.schoolId, schoolId));

      // Remove school-scoped user accounts (preserving any platform super_admin)
      await tx
        .delete(users)
        .where(
          and(
            ne(users.globalRole, 'super_admin'),
            or(eq(users.schoolId, schoolId), like(users.uid, `local:${schoolId}:%`))
          )
        );

      // Delete the school (cascades to students, marksheets, staff_teachers, exams, classes, etc.)
      await tx.delete(schools).where(eq(schools.id, schoolId));
    });

    return target;
  } catch (error) {
    console.error('Failed to delete school tenant:', error);
    throw new Error('Could not delete school tenant and its associated records.', { cause: error });
  }
}

export async function recordAuditLog(entry: {
  userId: string;
  userEmail: string;
  userRole: string;
  schoolId: string | null;
  action: string;
  details: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      userId: entry.userId,
      userEmail: entry.userEmail,
      userRole: entry.userRole,
      schoolId: entry.schoolId,
      action: entry.action,
      details: entry.details,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Failed to record platform audit log:', error);
  }
}

export async function listPlatformAuditLogs(limit = 60): Promise<AuditLogRecord[]> {
  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userEmail: auditLogs.userEmail,
        userRole: auditLogs.userRole,
        schoolId: auditLogs.schoolId,
        schoolName: schools.name,
        action: auditLogs.action,
        details: auditLogs.details,
        timestamp: auditLogs.timestamp,
      })
      .from(auditLogs)
      .leftJoin(schools, eq(auditLogs.schoolId, schools.id))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userRole: r.userRole,
      schoolId: r.schoolId,
      schoolName: r.schoolName ?? null,
      action: r.action,
      details: r.details,
      timestamp: r.timestamp.toISOString(),
    }));
  } catch (error) {
    console.error('Failed to load audit logs:', error);
    throw new Error('Could not load platform audit logs.', { cause: error });
  }
}

export async function getTenantDatabase(schoolId: string): Promise<SchoolDatabase> {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      const [
        schoolRows,
        gradingRows,
        staffRows,
        subjectRows,
        comboRows,
        classRows,
        studentRows,
        examRows,
        marksheetRows,
        remarkRows,
        invoiceRows,
        activityRows,
      ] = await Promise.all([
        tx.select().from(schools).where(eq(schools.id, schoolId)).limit(1),
        tx.select().from(gradingConfigs).where(eq(gradingConfigs.schoolId, schoolId)).limit(1),
        tx.select().from(staffTeachers).where(eq(staffTeachers.schoolId, schoolId)),
        tx.select().from(subjects).where(eq(subjects.schoolId, schoolId)),
        tx.select().from(subjectCombinations).where(eq(subjectCombinations.schoolId, schoolId)),
        tx.select().from(classesStreams).where(eq(classesStreams.schoolId, schoolId)),
        tx.select().from(students).where(eq(students.schoolId, schoolId)),
        tx.select().from(examinations).where(eq(examinations.schoolId, schoolId)),
        tx.select().from(marksheets).where(eq(marksheets.schoolId, schoolId)),
        tx.select().from(studentRemarks).where(eq(studentRemarks.schoolId, schoolId)),
        tx.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.schoolId, schoolId)),
        tx.select().from(loginActivity).where(eq(loginActivity.schoolId, schoolId)),
      ]);

      const school = schoolRows[0];
      if (!school) {
        throw new Error('School record not found.');
      }

      const gc = gradingRows[0];
      const resolvedBadge = school.logoUrl || gc?.reportLayout?.customLogoDataUrl || undefined;
      const settings: SchoolSettings = {
        schoolName: school.name,
        schoolAddress: school.address,
        schoolPhone: school.phone,
        schoolEmail: school.email,
        academicYear: school.academicYear,
        termName: school.termName,
        principalName: school.principalName,
        dosName: school.dosName,
        curriculumScope: (school.curriculumScope as CurriculumScope) || 'olevel_alevel',
        badgeDataUrl: resolvedBadge,
        uniformPrimaryColor: school.primaryColor || DEFAULT_UNIFORM_PRIMARY,
        uniformSecondaryColor: school.secondaryColor || DEFAULT_UNIFORM_SECONDARY,
        cbcConfig: gc?.cbcConfig ?? DEFAULT_CBC_CONFIG,
        alevelPolicy: gc?.alevelPolicy ?? DEFAULT_ALEVEL_POLICY,
        olevelGradingScale: gc?.olevelGradingScale ?? DEFAULT_OLEVEL_GRADING_SCALE,
        alevelGradingScale: gc?.alevelGradingScale ?? DEFAULT_ALEVEL_GRADING_SCALE,
        reportLayout: {
          ...(gc?.reportLayout ?? DEFAULT_REPORT_CARD_LAYOUT),
          schoolMotto: gc?.reportLayout?.schoolMotto || school.motto,
          customLogoDataUrl: gc?.reportLayout?.customLogoDataUrl || school.logoUrl || undefined,
        },
      };

      const remarksMap: Record<string, StudentTermRemarks> = {};
      for (const r of remarkRows) {
        remarksMap[`${r.examId}:${r.studentId}`] = {
          classTeacherRemark: r.classTeacherRemark ?? undefined,
          dosRemark: r.dosRemark ?? undefined,
          headTeacherRemark: r.headTeacherRemark ?? undefined,
        };
      }

      const usersList: UserAccount[] = staffRows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        password: '********',
        role: normalizeUserRole(u.role),
        active: u.active,
        phone: u.phone ?? undefined,
        assignedClassIds: u.assignedClassIds,
        assignedSubjectIds: u.assignedSubjectIds,
        lastLogin: u.lastLogin ?? undefined,
      }));

      return {
        users: usersList,
        loginActivity: activityRows.map((l) => ({
          id: l.id,
          userId: l.userId,
          userName: l.userName,
          role: l.role as UserRole,
          timestamp: l.timestamp,
          action: l.action as 'login' | 'logout' | 'password_reset',
        })),
        subjects: subjectRows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          level: s.level as SubjectDefinition['level'],
          category: s.category as SubjectDefinition['category'],
          maxMarks: s.maxMarks,
          passMark: s.passMark,
          competencies: s.competencies,
        })),
        combinations: comboRows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          principalSubjectIds: c.principalSubjectIds,
          subsidiarySubjectIds: c.subsidiarySubjectIds,
        })),
        classes: classRows.map((c) => ({
          id: c.id,
          name: c.name,
          gradeLevel: c.gradeLevel,
          stream: c.stream,
          level: c.level as StreamClass['level'],
          classTeacherId: c.classTeacherId,
          subjectIds: c.subjectIds,
          subjectTeacherMap: c.subjectTeacherMap,
        })),
        students: studentRows.map((stu) => ({
          id: stu.id,
          admissionNo: stu.admissionNo,
          fullName: stu.fullName,
          gender: stu.gender as 'M' | 'F',
          dateOfBirth: stu.dateOfBirth ?? undefined,
          classId: stu.classId,
          academicYear: stu.academicYear,
          status: stu.status as StudentProfile['status'],
          combinationId: stu.combinationId ?? undefined,
          parentName: stu.parentName ?? undefined,
          parentContact: stu.parentContact ?? undefined,
          photoDataUrl: stu.photoDataUrl ?? undefined,
        })),
        exams: examRows.map((e) => ({
          id: e.id,
          name: e.name,
          examType: e.examType as ExaminationPeriod['examType'],
          term: e.term,
          academicYear: e.academicYear,
          levelScope: e.levelScope as ExaminationPeriod['levelScope'],
          classIds: e.classIds,
          examDate: e.examDate,
          submissionDeadline: e.submissionDeadline,
          locked: e.locked,
          published: e.published,
          createdAt: e.createdAt,
        })),
        marksheets: marksheetRows.map((m) => ({
          id: m.id,
          examId: m.examId,
          classId: m.classId,
          subjectId: m.subjectId,
          teacherId: m.teacherId,
          status: m.status as MarksheetRecord['status'],
          entries: m.entries,
          submittedAt: m.submittedAt ?? undefined,
          submittedBy: m.submittedBy ?? undefined,
          approvedAt: m.approvedAt ?? undefined,
          approvedBy: m.approvedBy ?? undefined,
          dosComment: m.dosComment ?? undefined,
          lastModified: m.lastModified,
          auditHistory: m.auditHistory,
        })),
        studentRemarks: remarksMap,
        settings,
        reportsGeneratedCount: school.reportsGeneratedCount,
        invoices: invoiceRows.map((inv) => ({
          id: inv.id,
          schoolId: inv.schoolId,
          termName: inv.termName,
          academicYear: inv.academicYear,
          activeStudentsCount: inv.activeStudentsCount,
          licensedQuota: inv.licensedQuota,
          unitFeeUgx: inv.unitFeeUgx,
          totalAmountUgx: inv.totalAmountUgx,
          status: inv.status as BillingStatus,
          issuedAt: inv.issuedAt,
          paidAt: inv.paidAt,
        })),
      };
    });
  } catch (error) {
    console.error('Failed to load tenant database:', error);
    throw new Error('Failed to load school workspace data.', { cause: error });
  }
}

export async function addStudentsWithQuotaCheck(
  schoolId: string,
  newStudents: StudentProfile[]
): Promise<StudentProfile[]> {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      const [school] = await tx
        .select()
        .from(schools)
        .where(eq(schools.id, schoolId))
        .limit(1);
      if (!school) throw new Error('School not found.');

      const existingCountRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.status, 'active')));

      const currentActive = existingCountRows[0]?.count ?? 0;
      const incomingActive = newStudents.filter((s) => s.status === 'active').length;

      if (currentActive + incomingActive > school.studentQuota) {
        throw new Error(
          `Student license quota exceeded (${currentActive + incomingActive}/${school.studentQuota}). Upgrade your subscription tier in Billing & Licenses.`
        );
      }

      if (newStudents.length === 0) return [];

      await tx.insert(students).values(
        newStudents.map((stu) => ({
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

      return newStudents;
    });
  } catch (error) {
    console.error('Failed to add students:', error);
    if (error instanceof Error && error.message.includes('quota')) {
      throw error;
    }
    throw new Error('Failed to register student(s).', { cause: error });
  }
}

export async function updateTenantStudent(schoolId: string, stu: StudentProfile) {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      await tx
        .update(students)
        .set({
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
        })
        .where(and(eq(students.schoolId, schoolId), eq(students.id, stu.id)));
      return stu;
    });
  } catch (error) {
    console.error('Failed to update student:', error);
    throw new Error('Failed to update student record.', { cause: error });
  }
}

export async function bulkPromoteTenantStudents(
  schoolId: string,
  studentIds: string[],
  targetClassId: string
) {
  if (studentIds.length === 0) return;
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .update(students)
        .set({ classId: targetClassId })
        .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
    });
  } catch (error) {
    console.error('Failed to bulk promote students:', error);
    throw new Error('Failed to promote selected students.', { cause: error });
  }
}

export async function upsertTenantClass(schoolId: string, cls: StreamClass, attachToExamId?: string) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .insert(classesStreams)
        .values({
          id: cls.id,
          schoolId,
          name: cls.name,
          gradeLevel: cls.gradeLevel,
          stream: cls.stream,
          level: cls.level,
          classTeacherId: cls.classTeacherId,
          subjectIds: cls.subjectIds,
          subjectTeacherMap: cls.subjectTeacherMap,
        })
        .onConflictDoUpdate({
          target: classesStreams.id,
          set: {
            name: cls.name,
            gradeLevel: cls.gradeLevel,
            stream: cls.stream,
            level: cls.level,
            classTeacherId: cls.classTeacherId,
            subjectIds: cls.subjectIds,
            subjectTeacherMap: cls.subjectTeacherMap,
          },
        });

      if (attachToExamId) {
        const [ex] = await tx
          .select()
          .from(examinations)
          .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, attachToExamId)))
          .limit(1);
        if (ex && !ex.classIds.includes(cls.id)) {
          await tx
            .update(examinations)
            .set({ classIds: [...ex.classIds, cls.id] })
            .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, attachToExamId)));
        }
      }
    });
  } catch (error) {
    console.error('Failed to save class:', error);
    throw new Error('Failed to save class stream.', { cause: error });
  }
}

export async function upsertTenantSubject(schoolId: string, sub: SubjectDefinition) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .insert(subjects)
        .values({
          id: sub.id,
          schoolId,
          code: sub.code,
          name: sub.name,
          level: sub.level,
          category: sub.category,
          maxMarks: sub.maxMarks,
          passMark: sub.passMark,
          competencies: sub.competencies,
        })
        .onConflictDoUpdate({
          target: subjects.id,
          set: {
            code: sub.code,
            name: sub.name,
            level: sub.level,
            category: sub.category,
            maxMarks: sub.maxMarks,
            passMark: sub.passMark,
            competencies: sub.competencies,
          },
        });
    });
  } catch (error) {
    console.error('Failed to save subject:', error);
    throw new Error('Failed to save subject definition.', { cause: error });
  }
}

export async function upsertTenantCombination(schoolId: string, combo: SubjectCombination) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .insert(subjectCombinations)
        .values({
          id: combo.id,
          schoolId,
          code: combo.code,
          name: combo.name,
          principalSubjectIds: combo.principalSubjectIds,
          subsidiarySubjectIds: combo.subsidiarySubjectIds,
        })
        .onConflictDoUpdate({
          target: subjectCombinations.id,
          set: {
            code: combo.code,
            name: combo.name,
            principalSubjectIds: combo.principalSubjectIds,
            subsidiarySubjectIds: combo.subsidiarySubjectIds,
          },
        });
    });
  } catch (error) {
    console.error('Failed to save combination:', error);
    throw new Error('Failed to save subject combination.', { cause: error });
  }
}

export async function deleteTenantCombination(schoolId: string, comboId: string) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .delete(subjectCombinations)
        .where(
          and(
            eq(subjectCombinations.schoolId, schoolId),
            eq(subjectCombinations.id, comboId)
          )
        );
    });
  } catch (error) {
    console.error('Failed to delete combination:', error);
    throw new Error('Failed to delete subject combination.', { cause: error });
  }
}

export async function upsertTenantExam(schoolId: string, ex: ExaminationPeriod) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .insert(examinations)
        .values({
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
        })
        .onConflictDoUpdate({
          target: examinations.id,
          set: {
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
          },
        });
    });
  } catch (error) {
    console.error('Failed to save examination:', error);
    throw new Error('Failed to save examination period.', { cause: error });
  }
}

export async function upsertTenantMarksheet(schoolId: string, ms: MarksheetRecord) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      const existing = await tx
        .select()
        .from(marksheets)
        .where(
          and(
            eq(marksheets.schoolId, schoolId),
            eq(marksheets.examId, ms.examId),
            eq(marksheets.classId, ms.classId),
            eq(marksheets.subjectId, ms.subjectId)
          )
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(marksheets)
          .set({
            teacherId: ms.teacherId,
            status: ms.status,
            entries: ms.entries,
            submittedAt: ms.submittedAt ?? null,
            submittedBy: ms.submittedBy ?? null,
            approvedAt: ms.approvedAt ?? null,
            approvedBy: ms.approvedBy ?? null,
            dosComment: ms.dosComment ?? null,
            lastModified: ms.lastModified,
            auditHistory: ms.auditHistory,
          })
          .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.id, existing[0].id)));
      } else {
        await tx.insert(marksheets).values({
          id: ms.id.startsWith(`${schoolId}:`) ? ms.id : `${schoolId}:${ms.id}`,
          schoolId,
          examId: ms.examId,
          classId: ms.classId,
          subjectId: ms.subjectId,
          teacherId: ms.teacherId,
          status: ms.status,
          entries: ms.entries,
          submittedAt: ms.submittedAt ?? null,
          submittedBy: ms.submittedBy ?? null,
          approvedAt: ms.approvedAt ?? null,
          approvedBy: ms.approvedBy ?? null,
          dosComment: ms.dosComment ?? null,
          lastModified: ms.lastModified,
          auditHistory: ms.auditHistory,
        });
      }
    });
  } catch (error) {
    console.error('Failed to save marksheet:', error);
    throw new Error('Failed to save marksheet.', { cause: error });
  }
}

export async function publishAllApprovedTenantMarksheets(
  schoolId: string,
  examId: string,
  actor: { id: string; name: string; role: UserRole }
) {
  const now = new Date().toISOString();
  try {
    await withTenantScope(schoolId, async (tx) => {
      const approved = await tx
        .select()
        .from(marksheets)
        .where(
          and(
            eq(marksheets.schoolId, schoolId),
            eq(marksheets.examId, examId),
            eq(marksheets.status, 'approved')
          )
        );

      for (const m of approved) {
        const nextHistory = [
          ...m.auditHistory,
          {
            id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
            actorId: actor.id,
            actorName: actor.name,
            actorRole: actor.role,
            action: 'Published Results',
            details: 'Published officially by DOS/Headteacher.',
          },
        ];
        await tx
          .update(marksheets)
          .set({
            status: 'published',
            lastModified: now,
            auditHistory: nextHistory,
          })
          .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.id, m.id)));
      }

      await tx
        .update(examinations)
        .set({ published: true, locked: true })
        .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, examId)));
    });
  } catch (error) {
    console.error('Failed to publish exam marksheets:', error);
    throw new Error('Failed to publish approved marksheets.', { cause: error });
  }
}

export async function upsertTenantStudentRemark(
  schoolId: string,
  examId: string,
  studentId: string,
  field: keyof StudentTermRemarks,
  value: string
) {
  const rowId = `${schoolId}:${examId}:${studentId}`;
  try {
    await withTenantScope(schoolId, async (tx) => {
      const existing = await tx
        .select()
        .from(studentRemarks)
        .where(and(eq(studentRemarks.schoolId, schoolId), eq(studentRemarks.id, rowId)))
        .limit(1);

      if (existing[0]) {
        await tx
          .update(studentRemarks)
          .set({ [field]: value })
          .where(and(eq(studentRemarks.schoolId, schoolId), eq(studentRemarks.id, rowId)));
      } else {
        await tx.insert(studentRemarks).values({
          id: rowId,
          schoolId,
          examId,
          studentId,
          classTeacherRemark: field === 'classTeacherRemark' ? value : null,
          dosRemark: field === 'dosRemark' ? value : null,
          headTeacherRemark: field === 'headTeacherRemark' ? value : null,
        });
      }
    });
  } catch (error) {
    console.error('Failed to update student remark:', error);
    throw new Error('Failed to save student remark.', { cause: error });
  }
}

export async function updateTenantSettingsAndGrading(
  schoolId: string,
  settings: SchoolSettings
): Promise<{
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}> {
  const primaryColor = normalizeHexColor(settings.uniformPrimaryColor, DEFAULT_UNIFORM_PRIMARY);
  const secondaryColor = normalizeHexColor(
    settings.uniformSecondaryColor,
    DEFAULT_UNIFORM_SECONDARY
  );
  const resolvedLogo =
    settings.badgeDataUrl !== undefined
      ? settings.badgeDataUrl || null
      : settings.reportLayout.customLogoDataUrl ?? null;

  const syncedReportLayout = {
    ...settings.reportLayout,
    customLogoDataUrl: resolvedLogo ?? undefined,
    crestType:
      resolvedLogo && settings.reportLayout.crestType !== 'custom'
        ? ('custom' as const)
        : !resolvedLogo && settings.reportLayout.crestType === 'custom'
          ? ('shield' as const)
          : settings.reportLayout.crestType,
  };

  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .update(schools)
        .set({
          name: settings.schoolName,
          address: settings.schoolAddress,
          phone: settings.schoolPhone,
          email: settings.schoolEmail,
          academicYear: settings.academicYear,
          termName: settings.termName,
          principalName: settings.principalName,
          dosName: settings.dosName,
          ...(settings.curriculumScope ? { curriculumScope: settings.curriculumScope } : {}),
          motto: settings.reportLayout.schoolMotto,
          logoUrl: resolvedLogo,
          primaryColor,
          secondaryColor,
          updatedAt: new Date(),
        })
        .where(eq(schools.id, schoolId));

      await tx
        .insert(gradingConfigs)
        .values({
          id: `gc-${schoolId}`,
          schoolId,
          cbcConfig: settings.cbcConfig,
          alevelPolicy: settings.alevelPolicy,
          olevelGradingScale: settings.olevelGradingScale,
          alevelGradingScale: settings.alevelGradingScale,
          reportLayout: syncedReportLayout,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: gradingConfigs.schoolId,
          set: {
            cbcConfig: settings.cbcConfig,
            alevelPolicy: settings.alevelPolicy,
            olevelGradingScale: settings.olevelGradingScale,
            alevelGradingScale: settings.alevelGradingScale,
            reportLayout: syncedReportLayout,
            updatedAt: new Date(),
          },
        });
    });

    return {
      logoUrl: resolvedLogo,
      primaryColor,
      secondaryColor,
    };
  } catch (error) {
    console.error('Failed to save school settings:', error);
    throw new Error('Failed to save school configuration.', { cause: error });
  }
}

export async function upsertTenantStaffMember(schoolId: string, staff: UserAccount) {
  try {
    const cleanEmail = staff.email.trim().toLowerCase();
    const cleanUsername = staff.username.trim().toLowerCase() || cleanEmail.split('@')[0];
    const normalizedRole = normalizeUserRole(staff.role);
    const normalizedPhone = normalizeStoredPhone(staff.phone);
    const rawId = staff.id.trim();
    const unprefixedId = rawId.startsWith(`${schoolId}:`)
      ? rawId.slice(schoolId.length + 1)
      : rawId;
    const prefixedId = `${schoolId}:${unprefixedId}`;
    const hasNewPassword = Boolean(
      staff.password && staff.password.trim().length > 0 && staff.password !== '********'
    );
    const computedHash = hasNewPassword ? hashPassword(staff.password.trim()) : undefined;

    await withTenantScope(schoolId, async (tx) => {
      const existingStaffRows = await tx
        .select()
        .from(staffTeachers)
        .where(
          and(
            eq(staffTeachers.schoolId, schoolId),
            or(
              inArray(staffTeachers.id, [rawId, prefixedId, unprefixedId]),
              sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
            )
          )
        )
        .limit(1);

      const scopedId = existingStaffRows[0]?.id ?? (rawId.includes(':') ? rawId : prefixedId);

      await tx
        .insert(staffTeachers)
        .values({
          id: scopedId,
          schoolId,
          name: staff.name.trim(),
          email: cleanEmail,
          username: cleanUsername,
          passwordHash: computedHash ?? hashPassword('SchuleFlow2026!'),
          role: normalizedRole,
          active: staff.active,
          phone: normalizedPhone,
          assignedClassIds: staff.assignedClassIds,
          assignedSubjectIds: staff.assignedSubjectIds,
          lastLogin: staff.lastLogin ?? null,
        })
        .onConflictDoUpdate({
          target: staffTeachers.id,
          set: {
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            role: normalizedRole,
            active: staff.active,
            phone: normalizedPhone,
            assignedClassIds: staff.assignedClassIds,
            assignedSubjectIds: staff.assignedSubjectIds,
            ...(computedHash ? { passwordHash: computedHash } : {}),
          },
        });

      const existingAuthUsers = await tx
        .select()
        .from(users)
        .where(
          or(
            and(eq(users.schoolId, schoolId), sql`lower(trim(${users.email})) = ${cleanEmail}`),
            eq(users.uid, `local:${scopedId}`)
          )
        )
        .limit(1);

      if (existingAuthUsers[0]) {
        await tx
          .update(users)
          .set({
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
            ...(computedHash ? { passwordHash: computedHash } : {}),
          })
          .where(eq(users.id, existingAuthUsers[0].id));
      } else {
        await tx
          .insert(users)
          .values({
            uid: `local:${scopedId}`,
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            passwordHash: computedHash ?? hashPassword('SchuleFlow2026!'),
            name: staff.name.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              email: cleanEmail,
              username: cleanUsername,
              phone: normalizedPhone,
              name: staff.name.trim(),
              schoolId,
              schoolRole: normalizedRole,
              active: staff.active,
              ...(computedHash ? { passwordHash: computedHash } : {}),
            },
          });
      }
    });
  } catch (error) {
    console.error('Failed to save staff member:', error);
    throw new Error('Failed to save staff account.', { cause: error });
  }
}

export async function bulkUpsertTenantStaff(schoolId: string, staffList: UserAccount[]) {
  if (staffList.length === 0) return [];
  try {
    await withTenantScope(schoolId, async (tx) => {
      for (const staff of staffList) {
        const scopedId = staff.id.includes(':') ? staff.id : `${schoolId}:${staff.id}`;
        const cleanEmail = staff.email.trim().toLowerCase();
        const cleanUsername = staff.username.trim().toLowerCase() || cleanEmail.split('@')[0];
        const normalizedRole = normalizeUserRole(staff.role);
        const normalizedPhone = normalizeStoredPhone(staff.phone);
        const pwdHash =
          staff.password && staff.password !== '********'
            ? hashPassword(staff.password)
            : hashPassword('SchuleFlow2026!');

        await tx
          .insert(staffTeachers)
          .values({
            id: scopedId,
            schoolId,
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            passwordHash: pwdHash,
            role: normalizedRole,
            active: staff.active,
            phone: normalizedPhone,
            assignedClassIds: staff.assignedClassIds,
            assignedSubjectIds: staff.assignedSubjectIds,
            lastLogin: staff.lastLogin ?? null,
          })
          .onConflictDoUpdate({
            target: staffTeachers.id,
            set: {
              name: staff.name.trim(),
              email: cleanEmail,
              username: cleanUsername,
              role: normalizedRole,
              active: staff.active,
              phone: normalizedPhone,
              assignedClassIds: staff.assignedClassIds,
              assignedSubjectIds: staff.assignedSubjectIds,
            },
          });

        await tx
          .insert(users)
          .values({
            uid: `local:${scopedId}`,
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            passwordHash: pwdHash,
            name: staff.name.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              email: cleanEmail,
              username: cleanUsername,
              phone: normalizedPhone,
              name: staff.name.trim(),
              schoolRole: normalizedRole,
              active: staff.active,
            },
          });
      }
    });
    return staffList;
  } catch (error) {
    console.error('Failed to bulk upload staff members:', error);
    throw new Error('Failed to import staff directory.', { cause: error });
  }
}

export async function incrementTenantReportsGenerated(schoolId: string, count: number) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .update(schools)
        .set({
          reportsGeneratedCount: sql`${schools.reportsGeneratedCount} + ${count}`,
        })
        .where(eq(schools.id, schoolId));
    });
  } catch (error) {
    console.error('Failed to increment report count:', error);
  }
}

export async function generateTermlyInvoiceForSchool(
  schoolId: string
): Promise<SubscriptionInvoice> {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      const [school] = await tx
        .select()
        .from(schools)
        .where(eq(schools.id, schoolId))
        .limit(1);
      if (!school) throw new Error('School not found.');

      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.status, 'active')));

      const activeStudentsCount = countRows[0]?.count ?? 0;
      const totalAmountUgx = activeStudentsCount * school.termFeePerStudentUgx;

      const invoice: SubscriptionInvoice = {
        id: `inv-${schoolId}-${Date.now().toString(36)}`,
        schoolId,
        termName: school.termName,
        academicYear: school.academicYear,
        activeStudentsCount,
        licensedQuota: school.studentQuota,
        unitFeeUgx: school.termFeePerStudentUgx,
        totalAmountUgx,
        status: 'pending',
        issuedAt: new Date().toISOString().slice(0, 10),
        paidAt: null,
      };

      await tx.insert(subscriptionInvoices).values(invoice);
      return invoice;
    });
  } catch (error) {
    console.error('Failed to generate invoice:', error);
    throw new Error('Failed to generate termly subscription invoice.', { cause: error });
  }
}

export async function markInvoicePaid(schoolId: string, invoiceId: string) {
  try {
    await withTenantScope(schoolId, async (tx) => {
      const paidAt = new Date().toISOString().slice(0, 10);
      await tx
        .update(subscriptionInvoices)
        .set({ status: 'paid', paidAt })
        .where(
          and(
            eq(subscriptionInvoices.schoolId, schoolId),
            eq(subscriptionInvoices.id, invoiceId)
          )
        );
      await tx
        .update(schools)
        .set({ billingStatus: 'paid', status: 'active', subscriptionStatus: 'active' })
        .where(eq(schools.id, schoolId));
    });
  } catch (error) {
    console.error('Failed to mark invoice paid:', error);
    throw new Error('Failed to settle invoice.', { cause: error });
  }
}

export async function getSchoolSubscriptionOverview(schoolId: string): Promise<{
  activeStudentsCount: number;
  invoices: SubscriptionInvoice[];
}> {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      const [countRows, invoiceRows] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(students)
          .where(and(eq(students.schoolId, schoolId), eq(students.status, 'active'))),
        tx
          .select()
          .from(subscriptionInvoices)
          .where(eq(subscriptionInvoices.schoolId, schoolId)),
      ]);

      return {
        activeStudentsCount: countRows[0]?.count ?? 0,
        invoices: invoiceRows.map((inv) => ({
          id: inv.id,
          schoolId: inv.schoolId,
          termName: inv.termName,
          academicYear: inv.academicYear,
          activeStudentsCount: inv.activeStudentsCount,
          licensedQuota: inv.licensedQuota,
          unitFeeUgx: inv.unitFeeUgx,
          totalAmountUgx: inv.totalAmountUgx,
          status: inv.status as BillingStatus,
          issuedAt: inv.issuedAt,
          paidAt: inv.paidAt,
        })),
      };
    });
  } catch (error) {
    console.error('Failed to load subscription overview:', error);
    throw new Error('Failed to load school subscription details.', { cause: error });
  }
}

const PLAN_DETAILS: Record<
  SubscriptionPlan,
  { label: string; quota: number; defaultDays: number; targetStatus: SchoolStatus }
> = {
  trial: { label: 'Trial', quota: 80, defaultDays: 30, targetStatus: 'trial' },
  starter: { label: 'Starter', quota: 200, defaultDays: 365, targetStatus: 'active' },
  standard: { label: 'Standard', quota: 500, defaultDays: 365, targetStatus: 'active' },
  enterprise: { label: 'Enterprise', quota: 1500, defaultDays: 365, targetStatus: 'active' },
};

export async function activateSchoolSubscriptionPackage(
  schoolId: string,
  plan: SubscriptionPlan,
  durationDays?: number
): Promise<{ school: SchoolTenant; invoice: SubscriptionInvoice }> {
  const pkg = PLAN_DETAILS[plan] ?? PLAN_DETAILS.standard;
  const days =
    durationDays && durationDays > 0 ? Math.min(730, Math.round(durationDays)) : pkg.defaultDays;

  try {
    const invoice = await withTenantScope(schoolId, async (tx) => {
      const [school] = await tx
        .select()
        .from(schools)
        .where(eq(schools.id, schoolId))
        .limit(1);
      if (!school) throw new Error('School not found.');

      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.status, 'active')));
      const activeStudentsCount = countRows[0]?.count ?? 0;

      const currentExpiryMs =
        school.licenseExpiresAt instanceof Date ? school.licenseExpiresAt.getTime() : 0;
      const baseMs = Math.max(Date.now(), currentExpiryMs);
      const nextExpiry = new Date(baseMs + days * 86400000);
      const nextBillingDate = nextExpiry.toISOString().slice(0, 10);
      const todayIso = new Date().toISOString().slice(0, 10);

      await tx
        .update(schools)
        .set({
          plan,
          studentQuota: pkg.quota,
          termFeePerStudentUgx: 0,
          status: pkg.targetStatus,
          subscriptionStatus: pkg.targetStatus,
          licenseExpiresAt: nextExpiry,
          billingStatus: 'paid',
          nextBillingDate,
          updatedAt: new Date(),
        })
        .where(eq(schools.id, schoolId));

      const newInvoice: SubscriptionInvoice = {
        id: `sub-${schoolId}-${Date.now().toString(36)}`,
        schoolId,
        termName: `${pkg.label} Package (${school.termName})`,
        academicYear: school.academicYear,
        activeStudentsCount,
        licensedQuota: pkg.quota,
        unitFeeUgx: 0,
        totalAmountUgx: 0,
        status: 'paid',
        issuedAt: todayIso,
        paidAt: todayIso,
      };

      await tx.insert(subscriptionInvoices).values(newInvoice);
      return newInvoice;
    });

    const all = await listAllSchoolsWithStats();
    const updatedSchool = all.find((s) => s.id === schoolId);
    if (!updatedSchool) throw new Error('Updated school record not found.');
    return { school: updatedSchool, invoice };
  } catch (error) {
    console.error('Failed to activate school subscription package:', error);
    throw new Error('Failed to activate subscription package.', { cause: error });
  }
}

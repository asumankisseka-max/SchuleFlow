import { randomBytes } from 'node:crypto';
import { and, desc, eq, ilike, inArray, like, ne, or, sql } from 'drizzle-orm';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_REPORT_CARD_LAYOUT,
} from '../data/sampleData.ts';
import { hashPassword, validatePasswordStrength } from '../lib/passwordAuth.ts';
import {
  isInlineDataImageUrl,
  isSupabaseStorageConfigured,
  uploadMediaToSupabase,
} from '../lib/supabaseStorage.ts';
import type {
  AuditLogRecord,
  BillingStatus,
  CurriculumScope,
  ExaminationPeriod,
  MarksheetCorrectionRequest,
  MarksheetRecord,
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
import {
  extractSchoolInitials,
  generateNextStaffId,
  generateNextStudentId,
} from '../utils/idGenerator.ts';
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

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class PermissionError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class ValidationAppError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationAppError';
  }
}

export interface TenantActorContext {
  uid: string;
  email: string;
  staffId?: string;
  name?: string;
  role: UserRole;
}

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
      schoolCode: row.schoolCode,
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
        correctionRequestRows,
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
        tx
          .select()
          .from(marksheetCorrectionRequests)
          .where(eq(marksheetCorrectionRequests.schoolId, schoolId))
          .orderBy(desc(marksheetCorrectionRequests.createdAt)),
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
        staffId: u.staffId ?? undefined,
        name: u.name,
        email: u.email,
        username: u.username,
        password: '********',
        role: normalizeUserRole(u.role),
        active: u.active,
        mustChangePassword: Boolean(u.mustChangePassword),
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
          archived: Boolean(s.archived),
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
          stream: c.stream || undefined,
          level: c.level as StreamClass['level'],
          classTeacherId: c.classTeacherId,
          subjectIds: c.subjectIds,
          subjectTeacherMap: c.subjectTeacherMap,
          archived: Boolean(c.archived),
        })),
        students: studentRows.map((stu) => ({
          id: stu.id,
          studentId: stu.studentId ?? undefined,
          admissionNo: stu.admissionNo,
          fullName: stu.fullName,
          gender: stu.gender as 'M' | 'F',
          dateOfBirth: stu.dateOfBirth ?? undefined,
          classId: stu.classId,
          academicYear: stu.academicYear,
          status: stu.status as StudentProfile['status'],
          combinationId: stu.combinationId ?? undefined,
          offeredSubjectIds: stu.offeredSubjectIds ?? undefined,
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
          archived: Boolean(e.archived),
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
          version: m.version ?? 1,
          lastModified: m.lastModified,
          auditHistory: m.auditHistory,
        })),
        correctionRequests: correctionRequestRows.map((cr) => ({
          id: cr.id,
          schoolId: cr.schoolId,
          marksheetId: cr.marksheetId,
          examId: cr.examId,
          classId: cr.classId,
          subjectId: cr.subjectId,
          assessmentScope: cr.assessmentScope as MarksheetCorrectionRequest['assessmentScope'],
          requestedByUserId: cr.requestedByUserId,
          requestedByName: cr.requestedByName,
          requestedByStaffId: cr.requestedByStaffId ?? undefined,
          reason: cr.reason,
          status: cr.status as MarksheetCorrectionRequest['status'],
          reviewedByUserId: cr.reviewedByUserId ?? undefined,
          reviewedByName: cr.reviewedByName ?? undefined,
          reviewNote: cr.reviewNote ?? undefined,
          createdAt: cr.createdAt,
          reviewedAt: cr.reviewedAt ?? undefined,
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
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stu:${schoolId}`}))`);
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

      const uniqueClassIds = Array.from(new Set(newStudents.map((s) => s.classId)));
      const validClassRows = await tx
        .select({ id: classesStreams.id })
        .from(classesStreams)
        .where(and(eq(classesStreams.schoolId, schoolId), inArray(classesStreams.id, uniqueClassIds)));
      const validClassSet = new Set(validClassRows.map((c) => c.id));
      for (const cid of uniqueClassIds) {
        if (!validClassSet.has(cid)) {
          throw new ValidationAppError('Selected class does not belong to this school workspace.');
        }
      }

      const existingStudentIdRows = await tx
        .select({ studentId: students.studentId })
        .from(students)
        .where(eq(students.schoolId, schoolId));

      const initials = extractSchoolInitials(school.name);
      const usedStudentIds = existingStudentIdRows
        .map((r) => r.studentId)
        .filter((v): v is string => Boolean(v && v.trim()));
      const usedSet = new Set(usedStudentIds.map((id) => id.toUpperCase()));

      const preparedStudents: StudentProfile[] = newStudents.map((stu) => {
        const providedId = stu.studentId?.trim().toUpperCase();
        const generatedStudentId =
          providedId && !usedSet.has(providedId)
            ? providedId
            : generateNextStudentId(initials, usedStudentIds, true);
        usedStudentIds.push(generatedStudentId);
        usedSet.add(generatedStudentId.toUpperCase());
        const resolvedAdmissionNo = stu.admissionNo?.trim() || generatedStudentId;

        return {
          ...stu,
          studentId: generatedStudentId,
          admissionNo: resolvedAdmissionNo,
        };
      });

      const CHUNK_SIZE = 250;
      for (let i = 0; i < preparedStudents.length; i += CHUNK_SIZE) {
        const chunk = preparedStudents.slice(i, i + CHUNK_SIZE);
        await tx.insert(students).values(
          chunk.map((stu) => ({
            id: stu.id,
            schoolId,
            studentId: stu.studentId!,
            admissionNo: stu.admissionNo,
            fullName: stu.fullName,
            gender: stu.gender,
            dateOfBirth: stu.dateOfBirth ?? null,
            classId: stu.classId,
            academicYear: stu.academicYear,
            status: stu.status,
            combinationId: stu.combinationId ?? null,
            offeredSubjectIds:
              stu.offeredSubjectIds && stu.offeredSubjectIds.length > 0
                ? stu.offeredSubjectIds
                : null,
            parentName: stu.parentName ?? null,
            parentContact: stu.parentContact ?? null,
            photoDataUrl: stu.photoDataUrl ?? null,
          }))
        );
      }

      return preparedStudents;
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
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
      const validClass = await tx
        .select({ id: classesStreams.id })
        .from(classesStreams)
        .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, stu.classId)))
        .limit(1);
      if (!validClass[0]) {
        throw new ValidationAppError('Selected class does not belong to this school workspace.');
      }

      await tx
        .update(students)
        .set({
          ...(stu.studentId ? { studentId: stu.studentId.trim().toUpperCase() } : {}),
          admissionNo: stu.admissionNo,
          fullName: stu.fullName,
          gender: stu.gender,
          dateOfBirth: stu.dateOfBirth ?? null,
          classId: stu.classId,
          academicYear: stu.academicYear,
          status: stu.status,
          combinationId: stu.combinationId ?? null,
          offeredSubjectIds:
            stu.offeredSubjectIds && stu.offeredSubjectIds.length > 0
              ? stu.offeredSubjectIds
              : null,
          parentName: stu.parentName ?? null,
          parentContact: stu.parentContact ?? null,
          photoDataUrl: stu.photoDataUrl ?? null,
        })
        .where(and(eq(students.schoolId, schoolId), eq(students.id, stu.id)));
      return stu;
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
    console.error('Failed to update student:', error);
    throw new Error('Failed to update student record.', { cause: error });
  }
}

export async function bulkPromoteTenantStudents(
  schoolId: string,
  studentIds: string[],
  options: {
    targetClassId?: string;
    targetAcademicYear?: string;
    targetStatus?: 'active' | 'transferred' | 'inactive';
    updateSchoolYear?: boolean;
    resetElectives?: boolean;
  }
): Promise<{
  updatedCount: number;
  targetClassName?: string;
  targetAcademicYear?: string;
  targetStatus?: 'active' | 'transferred' | 'inactive';
}> {
  if (studentIds.length === 0) {
    return { updatedCount: 0 };
  }
  try {
    return await withTenantScope(schoolId, async (tx) => {
      let targetClassName: string | undefined;
      if (options.targetClassId) {
        const [targetCls] = await tx
          .select({ id: classesStreams.id, name: classesStreams.name })
          .from(classesStreams)
          .where(
            and(
              eq(classesStreams.schoolId, schoolId),
              eq(classesStreams.id, options.targetClassId)
            )
          )
          .limit(1);
        if (!targetCls) {
          throw new ValidationAppError('Selected destination class was not found in this school.');
        }
        targetClassName = targetCls.name;
      }

      const updatePatch: Partial<typeof students.$inferInsert> = {};
      if (options.targetClassId) updatePatch.classId = options.targetClassId;
      if (options.targetAcademicYear?.trim()) {
        updatePatch.academicYear = options.targetAcademicYear.trim();
      }
      if (options.targetStatus) updatePatch.status = options.targetStatus;
      if (options.resetElectives && options.targetClassId) {
        updatePatch.offeredSubjectIds = null;
      }

      if (Object.keys(updatePatch).length === 0) {
        return { updatedCount: 0 };
      }

      let totalUpdated = 0;
      const CHUNK_SIZE = 250;
      for (let i = 0; i < studentIds.length; i += CHUNK_SIZE) {
        const chunk = studentIds.slice(i, i + CHUNK_SIZE);
        const updatedRows = await tx
          .update(students)
          .set(updatePatch)
          .where(and(eq(students.schoolId, schoolId), inArray(students.id, chunk)))
          .returning({ id: students.id });
        totalUpdated += updatedRows.length;
      }

      if (options.updateSchoolYear && options.targetAcademicYear?.trim()) {
        await tx
          .update(schools)
          .set({
            academicYear: options.targetAcademicYear.trim(),
            updatedAt: new Date(),
          })
          .where(eq(schools.id, schoolId));
      }

      return {
        updatedCount: totalUpdated,
        targetClassName,
        targetAcademicYear: options.targetAcademicYear?.trim(),
        targetStatus: options.targetStatus,
      };
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
    console.error('Failed to bulk promote students:', error);
    throw new Error('Failed to promote selected students.', { cause: error });
  }
}

export async function queryTenantStudentsPaginated(
  schoolId: string,
  params: {
    page?: number;
    limit?: number;
    classId?: string;
    status?: string;
    search?: string;
  }
): Promise<{
  students: StudentProfile[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 50)));
  const offset = (page - 1) * limit;

  return withTenantScope(schoolId, async (tx) => {
    const predicates = [eq(students.schoolId, schoolId)];
    if (params.classId && params.classId !== 'all') {
      predicates.push(eq(students.classId, params.classId));
    }
    if (params.status && params.status !== 'all') {
      predicates.push(eq(students.status, params.status));
    }
    if (params.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      predicates.push(
        or(
          ilike(students.fullName, q),
          ilike(students.admissionNo, q),
          ilike(sql`COALESCE(${students.studentId}, '')`, q)
        )!
      );
    }

    const whereClause = and(...predicates);
    const [countRows, rows] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(whereClause),
      tx.select().from(students).where(whereClause).limit(limit).offset(offset),
    ]);

    return {
      students: rows.map((stu) => ({
        id: stu.id,
        studentId: stu.studentId ?? undefined,
        admissionNo: stu.admissionNo,
        fullName: stu.fullName,
        gender: stu.gender as 'M' | 'F',
        dateOfBirth: stu.dateOfBirth ?? undefined,
        classId: stu.classId,
        academicYear: stu.academicYear,
        status: stu.status as StudentProfile['status'],
        combinationId: stu.combinationId ?? undefined,
        offeredSubjectIds: stu.offeredSubjectIds ?? undefined,
        parentName: stu.parentName ?? undefined,
        parentContact: stu.parentContact ?? undefined,
        photoDataUrl: stu.photoDataUrl ?? undefined,
      })),
      total: countRows[0]?.count ?? 0,
      page,
      limit,
    };
  });
}

export async function queryTenantMarksheetsFiltered(
  schoolId: string,
  params: {
    examId?: string;
    classId?: string;
    subjectId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }
): Promise<{
  marksheets: MarksheetRecord[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 100)));
  const offset = (page - 1) * limit;

  return withTenantScope(schoolId, async (tx) => {
    const predicates = [eq(marksheets.schoolId, schoolId)];
    if (params.examId) predicates.push(eq(marksheets.examId, params.examId));
    if (params.classId) predicates.push(eq(marksheets.classId, params.classId));
    if (params.subjectId) predicates.push(eq(marksheets.subjectId, params.subjectId));
    if (params.status) predicates.push(eq(marksheets.status, params.status));

    const whereClause = and(...predicates);
    const [countRows, rows] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(marksheets)
        .where(whereClause),
      tx.select().from(marksheets).where(whereClause).limit(limit).offset(offset),
    ]);

    return {
      marksheets: rows.map((m) => ({
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
        version: m.version ?? 1,
        lastModified: m.lastModified,
        auditHistory: m.auditHistory,
      })),
      total: countRows[0]?.count ?? 0,
      page,
      limit,
    };
  });
}

export async function deleteTenantStudent(
  schoolId: string,
  studentId: string
): Promise<{ ok: true }> {
  return withTenantScope(schoolId, async (tx) => {
    const existingRows = await tx
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!existingRows[0]) {
      throw new ValidationAppError('Student record not found.');
    }

    const schoolSheets = await tx
      .select({ id: marksheets.id, entries: marksheets.entries })
      .from(marksheets)
      .where(eq(marksheets.schoolId, schoolId));

    const hasMarks = schoolSheets.some((sheet) => {
      const entry = sheet.entries?.[studentId];
      if (!entry) return false;
      return Boolean(
        entry.u1?.trim() ||
          entry.u2?.trim() ||
          entry.u3?.trim() ||
          entry.eot?.trim() ||
          entry.mark?.trim()
      );
    });

    if (hasMarks) {
      throw new ValidationAppError(
        'Cannot delete a student with recorded examination marks. Set their status to "Transferred" or "Inactive" to preserve historical transcripts.'
      );
    }

    await tx
      .delete(studentRemarks)
      .where(and(eq(studentRemarks.schoolId, schoolId), eq(studentRemarks.studentId, studentId)));
    await tx
      .delete(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));

    return { ok: true };
  });
}

export async function upsertTenantClass(
  schoolId: string,
  cls: StreamClass,
  attachToExamId?: string
): Promise<StreamClass> {
  try {
    const cleanStream = (cls.stream ?? '').trim();
    const cleanName =
      cls.name.trim() || (cleanStream ? `${cls.gradeLevel} ${cleanStream}` : cls.gradeLevel);
    await withTenantScope(schoolId, async (tx) => {
      await tx
        .insert(classesStreams)
        .values({
          id: cls.id,
          schoolId,
          name: cleanName,
          gradeLevel: cls.gradeLevel,
          stream: cleanStream,
          level: cls.level,
          classTeacherId: cls.classTeacherId,
          subjectIds: cls.subjectIds,
          subjectTeacherMap: cls.subjectTeacherMap,
          archived: Boolean(cls.archived),
        })
        .onConflictDoUpdate({
          target: classesStreams.id,
          set: {
            name: cleanName,
            gradeLevel: cls.gradeLevel,
            stream: cleanStream,
            level: cls.level,
            classTeacherId: cls.classTeacherId,
            subjectIds: cls.subjectIds,
            subjectTeacherMap: cls.subjectTeacherMap,
            archived: Boolean(cls.archived),
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
    return {
      ...cls,
      name: cleanName,
      stream: cleanStream || undefined,
      archived: Boolean(cls.archived),
    };
  } catch (error) {
    console.error('Failed to save class:', error);
    throw new Error('Failed to save class stream.', { cause: error });
  }
}

export async function archiveOrDeleteTenantClass(
  schoolId: string,
  classId: string,
  mode: 'archive' | 'restore' | 'delete'
): Promise<{ mode: 'archive' | 'restore' | 'delete'; archived: boolean }> {
  return withTenantScope(schoolId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(classesStreams)
      .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, classId)))
      .limit(1);
    if (!existing) throw new ValidationAppError('Class record not found.');

    if (mode === 'archive' || mode === 'restore') {
      const archived = mode === 'archive';
      await tx
        .update(classesStreams)
        .set({ archived })
        .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, classId)));
      return { mode, archived };
    }

    const [studentCountRows, sheetCountRows] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.classId, classId))),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(marksheets)
        .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.classId, classId))),
    ]);

    if ((studentCountRows[0]?.count ?? 0) > 0 || (sheetCountRows[0]?.count ?? 0) > 0) {
      throw new ValidationAppError(
        'This class has enrolled students or recorded marksheets. Archive it instead to preserve academic history.'
      );
    }

    await tx
      .delete(classesStreams)
      .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, classId)));
    return { mode: 'delete', archived: false };
  });
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
          archived: Boolean(sub.archived),
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
            archived: Boolean(sub.archived),
          },
        });
    });
  } catch (error) {
    console.error('Failed to save subject:', error);
    throw new Error('Failed to save subject definition.', { cause: error });
  }
}

export async function archiveOrDeleteTenantSubject(
  schoolId: string,
  subjectId: string,
  mode: 'archive' | 'restore' | 'delete'
): Promise<{ mode: 'archive' | 'restore' | 'delete'; archived: boolean }> {
  return withTenantScope(schoolId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, subjectId)))
      .limit(1);
    if (!existing) throw new ValidationAppError('Subject not found.');

    if (mode === 'archive' || mode === 'restore') {
      const archived = mode === 'archive';
      await tx
        .update(subjects)
        .set({ archived })
        .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, subjectId)));
      return { mode, archived };
    }

    const sheetRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(marksheets)
      .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.subjectId, subjectId)));
    if ((sheetRows[0]?.count ?? 0) > 0) {
      throw new ValidationAppError(
        'This subject has recorded marksheets. Archive it instead to protect historical transcripts.'
      );
    }

    await tx
      .delete(subjects)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, subjectId)));
    return { mode: 'delete', archived: false };
  });
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
      const uniqueClassIds = Array.from(new Set(ex.classIds));
      if (uniqueClassIds.length > 0) {
        const validClasses = await tx
          .select({ id: classesStreams.id })
          .from(classesStreams)
          .where(
            and(eq(classesStreams.schoolId, schoolId), inArray(classesStreams.id, uniqueClassIds))
          );
        const validSet = new Set(validClasses.map((c) => c.id));
        for (const cid of uniqueClassIds) {
          if (!validSet.has(cid)) {
            throw new ValidationAppError('One or more assigned classes do not belong to this school.');
          }
        }
      }

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
          archived: Boolean(ex.archived),
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
            archived: Boolean(ex.archived),
          },
        });
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
    console.error('Failed to save examination:', error);
    throw new Error('Failed to save examination period.', { cause: error });
  }
}

export async function archiveOrDeleteTenantExam(
  schoolId: string,
  examId: string,
  mode: 'archive' | 'restore' | 'delete'
): Promise<{ mode: 'archive' | 'restore' | 'delete'; archived: boolean }> {
  return withTenantScope(schoolId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(examinations)
      .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, examId)))
      .limit(1);
    if (!existing) throw new ValidationAppError('Examination period not found.');

    if (mode === 'archive' || mode === 'restore') {
      const archived = mode === 'archive';
      await tx
        .update(examinations)
        .set({ archived })
        .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, examId)));
      return { mode, archived };
    }

    if (existing.published || existing.locked) {
      throw new ValidationAppError(
        'Published or locked examinations cannot be deleted. Archive them instead.'
      );
    }

    const sheetRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(marksheets)
      .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.examId, examId)));
    if ((sheetRows[0]?.count ?? 0) > 0) {
      throw new ValidationAppError(
        'This examination already has recorded marksheets. Archive it instead.'
      );
    }

    await tx
      .delete(examinations)
      .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, examId)));
    return { mode: 'delete', archived: false };
  });
}

async function resolveActorStaffRow(
  tx: DbTransaction,
  schoolId: string,
  actor: TenantActorContext
) {
  const cleanEmail = actor.email.trim().toLowerCase();
  const rows = await tx
    .select()
    .from(staffTeachers)
    .where(
      and(
        eq(staffTeachers.schoolId, schoolId),
        or(
          actor.staffId
            ? sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${actor.staffId.trim().toLowerCase()}`
            : sql`false`,
          sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

function matchesTeacherIdentifier(
  assignedId: string | null | undefined,
  actor: TenantActorContext,
  staffRow: typeof staffTeachers.$inferSelect | null,
  schoolId: string
): boolean {
  if (!assignedId) return false;
  const cleanAssigned = assignedId.trim();
  if (!cleanAssigned) return false;
  const candidates = new Set<string>();
  if (actor.uid) candidates.add(actor.uid);
  if (actor.uid.startsWith('local:')) candidates.add(actor.uid.slice('local:'.length));
  if (actor.staffId) candidates.add(actor.staffId);
  if (staffRow) {
    candidates.add(staffRow.id);
    if (staffRow.id.startsWith(`${schoolId}:`)) {
      candidates.add(staffRow.id.slice(schoolId.length + 1));
    }
    if (staffRow.staffId) candidates.add(staffRow.staffId);
  }
  return candidates.has(cleanAssigned);
}

export async function upsertTenantMarksheet(
  schoolId: string,
  ms: MarksheetRecord,
  actorContext?: TenantActorContext
): Promise<MarksheetRecord> {
  try {
    return await withTenantScope(schoolId, async (tx) => {
      if (actorContext) {
        const actorRole = normalizeUserRole(actorContext.role);
        const isLeadership =
          actorRole === 'dos' || actorRole === 'headteacher' || actorRole === 'school_admin';

        if (!isLeadership) {
          if (
            ms.status === 'approved' ||
            ms.status === 'published' ||
            ms.status === 'returned'
          ) {
            throw new PermissionError(
              'Only Director of Studies or Headteacher can approve, return, or publish marksheets.'
            );
          }

          const [clsRows, staffRow] = await Promise.all([
            tx
              .select()
              .from(classesStreams)
              .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, ms.classId)))
              .limit(1),
            resolveActorStaffRow(tx, schoolId, actorContext),
          ]);

          const cls = clsRows[0];
          const mappedTeacher = cls?.subjectTeacherMap?.[ms.subjectId];
          const isSubjectTeacher = matchesTeacherIdentifier(
            mappedTeacher,
            actorContext,
            staffRow,
            schoolId
          );
          const isClassTeacher = matchesTeacherIdentifier(
            cls?.classTeacherId,
            actorContext,
            staffRow,
            schoolId
          );
          const hasExplicitLists = Boolean(
            staffRow &&
              staffRow.assignedClassIds.includes(ms.classId) &&
              (staffRow.assignedSubjectIds.length === 0 ||
                staffRow.assignedSubjectIds.includes(ms.subjectId))
          );

          if (!isSubjectTeacher && !isClassTeacher && !hasExplicitLists) {
            throw new PermissionError(
              'Forbidden: You are not assigned to teach or manage marks for this class and subject.'
            );
          }
        }
      }

      const [existing, examRows, clsCheckRows, subjectCheckRows, approvedCorrectionRows] =
        await Promise.all([
          tx
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
            .limit(1),
          tx
            .select()
            .from(examinations)
            .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, ms.examId)))
            .limit(1),
          tx
            .select({ id: classesStreams.id })
            .from(classesStreams)
            .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, ms.classId)))
            .limit(1),
          tx
            .select({ id: subjects.id })
            .from(subjects)
            .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, ms.subjectId)))
            .limit(1),
          tx
            .select()
            .from(marksheetCorrectionRequests)
            .where(
              and(
                eq(marksheetCorrectionRequests.schoolId, schoolId),
                eq(marksheetCorrectionRequests.examId, ms.examId),
                eq(marksheetCorrectionRequests.classId, ms.classId),
                eq(marksheetCorrectionRequests.subjectId, ms.subjectId),
                eq(marksheetCorrectionRequests.status, 'approved')
              )
            ),
        ]);

      if (!examRows[0] || !clsCheckRows[0] || !subjectCheckRows[0]) {
        throw new ValidationAppError(
          'Referenced examination, class, or subject does not belong to this school workspace.'
        );
      }

      const actorRole = actorContext ? normalizeUserRole(actorContext.role) : 'school_admin';
      const isLeadership =
        actorRole === 'dos' || actorRole === 'headteacher' || actorRole === 'school_admin';
      const hasApprovedUnlock = approvedCorrectionRows.length > 0;

      if (!isLeadership) {
        if (existing[0]) {
          const curStatus = existing[0].status;
          if (
            (curStatus === 'submitted' || curStatus === 'approved' || curStatus === 'published') &&
            !hasApprovedUnlock
          ) {
            throw new PermissionError(
              'This marksheet has already been submitted and locked. Submit a Correction Request for DOS approval before editing.'
            );
          }
        }
        if ((examRows[0]?.locked || examRows[0]?.published) && !hasApprovedUnlock) {
          throw new PermissionError(
            'This examination period is locked. Request DOS approval to re-correct submitted marks.'
          );
        }
      }

      if (existing[0]) {
        const currentVersion = existing[0].version ?? 1;
        if (ms.version !== undefined && ms.version !== currentVersion) {
          throw new ConflictError(
            'This marksheet was updated by another user while you were editing. Refresh to load the latest scores before saving.'
          );
        }

        const nextVersion = currentVersion + 1;
        const updatedRows = await tx
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
            version: nextVersion,
            lastModified: ms.lastModified,
            auditHistory: ms.auditHistory,
          })
          .where(
            and(
              eq(marksheets.schoolId, schoolId),
              eq(marksheets.id, existing[0].id),
              eq(marksheets.version, currentVersion)
            )
          )
          .returning();

        if (!updatedRows[0]) {
          throw new ConflictError(
            'Concurrent update detected while saving marksheet. Refresh to load the latest version.'
          );
        }

        if (ms.status === 'submitted' && approvedCorrectionRows.length > 0) {
          await tx
            .update(marksheetCorrectionRequests)
            .set({ status: 'completed' })
            .where(
              and(
                eq(marksheetCorrectionRequests.schoolId, schoolId),
                eq(marksheetCorrectionRequests.examId, ms.examId),
                eq(marksheetCorrectionRequests.classId, ms.classId),
                eq(marksheetCorrectionRequests.subjectId, ms.subjectId),
                eq(marksheetCorrectionRequests.status, 'approved')
              )
            );
        }

        return {
          ...ms,
          id: existing[0].id,
          version: updatedRows[0].version,
        };
      }

      const insertedId = ms.id.startsWith(`${schoolId}:`) ? ms.id : `${schoolId}:${ms.id}`;
      const inserted = await tx
        .insert(marksheets)
        .values({
          id: insertedId,
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
          version: 1,
          lastModified: ms.lastModified,
          auditHistory: ms.auditHistory,
        })
        .returning();

      return {
        ...ms,
        id: inserted[0]?.id ?? insertedId,
        version: inserted[0]?.version ?? 1,
      };
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof PermissionError ||
      error instanceof ValidationAppError
    ) {
      throw error;
    }
    const pgCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (pgCode === '23505') {
      throw new ConflictError(
        'Concurrent marksheet creation detected. Refresh to load the latest saved scores.'
      );
    }
    console.error('Failed to save marksheet:', error);
    throw new Error('Failed to save marksheet.', { cause: error });
  }
}

function mapCorrectionRequestRow(
  cr: typeof marksheetCorrectionRequests.$inferSelect
): MarksheetCorrectionRequest {
  return {
    id: cr.id,
    schoolId: cr.schoolId,
    marksheetId: cr.marksheetId,
    examId: cr.examId,
    classId: cr.classId,
    subjectId: cr.subjectId,
    assessmentScope: cr.assessmentScope as MarksheetCorrectionRequest['assessmentScope'],
    requestedByUserId: cr.requestedByUserId,
    requestedByName: cr.requestedByName,
    requestedByStaffId: cr.requestedByStaffId ?? undefined,
    reason: cr.reason,
    status: cr.status as MarksheetCorrectionRequest['status'],
    reviewedByUserId: cr.reviewedByUserId ?? undefined,
    reviewedByName: cr.reviewedByName ?? undefined,
    reviewNote: cr.reviewNote ?? undefined,
    createdAt: cr.createdAt,
    reviewedAt: cr.reviewedAt ?? undefined,
  };
}

export async function createMarksheetCorrectionRequest(
  schoolId: string,
  input: {
    marksheetId?: string;
    examId: string;
    classId: string;
    subjectId: string;
    assessmentScope: MarksheetCorrectionRequest['assessmentScope'];
    reason: string;
  },
  actor: TenantActorContext
): Promise<{ request: MarksheetCorrectionRequest; marksheet?: MarksheetRecord }> {
  const now = new Date().toISOString();
  return withTenantScope(schoolId, async (tx) => {
    const actorRole = normalizeUserRole(actor.role);
    const isLeadership =
      actorRole === 'dos' || actorRole === 'headteacher' || actorRole === 'school_admin';

    const [clsRows, staffRow, existingSheetRows, existingPendingRows] = await Promise.all([
      tx
        .select()
        .from(classesStreams)
        .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, input.classId)))
        .limit(1),
      resolveActorStaffRow(tx, schoolId, actor),
      tx
        .select()
        .from(marksheets)
        .where(
          and(
            eq(marksheets.schoolId, schoolId),
            eq(marksheets.examId, input.examId),
            eq(marksheets.classId, input.classId),
            eq(marksheets.subjectId, input.subjectId)
          )
        )
        .limit(1),
      tx
        .select()
        .from(marksheetCorrectionRequests)
        .where(
          and(
            eq(marksheetCorrectionRequests.schoolId, schoolId),
            eq(marksheetCorrectionRequests.examId, input.examId),
            eq(marksheetCorrectionRequests.classId, input.classId),
            eq(marksheetCorrectionRequests.subjectId, input.subjectId),
            eq(marksheetCorrectionRequests.status, 'pending')
          )
        )
        .limit(1),
    ]);

    if (!isLeadership) {
      const cls = clsRows[0];
      const mappedTeacher = cls?.subjectTeacherMap?.[input.subjectId];
      const isSubjectTeacher = matchesTeacherIdentifier(mappedTeacher, actor, staffRow, schoolId);
      const isClassTeacher = matchesTeacherIdentifier(cls?.classTeacherId, actor, staffRow, schoolId);
      const hasExplicitLists = Boolean(
        staffRow &&
          staffRow.assignedClassIds.includes(input.classId) &&
          (staffRow.assignedSubjectIds.length === 0 ||
            staffRow.assignedSubjectIds.includes(input.subjectId))
      );
      if (!isSubjectTeacher && !isClassTeacher && !hasExplicitLists) {
        throw new PermissionError(
          'Forbidden: You are not assigned to request marksheet corrections for this class and subject.'
        );
      }
    }

    if (existingPendingRows[0]) {
      throw new ValidationAppError(
        'A correction approval request for this marksheet is already pending DOS review.'
      );
    }

    const existingSheet = existingSheetRows[0];
    const resolvedMarksheetId =
      existingSheet?.id ??
      input.marksheetId ??
      `${schoolId}:ms-${input.examId}-${input.classId}-${input.subjectId}`;

    const requesterId = staffRow?.id ?? actor.uid;
    const requesterName = staffRow?.name ?? actor.name ?? actor.email;
    const requesterStaffId = staffRow?.staffId ?? actor.staffId ?? null;

    const reqId = `cr-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const [inserted] = await tx
      .insert(marksheetCorrectionRequests)
      .values({
        id: reqId,
        schoolId,
        marksheetId: resolvedMarksheetId,
        examId: input.examId,
        classId: input.classId,
        subjectId: input.subjectId,
        assessmentScope: input.assessmentScope,
        requestedByUserId: requesterId,
        requestedByName: requesterName,
        requestedByStaffId: requesterStaffId,
        reason: input.reason.trim(),
        status: 'pending',
        createdAt: now,
      })
      .returning();

    let updatedMarksheet: MarksheetRecord | undefined;
    if (existingSheet) {
      const nextHistory = [
        ...existingSheet.auditHistory,
        {
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          actorId: requesterId,
          actorName: requesterName,
          actorRole: actorRole,
          action: 'Requested DOS Correction Approval',
          details: `${input.assessmentScope === 'all' ? 'Full marksheet' : input.assessmentScope.toUpperCase()} — ${input.reason.trim()}`,
        },
      ];
      const [msRow] = await tx
        .update(marksheets)
        .set({
          version: (existingSheet.version ?? 1) + 1,
          lastModified: now,
          auditHistory: nextHistory,
        })
        .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.id, existingSheet.id)))
        .returning();
      if (msRow) {
        updatedMarksheet = {
          id: msRow.id,
          examId: msRow.examId,
          classId: msRow.classId,
          subjectId: msRow.subjectId,
          teacherId: msRow.teacherId,
          status: msRow.status as MarksheetRecord['status'],
          entries: msRow.entries,
          submittedAt: msRow.submittedAt ?? undefined,
          submittedBy: msRow.submittedBy ?? undefined,
          approvedAt: msRow.approvedAt ?? undefined,
          approvedBy: msRow.approvedBy ?? undefined,
          dosComment: msRow.dosComment ?? undefined,
          version: msRow.version ?? 1,
          lastModified: msRow.lastModified,
          auditHistory: msRow.auditHistory,
        };
      }
    }

    return {
      request: mapCorrectionRequestRow(inserted),
      marksheet: updatedMarksheet,
    };
  });
}

export async function approveMarksheetCorrectionRequest(
  schoolId: string,
  requestId: string,
  actor: TenantActorContext,
  reviewNote?: string
): Promise<{ request: MarksheetCorrectionRequest; marksheet?: MarksheetRecord }> {
  const now = new Date().toISOString();
  return withTenantScope(schoolId, async (tx) => {
    const [existingReq] = await tx
      .select()
      .from(marksheetCorrectionRequests)
      .where(
        and(
          eq(marksheetCorrectionRequests.schoolId, schoolId),
          eq(marksheetCorrectionRequests.id, requestId)
        )
      )
      .limit(1);

    if (!existingReq) {
      throw new ValidationAppError('Correction request not found.');
    }

    const reviewerName = actor.name || actor.email;
    const cleanNote = reviewNote?.trim() || 'Approved by DOS for score re-correction and resubmission.';

    const [updatedReq] = await tx
      .update(marksheetCorrectionRequests)
      .set({
        status: 'approved',
        reviewedByUserId: actor.uid,
        reviewedByName: reviewerName,
        reviewNote: cleanNote,
        reviewedAt: now,
      })
      .where(
        and(
          eq(marksheetCorrectionRequests.schoolId, schoolId),
          eq(marksheetCorrectionRequests.id, requestId)
        )
      )
      .returning();

    const [existingSheet] = await tx
      .select()
      .from(marksheets)
      .where(
        and(
          eq(marksheets.schoolId, schoolId),
          eq(marksheets.examId, existingReq.examId),
          eq(marksheets.classId, existingReq.classId),
          eq(marksheets.subjectId, existingReq.subjectId)
        )
      )
      .limit(1);

    let updatedMarksheet: MarksheetRecord | undefined;
    if (existingSheet) {
      const nextHistory = [
        ...existingSheet.auditHistory,
        {
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          actorId: actor.uid,
          actorName: reviewerName,
          actorRole: normalizeUserRole(actor.role),
          action: 'Correction Approved by DOS',
          details: `${cleanNote} (Unlocked for ${existingReq.requestedByName})`,
        },
      ];
      const [msRow] = await tx
        .update(marksheets)
        .set({
          status: 'draft',
          dosComment: cleanNote,
          version: (existingSheet.version ?? 1) + 1,
          lastModified: now,
          auditHistory: nextHistory,
        })
        .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.id, existingSheet.id)))
        .returning();

      if (msRow) {
        updatedMarksheet = {
          id: msRow.id,
          examId: msRow.examId,
          classId: msRow.classId,
          subjectId: msRow.subjectId,
          teacherId: msRow.teacherId,
          status: msRow.status as MarksheetRecord['status'],
          entries: msRow.entries,
          submittedAt: msRow.submittedAt ?? undefined,
          submittedBy: msRow.submittedBy ?? undefined,
          approvedAt: msRow.approvedAt ?? undefined,
          approvedBy: msRow.approvedBy ?? undefined,
          dosComment: msRow.dosComment ?? undefined,
          version: msRow.version ?? 1,
          lastModified: msRow.lastModified,
          auditHistory: msRow.auditHistory,
        };
      }
    }

    return {
      request: mapCorrectionRequestRow(updatedReq),
      marksheet: updatedMarksheet,
    };
  });
}

export async function rejectMarksheetCorrectionRequest(
  schoolId: string,
  requestId: string,
  actor: TenantActorContext,
  reviewNote?: string
): Promise<{ request: MarksheetCorrectionRequest }> {
  const now = new Date().toISOString();
  return withTenantScope(schoolId, async (tx) => {
    const [existingReq] = await tx
      .select()
      .from(marksheetCorrectionRequests)
      .where(
        and(
          eq(marksheetCorrectionRequests.schoolId, schoolId),
          eq(marksheetCorrectionRequests.id, requestId)
        )
      )
      .limit(1);

    if (!existingReq) {
      throw new ValidationAppError('Correction request not found.');
    }

    const reviewerName = actor.name || actor.email;
    const cleanNote = reviewNote?.trim() || 'Correction request declined by DOS.';

    const [updatedReq] = await tx
      .update(marksheetCorrectionRequests)
      .set({
        status: 'rejected',
        reviewedByUserId: actor.uid,
        reviewedByName: reviewerName,
        reviewNote: cleanNote,
        reviewedAt: now,
      })
      .where(
        and(
          eq(marksheetCorrectionRequests.schoolId, schoolId),
          eq(marksheetCorrectionRequests.id, requestId)
        )
      )
      .returning();

    const [existingSheet] = await tx
      .select()
      .from(marksheets)
      .where(
        and(
          eq(marksheets.schoolId, schoolId),
          eq(marksheets.examId, existingReq.examId),
          eq(marksheets.classId, existingReq.classId),
          eq(marksheets.subjectId, existingReq.subjectId)
        )
      )
      .limit(1);

    if (existingSheet) {
      const nextHistory = [
        ...existingSheet.auditHistory,
        {
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          actorId: actor.uid,
          actorName: reviewerName,
          actorRole: normalizeUserRole(actor.role),
          action: 'Correction Request Declined',
          details: cleanNote,
        },
      ];
      await tx
        .update(marksheets)
        .set({
          version: (existingSheet.version ?? 1) + 1,
          lastModified: now,
          auditHistory: nextHistory,
        })
        .where(and(eq(marksheets.schoolId, schoolId), eq(marksheets.id, existingSheet.id)));
    }

    return { request: mapCorrectionRequestRow(updatedReq) };
  });
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
            version: (m.version ?? 1) + 1,
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
  value: string,
  actorContext?: TenantActorContext
) {
  const rowId = `${schoolId}:${examId}:${studentId}`;
  try {
    await withTenantScope(schoolId, async (tx) => {
      const [stuRows, examCheckRows] = await Promise.all([
        tx
          .select({ classId: students.classId })
          .from(students)
          .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
          .limit(1),
        tx
          .select({ id: examinations.id })
          .from(examinations)
          .where(and(eq(examinations.schoolId, schoolId), eq(examinations.id, examId)))
          .limit(1),
      ]);
      const stuClassId = stuRows[0]?.classId;
      if (!stuClassId || !examCheckRows[0]) {
        throw new ValidationAppError(
          'Student or examination does not belong to this school workspace.'
        );
      }

      if (actorContext) {
        const actorRole = normalizeUserRole(actorContext.role);
        const isLeadership =
          actorRole === 'dos' || actorRole === 'headteacher' || actorRole === 'school_admin';
        if (!isLeadership) {
          if (actorRole !== 'class_teacher' || field !== 'classTeacherRemark') {
            throw new PermissionError(
              'Only assigned Class Teachers can edit class teacher remarks.'
            );
          }
          const staffRow = await resolveActorStaffRow(tx, schoolId, actorContext);
          const clsRows = await tx
            .select({ classTeacherId: classesStreams.classTeacherId })
            .from(classesStreams)
            .where(and(eq(classesStreams.schoolId, schoolId), eq(classesStreams.id, stuClassId)))
            .limit(1);
          const isAssignedClassTeacher =
            matchesTeacherIdentifier(clsRows[0]?.classTeacherId, actorContext, staffRow, schoolId) ||
            Boolean(staffRow?.assignedClassIds.includes(stuClassId));
          if (!isAssignedClassTeacher) {
            throw new PermissionError(
              'Forbidden: You can only record class teacher remarks for students in your assigned class.'
            );
          }
        }
      }

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
    if (error instanceof PermissionError || error instanceof ValidationAppError) {
      throw error;
    }
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

export async function upsertTenantStaffMember(
  schoolId: string,
  staff: UserAccount
): Promise<UserAccount> {
  try {
    const cleanEmail = staff.email.trim().toLowerCase();
    const cleanUsername = staff.username.trim().toLowerCase() || cleanEmail.split('@')[0];
    if (cleanEmail === 'superadmin@schuleflow.ac.ug' || cleanUsername === 'superadmin') {
      throw new ValidationAppError(
        'superadmin@schuleflow.ac.ug and username "superadmin" are reserved for the Platform Super Admin.'
      );
    }
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

    return await withTenantScope(schoolId, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff:${schoolId}`}))`);
      const [schoolRow] = await tx
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.id, schoolId))
        .limit(1);
      const initials = extractSchoolInitials(schoolRow?.name ?? 'School');

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
      const isNewStaff = !existingStaffRows[0];
      const nextMustChange =
        staff.mustChangePassword !== undefined
          ? Boolean(staff.mustChangePassword)
          : isNewStaff || hasNewPassword
            ? true
            : Boolean(existingStaffRows[0]?.mustChangePassword);

      let assignedStaffId = existingStaffRows[0]?.staffId?.trim() || staff.staffId?.trim() || null;
      if (!assignedStaffId) {
        const [allStaffIds, allUserStaffIds] = await Promise.all([
          tx
            .select({ staffId: staffTeachers.staffId })
            .from(staffTeachers)
            .where(eq(staffTeachers.schoolId, schoolId)),
          tx
            .select({ staffId: users.staffId })
            .from(users)
            .where(eq(users.schoolId, schoolId)),
        ]);
        const usedIds = [...allStaffIds, ...allUserStaffIds]
          .map((r) => r.staffId)
          .filter((v): v is string => Boolean(v && v.trim()));
        assignedStaffId = generateNextStaffId(initials, usedIds, true);
      }

      await tx
        .insert(staffTeachers)
        .values({
          id: scopedId,
          schoolId,
          staffId: assignedStaffId,
          name: staff.name.trim(),
          email: cleanEmail,
          username: cleanUsername,
          passwordHash: computedHash ?? hashPassword('SchuleFlow2026!'),
          role: normalizedRole,
          active: staff.active,
          mustChangePassword: nextMustChange,
          phone: normalizedPhone,
          assignedClassIds: staff.assignedClassIds,
          assignedSubjectIds: staff.assignedSubjectIds,
          lastLogin: staff.lastLogin ?? null,
        })
        .onConflictDoUpdate({
          target: staffTeachers.id,
          set: {
            staffId: assignedStaffId,
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            role: normalizedRole,
            active: staff.active,
            phone: normalizedPhone,
            assignedClassIds: staff.assignedClassIds,
            assignedSubjectIds: staff.assignedSubjectIds,
            ...(computedHash ? { passwordHash: computedHash, mustChangePassword: nextMustChange } : {}),
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
        const shouldRevokeSessions =
          !staff.active ||
          Boolean(computedHash) ||
          normalizeUserRole(existingAuthUsers[0].schoolRole) !== normalizedRole;

        await tx
          .update(users)
          .set({
            staffId: assignedStaffId,
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
            ...(computedHash ? { passwordHash: computedHash, mustChangePassword: nextMustChange } : {}),
          })
          .where(eq(users.id, existingAuthUsers[0].id));

        if (shouldRevokeSessions) {
          const nowMs = Date.now();
          await tx
            .insert(platformRuntimeConfig)
            .values({ key: `sva:${existingAuthUsers[0].uid}`, value: String(nowMs), updatedAt: new Date(nowMs) })
            .onConflictDoUpdate({
              target: platformRuntimeConfig.key,
              set: { value: String(nowMs), updatedAt: new Date(nowMs) },
            });
        }
      } else {
        await tx
          .insert(users)
          .values({
            uid: `local:${scopedId}`,
            staffId: assignedStaffId,
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            passwordHash: computedHash ?? hashPassword('SchuleFlow2026!'),
            name: staff.name.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
            mustChangePassword: nextMustChange,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              staffId: assignedStaffId,
              email: cleanEmail,
              username: cleanUsername,
              phone: normalizedPhone,
              name: staff.name.trim(),
              schoolId,
              schoolRole: normalizedRole,
              active: staff.active,
              ...(computedHash ? { passwordHash: computedHash, mustChangePassword: nextMustChange } : {}),
            },
          });

        if (!staff.active || computedHash) {
          const nowMs = Date.now();
          await tx
            .insert(platformRuntimeConfig)
            .values({ key: `sva:local:${scopedId}`, value: String(nowMs), updatedAt: new Date(nowMs) })
            .onConflictDoUpdate({
              target: platformRuntimeConfig.key,
              set: { value: String(nowMs), updatedAt: new Date(nowMs) },
            });
        }
      }

      return {
        ...staff,
        id: scopedId,
        staffId: assignedStaffId,
        email: cleanEmail,
        username: cleanUsername,
        role: normalizedRole,
        mustChangePassword: nextMustChange,
        phone: normalizedPhone ?? undefined,
        password: '********',
      };
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
    console.error('Failed to save staff member:', error);
    throw new Error('Failed to save staff account.', { cause: error });
  }
}

export async function bulkUpsertTenantStaff(
  schoolId: string,
  staffList: UserAccount[]
): Promise<UserAccount[]> {
  if (staffList.length === 0) return [];
  try {
    return await withTenantScope(schoolId, async (tx) => {
      const [schoolRow, allStaffIds, allUserStaffIds] = await Promise.all([
        tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1),
        tx
          .select({ id: staffTeachers.id, email: staffTeachers.email, staffId: staffTeachers.staffId })
          .from(staffTeachers)
          .where(eq(staffTeachers.schoolId, schoolId)),
        tx.select({ staffId: users.staffId }).from(users).where(eq(users.schoolId, schoolId)),
      ]);

      const initials = extractSchoolInitials(schoolRow[0]?.name ?? 'School');
      const existingByEmail = new Map(
        allStaffIds.map((r) => [r.email.trim().toLowerCase(), r])
      );
      const usedIds = [...allStaffIds, ...allUserStaffIds]
        .map((r) => r.staffId)
        .filter((v): v is string => Boolean(v && v.trim()));
      const usedSet = new Set(usedIds.map((id) => id.toUpperCase()));

      const savedResults: UserAccount[] = [];

      for (const staff of staffList) {
        const cleanEmail = staff.email.trim().toLowerCase();
        const existingMatch = existingByEmail.get(cleanEmail);
        const scopedId =
          existingMatch?.id ?? (staff.id.includes(':') ? staff.id : `${schoolId}:${staff.id}`);
        const cleanUsername = staff.username.trim().toLowerCase() || cleanEmail.split('@')[0];
        if (cleanEmail === 'superadmin@schuleflow.ac.ug' || cleanUsername === 'superadmin') {
          throw new ValidationAppError(
            'superadmin@schuleflow.ac.ug and username "superadmin" are reserved for the Platform Super Admin.'
          );
        }
        const normalizedRole = normalizeUserRole(staff.role);
        const normalizedPhone = normalizeStoredPhone(staff.phone);
        const pwdHash =
          staff.password && staff.password !== '********'
            ? hashPassword(staff.password)
            : hashPassword('SchuleFlow2026!');
        const forcePwdChange = existingMatch ? false : true;

        let assignedStaffId = existingMatch?.staffId?.trim() || staff.staffId?.trim() || null;
        if (!assignedStaffId || (!existingMatch && usedSet.has(assignedStaffId.toUpperCase()))) {
          assignedStaffId = generateNextStaffId(initials, usedIds, true);
        }
        usedIds.push(assignedStaffId);
        usedSet.add(assignedStaffId.toUpperCase());

        await tx
          .insert(staffTeachers)
          .values({
            id: scopedId,
            schoolId,
            staffId: assignedStaffId,
            name: staff.name.trim(),
            email: cleanEmail,
            username: cleanUsername,
            passwordHash: pwdHash,
            role: normalizedRole,
            active: staff.active,
            mustChangePassword: forcePwdChange,
            phone: normalizedPhone,
            assignedClassIds: staff.assignedClassIds,
            assignedSubjectIds: staff.assignedSubjectIds,
            lastLogin: staff.lastLogin ?? null,
          })
          .onConflictDoUpdate({
            target: staffTeachers.id,
            set: {
              staffId: assignedStaffId,
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
            staffId: assignedStaffId,
            email: cleanEmail,
            username: cleanUsername,
            phone: normalizedPhone,
            passwordHash: pwdHash,
            name: staff.name.trim(),
            globalRole: 'school_user',
            schoolId,
            schoolRole: normalizedRole,
            active: staff.active,
            mustChangePassword: forcePwdChange,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: {
              staffId: assignedStaffId,
              email: cleanEmail,
              username: cleanUsername,
              phone: normalizedPhone,
              name: staff.name.trim(),
              schoolRole: normalizedRole,
              active: staff.active,
            },
          });

        savedResults.push({
          ...staff,
          id: scopedId,
          staffId: assignedStaffId,
          email: cleanEmail,
          username: cleanUsername,
          role: normalizedRole,
          mustChangePassword: forcePwdChange,
          phone: normalizedPhone ?? undefined,
          password: '********',
        });
      }

      return savedResults;
    });
  } catch (error) {
    if (error instanceof ValidationAppError) {
      throw error;
    }
    console.error('Failed to bulk upload staff members:', error);
    throw new Error('Failed to import staff directory.', { cause: error });
  }
}

export async function resetTenantStaffPasswordByAdmin(
  schoolId: string,
  staffRowId: string,
  suppliedTempPassword?: string
): Promise<{
  id: string;
  staffId: string | null;
  email: string;
  name: string;
  temporaryPassword: string;
}> {
  const tempPassword = suppliedTempPassword?.trim()
    ? suppliedTempPassword.trim()
    : `SF-${randomBytes(3).toString('hex').toUpperCase()}9`;

  const strengthErr = validatePasswordStrength(tempPassword);
  if (strengthErr) {
    throw new ValidationAppError(strengthErr);
  }

  const nextHash = hashPassword(tempPassword);
  const rawId = staffRowId.trim();
  const unprefixed = rawId.startsWith(`${schoolId}:`) ? rawId.slice(schoolId.length + 1) : rawId;
  const prefixed = `${schoolId}:${unprefixed}`;

  return withTenantScope(schoolId, async (tx) => {
    const existingRows = await tx
      .select()
      .from(staffTeachers)
      .where(
        and(
          eq(staffTeachers.schoolId, schoolId),
          inArray(staffTeachers.id, [rawId, prefixed, unprefixed])
        )
      )
      .limit(1);

    const target = existingRows[0];
    if (!target) {
      throw new ValidationAppError('Staff account not found.');
    }

    await tx
      .update(staffTeachers)
      .set({ passwordHash: nextHash, mustChangePassword: true })
      .where(eq(staffTeachers.id, target.id));

    const updatedUsers = await tx
      .update(users)
      .set({
        passwordHash: nextHash,
        mustChangePassword: true,
      })
      .where(
        and(
          eq(users.schoolId, schoolId),
          or(
            target.staffId
              ? sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${target.staffId.toLowerCase()}`
              : sql`false`,
            sql`lower(trim(${users.email})) = ${target.email.trim().toLowerCase()}`
          )
        )
      )
      .returning({ uid: users.uid });

    const nowMs = Date.now();
    for (const u of updatedUsers) {
      await tx
        .insert(platformRuntimeConfig)
        .values({ key: `sva:${u.uid}`, value: String(nowMs), updatedAt: new Date(nowMs) })
        .onConflictDoUpdate({
          target: platformRuntimeConfig.key,
          set: { value: String(nowMs), updatedAt: new Date(nowMs) },
        });
    }

    return {
      id: target.id,
      staffId: target.staffId ?? null,
      email: target.email,
      name: target.name,
      temporaryPassword: tempPassword,
    };
  });
}

export async function getSchoolMediaStorageSummary(schoolId: string): Promise<{
  configured: boolean;
  bucket: string;
  urlOrigin?: string;
  inlineLogoCount: number;
  inlineStudentPhotosCount: number;
  supabaseStudentPhotosCount: number;
}> {
  const status = isSupabaseStorageConfigured();
  return withTenantScope(schoolId, async (tx) => {
    const [schRows, gcRows, stuRows] = await Promise.all([
      tx.select({ logoUrl: schools.logoUrl }).from(schools).where(eq(schools.id, schoolId)).limit(1),
      tx
        .select({ reportLayout: gradingConfigs.reportLayout })
        .from(gradingConfigs)
        .where(eq(gradingConfigs.schoolId, schoolId))
        .limit(1),
      tx
        .select({ photoDataUrl: students.photoDataUrl })
        .from(students)
        .where(eq(students.schoolId, schoolId)),
    ]);

    const logoVal = schRows[0]?.logoUrl || gcRows[0]?.reportLayout?.customLogoDataUrl || '';
    const inlineLogoCount = isInlineDataImageUrl(logoVal) ? 1 : 0;

    let inlineStudentPhotosCount = 0;
    let supabaseStudentPhotosCount = 0;
    for (const row of stuRows) {
      if (!row.photoDataUrl) continue;
      if (isInlineDataImageUrl(row.photoDataUrl)) {
        inlineStudentPhotosCount += 1;
      } else if (/^https?:\/\//i.test(row.photoDataUrl)) {
        supabaseStudentPhotosCount += 1;
      }
    }

    return {
      ...status,
      inlineLogoCount,
      inlineStudentPhotosCount,
      supabaseStudentPhotosCount,
    };
  });
}

export async function migrateSchoolMediaToSupabase(schoolId: string): Promise<{
  migratedLogos: number;
  migratedPhotos: number;
  skipped: number;
}> {
  const status = isSupabaseStorageConfigured();
  if (!status.configured) {
    throw new ValidationAppError(
      'Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment first.'
    );
  }

  let migratedLogos = 0;
  let migratedPhotos = 0;
  let skipped = 0;

  await withTenantScope(schoolId, async (tx) => {
    const [schRows, gcRows, stuRows] = await Promise.all([
      tx.select({ logoUrl: schools.logoUrl }).from(schools).where(eq(schools.id, schoolId)).limit(1),
      tx
        .select({ id: gradingConfigs.id, reportLayout: gradingConfigs.reportLayout })
        .from(gradingConfigs)
        .where(eq(gradingConfigs.schoolId, schoolId))
        .limit(1),
      tx
        .select({ id: students.id, photoDataUrl: students.photoDataUrl })
        .from(students)
        .where(eq(students.schoolId, schoolId)),
    ]);

    const currentLogo = schRows[0]?.logoUrl || gcRows[0]?.reportLayout?.customLogoDataUrl || '';
    if (isInlineDataImageUrl(currentLogo)) {
      let uploaded;
      try {
        uploaded = await uploadMediaToSupabase({
          schoolId,
          folder: 'logos',
          entityId: 'school-crest',
          dataUrl: currentLogo,
          strictSupabase: true,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to migrate school logo.';
        throw new ValidationAppError(msg);
      }
      await tx.update(schools).set({ logoUrl: uploaded.url }).where(eq(schools.id, schoolId));
      if (gcRows[0]) {
        await tx
          .update(gradingConfigs)
          .set({
            reportLayout: {
              ...gcRows[0].reportLayout,
              customLogoDataUrl: uploaded.url,
            },
          })
          .where(eq(gradingConfigs.id, gcRows[0].id));
      }
      migratedLogos += 1;
    }

    for (const stu of stuRows) {
      if (!stu.photoDataUrl) continue;
      if (!isInlineDataImageUrl(stu.photoDataUrl)) {
        skipped += 1;
        continue;
      }
      try {
        const uploaded = await uploadMediaToSupabase({
          schoolId,
          folder: 'students',
          entityId: stu.id,
          dataUrl: stu.photoDataUrl,
          strictSupabase: true,
        });
        await tx
          .update(students)
          .set({ photoDataUrl: uploaded.url })
          .where(and(eq(students.schoolId, schoolId), eq(students.id, stu.id)));
        migratedPhotos += 1;
      } catch (err) {
        console.warn(`Skipped migrating photo for student ${stu.id}:`, err);
        skipped += 1;
      }
    }
  });

  return { migratedLogos, migratedPhotos, skipped };
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

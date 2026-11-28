import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  ALevelPolicyConfig,
  CbcConfig,
  GradeBand,
  MarkEntryItem,
  MarksheetAuditEntry,
  ReportCardLayoutConfig,
} from '../types';

/* -------------------------------------------------------------------------- */
/* 1. Master Tenant Table: Schools                                            */
/* -------------------------------------------------------------------------- */
export const schools = pgTable(
  'schools',
  {
    id: text('id').primaryKey(), // e.g., 'sch-kampala-horizon'
    schoolCode: text('school_code').notNull(), // e.g., 'KHHS-101'
    name: text('name').notNull(),
    subdomain: text('subdomain').notNull().unique(), // e.g., 'kampalahorizon'
    ministryRegNo: text('ministry_reg_no').notNull().default('MoES/SEC/000'),
    subCounty: text('sub_county').notNull().default('Central Division'),
    motto: text('motto').notNull().default('Strive for Excellence & Integrity'),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color').notNull().default('#1e3a8a'),
    secondaryColor: text('secondary_color').notNull().default('#b45309'),
    address: text('address').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    district: text('district').notNull().default('Kampala'),
    region: text('region').notNull().default('Central'),
    status: text('status').notNull().default('active'), // 'active' | 'trial' | 'suspended' | 'expired'
    subscriptionStatus: text('subscription_status').notNull().default('active'), // 'active' | 'trial' | 'suspended' | 'expired'
    licenseExpiresAt: timestamp('license_expires_at')
      .notNull()
      .default(sql`now() + interval '365 days'`),
    plan: text('plan').notNull().default('standard'), // 'starter' | 'standard' | 'enterprise'
    curriculumScope: text('curriculum_scope').notNull().default('olevel_alevel'), // 'olevel_only' | 'alevel_only' | 'olevel_alevel'
    studentQuota: integer('student_quota').notNull().default(250),
    termFeePerStudentUgx: integer('term_fee_per_student_ugx').notNull().default(4500),
    billingStatus: text('billing_status').notNull().default('paid'), // 'paid' | 'pending' | 'overdue'
    nextBillingDate: text('next_billing_date').notNull().default('2027-02-01'),
    academicYear: text('academic_year').notNull().default('2026'),
    termName: text('term_name').notNull().default('Term III'),
    principalName: text('principal_name').notNull(),
    dosName: text('dos_name').notNull(),
    reportsGeneratedCount: integer('reports_generated_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('schools_subdomain_idx').on(table.subdomain),
    uniqueIndex('schools_code_idx').on(table.schoolCode),
  ]
);

/* -------------------------------------------------------------------------- */
/* 2. Dynamic Grading & Report Card Configuration per School                  */
/* -------------------------------------------------------------------------- */
export const gradingConfigs = pgTable(
  'grading_configs',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .unique()
      .references(() => schools.id, { onDelete: 'cascade' }),
    cbcConfig: jsonb('cbc_config').$type<CbcConfig>().notNull(),
    alevelPolicy: jsonb('alevel_policy').$type<ALevelPolicyConfig>().notNull(),
    olevelGradingScale: jsonb('olevel_grading_scale').$type<GradeBand[]>().notNull(),
    alevelGradingScale: jsonb('alevel_grading_scale').$type<GradeBand[]>().notNull(),
    reportLayout: jsonb('report_layout').$type<ReportCardLayoutConfig>().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('grading_configs_school_idx').on(table.schoolId)]
);

/* -------------------------------------------------------------------------- */
/* 3. Authenticated Platform Users (PostgreSQL RBAC & Staff ID Login)         */
/* -------------------------------------------------------------------------- */
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(), // local:<staffId> or env:super_admin:<email>
    staffId: text('staff_id'), // e.g., 'KHS-TCH-001' (scoped per school)
    email: text('email').notNull(),
    username: text('username'),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    globalRole: text('global_role').notNull().default('school_user'), // 'super_admin' | 'school_user'
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'set null' }),
    schoolRole: text('school_role').notNull().default('teacher'), // 'school_admin' | 'dos' | 'class_teacher' | 'teacher' | 'bursar' | 'headteacher'
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLogin: timestamp('last_login').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
    index('users_username_idx').on(table.username),
    index('users_phone_idx').on(table.phone),
    index('users_school_idx').on(table.schoolId),
    uniqueIndex('users_school_staff_id_idx').on(table.schoolId, table.staffId),
  ]
);

/* -------------------------------------------------------------------------- */
/* 4. Tenant-Scoped Staff & Teachers                                          */
/* -------------------------------------------------------------------------- */
export const staffTeachers = pgTable(
  'staff_teachers',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    staffId: text('staff_id'), // e.g., '001' (short < 4 char ID, unique per school)
    name: text('name').notNull(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash'),
    role: text('role').notNull(), // 'school_admin' | 'dos' | 'class_teacher' | 'teacher' | 'bursar' | 'headteacher'
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    phone: text('phone'),
    assignedClassIds: jsonb('assigned_class_ids').$type<string[]>().notNull().default([]),
    assignedSubjectIds: jsonb('assigned_subject_ids').$type<string[]>().notNull().default([]),
    lastLogin: text('last_login'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('staff_school_idx').on(table.schoolId),
    index('staff_email_idx').on(table.schoolId, table.email),
    uniqueIndex('staff_school_staff_id_idx').on(table.schoolId, table.staffId),
  ]
);

/* -------------------------------------------------------------------------- */
/* 5. Tenant-Scoped Subjects & Combinations                                   */
/* -------------------------------------------------------------------------- */
export const subjects = pgTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    level: text('level').notNull(), // 'olevel' | 'alevel'
    category: text('category').notNull(), // 'compulsory' | 'elective' | 'principal' | 'subsidiary'
    maxMarks: integer('max_marks').notNull().default(100),
    passMark: integer('pass_mark').notNull().default(50),
    competencies: jsonb('competencies').$type<string[]>().notNull().default([]),
    archived: boolean('archived').notNull().default(false),
  },
  (table) => [index('subjects_school_idx').on(table.schoolId)]
);

export const subjectCombinations = pgTable(
  'subject_combinations',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    principalSubjectIds: jsonb('principal_subject_ids').$type<string[]>().notNull().default([]),
    subsidiarySubjectIds: jsonb('subsidiary_subject_ids').$type<string[]>().notNull().default([]),
  },
  (table) => [index('combinations_school_idx').on(table.schoolId)]
);

/* -------------------------------------------------------------------------- */
/* 6. Tenant-Scoped Classes & Streams                                         */
/* -------------------------------------------------------------------------- */
export const classesStreams = pgTable(
  'classes_streams',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    gradeLevel: text('grade_level').notNull(),
    stream: text('stream').notNull(),
    level: text('level').notNull(), // 'olevel' | 'alevel'
    classTeacherId: text('class_teacher_id').notNull().default(''),
    subjectIds: jsonb('subject_ids').$type<string[]>().notNull().default([]),
    subjectTeacherMap: jsonb('subject_teacher_map')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    archived: boolean('archived').notNull().default(false),
  },
  (table) => [index('classes_school_idx').on(table.schoolId)]
);

/* -------------------------------------------------------------------------- */
/* 7. Tenant-Scoped Students                                                  */
/* -------------------------------------------------------------------------- */
export const students = pgTable(
  'students',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    studentId: text('student_id'), // e.g., 'KHS-STD-001' (unique per school)
    admissionNo: text('admission_no').notNull(),
    fullName: text('full_name').notNull(),
    gender: text('gender').notNull(), // 'M' | 'F'
    dateOfBirth: text('date_of_birth'),
    classId: text('class_id').notNull(),
    academicYear: text('academic_year').notNull(),
    status: text('status').notNull().default('active'), // 'active' | 'transferred' | 'inactive'
    combinationId: text('combination_id'),
    offeredSubjectIds: jsonb('offered_subject_ids').$type<string[] | null>(),
    parentName: text('parent_name'),
    parentContact: text('parent_contact'),
    photoDataUrl: text('photo_data_url'),
    feesBalance: text('fees_balance').default('Cleared'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('students_school_idx').on(table.schoolId),
    index('students_school_class_idx').on(table.schoolId, table.classId),
    index('students_school_status_idx').on(table.schoolId, table.status),
    uniqueIndex('students_school_student_id_idx').on(table.schoolId, table.studentId),
  ]
);

/* -------------------------------------------------------------------------- */
/* 8. Tenant-Scoped Examinations & Marksheets                                 */
/* -------------------------------------------------------------------------- */
export const examinations = pgTable(
  'examinations',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    examType: text('exam_type').notNull(),
    term: text('term').notNull(),
    academicYear: text('academic_year').notNull(),
    levelScope: text('level_scope').notNull().default('all'),
    classIds: jsonb('class_ids').$type<string[]>().notNull().default([]),
    examDate: text('exam_date').notNull(),
    submissionDeadline: text('submission_deadline').notNull(),
    locked: boolean('locked').notNull().default(false),
    published: boolean('published').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('exams_school_idx').on(table.schoolId)]
);

export const marksheets = pgTable(
  'marksheets',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    examId: text('exam_id').notNull(),
    classId: text('class_id').notNull(),
    subjectId: text('subject_id').notNull(),
    teacherId: text('teacher_id').notNull().default(''),
    status: text('status').notNull().default('draft'),
    entries: jsonb('entries').$type<Record<string, MarkEntryItem>>().notNull().default({}),
    submittedAt: text('submitted_at'),
    submittedBy: text('submitted_by'),
    approvedAt: text('approved_at'),
    approvedBy: text('approved_by'),
    dosComment: text('dos_comment'),
    version: integer('version').notNull().default(1),
    lastModified: text('last_modified').notNull(),
    auditHistory: jsonb('audit_history').$type<MarksheetAuditEntry[]>().notNull().default([]),
  },
  (table) => [
    index('marksheets_school_idx').on(table.schoolId),
    index('marksheets_school_exam_status_idx').on(table.schoolId, table.examId, table.status),
    index('marksheets_lookup_idx').on(
      table.schoolId,
      table.examId,
      table.classId,
      table.subjectId
    ),
  ]
);

export const studentRemarks = pgTable(
  'student_remarks',
  {
    id: text('id').primaryKey(), // `${schoolId}:${examId}:${studentId}`
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    examId: text('exam_id').notNull(),
    studentId: text('student_id').notNull(),
    classTeacherRemark: text('class_teacher_remark'),
    dosRemark: text('dos_remark'),
    headTeacherRemark: text('head_teacher_remark'),
  },
  (table) => [index('remarks_school_idx').on(table.schoolId)]
);

export const marksheetCorrectionRequests = pgTable(
  'marksheet_correction_requests',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    marksheetId: text('marksheet_id').notNull(),
    examId: text('exam_id').notNull(),
    classId: text('class_id').notNull(),
    subjectId: text('subject_id').notNull(),
    assessmentScope: text('assessment_scope').notNull().default('all'),
    requestedByUserId: text('requested_by_user_id').notNull(),
    requestedByName: text('requested_by_name').notNull(),
    requestedByStaffId: text('requested_by_staff_id'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedByName: text('reviewed_by_name'),
    reviewNote: text('review_note'),
    createdAt: text('created_at').notNull(),
    reviewedAt: text('reviewed_at'),
  },
  (table) => [
    index('correction_req_school_idx').on(table.schoolId),
    index('correction_req_school_status_idx').on(table.schoolId, table.status),
    index('correction_req_lookup_idx').on(
      table.schoolId,
      table.examId,
      table.classId,
      table.subjectId
    ),
  ]
);

/* -------------------------------------------------------------------------- */
/* 9. Subscription Billing & Tenant Activity Logs                             */
/* -------------------------------------------------------------------------- */
export const subscriptionInvoices = pgTable(
  'subscription_invoices',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    termName: text('term_name').notNull(),
    academicYear: text('academic_year').notNull(),
    activeStudentsCount: integer('active_students_count').notNull(),
    licensedQuota: integer('licensed_quota').notNull(),
    unitFeeUgx: integer('unit_fee_ugx').notNull(),
    totalAmountUgx: integer('total_amount_ugx').notNull(),
    status: text('status').notNull().default('paid'), // 'paid' | 'pending' | 'overdue'
    issuedAt: text('issued_at').notNull(),
    paidAt: text('paid_at'),
  },
  (table) => [index('invoices_school_idx').on(table.schoolId)]
);

export const loginActivity = pgTable(
  'login_activity',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    role: text('role').notNull(),
    timestamp: text('timestamp').notNull(),
    action: text('action').notNull(),
  },
  (table) => [index('activity_school_idx').on(table.schoolId)]
);

/* -------------------------------------------------------------------------- */
/* 10. Platform-Level Administrative Audit Logs                               */
/* -------------------------------------------------------------------------- */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    userRole: text('user_role').notNull(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: text('details').notNull(),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_timestamp_idx').on(table.timestamp),
    index('audit_logs_school_idx').on(table.schoolId),
    index('audit_logs_school_ts_idx').on(table.schoolId, table.timestamp),
  ]
);

/* -------------------------------------------------------------------------- */
/* 11. Platform Runtime Configuration (e.g., Cloud Run HMAC Signing Secret)   */
/* -------------------------------------------------------------------------- */
export const platformRuntimeConfig = pgTable('platform_runtime_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* -------------------------------------------------------------------------- */
/* Drizzle Relations                                                          */
/* -------------------------------------------------------------------------- */
export const schoolsRelations = relations(schools, ({ one, many }) => ({
  gradingConfig: one(gradingConfigs, {
    fields: [schools.id],
    references: [gradingConfigs.schoolId],
  }),
  staffTeachers: many(staffTeachers),
  subjects: many(subjects),
  combinations: many(subjectCombinations),
  classes: many(classesStreams),
  students: many(students),
  examinations: many(examinations),
  marksheets: many(marksheets),
  invoices: many(subscriptionInvoices),
}));

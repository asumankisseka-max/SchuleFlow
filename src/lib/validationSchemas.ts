import { z } from 'zod';

const USER_ROLES = [
  'school_admin',
  'admin',
  'dos',
  'class_teacher',
  'teacher',
  'bursar',
  'headteacher',
] as const;

export const loginSchema = z.object({
  schoolCode: z.string().trim().max(40).optional(),
  identifier: z.string().trim().min(1, 'Staff ID, email, username, or phone is required.').max(180),
  password: z.string().min(1, 'Password is required.').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(200),
});

export const onboardSchoolSchema = z.object({
  name: z.string().trim().min(2, 'School name is required.').max(160),
  subdomain: z.string().trim().min(2, 'School subdomain is required.').max(64),
  ministryRegNo: z.string().trim().max(80).optional(),
  subCounty: z.string().trim().max(80).optional(),
  motto: z.string().trim().max(200).default('Strive for Excellence & Integrity'),
  district: z.string().trim().min(2).max(80).default('Kampala'),
  region: z.string().trim().min(2).max(80).default('Central'),
  address: z.string().trim().min(2).max(200).default('P.O. Box, Kampala'),
  phone: z.string().trim().min(6).max(40).default('+256 700 000000'),
  email: z.string().trim().email('Valid school email is required.'),
  principalName: z.string().trim().min(2).max(120).default('Headteacher'),
  dosName: z.string().trim().min(2).max(120).default('Director of Studies'),
  adminName: z.string().trim().min(2, 'Primary School Admin name is required.').max(120),
  adminEmail: z.string().trim().email('Valid primary School Admin email is required.'),
  adminPhone: z.string().trim().max(40).optional(),
  adminUsername: z.string().trim().max(80).optional(),
  adminPassword: z.string().min(6).max(200).optional(),
  plan: z.enum(['trial', 'starter', 'standard', 'enterprise']).default('standard'),
  curriculumScope: z.enum(['olevel_only', 'alevel_only', 'olevel_alevel']).default('olevel_alevel'),
  status: z.enum(['active', 'trial', 'suspended', 'expired']).default('active'),
  subscriptionStatus: z.enum(['active', 'trial', 'suspended', 'expired']).optional(),
  licenseExpiresAt: z.string().optional(),
  academicYear: z.string().trim().min(4).max(20).default('2026'),
  termName: z.string().trim().min(2).max(40).default('Term III'),
});

export const studentProfileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  studentId: z.string().trim().max(60).optional(),
  admissionNo: z.string().trim().min(1, 'Admission number is required.').max(60),
  fullName: z.string().trim().min(2, 'Student full name is required.').max(160),
  gender: z.enum(['M', 'F']),
  dateOfBirth: z.string().trim().max(40).optional(),
  classId: z.string().trim().min(1, 'Class assignment is required.').max(120),
  academicYear: z.string().trim().min(4).max(20),
  status: z.enum(['active', 'transferred', 'inactive']).default('active'),
  combinationId: z.string().trim().max(120).optional(),
  parentName: z.string().trim().max(160).optional(),
  parentContact: z.string().trim().max(40).optional(),
  photoDataUrl: z.string().max(4_500_000).optional(),
});

export const createStudentsBodySchema = z
  .object({
    students: z.array(studentProfileSchema).max(500).optional(),
    student: studentProfileSchema.optional(),
  })
  .refine((d) => (d.students && d.students.length > 0) || Boolean(d.student), {
    message: 'Provide at least one student record.',
  });

export const promoteStudentsSchema = z.object({
  studentIds: z.array(z.string().trim().min(1)).min(1, 'Select at least one student.'),
  targetClassId: z.string().trim().min(1, 'Target class is required.'),
});

export const streamClassPayloadSchema = z.object({
  cls: z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().max(120).default(''),
    gradeLevel: z.string().trim().min(1, 'Grade level is required.').max(40),
    stream: z.string().trim().max(60).optional(),
    level: z.enum(['olevel', 'alevel']),
    classTeacherId: z.string().max(120).default(''),
    subjectIds: z.array(z.string()).default([]),
    subjectTeacherMap: z.record(z.string(), z.string()).default({}),
    archived: z.boolean().optional(),
  }),
  attachToExamId: z.string().trim().max(120).optional(),
});

export const subjectSchema = z.object({
  id: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1, 'Subject code is required.').max(32),
  name: z.string().trim().min(1, 'Subject name is required.').max(120),
  level: z.enum(['olevel', 'alevel']),
  category: z.enum(['compulsory', 'elective', 'principal', 'subsidiary']),
  maxMarks: z.coerce.number().min(1).max(1000),
  passMark: z.coerce.number().min(0).max(1000),
  competencies: z.array(z.string()).default([]),
  archived: z.boolean().optional(),
});

export const combinationSchema = z.object({
  id: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1, 'Combination code is required.').max(40),
  name: z.string().trim().min(1).max(160),
  principalSubjectIds: z.array(z.string()).min(1, 'Select at least one principal subject.'),
  subsidiarySubjectIds: z.array(z.string()).default([]),
});

export const examSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2, 'Exam name is required.').max(160),
  examType: z.enum(['BOT', 'Midterm', 'End of Term']),
  term: z.string().trim().min(1).max(60),
  academicYear: z.string().trim().min(4).max(20),
  levelScope: z.enum(['all', 'olevel', 'alevel']),
  classIds: z.array(z.string()).min(1, 'Select at least one class.'),
  examDate: z.string().trim().min(4).max(40),
  submissionDeadline: z.string().trim().min(4).max(40),
  locked: z.boolean().default(false),
  published: z.boolean().default(false),
  archived: z.boolean().optional(),
  createdAt: z.string().trim().min(4).max(60),
});

const markEntryItemSchema = z.object({
  u1: z.string().max(16).optional(),
  u2: z.string().max(16).optional(),
  u3: z.string().max(16).optional(),
  eot: z.string().max(16).optional(),
  mark: z.string().max(16).optional(),
  competencyObservation: z.string().max(500).optional(),
  exempted: z.boolean().optional(),
  missed: z.boolean().optional(),
});

export const marksheetSchema = z.object({
  id: z.string().trim().min(1).max(160),
  examId: z.string().trim().min(1).max(120),
  classId: z.string().trim().min(1).max(120),
  subjectId: z.string().trim().min(1).max(120),
  teacherId: z.string().max(160).default(''),
  status: z.enum(['draft', 'submitted', 'returned', 'approved', 'published']),
  entries: z.record(z.string(), markEntryItemSchema),
  submittedAt: z.string().optional(),
  submittedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  dosComment: z.string().max(1000).optional(),
  version: z.number().int().positive().optional(),
  lastModified: z.string().min(4).max(60),
  auditHistory: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.string(),
        actorId: z.string(),
        actorName: z.string(),
        actorRole: z.enum(USER_ROLES),
        action: z.string(),
        details: z.string(),
      })
    )
    .default([]),
});

export const remarkSchema = z.object({
  examId: z.string().trim().min(1, 'Exam ID is required.').max(120),
  studentId: z.string().trim().min(1, 'Student ID is required.').max(120),
  field: z.enum(['classTeacherRemark', 'dosRemark', 'headTeacherRemark']),
  value: z.string().max(1000),
});

export const staffSchema = z.object({
  id: z.string().trim().min(1).max(160),
  staffId: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2, 'Staff full name is required.').max(160),
  email: z.string().trim().email('Valid email address is required.'),
  username: z.string().trim().min(2).max(120),
  password: z.string().max(200).default(''),
  role: z.enum(USER_ROLES),
  active: z.boolean().default(true),
  mustChangePassword: z.boolean().optional(),
  phone: z.string().trim().max(40).optional(),
  assignedClassIds: z.array(z.string()).default([]),
  assignedSubjectIds: z.array(z.string()).default([]),
  lastLogin: z.string().optional(),
});

export const bulkStaffSchema = z.object({
  staff: z.array(staffSchema).min(1, 'Provide at least one staff account.').max(300),
});

export const mediaUploadSchema = z.object({
  folder: z.enum(['logos', 'students']),
  entityId: z.string().trim().max(120).optional(),
  dataUrl: z.string().min(10, 'Image data is required.').max(4_500_000),
});

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const first = result.error.issues[0];
  const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
  return {
    ok: false,
    error: `${path}${first?.message || 'Invalid request payload.'}`,
  };
}

export type EducationLevel = 'olevel' | 'alevel';

export type UserRole =
  | 'school_admin'
  | 'admin'
  | 'dos'
  | 'class_teacher'
  | 'teacher'
  | 'bursar'
  | 'headteacher';

export type CurriculumScope = 'olevel_only' | 'alevel_only' | 'olevel_alevel';

export type GlobalRole = 'super_admin' | 'school_user';

export type SchoolStatus = 'active' | 'trial' | 'suspended' | 'expired';

export type SubscriptionPlan = 'trial' | 'starter' | 'standard' | 'enterprise';

export type BillingStatus = 'paid' | 'pending' | 'overdue';

export type WorkspaceTab =
  | 'dashboard'
  | 'students'
  | 'classes'
  | 'subjects'
  | 'teachers'
  | 'examinations'
  | 'marks-entry'
  | 'marksheets'
  | 'results-analysis'
  | 'reports'
  | 'academic-history'
  | 'settings'
  | 'users'
  | 'billing'
  | 'platform-admin';

export interface UserAccount {
  id: string;
  staffId?: string;
  name: string;
  email: string;
  username: string;
  password: string;
  role: UserRole;
  active: boolean;
  mustChangePassword?: boolean;
  phone?: string;
  assignedClassIds: string[];
  assignedSubjectIds: string[];
  lastLogin?: string;
}

export interface LoginActivityRecord {
  id: string;
  userId: string;
  userName: string;
  role: UserRole;
  timestamp: string;
  action: 'login' | 'logout' | 'password_reset';
}

export type SubjectCategory = 'compulsory' | 'elective' | 'principal' | 'subsidiary';

export interface SubjectDefinition {
  id: string;
  code: string;
  name: string;
  level: EducationLevel;
  category: SubjectCategory;
  maxMarks: number;
  passMark: number;
  competencies: string[];
  archived?: boolean;
}

export interface SubjectCombination {
  id: string;
  code: string;
  name: string;
  principalSubjectIds: string[];
  subsidiarySubjectIds: string[];
}

export interface StreamClass {
  id: string;
  name: string; // e.g., "S.1" or "S.2 East"
  gradeLevel: string; // "S.1" .. "S.6"
  stream?: string; // Optional stream e.g. "East", "West", "Science", "Arts"
  level: EducationLevel;
  classTeacherId: string;
  subjectIds: string[];
  subjectTeacherMap: Record<string, string>; // subjectId -> userId
  archived?: boolean;
}

export type StudentStatus = 'active' | 'transferred' | 'inactive';

export interface StudentProfile {
  id: string;
  studentId?: string;
  admissionNo: string;
  fullName: string;
  gender: 'M' | 'F';
  dateOfBirth?: string;
  classId: string;
  academicYear: string;
  status: StudentStatus;
  combinationId?: string; // A'Level combination
  parentName?: string;
  parentContact?: string;
  photoDataUrl?: string;
}

export type ExamType = 'BOT' | 'Midterm' | 'End of Term';

export interface ExaminationPeriod {
  id: string;
  name: string;
  examType: ExamType;
  term: string;
  academicYear: string;
  levelScope: 'all' | 'olevel' | 'alevel';
  classIds: string[];
  examDate: string;
  submissionDeadline: string;
  locked: boolean;
  published: boolean;
  archived?: boolean;
  createdAt: string;
}

export type MarksheetStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'published';

export interface MarksheetAuditEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  details: string;
}

export interface MarkEntryItem {
  u1?: string;
  u2?: string;
  u3?: string;
  eot?: string;
  mark?: string;
  competencyObservation?: string;
  exempted?: boolean;
  missed?: boolean;
}

export interface MarksheetRecord {
  id: string;
  examId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  status: MarksheetStatus;
  entries: Record<string, MarkEntryItem>; // studentId -> MarkEntryItem
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  dosComment?: string;
  version?: number;
  lastModified: string;
  auditHistory: MarksheetAuditEntry[];
}

export interface StudentTermRemarks {
  classTeacherRemark?: string;
  dosRemark?: string;
  headTeacherRemark?: string;
}

export interface GradeBand {
  grade: string;
  minPercentage: number;
  label: string;
  gpa: number;
  description?: string;
}

export interface CbcConfig {
  aoiMaxMark: number; // Default 3
  eotMaxMark: number; // Default 100
  formativeWeight: number; // Default 20
  summativeWeight: number; // Default 80
  roundingMode: 'one_decimal' | 'two_decimals' | 'whole';
  aoiInputMode: 'u1_u3' | 'single_aoi';
}

export interface ALevelPolicyConfig {
  maxPrincipalsCount: number; // Default 3
  maxSubsidiariesCount: number; // Default 2
  subsidiaryPassMark: number; // Default 50
  includeSubsidiaryPoints: boolean; // Default true
}

export type ReportCardStyle = 'classic' | 'modern' | 'compact';
export type ReportCardCrest = 'shield' | 'book' | 'award' | 'graduation' | 'custom' | 'none';
export type ReportCardAccent = 'navy' | 'emerald' | 'burgundy' | 'slate' | 'indigo';

export interface ReportCardLayoutConfig {
  style: ReportCardStyle;
  accentColor: ReportCardAccent;
  headerAlignment: 'split' | 'centered';
  crestType: ReportCardCrest;
  customLogoDataUrl?: string;
  reportTitle: string;
  schoolMotto: string;
  schoolContact: string;
  showStudentPhoto: boolean;
  showSubjectCode: boolean;
  showPassMark: boolean;
  showClassAverage: boolean;
  showSubjectRank: boolean;
  showSubjectTeacher: boolean;
  showClassPosition: boolean;
  showOverallSummaryStrip: boolean;
  showPerformanceChart: boolean;
  showGradingKey: boolean;
  showCompetenciesSection: boolean;
  showDosComment: boolean;
  showParentSignature: boolean;
  showSchoolStampBox: boolean;
  showNextTermDate: boolean;
  nextTermClosingDate: string;
  nextTermDate: string;
  leftSignatureLabel: string;
  rightSignatureLabel: string;
  parentSignatureLabel: string;
  footerNote: string;
}

export interface SchoolSettings {
  schoolName: string;
  schoolAddress: string;
  schoolPhone: string;
  schoolEmail: string;
  academicYear: string;
  termName: string;
  principalName: string;
  dosName: string;
  curriculumScope?: CurriculumScope;
  badgeDataUrl?: string;
  uniformPrimaryColor?: string;
  uniformSecondaryColor?: string;
  cbcConfig: CbcConfig;
  alevelPolicy: ALevelPolicyConfig;
  olevelGradingScale: GradeBand[];
  alevelGradingScale: GradeBand[];
  reportLayout: ReportCardLayoutConfig;
}

export interface SchoolTenant {
  id: string;
  schoolCode: string;
  name: string;
  subdomain: string;
  ministryRegNo?: string;
  subCounty?: string;
  motto: string;
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  address: string;
  phone: string;
  email: string;
  district: string;
  region: string;
  status: SchoolStatus;
  subscriptionStatus: SchoolStatus;
  licenseExpiresAt: string;
  plan: SubscriptionPlan;
  curriculumScope?: CurriculumScope;
  studentQuota: number;
  termFeePerStudentUgx: number;
  billingStatus: BillingStatus;
  nextBillingDate: string;
  academicYear: string;
  termName: string;
  principalName: string;
  dosName: string;
  reportsGeneratedCount: number;
  activeStudentCount?: number;
  staffCount?: number;
  adminStaffId?: string;
  createdAt?: string;
}

export interface PublicSchoolBranding {
  id: string;
  schoolCode: string;
  name: string;
  subdomain: string;
  district: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface AuditLogRecord {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  schoolId: string | null;
  schoolName?: string | null;
  action: string;
  details: string;
  timestamp: string;
}

export interface SubscriptionInvoice {
  id: string;
  schoolId: string;
  termName: string;
  academicYear: string;
  activeStudentsCount: number;
  licensedQuota: number;
  unitFeeUgx: number;
  totalAmountUgx: number;
  status: BillingStatus;
  issuedAt: string;
  paidAt?: string | null;
}

export interface AuthSessionProfile {
  userId?: number;
  uid: string;
  staffId?: string;
  schoolCode?: string | null;
  email: string;
  username?: string;
  phone?: string;
  name: string;
  globalRole: GlobalRole;
  schoolId: string | null;
  schoolRole: UserRole;
  active: boolean;
  mustChangePassword?: boolean;
}

export interface SchoolDatabase {
  users: UserAccount[];
  loginActivity: LoginActivityRecord[];
  subjects: SubjectDefinition[];
  combinations: SubjectCombination[];
  classes: StreamClass[];
  students: StudentProfile[];
  exams: ExaminationPeriod[];
  marksheets: MarksheetRecord[];
  studentRemarks: Record<string, StudentTermRemarks>; // key `${examId}:${studentId}`
  settings: SchoolSettings;
  reportsGeneratedCount: number;
  invoices?: SubscriptionInvoice[];
}

/* -------------------------------------------------------------------------- */
/* Computed Result & Validation Models (consumed by Analytics & Report Cards) */
/* -------------------------------------------------------------------------- */

export interface SubjectConfig {
  id: string;
  code: string;
  name: string;
  category: SubjectCategory;
  maxMarks: number;
  passMark: number;
  teacher?: string;
  competencies?: string[];
}

export interface CbcSubjectMarks {
  u1: string;
  u2: string;
  u3: string;
  eot: string;
}

export interface StudentRecord {
  id: string;
  admissionNo: string;
  name: string;
  gender: 'M' | 'F';
  combinationCode?: string;
  combinationName?: string;
  photoDataUrl?: string;
  marks: Record<string, string>;
  cbcMarks?: Record<string, CbcSubjectMarks>;
  teacherRemark?: string;
  dosRemark?: string;
  headTeacherRemark?: string;
}

export interface ExamClass {
  id: string;
  examId: string;
  classId: string;
  className: string;
  level: EducationLevel;
  examTitle: string;
  classTeacher: string;
  examDate: string;
  subjects: SubjectConfig[];
  students: StudentRecord[];
  lastModified: string;
}

export interface SubjectStudentResult {
  subjectId: string;
  category: SubjectCategory;
  rawValue: string;
  numericValue: number | null;
  maxMarks: number;
  percentage: number | null;
  grade: string;
  gradeLabel: string;
  points: number;
  passed: boolean | null;
  subjectRank?: number | null;
  exempted: boolean;
  missed: boolean;
  competencyObservation?: string;
  // O'Level CBC breakdown
  u1: number | null;
  u2: number | null;
  u3: number | null;
  aoiAverage: number | null;
  aoiScore20: number | null;
  identifier: number | null; // 1 = Basic, 2 = Moderate, 3 = Outstanding
  eotScore: number | null;
  eotScore80: number | null;
}

export interface StudentCalculatedResult {
  studentId: string;
  admissionNo: string;
  name: string;
  gender: 'M' | 'F';
  combinationCode?: string;
  combinationName?: string;
  photoDataUrl?: string;
  subjectResults: Record<string, SubjectStudentResult>;
  totalObtained: number;
  totalMax: number;
  assessedCount: number;
  subjectCount: number;
  percentage: number;
  grade: string;
  gradeLabel: string;
  gpa: number;
  totalPoints: number;
  principalPassesCount: number;
  subsidiaryPassesCount: number;
  passedAll: boolean;
  failedSubjects: string[];
  status: 'Passed' | 'Needs Support' | 'In Progress';
  rank: number;
  autoRemark: string;
  teacherRemark: string;
  dosRemark: string;
  headTeacherRemark: string;
}

export interface SubjectSummary {
  subjectId: string;
  code: string;
  name: string;
  category: SubjectCategory;
  teacher?: string;
  maxMarks: number;
  passMark: number;
  enteredCount: number;
  missingCount: number;
  exemptCount: number;
  missedCount: number;
  mean: number;
  meanPercent: number;
  median: number;
  medianPercent: number;
  highest: number;
  highestPercent: number;
  highestStudents: string[];
  lowest: number;
  lowestPercent: number;
  lowestStudents: string[];
  passCount: number;
  failCount: number;
  passRate: number;
  stdDev: number;
  gradeCounts: Record<string, number>;
}

export interface ClassPerformanceSummary {
  level: EducationLevel;
  studentResults: StudentCalculatedResult[];
  subjectSummaries: SubjectSummary[];
  classMeanPercent: number;
  classMedianPercent: number;
  passRate: number;
  passedCount: number;
  needsSupportCount: number;
  highestStudent: StudentCalculatedResult | null;
  topSubject: SubjectSummary | null;
  gradeDistribution: Array<{
    grade: string;
    label: string;
    count: number;
    percent: number;
  }>;
  topPerformers: StudentCalculatedResult[];
  needsSupportStudents: StudentCalculatedResult[];
}

export interface MarkValidationIssue {
  studentId: string;
  admissionNo: string;
  studentName: string;
  field: string;
  type: 'missing' | 'out_of_range' | 'invalid_number';
  message: string;
}

export interface MarksheetValidationSummary {
  isReadyForSubmission: boolean;
  totalStudents: number;
  completedCount: number;
  missingCount: number;
  invalidCount: number;
  exemptOrMissedCount: number;
  issues: MarkValidationIssue[];
}

export interface StudentTermHistoryPoint {
  examId: string;
  examName: string;
  term: string;
  academicYear: string;
  examDate: string;
  className: string;
  level: EducationLevel;
  percentage: number;
  grade: string;
  totalPoints: number;
  rank: number;
  classSize: number;
  subjectScores: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    score: number | null;
    grade: string;
  }>;
}

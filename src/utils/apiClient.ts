import type {
  AuditLogRecord,
  AuthSessionProfile,
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
} from '../types';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;
let activeSchoolInterceptorId: string | null = null;

export function configureApiClient(
  getToken: TokenProvider,
  schoolId: string | null
): void {
  tokenProvider = getToken;
  activeSchoolInterceptorId = schoolId;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  explicitSchoolId?: string | null
): Promise<T> {
  const token = await tokenProvider();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const tenantHeader = explicitSchoolId ?? activeSchoolInterceptorId;
  if (tenantHeader) {
    headers.set('X-School-Id', tenantHeader);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errMsg =
      (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
        ? parsed.error
        : null) || `Request failed (${response.status})`;
    throw new ApiError(errMsg, response.status);
  }

  return parsed as T;
}

export const platformApi = {
  getAuthConfig: () =>
    requestJson<{ supabaseUrl: string | null; supabaseAnonKey: string | null }>(
      '/api/v1/auth/config',
      { method: 'GET' },
      null
    ),

  listPublicSchoolBranding: () =>
    requestJson<{ schools: PublicSchoolBranding[] }>(
      '/api/v1/auth/schools-branding',
      { method: 'GET' },
      null
    ),

  registerEmail: (email: string, password: string, fullName?: string) =>
    requestJson<{ token: string; user: AuthSessionProfile; schools: SchoolTenant[] }>(
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(fullName ? { fullName } : {}) }),
      },
      null
    ),

  loginWithCredentials: (identifier: string, password: string, schoolId?: string) =>
    requestJson<{ token: string; user: AuthSessionProfile; schools: SchoolTenant[] }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ identifier, password, ...(schoolId ? { schoolId } : {}) }),
      },
      null
    ),

  syncSession: () =>
    requestJson<{ user: AuthSessionProfile; schools: SchoolTenant[] }>(
      '/api/v1/auth/sync',
      { method: 'POST' },
      null
    ),

  listSchools: () =>
    requestJson<{ schools: SchoolTenant[] }>('/api/v1/platform/schools', { method: 'GET' }, null),

  listAuditLogs: () =>
    requestJson<{ logs: AuditLogRecord[] }>(
      '/api/v1/platform/audit-logs',
      { method: 'GET' },
      null
    ),

  onboardSchool: (payload: {
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
  }) =>
    requestJson<{ school: SchoolTenant }>(
      '/api/v1/platform/schools',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      null
    ),

  updateSchoolSubscription: (
    targetSchoolId: string,
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
  ) =>
    requestJson<{ school: SchoolTenant }>(
      `/api/v1/platform/schools/${encodeURIComponent(targetSchoolId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      null
    ),

  deleteSchool: (targetSchoolId: string) =>
    requestJson<{
      ok: boolean;
      deleted: { id: string; name: string; subdomain: string; ministryRegNo: string };
    }>(
      `/api/v1/platform/schools/${encodeURIComponent(targetSchoolId)}`,
      {
        method: 'DELETE',
      },
      null
    ),

  recoverySchools: () =>
    requestJson<{ schools: Array<{ id: string; name: string; district: string }> }>(
      '/api/v1/auth/recover/schools',
      { method: 'GET' },
      null
    ),

  recoveryLookup: (payload: { identifier?: string; schoolId?: string; fullName?: string }) =>
    requestJson<{
      recoveryToken: string;
      lookupMethod: 'identifier' | 'name_school';
      maskedEmail: string;
      maskedPhone: string | null;
      maskedUsername: string | null;
      schoolName: string;
      schoolContactPhone: string | null;
      schoolContactEmail: string | null;
      roleLabel: string;
      hasPhone: boolean;
    }>(
      '/api/v1/auth/recover/lookup',
      { method: 'POST', body: JSON.stringify(payload) },
      null
    ),

  recoveryVerify: (recoveryToken: string, verification: string) =>
    requestJson<{
      resetToken: string;
      account: {
        name: string;
        email: string;
        username: string;
        phone: string | null;
        schoolId: string | null;
        schoolName: string;
        roleLabel: string;
      };
    }>(
      '/api/v1/auth/recover/verify',
      { method: 'POST', body: JSON.stringify({ recoveryToken, verification }) },
      null
    ),

  recoveryResetPassword: (resetToken: string, newPassword: string) =>
    requestJson<{ ok: boolean; email: string; phone: string | null; username: string }>(
      '/api/v1/auth/recover/reset-password',
      { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) },
      null
    ),

  recoveryRequestAdmin: (recoveryToken: string, note?: string) =>
    requestJson<{ ok: boolean }>(
      '/api/v1/auth/recover/request-admin',
      { method: 'POST', body: JSON.stringify({ recoveryToken, note }) },
      null
    ),
};

export function createTenantApi(schoolId: string) {
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}`;

  return {
    bootstrap: () =>
      requestJson<{ school: SchoolTenant; db: SchoolDatabase }>(
        `${base}/bootstrap`,
        { method: 'GET' },
        schoolId
      ),

    addStudents: (students: StudentProfile[]) =>
      requestJson<{ students: StudentProfile[] }>(
        `${base}/students`,
        { method: 'POST', body: JSON.stringify({ students }) },
        schoolId
      ),

    updateStudent: (student: StudentProfile) =>
      requestJson<{ student: StudentProfile }>(
        `${base}/students/${encodeURIComponent(student.id)}`,
        { method: 'PUT', body: JSON.stringify(student) },
        schoolId
      ),

    promoteStudents: (studentIds: string[], targetClassId: string) =>
      requestJson<{ ok: boolean }>(
        `${base}/students/promote`,
        { method: 'POST', body: JSON.stringify({ studentIds, targetClassId }) },
        schoolId
      ),

    saveClass: (cls: StreamClass, attachToExamId?: string) =>
      requestJson<{ cls: StreamClass }>(
        `${base}/classes`,
        { method: 'PUT', body: JSON.stringify({ cls, attachToExamId }) },
        schoolId
      ),

    saveSubject: (sub: SubjectDefinition) =>
      requestJson<{ subject: SubjectDefinition }>(
        `${base}/subjects`,
        { method: 'PUT', body: JSON.stringify(sub) },
        schoolId
      ),

    saveCombination: (combo: SubjectCombination) =>
      requestJson<{ combination: SubjectCombination }>(
        `${base}/combinations`,
        { method: 'PUT', body: JSON.stringify(combo) },
        schoolId
      ),

    deleteCombination: (comboId: string) =>
      requestJson<{ ok: boolean }>(
        `${base}/combinations/${encodeURIComponent(comboId)}`,
        { method: 'DELETE' },
        schoolId
      ),

    saveExam: (exam: ExaminationPeriod) =>
      requestJson<{ exam: ExaminationPeriod }>(
        `${base}/examinations`,
        { method: 'PUT', body: JSON.stringify(exam) },
        schoolId
      ),

    saveMarksheet: (marksheet: MarksheetRecord) =>
      requestJson<{ marksheet: MarksheetRecord }>(
        `${base}/marksheets`,
        { method: 'POST', body: JSON.stringify(marksheet) },
        schoolId
      ),

    publishExam: (examId: string) =>
      requestJson<{ ok: boolean }>(
        `${base}/examinations/${encodeURIComponent(examId)}/publish`,
        { method: 'POST' },
        schoolId
      ),

    saveRemark: (
      examId: string,
      studentId: string,
      field: keyof StudentTermRemarks,
      value: string
    ) =>
      requestJson<{ ok: boolean }>(
        `${base}/remarks`,
        { method: 'PUT', body: JSON.stringify({ examId, studentId, field, value }) },
        schoolId
      ),

    saveSettings: (settings: SchoolSettings) =>
      requestJson<{
        settings: SchoolSettings;
        schoolBranding?: { logoUrl: string | null; primaryColor: string; secondaryColor: string };
      }>(`${base}/settings`, { method: 'PUT', body: JSON.stringify(settings) }, schoolId),

    saveStaff: (staff: UserAccount) =>
      requestJson<{ staff: UserAccount }>(
        `${base}/staff`,
        { method: 'PUT', body: JSON.stringify(staff) },
        schoolId
      ),

    bulkSaveStaff: (staff: UserAccount[]) =>
      requestJson<{ staff: UserAccount[] }>(
        `${base}/staff/bulk`,
        { method: 'POST', body: JSON.stringify({ staff }) },
        schoolId
      ),

    trackReports: (count: number) =>
      requestJson<{ ok: boolean }>(
        `${base}/reports/track`,
        { method: 'POST', body: JSON.stringify({ count }) },
        schoolId
      ),

    getSubscriptionOverview: () =>
      requestJson<{
        school: SchoolTenant;
        activeStudentsCount: number;
        invoices: SubscriptionInvoice[];
      }>(`${base}/subscription`, { method: 'GET' }, schoolId),
  };
}

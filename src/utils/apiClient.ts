import type {
  AssessmentComponent,
  AuditLogRecord,
  AuthSessionProfile,
  BillingStatus,
  CurriculumScope,
  ExaminationPeriod,
  MarksheetCorrectionRequest,
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
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  headers.set('X-Requested-With', 'SchuleFlow-Client');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const tenantHeader = explicitSchoolId ?? activeSchoolInterceptorId;
  if (tenantHeader) {
    headers.set('X-School-Id', tenantHeader);
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
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
    const errCode =
      parsed && typeof parsed === 'object' && 'code' in parsed && typeof parsed.code === 'string'
        ? parsed.code
        : undefined;
    throw new ApiError(errMsg, response.status, errCode);
  }

  return parsed as T;
}

export const platformApi = {
  lookupSchoolByCode: (code: string) =>
    requestJson<{ school: PublicSchoolBranding }>(
      `/api/v1/auth/school-lookup?code=${encodeURIComponent(code.trim())}`,
      { method: 'GET' },
      null
    ),

  loginWithCredentials: (params: {
    schoolCode?: string;
    identifier: string;
    password: string;
  }) =>
    requestJson<{ token: string; user: AuthSessionProfile; schools: SchoolTenant[] }>(
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      null
    ),

  logoutSession: () =>
    requestJson<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }, null),

  syncSession: () =>
    requestJson<{ user: AuthSessionProfile; schools: SchoolTenant[] }>(
      '/api/v1/auth/sync',
      { method: 'POST' },
      null
    ),

  changePassword: (currentPassword: string, newPassword: string) =>
    requestJson<{ token: string; user: AuthSessionProfile }>(
      '/api/v1/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      },
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

  generateSchoolInvoice: (targetSchoolId: string) =>
    requestJson<{ invoice: SubscriptionInvoice }>(
      `/api/v1/platform/schools/${encodeURIComponent(targetSchoolId)}/invoices/generate`,
      { method: 'POST' },
      null
    ),

  resetToBaseline: (confirmText: string) =>
    requestJson<{ ok: boolean; schoolId: string; schoolCode: string; schoolName: string }>(
      '/api/v1/platform/reset-baseline',
      { method: 'POST', body: JSON.stringify({ confirmText }) },
      null
    ),

  recoveryLookup: (payload: { identifier?: string; schoolCode?: string; fullName?: string }) =>
    requestJson<{
      recoveryToken: string;
      lookupMethod: 'identifier' | 'name_school';
      maskedEmail: string;
      maskedPhone: string | null;
      maskedUsername: string | null;
      maskedStaffId: string | null;
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
        staffId: string | null;
        schoolCode: string | null;
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

    listStudentsPaginated: (params?: {
      page?: number;
      limit?: number;
      classId?: string;
      status?: string;
      search?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.classId) qs.set('classId', params.classId);
      if (params?.status) qs.set('status', params.status);
      if (params?.search) qs.set('search', params.search);
      const qStr = qs.toString();
      return requestJson<{
        students: StudentProfile[];
        total: number;
        page: number;
        limit: number;
      }>(`${base}/students${qStr ? `?${qStr}` : ''}`, { method: 'GET' }, schoolId);
    },

    listMarksheetsFiltered: (params?: {
      examId?: string;
      classId?: string;
      subjectId?: string;
      status?: string;
      page?: number;
      limit?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.examId) qs.set('examId', params.examId);
      if (params?.classId) qs.set('classId', params.classId);
      if (params?.subjectId) qs.set('subjectId', params.subjectId);
      if (params?.status) qs.set('status', params.status);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      const qStr = qs.toString();
      return requestJson<{
        marksheets: MarksheetRecord[];
        total: number;
        page: number;
        limit: number;
      }>(`${base}/marksheets${qStr ? `?${qStr}` : ''}`, { method: 'GET' }, schoolId);
    },

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

    deleteStudent: (studentId: string) =>
      requestJson<{ ok: boolean }>(
        `${base}/students/${encodeURIComponent(studentId)}`,
        { method: 'DELETE' },
        schoolId
      ),

    promoteStudents: (
      studentIds: string[],
      options:
        | string
        | {
            targetClassId?: string;
            targetAcademicYear?: string;
            targetStatus?: 'active' | 'transferred' | 'inactive';
            updateSchoolYear?: boolean;
            resetElectives?: boolean;
          }
    ) => {
      const payload =
        typeof options === 'string'
          ? { studentIds, targetClassId: options }
          : { studentIds, ...options };
      return requestJson<{
        ok: boolean;
        updatedCount?: number;
        targetClassName?: string;
        targetAcademicYear?: string;
      }>(
        `${base}/students/promote`,
        { method: 'POST', body: JSON.stringify(payload) },
        schoolId
      );
    },

    saveClass: (cls: StreamClass, attachToExamId?: string) =>
      requestJson<{ cls: StreamClass }>(
        `${base}/classes`,
        { method: 'PUT', body: JSON.stringify({ cls, attachToExamId }) },
        schoolId
      ),

    deleteOrArchiveClass: (classId: string, mode: 'archive' | 'restore' | 'delete') =>
      requestJson<{ mode: string; archived: boolean }>(
        `${base}/classes/${encodeURIComponent(classId)}?mode=${mode}`,
        { method: 'DELETE' },
        schoolId
      ),

    saveSubject: (sub: SubjectDefinition) =>
      requestJson<{ subject: SubjectDefinition }>(
        `${base}/subjects`,
        { method: 'PUT', body: JSON.stringify(sub) },
        schoolId
      ),

    deleteOrArchiveSubject: (subjectId: string, mode: 'archive' | 'restore' | 'delete') =>
      requestJson<{ mode: string; archived: boolean }>(
        `${base}/subjects/${encodeURIComponent(subjectId)}?mode=${mode}`,
        { method: 'DELETE' },
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

    deleteOrArchiveExam: (examId: string, mode: 'archive' | 'restore' | 'delete') =>
      requestJson<{ mode: string; archived: boolean }>(
        `${base}/examinations/${encodeURIComponent(examId)}?mode=${mode}`,
        { method: 'DELETE' },
        schoolId
      ),

    saveMarksheet: (marksheet: MarksheetRecord) =>
      requestJson<{ marksheet: MarksheetRecord }>(
        `${base}/marksheets`,
        { method: 'POST', body: JSON.stringify(marksheet) },
        schoolId
      ),

    requestMarksheetCorrection: (payload: {
      marksheetId?: string;
      examId: string;
      classId: string;
      subjectId: string;
      assessmentScope: AssessmentComponent;
      reason: string;
    }) =>
      requestJson<{ request: MarksheetCorrectionRequest; marksheet?: MarksheetRecord }>(
        `${base}/marksheets/correction-requests`,
        { method: 'POST', body: JSON.stringify(payload) },
        schoolId
      ),

    approveCorrectionRequest: (requestId: string, reviewNote?: string) =>
      requestJson<{ request: MarksheetCorrectionRequest; marksheet?: MarksheetRecord }>(
        `${base}/correction-requests/${encodeURIComponent(requestId)}/approve`,
        { method: 'POST', body: JSON.stringify({ reviewNote }) },
        schoolId
      ),

    rejectCorrectionRequest: (requestId: string, reviewNote?: string) =>
      requestJson<{ request: MarksheetCorrectionRequest }>(
        `${base}/correction-requests/${encodeURIComponent(requestId)}/reject`,
        { method: 'POST', body: JSON.stringify({ reviewNote }) },
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

    resetStaffPassword: (staffRowId: string, temporaryPassword?: string) =>
      requestJson<{
        id: string;
        staffId: string | null;
        email: string;
        name: string;
        temporaryPassword: string;
      }>(
        `${base}/staff/${encodeURIComponent(staffRowId)}/reset-password`,
        { method: 'POST', body: JSON.stringify({ temporaryPassword }) },
        schoolId
      ),

    getMediaStatus: () =>
      requestJson<{
        configured: boolean;
        bucket: string;
        urlOrigin?: string;
        inlineLogoCount: number;
        inlineStudentPhotosCount: number;
        supabaseStudentPhotosCount: number;
      }>(`${base}/media/status`, { method: 'GET' }, schoolId),

    uploadMedia: (folder: 'logos' | 'students', dataUrl: string, entityId?: string) =>
      requestJson<{ url: string; storage: 'supabase' | 'inline'; path?: string }>(
        `${base}/media/upload`,
        { method: 'POST', body: JSON.stringify({ folder, entityId, dataUrl }) },
        schoolId
      ),

    migrateMedia: () =>
      requestJson<{ migratedLogos: number; migratedPhotos: number; skipped: number }>(
        `${base}/media/migrate`,
        { method: 'POST' },
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

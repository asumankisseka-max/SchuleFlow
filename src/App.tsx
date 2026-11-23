import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpenCheck, Loader2, Menu } from 'lucide-react';
import { AcademicHistoryView } from './components/AcademicHistoryView';
import { BillingView } from './components/BillingView';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { ClassesView } from './components/ClassesView';
import { DashboardView } from './components/DashboardView';
import { ExaminationsView } from './components/ExaminationsView';
import { LoginView } from './components/LoginView';
import { MarksEntryView } from './components/MarksEntryView';
import { MarksheetsApprovalView } from './components/MarksheetsApprovalView';
import { PlatformAdminView } from './components/PlatformAdminView';
import { ReportCardsView } from './components/ReportCardsView';
import { ResultsAnalysisView } from './components/ResultsAnalysisView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { StudentsView } from './components/StudentsView';
import { SubjectsView } from './components/SubjectsView';
import { TeachersView } from './components/TeachersView';
import { UserManagementView } from './components/UserManagementView';
import { useSchoolContext } from './context/SchoolContext';
import { ApiError } from './utils/apiClient';
import type {
  AssessmentComponent,
  CurriculumScope,
  ExaminationPeriod,
  MarkEntryItem,
  MarksheetAuditEntry,
  MarksheetRecord,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
  WorkspaceTab,
} from './types';
import {
  buildSchoolThemeVars,
  DEFAULT_UNIFORM_PRIMARY,
  DEFAULT_UNIFORM_SECONDARY,
  normalizeHexColor,
} from './utils/schoolTheme';
import {
  canAccessTab,
  getDashboardPathForRole,
  getDefaultTabForRole,
  isTeachingRole,
  normalizeUserRole,
  ROLE_DISPLAY_NAMES,
} from './utils/rbac';

const TAB_TITLES: Record<WorkspaceTab, string> = {
  dashboard: 'Overview',
  students: 'Students',
  classes: 'Classes',
  subjects: 'Subjects',
  teachers: 'Teachers',
  examinations: 'Exams',
  'marks-entry': 'Enter Marks',
  marksheets: 'Review Marks',
  'results-analysis': 'Results',
  reports: 'Report Cards',
  'academic-history': 'Student History',
  settings: 'School Settings',
  users: 'Staff Accounts',
  billing: 'School Billing',
  'platform-admin': 'Platform Administration',
};

const EXAM_CONTEXT_TABS = new Set<WorkspaceTab>([
  'dashboard',
  'examinations',
  'marks-entry',
  'marksheets',
  'results-analysis',
  'reports',
]);

const CLASS_CONTEXT_TABS = new Set<WorkspaceTab>([
  'marks-entry',
  'results-analysis',
  'reports',
]);

export default function App() {
  const {
    authProfile,
    authLoading,
    authError,
    authErrorCode,
    schools,
    auditLogs,
    activeSchoolId,
    activeSchool,
    db,
    subscriptionLocked,
    subscriptionPortalData,
    loadingWorkspace,
    workspaceError,
    recentAccounts,
    clearAuthError,
    removeRecentAccount,
    signInWithCredentials,
    signOutWorkspace,
    completePasswordChange,
    refreshPlatformData,
    refreshTenantWorkspace,
    refreshSubscriptionPortal,
    updateLocalTenantDb,
    updateLocalActiveSchool,
    tenantApi,
  } = useSchoolContext();

  const [activeExamId, setActiveExamId] = useState<string>('');
  const [activeClassId, setActiveClassId] = useState<string>('');
  const [activeSubjectId, setActiveSubjectId] = useState<string>('');
  const [activeAssessment, setActiveAssessment] = useState<AssessmentComponent>('all');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [initialBootDone, setInitialBootDone] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      setInitialBootDone(true);
    }
  }, [authLoading]);

  // Live background sync on window focus & every 12s so DOS approvals & teacher submissions reflect immediately
  useEffect(() => {
    if (
      !authProfile ||
      authProfile.globalRole === 'super_admin' ||
      !activeSchoolId ||
      subscriptionLocked
    ) {
      return;
    }
    const handleFocus = () => {
      void refreshTenantWorkspace(undefined, true);
    };
    window.addEventListener('focus', handleFocus);
    const interval = window.setInterval(() => {
      void refreshTenantWorkspace(undefined, true);
    }, 12_000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(interval);
    };
  }, [authProfile, activeSchoolId, subscriptionLocked, refreshTenantWorkspace]);

  const currentUser: UserAccount | null = useMemo(() => {
    if (!authProfile) return null;
    const normalizedRole = normalizeUserRole(authProfile.schoolRole);
    const cleanEmail = authProfile.email.trim().toLowerCase();
    const cleanStaffId = authProfile.staffId?.trim().toUpperCase() ?? '';
    const uid = authProfile.uid;
    const matchedStaff = db?.users.find((u) => {
      if (cleanStaffId && u.staffId && u.staffId.trim().toUpperCase() === cleanStaffId) {
        return true;
      }
      if (cleanEmail && u.email.trim().toLowerCase() === cleanEmail) {
        return true;
      }
      const unprefixed = u.id.includes(':') ? u.id.split(':').slice(1).join(':') : u.id;
      const prefixed = activeSchoolId ? `${activeSchoolId}:${unprefixed}` : u.id;
      return (
        u.id === uid ||
        unprefixed === uid ||
        prefixed === uid ||
        `local:${u.id}` === uid ||
        `local:${prefixed}` === uid ||
        `local:${unprefixed}` === uid
      );
    });
    if (matchedStaff && authProfile.globalRole !== 'super_admin') {
      return {
        ...matchedStaff,
        staffId: matchedStaff.staffId ?? authProfile.staffId,
        role: normalizeUserRole(matchedStaff.role),
      };
    }
    return {
      id: matchedStaff?.id ?? authProfile.uid,
      staffId: matchedStaff?.staffId ?? authProfile.staffId,
      name: authProfile.name,
      email: authProfile.email,
      username: authProfile.username || authProfile.email.split('@')[0] || 'user',
      password: '',
      role: normalizedRole,
      active: authProfile.active,
      assignedClassIds: matchedStaff?.assignedClassIds ?? [],
      assignedSubjectIds: matchedStaff?.assignedSubjectIds ?? [],
    };
  }, [authProfile, activeSchoolId, db?.users]);

  // Smart Role-Based URL Routing & Route Guard
  useEffect(() => {
    if (authLoading) return;

    if (!authProfile || !currentUser) {
      if (window.location.pathname !== '/') {
        window.history.replaceState({}, '', '/');
      }
      return;
    }

    const expectedPath = getDashboardPathForRole(authProfile.globalRole, currentUser.role);
    if (window.location.pathname !== expectedPath) {
      window.history.replaceState({}, '', expectedPath);
    }

    const defaultTab = getDefaultTabForRole(authProfile.globalRole, currentUser.role);
    setActiveTab((prev) =>
      canAccessTab(currentUser.role, prev, authProfile.globalRole) ? prev : defaultTab
    );

    const handlePopState = () => {
      if (window.location.pathname !== expectedPath) {
        window.history.replaceState({}, '', expectedPath);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [authLoading, authProfile, currentUser]);

  // Reset class/exam/student selection cleanly whenever switching school tenants
  useEffect(() => {
    setSelectedStudentId(null);
    setActiveSubjectId('');
    if (db) {
      const nonArchivedExams = db.exams.filter((e) => !e.archived);
      const examPool = nonArchivedExams.length > 0 ? nonArchivedExams : db.exams;
      const inProgressPool = examPool.filter((e) => !e.archived && !e.locked && !e.published);
      const preferredExam =
        inProgressPool[inProgressPool.length - 1] ?? examPool[examPool.length - 1];
      const nonArchivedClasses = db.classes.filter((c) => !c.archived);
      const classPool = nonArchivedClasses.length > 0 ? nonArchivedClasses : db.classes;
      setActiveExamId(preferredExam?.id ?? '');
      setActiveClassId(classPool[0]?.id ?? '');
    } else {
      setActiveExamId('');
      setActiveClassId('');
    }
  }, [activeSchoolId, db?.exams.length, db?.classes.length]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!errorBanner) return;
    const t = setTimeout(() => setErrorBanner(null), 6000);
    return () => clearTimeout(t);
  }, [errorBanner]);

  const effectiveCurriculumScope: CurriculumScope =
    db?.settings.curriculumScope ?? activeSchool?.curriculumScope ?? 'olevel_alevel';

  const scopedClasses = useMemo(() => {
    if (!db) return [];
    const activeOnly = db.classes.filter((c) => !c.archived);
    const pool = activeOnly.length > 0 ? activeOnly : db.classes;
    const filtered = pool.filter((c) =>
      effectiveCurriculumScope === 'olevel_only'
        ? c.level === 'olevel'
        : effectiveCurriculumScope === 'alevel_only'
          ? c.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : pool;
  }, [db, effectiveCurriculumScope]);

  const activeExams = useMemo(() => {
    if (!db) return [];
    const nonArchived = db.exams.filter((e) => !e.archived);
    return nonArchived.length > 0 ? nonArchived : db.exams;
  }, [db]);

  const activeSubjects = useMemo(() => {
    if (!db) return [];
    const nonArchived = db.subjects.filter((s) => !s.archived);
    return nonArchived.length > 0 ? nonArchived : db.subjects;
  }, [db]);

  const activeExam = useMemo(() => {
    if (activeExams.length === 0) return null;
    return activeExams.find((e) => e.id === activeExamId) ?? activeExams[activeExams.length - 1];
  }, [activeExams, activeExamId]);

  const activeClass = useMemo(() => {
    if (scopedClasses.length === 0) return null;
    return scopedClasses.find((c) => c.id === activeClassId) ?? scopedClasses[0];
  }, [scopedClasses, activeClassId]);

  const pendingApprovalCount = useMemo(() => {
    if (!db || !activeExam) return 0;
    return db.marksheets.filter((m) => m.examId === activeExam.id && m.status === 'submitted').length;
  }, [db, activeExam]);

  const pendingCorrectionRequestsCount = useMemo(() => {
    if (!db || !activeExam) return 0;
    return (db.correctionRequests ?? []).filter(
      (r) => r.examId === activeExam.id && r.status === 'pending'
    ).length;
  }, [db, activeExam]);

  const returnedForTeacherCount = useMemo(() => {
    if (!db || !activeExam || !currentUser) return 0;
    return db.marksheets.filter(
      (m) =>
        m.examId === activeExam.id &&
        m.status === 'returned' &&
        (!isTeachingRole(currentUser.role) || m.teacherId === currentUser.id)
    ).length;
  }, [db, activeExam, currentUser]);

  const teacherUnlockedCorrectionsCount = useMemo(() => {
    if (!db || !activeExam || !currentUser || !isTeachingRole(currentUser.role)) return 0;
    return (db.correctionRequests ?? []).filter(
      (r) =>
        r.examId === activeExam.id &&
        r.status === 'approved' &&
        (r.requestedByUserId === currentUser.id ||
          (currentUser.staffId && r.requestedByStaffId === currentUser.staffId))
    ).length;
  }, [db, activeExam, currentUser]);

  if (!initialBootDone && authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-7 w-7 animate-spin text-blue-900" />
        <p className="text-xs font-medium">Verifying your institutional session...</p>
      </div>
    );
  }

  if (!authProfile || !currentUser) {
    return (
      <LoginView
        loading={authLoading}
        error={authError}
        errorCode={authErrorCode}
        recentAccounts={recentAccounts}
        onClearError={clearAuthError}
        onRemoveRecentAccount={removeRecentAccount}
        onCredentialSignIn={signInWithCredentials}
      />
    );
  }

  const changePasswordModalNode = (
    <ChangePasswordModal
      open={Boolean(authProfile.mustChangePassword || changePwdOpen)}
      required={Boolean(authProfile.mustChangePassword)}
      userEmail={authProfile.email}
      userName={authProfile.name}
      onClose={() => setChangePwdOpen(false)}
      onLogout={() => void signOutWorkspace()}
      onPasswordChanged={(token, updatedUser) => {
        completePasswordChange(token, updatedUser);
        setChangePwdOpen(false);
        setNotice('Personal password updated.');
      }}
    />
  );

  // Strict Super Admin Isolation: /platform/dashboard only (no internal school marks or grading)
  if (authProfile.globalRole === 'super_admin') {
    return (
      <>
        <PlatformAdminView
          authProfile={authProfile}
          schools={schools}
          auditLogs={auditLogs}
          onRefreshPlatform={refreshPlatformData}
          onLogout={signOutWorkspace}
        />
        {changePasswordModalNode}
      </>
    );
  }

  if (loadingWorkspace && !db && !subscriptionLocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-7 w-7 animate-spin text-blue-900" />
        <p className="text-xs font-medium">
          Loading isolated tenant workspace for {activeSchool?.name ?? 'your school'}...
        </p>
      </div>
    );
  }

  // Strict Subscription Expiry Gate: school users can ONLY access the Subscription Portal
  if (subscriptionLocked && activeSchool && tenantApi) {
    if (!currentUser.active) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-6 space-y-4">
            <div className="flex items-start gap-2.5 text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <h2 className="font-display text-base font-bold">Workspace Access Restricted</h2>
                <p className="text-xs text-slate-600 mt-1">
                  Account deactivated. Please contact your School Administrator.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOutWorkspace()}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      );
    }

    const portalThemeVars = buildSchoolThemeVars(
      activeSchool.primaryColor,
      activeSchool.secondaryColor
    );

    return (
      <div
        style={portalThemeVars}
        className="min-h-screen bg-slate-50 text-slate-900 flex flex-col school-themed"
      >
        <header
          className="h-16 bg-white border-b-2 border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4"
          style={{ borderBottomColor: 'var(--school-secondary, #e2e8f0)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {activeSchool.logoUrl ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white p-0.5 overflow-hidden">
                <img
                  src={activeSchool.logoUrl}
                  alt={`${activeSchool.name} badge`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-900 text-white">
                <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              <span className="font-display text-base font-bold tracking-tight text-slate-900 block leading-tight">
                SchuleFlow Subscription Portal
              </span>
              <span className="text-[11px] text-slate-500 truncate block">
                {activeSchool.name}
              </span>
            </div>
          </div>
          <div className="text-xs text-slate-600 hidden sm:flex items-center gap-2">
            <span className="font-medium text-slate-900">{currentUser.name}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>{ROLE_DISPLAY_NAMES[normalizeUserRole(currentUser.role)]}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">
          <BillingView
            school={activeSchool}
            activeStudentsCount={subscriptionPortalData?.activeStudentsCount ?? 0}
            invoices={subscriptionPortalData?.invoices ?? []}
            expiredLocked={true}
            onRefreshStatus={refreshSubscriptionPortal}
            onLogout={() => void signOutWorkspace()}
          />
        </main>
        {changePasswordModalNode}
      </div>
    );
  }

  if (workspaceError || !db || !tenantApi || !currentUser.active) {
    const restrictedMessage = !currentUser.active
      ? 'Account deactivated. Please contact your School Administrator.'
      : workspaceError || 'Account not assigned to an active school workspace.';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-6 space-y-4">
          <div className="flex items-start gap-2.5 text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-bold">Workspace Access Restricted</h2>
              <p className="text-xs text-slate-600 mt-1">{restrictedMessage}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refreshTenantWorkspace()}
              className="rounded-md bg-blue-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-950"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void signOutWorkspace()}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const defaultTab = getDefaultTabForRole(authProfile.globalRole, currentUser.role);

  const safeNavigate = (tab: WorkspaceTab) => {
    if (canAccessTab(currentUser.role, tab, authProfile.globalRole)) {
      setActiveTab(tab);
    } else {
      setActiveTab(defaultTab);
    }
  };

  const effectiveTab: WorkspaceTab = canAccessTab(
    currentUser.role,
    activeTab,
    authProfile.globalRole
  )
    ? activeTab
    : defaultTab;

  const runPersist = async (fn: () => Promise<unknown>, fallbackErr: string) => {
    setErrorBanner(null);
    try {
      await fn();
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : fallbackErr);
    }
  };

  // Marksheet Draft / Submit / Approval Workflow Handlers
  const makeAudit = (action: string, details: string): MarksheetAuditEntry => ({
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actorId: currentUser.id,
    actorName: currentUser.name,
    actorRole: currentUser.role,
    action,
    details,
  });

  const buildUpdatedMarksheet = (
    examId: string,
    classId: string,
    subjectId: string,
    updater: (existing: MarksheetRecord) => MarksheetRecord
  ): MarksheetRecord => {
    const existing = db.marksheets.find(
      (m) => m.examId === examId && m.classId === classId && m.subjectId === subjectId
    );
    const cls = db.classes.find((c) => c.id === classId);
    const base: MarksheetRecord = existing ?? {
      id: `ms-${examId}-${classId}-${subjectId}`,
      examId,
      classId,
      subjectId,
      teacherId: cls?.subjectTeacherMap[subjectId] ?? currentUser.id,
      status: 'draft',
      entries: {},
      lastModified: new Date().toISOString(),
      auditHistory: [],
    };
    return updater(base);
  };

  const applyMarksheetMutation = async (updated: MarksheetRecord, successMsg: string) => {
    setErrorBanner(null);
    try {
      const res = await tenantApi.saveMarksheet(updated);
      const saved = res.marksheet ?? updated;
      updateLocalTenantDb((prev) => {
        const idx = prev.marksheets.findIndex(
          (m) =>
            m.examId === saved.examId &&
            m.classId === saved.classId &&
            m.subjectId === saved.subjectId
        );
        const nextSheets =
          idx >= 0
            ? prev.marksheets.map((m, i) => (i === idx ? saved : m))
            : [...prev.marksheets, saved];
        const nextRequests =
          saved.status === 'submitted' && prev.correctionRequests
            ? prev.correctionRequests.map((req) =>
                req.examId === saved.examId &&
                req.classId === saved.classId &&
                req.subjectId === saved.subjectId &&
                req.status === 'approved'
                  ? { ...req, status: 'completed' as const }
                  : req
              )
            : prev.correctionRequests;
        return { ...prev, marksheets: nextSheets, correctionRequests: nextRequests };
      });
      setNotice(successMsg);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setErrorBanner(
          `${err.message} Refreshing latest marksheet version from server...`
        );
        void refreshTenantWorkspace(undefined, true);
        return;
      }
      setErrorBanner(err instanceof Error ? err.message : 'Failed to persist marksheet.');
    }
  };

  const handleSaveMarksheetEntries = (
    examId: string,
    classId: string,
    subjectId: string,
    entries: Record<string, MarkEntryItem>,
    actionNote = 'Saved marksheet draft'
  ) => {
    const updated = buildUpdatedMarksheet(examId, classId, subjectId, (ms) => ({
      ...ms,
      entries,
      lastModified: new Date().toISOString(),
      auditHistory: [...ms.auditHistory, makeAudit('Draft Saved', actionNote)],
    }));
    void applyMarksheetMutation(updated, 'Marksheet draft saved to school database.');
  };

  const handleSubmitMarksheet = (
    examId: string,
    classId: string,
    subjectId: string,
    entries: Record<string, MarkEntryItem>,
    missingSummary?: string
  ) => {
    const now = new Date().toISOString();
    const auditDetail = missingSummary
      ? `Submitted directly to system with missing marks flagged (${missingSummary}).`
      : 'All required student marks verified and submitted into the system.';
    const updated = buildUpdatedMarksheet(examId, classId, subjectId, (ms) => ({
      ...ms,
      entries,
      status: 'submitted',
      submittedAt: now,
      submittedBy: currentUser.id,
      dosComment: undefined,
      lastModified: now,
      auditHistory: [...ms.auditHistory, makeAudit('Submitted Results', auditDetail)],
    }));
    const msg = missingSummary
      ? `Results loaded into the system. Missing marks alert sent to your dashboard & DOS (${missingSummary}).`
      : 'Results submitted and loaded into the system.';
    void applyMarksheetMutation(updated, msg);
  };

  const handleRequestCorrection = async (
    examId: string,
    classId: string,
    subjectId: string,
    assessmentScope: AssessmentComponent,
    reason: string
  ) => {
    setErrorBanner(null);
    const existing = db.marksheets.find(
      (m) => m.examId === examId && m.classId === classId && m.subjectId === subjectId
    );
    try {
      const res = await tenantApi.requestMarksheetCorrection({
        marksheetId: existing?.id,
        examId,
        classId,
        subjectId,
        assessmentScope,
        reason,
      });
      updateLocalTenantDb((prev) => ({
        ...prev,
        correctionRequests: [res.request, ...(prev.correctionRequests ?? [])],
        marksheets: res.marksheet
          ? prev.marksheets.map((m) =>
              m.examId === res.marksheet!.examId &&
              m.classId === res.marksheet!.classId &&
              m.subjectId === res.marksheet!.subjectId
                ? res.marksheet!
                : m
            )
          : prev.marksheets,
      }));
      setNotice('Correction approval request sent to the Director of Studies.');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit correction request.';
      setErrorBanner(msg);
      throw err;
    }
  };

  const handleApproveCorrectionRequest = async (requestId: string, reviewNote?: string) => {
    setErrorBanner(null);
    try {
      const res = await tenantApi.approveCorrectionRequest(requestId, reviewNote);
      updateLocalTenantDb((prev) => ({
        ...prev,
        correctionRequests: (prev.correctionRequests ?? []).map((r) =>
          r.id === res.request.id ? res.request : r
        ),
        marksheets: res.marksheet
          ? prev.marksheets.map((m) =>
              m.examId === res.marksheet!.examId &&
              m.classId === res.marksheet!.classId &&
              m.subjectId === res.marksheet!.subjectId
                ? res.marksheet!
                : m
            )
          : prev.marksheets,
      }));
      setNotice(
        `Correction approved for ${res.request.requestedByName}. Teacher can now re-edit and resubmit.`
      );
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to approve correction request.'
      );
    }
  };

  const handleRejectCorrectionRequest = async (requestId: string, reviewNote?: string) => {
    setErrorBanner(null);
    try {
      const res = await tenantApi.rejectCorrectionRequest(requestId, reviewNote);
      updateLocalTenantDb((prev) => ({
        ...prev,
        correctionRequests: (prev.correctionRequests ?? []).map((r) =>
          r.id === res.request.id ? res.request : r
        ),
      }));
      setNotice(`Declined correction request from ${res.request.requestedByName}.`);
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to decline correction request.'
      );
    }
  };

  const handleApproveMarksheet = (examId: string, classId: string, subjectId: string) => {
    const now = new Date().toISOString();
    const updated = buildUpdatedMarksheet(examId, classId, subjectId, (ms) => ({
      ...ms,
      status: 'approved',
      approvedAt: now,
      approvedBy: currentUser.id,
      lastModified: now,
      auditHistory: [
        ...ms.auditHistory,
        makeAudit('Approved by DOS', 'Marksheet approved and locked for terminal report cards.'),
      ],
    }));
    void applyMarksheetMutation(updated, 'Marksheet approved and locked.');
  };

  const handleReturnMarksheet = (
    examId: string,
    classId: string,
    subjectId: string,
    comment: string
  ) => {
    const now = new Date().toISOString();
    const updated = buildUpdatedMarksheet(examId, classId, subjectId, (ms) => ({
      ...ms,
      status: 'returned',
      dosComment: comment,
      lastModified: now,
      auditHistory: [...ms.auditHistory, makeAudit('Returned for Revision', comment)],
    }));
    void applyMarksheetMutation(updated, 'Marksheet returned to teacher with DOS comment.');
  };

  const handleReopenMarksheet = (examId: string, classId: string, subjectId: string) => {
    const now = new Date().toISOString();
    const updated = buildUpdatedMarksheet(examId, classId, subjectId, (ms) => ({
      ...ms,
      status: 'draft',
      lastModified: now,
      auditHistory: [
        ...ms.auditHistory,
        makeAudit('Reopened / Unlocked', 'Authorized unlock for score amendment.'),
      ],
    }));
    void applyMarksheetMutation(updated, 'Marksheet unlocked for revision.');
  };

  const handlePublishAllApproved = (examId: string) => {
    const now = new Date().toISOString();
    updateLocalTenantDb((prev) => ({
      ...prev,
      marksheets: prev.marksheets.map((m) =>
        m.examId === examId && m.status === 'approved'
          ? {
              ...m,
              status: 'published',
              lastModified: now,
              auditHistory: [
                ...m.auditHistory,
                makeAudit('Published Results', 'Published officially by DOS/Headteacher.'),
              ],
            }
          : m
      ),
      exams: prev.exams.map((ex) =>
        ex.id === examId ? { ...ex, published: true, locked: true } : ex
      ),
    }));
    setNotice('All approved marksheets published and examination locked.');
    void runPersist(() => tenantApi.publishExam(examId), 'Failed to publish exam.');
  };

  const schoolThemeVars = buildSchoolThemeVars(
    db.settings.uniformPrimaryColor ?? activeSchool?.primaryColor,
    db.settings.uniformSecondaryColor ?? activeSchool?.secondaryColor
  );

  return (
    <div
      style={schoolThemeVars}
      className="min-h-screen flex bg-slate-50 text-slate-900 school-themed"
    >
      <Sidebar
        currentUser={currentUser}
        globalRole={authProfile.globalRole}
        activeTab={effectiveTab}
        onSelectTab={safeNavigate}
        settings={db.settings}
        schoolCode={activeSchool?.schoolCode ?? authProfile.schoolCode ?? undefined}
        pendingApprovalCount={pendingApprovalCount + pendingCorrectionRequestsCount}
        returnedCount={returnedForTeacherCount + teacherUnlockedCorrectionsCount}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onChangePassword={() => setChangePwdOpen(true)}
        onLogout={() => void signOutWorkspace()}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Single-Row Top Header */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {(activeSchool?.schoolCode || authProfile.schoolCode) && (
                  <span className="font-mono font-semibold text-blue-900">
                    {activeSchool?.schoolCode ?? authProfile.schoolCode}
                  </span>
                )}
                {(activeSchool?.schoolCode || authProfile.schoolCode) && (
                  <span aria-hidden="true">·</span>
                )}
                <span className="truncate font-medium text-slate-600">{db.settings.schoolName}</span>
                <span aria-hidden="true">/</span>
                <span className="text-slate-900 font-medium whitespace-nowrap">
                  {TAB_TITLES[effectiveTab]}
                </span>
              </div>
              <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
                {TAB_TITLES[effectiveTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {notice && (
              <span className="hidden md:inline-block rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                {notice}
              </span>
            )}
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
              <span className="font-medium text-slate-900">{currentUser.name}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>{ROLE_DISPLAY_NAMES[normalizeUserRole(currentUser.role)]}</span>
            </div>
          </div>
        </header>

        {/* Contextual Exam & Class Switcher (Shown only on exam/marks/report pages) */}
        {currentUser.role !== 'bursar' &&
          EXAM_CONTEXT_TABS.has(effectiveTab) &&
          activeExams.length > 0 && (
            <div className="bg-white/90 border-b border-slate-200 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="workspace-exam"
                    className="text-xs font-medium text-slate-500 whitespace-nowrap"
                  >
                    Exam Term
                  </label>
                  <select
                    id="workspace-exam"
                    value={activeExam?.id ?? ''}
                    onChange={(e) => setActiveExamId(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none"
                  >
                    {activeExams.map((ex) => {
                      const statusLabel = ex.published
                        ? 'Final Published'
                        : ex.locked
                          ? 'Locked'
                          : 'In Progress';
                      return (
                        <option key={ex.id} value={ex.id}>
                          {ex.name} · {ex.academicYear} ({statusLabel})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {CLASS_CONTEXT_TABS.has(effectiveTab) && scopedClasses.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="workspace-class"
                      className="text-xs font-medium text-slate-500 whitespace-nowrap"
                    >
                      Class
                    </label>
                    <select
                      id="workspace-class"
                      value={activeClass?.id ?? ''}
                      onChange={(e) => {
                        setActiveClassId(e.target.value);
                        setActiveSubjectId('');
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none"
                    >
                      {scopedClasses.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name} ({cls.level === 'olevel' ? "O'Level CBC" : "A'Level"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {activeExam && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{activeExam.term}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700">
                    {activeExam.published
                      ? 'Published'
                      : activeExam.locked
                        ? 'Locked'
                        : 'Open for entry'}
                  </span>
                </div>
              )}
            </div>
          )}

        {/* Main Viewport (Keyed strictly by activeSchoolId for complete UI state isolation) */}
        <main
          key={activeSchoolId ?? 'default'}
          className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-4 print:p-0 print:max-w-none print:space-y-0"
        >
          {errorBanner && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center gap-2 no-print">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {effectiveTab === 'billing' && activeSchool && (
            <BillingView
              school={activeSchool}
              activeStudentsCount={db.students.filter((s) => s.status === 'active').length}
              invoices={db.invoices ?? []}
              onRefreshStatus={refreshTenantWorkspace}
              onLogout={() => void signOutWorkspace()}
            />
          )}

          {effectiveTab === 'dashboard' && activeExam && (
            <DashboardView
              db={db}
              currentUser={currentUser}
              activeExam={activeExam}
              curriculumScope={effectiveCurriculumScope}
              onNavigate={safeNavigate}
              onSelectClassAndNavigate={(cid, tab, sid, assessment, examId) => {
                if (examId) setActiveExamId(examId);
                setActiveClassId(cid);
                setActiveSubjectId(sid ?? '');
                setActiveAssessment(assessment ?? 'all');
                safeNavigate(tab);
              }}
              onApproveCorrectionRequest={handleApproveCorrectionRequest}
              onRejectCorrectionRequest={handleRejectCorrectionRequest}
            />
          )}

          {effectiveTab === 'students' && (
            <StudentsView
              students={db.students}
              classes={db.classes}
              subjects={activeSubjects}
              combinations={db.combinations}
              schoolName={db.settings.schoolName}
              academicYear={db.settings.academicYear}
              userRole={currentUser.role}
              curriculumScope={effectiveCurriculumScope}
              onAddStudent={(stu: StudentProfile) => {
                void runPersist(async () => {
                  const res = await tenantApi.addStudents([stu]);
                  const savedStudents = res.students.length > 0 ? res.students : [stu];
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    students: [...prev.students, ...savedStudents],
                  }));
                  const created = savedStudents[0];
                  setNotice(
                    `Registered student ${created.fullName} (${created.studentId || created.admissionNo}).`
                  );
                }, 'Failed to register student.');
              }}
              onBulkAddStudents={(list: StudentProfile[]) => {
                void runPersist(async () => {
                  const res = await tenantApi.addStudents(list);
                  const savedStudents = res.students.length > 0 ? res.students : list;
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    students: [...prev.students, ...savedStudents],
                  }));
                  setNotice(`Imported ${savedStudents.length} new student(s) with auto-generated IDs.`);
                }, 'Failed to import students.');
              }}
              onUpdateStudent={(stu: StudentProfile) => {
                void runPersist(async () => {
                  const res = await tenantApi.updateStudent(stu);
                  const saved = res.student ?? stu;
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    students: prev.students.map((s) => (s.id === saved.id ? saved : s)),
                  }));
                  setNotice(`Updated record for ${saved.fullName}.`);
                }, 'Failed to update student.');
              }}
              onDeleteStudent={(studentId: string) => {
                void runPersist(async () => {
                  await tenantApi.deleteStudent(studentId);
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    students: prev.students.filter((s) => s.id !== studentId),
                  }));
                  setNotice('Student removed from directory.');
                }, 'Failed to delete student.');
              }}
              onUploadStudentPhoto={async (studentId: string, dataUrl: string) => {
                const res = await tenantApi.uploadMedia('students', dataUrl, studentId);
                return res.url;
              }}
              onBulkPromote={(ids, options) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  settings:
                    options.updateSchoolYear && options.targetAcademicYear
                      ? { ...prev.settings, academicYear: options.targetAcademicYear }
                      : prev.settings,
                  students: prev.students.map((s) =>
                    ids.includes(s.id)
                      ? {
                          ...s,
                          classId: options.targetClassId ?? s.classId,
                          academicYear: options.targetAcademicYear ?? s.academicYear,
                          status: options.targetStatus ?? s.status,
                          offeredSubjectIds:
                            options.resetElectives && options.targetClassId
                              ? undefined
                              : s.offeredSubjectIds,
                        }
                      : s
                  ),
                }));
                if (options.updateSchoolYear && options.targetAcademicYear) {
                  updateLocalActiveSchool((prev) => ({
                    ...prev,
                    academicYear: options.targetAcademicYear!,
                  }));
                }
                const targetClsName = options.targetClassId
                  ? db.classes.find((c) => c.id === options.targetClassId)?.name
                  : undefined;
                setNotice(
                  options.targetStatus === 'inactive' && !options.targetClassId
                    ? `Marked ${ids.length} student(s) as graduated/inactive for ${options.targetAcademicYear ?? db.settings.academicYear}.`
                    : `Promoted/transferred ${ids.length} student(s)${targetClsName ? ` to ${targetClsName}` : ''}.`
                );
                void runPersist(
                  () => tenantApi.promoteStudents(ids, options),
                  'Failed to promote students.'
                );
              }}
              onViewHistory={(sid) => {
                setSelectedStudentId(sid);
                safeNavigate('academic-history');
              }}
              onViewReportCard={(cid, sid) => {
                setActiveClassId(cid);
                setSelectedStudentId(sid);
                safeNavigate('reports');
              }}
            />
          )}

          {effectiveTab === 'classes' && (
            <ClassesView
              classes={db.classes}
              subjects={db.subjects}
              combinations={db.combinations}
              students={db.students}
              users={db.users}
              userRole={currentUser.role}
              curriculumScope={effectiveCurriculumScope}
              onAddClass={(cls: StreamClass) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  classes: [...prev.classes, cls],
                  exams: prev.exams.map((ex) =>
                    activeExam && ex.id === activeExam.id
                      ? { ...ex, classIds: [...ex.classIds, cls.id] }
                      : ex
                  ),
                }));
                setNotice(`Added class ${cls.name}.`);
                void runPersist(
                  () => tenantApi.saveClass(cls, activeExam?.id),
                  'Failed to save class.'
                );
              }}
              onUpdateClass={(cls: StreamClass) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  classes: prev.classes.map((c) => (c.id === cls.id ? cls : c)),
                }));
                void runPersist(() => tenantApi.saveClass(cls), 'Failed to update class.');
              }}
              onArchiveOrDeleteClass={(classId, mode) => {
                void runPersist(async () => {
                  await tenantApi.deleteOrArchiveClass(classId, mode);
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    classes:
                      mode === 'delete'
                        ? prev.classes.filter((c) => c.id !== classId)
                        : prev.classes.map((c) =>
                            c.id === classId ? { ...c, archived: mode === 'archive' } : c
                          ),
                  }));
                  setNotice(
                    mode === 'delete'
                      ? 'Class deleted permanently.'
                      : mode === 'archive'
                        ? 'Class archived.'
                        : 'Class restored to active workspace.'
                  );
                }, `Failed to ${mode} class.`);
              }}
              onAddCombination={(combo: SubjectCombination) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  combinations: [...prev.combinations, combo],
                }));
                setNotice(`Added combination ${combo.code}.`);
                void runPersist(
                  () => tenantApi.saveCombination(combo),
                  'Failed to save combination.'
                );
              }}
              onDeleteCombination={(comboId: string) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  combinations: prev.combinations.filter((c) => c.id !== comboId),
                }));
                void runPersist(
                  () => tenantApi.deleteCombination(comboId),
                  'Failed to delete combination.'
                );
              }}
            />
          )}

          {effectiveTab === 'subjects' && (
            <SubjectsView
              subjects={db.subjects}
              userRole={currentUser.role}
              curriculumScope={effectiveCurriculumScope}
              onAddSubject={(sub: SubjectDefinition) => {
                updateLocalTenantDb((prev) => ({ ...prev, subjects: [...prev.subjects, sub] }));
                setNotice(`Added subject ${sub.name} (${sub.code}).`);
                void runPersist(() => tenantApi.saveSubject(sub), 'Failed to save subject.');
              }}
              onUpdateSubject={(sub: SubjectDefinition) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  subjects: prev.subjects.map((s) => (s.id === sub.id ? sub : s)),
                }));
                setNotice(`Updated subject ${sub.name}.`);
                void runPersist(() => tenantApi.saveSubject(sub), 'Failed to update subject.');
              }}
              onArchiveOrDeleteSubject={(subjectId, mode) => {
                void runPersist(async () => {
                  await tenantApi.deleteOrArchiveSubject(subjectId, mode);
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    subjects:
                      mode === 'delete'
                        ? prev.subjects.filter((s) => s.id !== subjectId)
                        : prev.subjects.map((s) =>
                            s.id === subjectId ? { ...s, archived: mode === 'archive' } : s
                          ),
                  }));
                  setNotice(
                    mode === 'delete'
                      ? 'Subject deleted permanently.'
                      : mode === 'archive'
                        ? 'Subject archived.'
                        : 'Subject restored to active curriculum.'
                  );
                }, `Failed to ${mode} subject.`);
              }}
            />
          )}

          {effectiveTab === 'teachers' && activeExam && (
            <TeachersView
              users={db.users}
              classes={scopedClasses}
              subjects={activeSubjects}
              marksheets={db.marksheets}
              activeExam={activeExam}
            />
          )}

          {effectiveTab === 'examinations' && activeExam && (
            <ExaminationsView
              exams={db.exams}
              activeExamId={activeExam.id}
              classes={scopedClasses}
              marksheets={db.marksheets}
              academicYear={db.settings.academicYear}
              termName={db.settings.termName}
              userRole={currentUser.role}
              curriculumScope={effectiveCurriculumScope}
              onSelectExam={setActiveExamId}
              onAddExam={(ex: ExaminationPeriod) => {
                updateLocalTenantDb((prev) => ({ ...prev, exams: [...prev.exams, ex] }));
                setNotice(`Created examination period "${ex.name}".`);
                void runPersist(() => tenantApi.saveExam(ex), 'Failed to create examination.');
              }}
              onUpdateExam={(ex: ExaminationPeriod) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  exams: prev.exams.map((item) => (item.id === ex.id ? ex : item)),
                }));
                setNotice(`Updated "${ex.name}".`);
                void runPersist(() => tenantApi.saveExam(ex), 'Failed to update examination.');
              }}
              onArchiveOrDeleteExam={(examId, mode) => {
                void runPersist(async () => {
                  await tenantApi.deleteOrArchiveExam(examId, mode);
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    exams:
                      mode === 'delete'
                        ? prev.exams.filter((e) => e.id !== examId)
                        : prev.exams.map((e) =>
                            e.id === examId ? { ...e, archived: mode === 'archive' } : e
                          ),
                  }));
                  setNotice(
                    mode === 'delete'
                      ? 'Examination period deleted permanently.'
                      : mode === 'archive'
                        ? 'Examination archived.'
                        : 'Examination restored.'
                  );
                }, `Failed to ${mode} examination.`);
              }}
            />
          )}

          {effectiveTab === 'marks-entry' && activeExam && activeClass && (
            <MarksEntryView
              currentUser={currentUser}
              activeExam={activeExam}
              exams={activeExams}
              activeClass={activeClass}
              classes={scopedClasses}
              subjects={activeSubjects}
              combinations={db.combinations}
              students={db.students}
              marksheets={db.marksheets}
              correctionRequests={db.correctionRequests ?? []}
              settings={db.settings}
              initialSubjectId={activeSubjectId}
              initialAssessment={activeAssessment}
              onSelectExam={setActiveExamId}
              onSelectClass={(cid) => {
                setActiveClassId(cid);
                setActiveSubjectId('');
              }}
              onSaveMarksheetEntries={handleSaveMarksheetEntries}
              onSubmitMarksheet={handleSubmitMarksheet}
              onRequestCorrection={handleRequestCorrection}
            />
          )}

          {effectiveTab === 'marksheets' && activeExam && (
            <MarksheetsApprovalView
              currentUser={currentUser}
              activeExam={activeExam}
              classes={scopedClasses}
              subjects={activeSubjects}
              combinations={db.combinations}
              students={db.students}
              users={db.users}
              marksheets={db.marksheets}
              correctionRequests={db.correctionRequests ?? []}
              settings={db.settings}
              onApproveMarksheet={handleApproveMarksheet}
              onReturnMarksheet={handleReturnMarksheet}
              onReopenMarksheet={handleReopenMarksheet}
              onPublishAllApproved={handlePublishAllApproved}
              onApproveCorrectionRequest={handleApproveCorrectionRequest}
              onRejectCorrectionRequest={handleRejectCorrectionRequest}
            />
          )}

          {effectiveTab === 'results-analysis' && activeExam && activeClass && (
            <ResultsAnalysisView
              db={db}
              activeExam={activeExam}
              activeClassId={activeClass.id}
              onSelectClass={setActiveClassId}
              onOpenReportCard={(studentId) => {
                setSelectedStudentId(studentId);
                safeNavigate('reports');
              }}
            />
          )}

          {effectiveTab === 'reports' && activeExam && activeClass && (
            <ReportCardsView
              db={db}
              activeExam={activeExam}
              activeClassId={activeClass.id}
              userRole={currentUser.role}
              selectedStudentId={selectedStudentId}
              onSelectClass={setActiveClassId}
              onSelectStudent={setSelectedStudentId}
              onUpdateSettings={(updated: SchoolSettings) => {
                const resolvedLogo =
                  updated.reportLayout.customLogoDataUrl ?? updated.badgeDataUrl ?? null;
                const synced: SchoolSettings = {
                  ...updated,
                  badgeDataUrl: resolvedLogo ?? undefined,
                };
                updateLocalTenantDb((prev) => ({ ...prev, settings: synced }));
                updateLocalActiveSchool((prev) => ({
                  ...prev,
                  logoUrl: resolvedLogo,
                }));
                void runPersist(
                  () => tenantApi.saveSettings(synced),
                  'Failed to save report card template.'
                );
              }}
              onUpdateStudentRemark={(examId, studentId, field, value) => {
                const key = `${examId}:${studentId}`;
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  studentRemarks: {
                    ...prev.studentRemarks,
                    [key]: {
                      ...prev.studentRemarks[key],
                      [field]: value,
                    },
                  },
                }));
                void runPersist(
                  () => tenantApi.saveRemark(examId, studentId, field, value),
                  'Failed to save student remark.'
                );
              }}
              onUpdateStudentPhoto={(studentId, photoDataUrl) => {
                const target = db.students.find((s) => s.id === studentId);
                if (!target) return;
                const updatedStu = { ...target, photoDataUrl };
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  students: prev.students.map((s) => (s.id === studentId ? updatedStu : s)),
                }));
                void runPersist(
                  () => tenantApi.updateStudent(updatedStu),
                  'Failed to save student photo.'
                );
              }}
              onUploadStudentPhoto={async (studentId, dataUrl) => {
                const res = await tenantApi.uploadMedia('students', dataUrl, studentId);
                return res.url;
              }}
              onUploadSchoolLogo={async (dataUrl) => {
                const res = await tenantApi.uploadMedia('logos', dataUrl, 'school-logo');
                return res.url;
              }}
              onIncrementReportsPrinted={(count) => {
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  reportsGeneratedCount: prev.reportsGeneratedCount + count,
                }));
                void runPersist(
                  () => tenantApi.trackReports(count),
                  'Failed to record printed report count.'
                );
              }}
            />
          )}

          {effectiveTab === 'academic-history' && (
            <AcademicHistoryView
              db={db}
              selectedStudentId={selectedStudentId}
              onSelectStudent={setSelectedStudentId}
              onOpenReportCard={(classId, studentId, examId) => {
                setActiveExamId(examId);
                setActiveClassId(classId);
                setSelectedStudentId(studentId);
                safeNavigate('reports');
              }}
            />
          )}

          {effectiveTab === 'settings' && (
            <SettingsView
              settings={db.settings}
              curriculumScope={effectiveCurriculumScope}
              schoolCode={activeSchool?.schoolCode ?? authProfile.schoolCode ?? undefined}
              db={db}
              onUploadLogo={async (dataUrl) => {
                const res = await tenantApi.uploadMedia('logos', dataUrl, 'school-logo');
                return res.url;
              }}
              onGetMediaStatus={() => tenantApi.getMediaStatus()}
              onMigrateMedia={async () => {
                const res = await tenantApi.migrateMedia();
                await refreshTenantWorkspace();
                return res;
              }}
              onUpdateSettings={(updated) => {
                const resolvedLogo =
                  updated.badgeDataUrl !== undefined
                    ? updated.badgeDataUrl || null
                    : updated.reportLayout.customLogoDataUrl ?? null;
                const resolvedPrimary = normalizeHexColor(
                  updated.uniformPrimaryColor,
                  DEFAULT_UNIFORM_PRIMARY
                );
                const resolvedSecondary = normalizeHexColor(
                  updated.uniformSecondaryColor,
                  DEFAULT_UNIFORM_SECONDARY
                );
                const normalizedSettings: SchoolSettings = {
                  ...updated,
                  badgeDataUrl: resolvedLogo ?? undefined,
                  uniformPrimaryColor: resolvedPrimary,
                  uniformSecondaryColor: resolvedSecondary,
                  reportLayout: {
                    ...updated.reportLayout,
                    customLogoDataUrl: resolvedLogo ?? undefined,
                    crestType:
                      resolvedLogo && updated.reportLayout.crestType !== 'custom'
                        ? 'custom'
                        : !resolvedLogo && updated.reportLayout.crestType === 'custom'
                          ? 'shield'
                          : updated.reportLayout.crestType,
                  },
                };

                updateLocalTenantDb((prev) => ({ ...prev, settings: normalizedSettings }));
                updateLocalActiveSchool((prev) => ({
                  ...prev,
                  name: normalizedSettings.schoolName || prev.name,
                  logoUrl: resolvedLogo,
                  primaryColor: resolvedPrimary,
                  secondaryColor: resolvedSecondary,
                  curriculumScope: normalizedSettings.curriculumScope ?? prev.curriculumScope,
                }));
                setNotice('School profile, badge, uniform colors & grading rules saved.');
                void runPersist(
                  () => tenantApi.saveSettings(normalizedSettings),
                  'Failed to save school configuration.'
                );
              }}
              onRestoreDatabase={(restored) => {
                updateLocalTenantDb(() => restored);
                setNotice('School snapshot loaded into workspace.');
              }}
              onResetSampleData={() => {
                void refreshTenantWorkspace();
                setNotice('Reloaded workspace data from server.');
              }}
            />
          )}

          {effectiveTab === 'users' && (
            <UserManagementView
              users={db.users}
              loginActivity={db.loginActivity}
              classes={db.classes}
              subjects={db.subjects}
              schoolName={db.settings.schoolName}
              currentUserId={currentUser.id}
              onAddUser={(u) => {
                const scopedUser = {
                  ...u,
                  id: u.id.includes(':') ? u.id : `${activeSchoolId}:${u.id}`,
                };
                void runPersist(async () => {
                  const res = await tenantApi.saveStaff(scopedUser);
                  const saved = { ...res.staff, password: '********' };
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    users: [...prev.users, saved],
                  }));
                  setNotice(
                    `Created staff account for ${saved.name}${saved.staffId ? ` (${saved.staffId})` : ''}.`
                  );
                }, 'Failed to create staff account.');
              }}
              onBulkAddUsers={(list) => {
                const scopedList = list.map((u) => ({
                  ...u,
                  id: u.id.includes(':') ? u.id : `${activeSchoolId}:${u.id}`,
                }));
                void runPersist(async () => {
                  const res = await tenantApi.bulkSaveStaff(scopedList);
                  const savedList = (res.staff ?? scopedList).map((s) => ({
                    ...s,
                    password: '********',
                  }));
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    users: [...prev.users, ...savedList],
                  }));
                  setNotice(`Imported ${savedList.length} staff account(s) with generated Staff IDs.`);
                }, 'Failed to bulk-import staff accounts.');
              }}
              onUpdateUser={(u) => {
                void runPersist(async () => {
                  const res = await tenantApi.saveStaff(u);
                  const saved = { ...res.staff, password: '********' };
                  updateLocalTenantDb((prev) => ({
                    ...prev,
                    users: prev.users.map((item) => (item.id === saved.id ? saved : item)),
                  }));
                  setNotice(
                    `Updated account for ${saved.name}${saved.staffId ? ` (${saved.staffId})` : ''}.`
                  );
                }, 'Failed to update staff account.');
              }}
              onResetPassword={async (userId) => {
                const res = await tenantApi.resetStaffPassword(userId);
                updateLocalTenantDb((prev) => ({
                  ...prev,
                  users: prev.users.map((u) =>
                    u.id === userId ? { ...u, mustChangePassword: true } : u
                  ),
                }));
                setNotice(`Issued temporary password for ${res.name}.`);
                return {
                  temporaryPassword: res.temporaryPassword,
                  staffId: res.staffId,
                  name: res.name,
                };
              }}
            />
          )}
        </main>
      </div>
      {changePasswordModalNode}
    </div>
  );
}

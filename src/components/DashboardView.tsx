import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  ShieldAlert,
  Unlock,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  AssessmentComponent,
  CurriculumScope,
  ExaminationPeriod,
  SchoolDatabase,
  UserAccount,
  WorkspaceTab,
} from '../types';
import {
  buildExamClassView,
  calculateClassPerformance,
  filterStudentsOfferingSubject,
  getMarksheetMissingBreakdown,
  type MarksheetMissingBreakdown,
} from '../utils/calculations';
import {
  canApproveOrPublishResults,
  isSchoolAdminRole,
  isTeachingRole,
  normalizeUserRole,
  ROLE_DISPLAY_NAMES,
} from '../utils/rbac';
import { ClassComparisonBarChart } from './AnalyticsCharts';

interface DashboardViewProps {
  db: SchoolDatabase;
  currentUser: UserAccount;
  activeExam: ExaminationPeriod;
  curriculumScope?: CurriculumScope;
  onNavigate: (tab: WorkspaceTab) => void;
  onSelectClassAndNavigate: (
    classId: string,
    tab: WorkspaceTab,
    subjectId?: string,
    assessment?: AssessmentComponent,
    examId?: string
  ) => void;
  onApproveCorrectionRequest?: (requestId: string, reviewNote?: string) => Promise<void>;
  onRejectCorrectionRequest?: (requestId: string, reviewNote?: string) => Promise<void>;
}

function teacherMatchesId(mappedId: string | undefined, user: UserAccount): boolean {
  if (!mappedId) return false;
  const clean = mappedId.trim();
  if (!clean) return false;
  if (clean === user.id) return true;
  if (user.staffId && clean === user.staffId) return true;
  const userSuffix = user.id.includes(':') ? user.id.split(':').slice(1).join(':') : user.id;
  const cleanSuffix = clean.includes(':') ? clean.split(':').slice(1).join(':') : clean;
  return cleanSuffix === userSuffix;
}

const SCOPE_LABELS: Record<AssessmentComponent, string> = {
  all: 'Full Marksheet',
  u1: 'U1 (Activity 1)',
  u2: 'U2 (Activity 2)',
  u3: 'U3 (Activity 3)',
  eot: 'End of Term (EoT)',
};

export function DashboardView({
  db,
  currentUser,
  activeExam,
  curriculumScope = 'olevel_alevel',
  onNavigate,
  onSelectClassAndNavigate,
  onApproveCorrectionRequest,
  onRejectCorrectionRequest,
}: DashboardViewProps) {
  const isTeacher = isTeachingRole(currentUser.role);
  const canReviewAsDos = canApproveOrPublishResults(currentUser.role);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const scopedClasses = useMemo(() => {
    const activeOnly = db.classes.filter((c) => !c.archived);
    const filtered = activeOnly.filter((c) =>
      curriculumScope === 'olevel_only'
        ? c.level === 'olevel'
        : curriculumScope === 'alevel_only'
          ? c.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : activeOnly;
  }, [db.classes, curriculumScope]);

  const scopedSubjects = useMemo(() => {
    const activeOnly = db.subjects.filter((s) => !s.archived);
    const filtered = activeOnly.filter((s) =>
      curriculumScope === 'olevel_only'
        ? s.level === 'olevel'
        : curriculumScope === 'alevel_only'
          ? s.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : activeOnly;
  }, [db.subjects, curriculumScope]);

  const activeStudents = useMemo(
    () => db.students.filter((s) => s.status === 'active'),
    [db.students]
  );

  const participatingClasses = useMemo(
    () => scopedClasses.filter((c) => activeExam.classIds.includes(c.id)),
    [scopedClasses, activeExam.classIds]
  );

  const userMap = useMemo(() => new Map(db.users.map((u) => [u.id, u])), [db.users]);
  const subjectMap = useMemo(() => new Map(db.subjects.map((s) => [s.id, s])), [db.subjects]);
  const classMap = useMemo(() => new Map(db.classes.map((c) => [c.id, c])), [db.classes]);

  // Quick Marks Entry Launcher State (for teachers upon login)
  const teacherClasses = useMemo(() => {
    if (!isTeacher) return scopedClasses;
    const assigned = scopedClasses.filter((cls) => {
      if (teacherMatchesId(cls.classTeacherId, currentUser)) return true;
      if (currentUser.assignedClassIds.includes(cls.id)) return true;
      return cls.subjectIds.some(
        (subId) =>
          teacherMatchesId(cls.subjectTeacherMap[subId], currentUser) ||
          currentUser.assignedSubjectIds.includes(subId)
      );
    });
    return assigned.length > 0 ? assigned : scopedClasses;
  }, [isTeacher, scopedClasses, currentUser]);

  const [launcherClassId, setLauncherClassId] = useState<string>(teacherClasses[0]?.id ?? '');
  useEffect(() => {
    if (!teacherClasses.some((c) => c.id === launcherClassId)) {
      setLauncherClassId(teacherClasses[0]?.id ?? '');
    }
  }, [teacherClasses, launcherClassId]);

  const launcherClass = useMemo(
    () => teacherClasses.find((c) => c.id === launcherClassId) ?? teacherClasses[0],
    [teacherClasses, launcherClassId]
  );

  const launcherSubjects = useMemo(() => {
    if (!launcherClass) return [];
    const allInClass = launcherClass.subjectIds
      .map((id) => subjectMap.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s && !s.archived));
    if (!isTeacher) return allInClass;
    const isHomeroom =
      currentUser.role === 'class_teacher' &&
      (teacherMatchesId(launcherClass.classTeacherId, currentUser) ||
        currentUser.assignedClassIds.includes(launcherClass.id));
    if (isHomeroom) return allInClass;
    const mine = allInClass.filter(
      (s) =>
        teacherMatchesId(launcherClass.subjectTeacherMap[s.id], currentUser) ||
        currentUser.assignedSubjectIds.includes(s.id)
    );
    return mine.length > 0 ? mine : allInClass;
  }, [launcherClass, subjectMap, isTeacher, currentUser]);

  const [launcherSubjectId, setLauncherSubjectId] = useState<string>(launcherSubjects[0]?.id ?? '');
  useEffect(() => {
    if (!launcherSubjects.some((s) => s.id === launcherSubjectId)) {
      setLauncherSubjectId(launcherSubjects[0]?.id ?? '');
    }
  }, [launcherSubjects, launcherSubjectId]);

  const [launcherAssessment, setLauncherAssessment] = useState<AssessmentComponent>('u1');

  const inProgressLauncherExams = useMemo(() => {
    const open = db.exams.filter((e) => !e.archived && !e.locked && !e.published);
    if (!launcherClass) return open.length > 0 ? open : [activeExam];
    const matching = open.filter((e) => e.classIds.includes(launcherClass.id));
    if (matching.length > 0) return matching;
    return open.length > 0 ? open : [activeExam];
  }, [db.exams, launcherClass, activeExam]);

  const [launcherExamId, setLauncherExamId] = useState<string>(
    inProgressLauncherExams[0]?.id ?? activeExam.id
  );
  useEffect(() => {
    if (!inProgressLauncherExams.some((e) => e.id === launcherExamId)) {
      setLauncherExamId(inProgressLauncherExams[0]?.id ?? activeExam.id);
    }
  }, [inProgressLauncherExams, launcherExamId, activeExam.id]);

  const launcherOfferingCount = useMemo(() => {
    if (!launcherClass || !launcherSubjectId) return 0;
    return filterStudentsOfferingSubject(
      activeStudents,
      launcherSubjectId,
      launcherClass,
      db.combinations
    ).length;
  }, [activeStudents, launcherClass, launcherSubjectId, db.combinations]);

  const deadlineInfo = useMemo(() => {
    const raw = activeExam.submissionDeadline?.trim();
    if (!raw) return { label: 'No deadline set', overdue: false, urgent: false };
    const dueMs = new Date(`${raw}T23:59:59`).getTime();
    if (Number.isNaN(dueMs)) return { label: raw, overdue: false, urgent: false };
    const diffDays = Math.ceil((dueMs - Date.now()) / 86400000);
    if (diffDays < 0) {
      return {
        label: `Overdue by ${Math.abs(diffDays)}d`,
        overdue: true,
        urgent: true,
      };
    }
    if (diffDays === 0) {
      return { label: 'Due today', overdue: false, urgent: true };
    }
    if (diffDays <= 3) {
      return { label: `${diffDays}d remaining`, overdue: false, urgent: true };
    }
    return { label: `${diffDays}d remaining`, overdue: false, urgent: false };
  }, [activeExam.submissionDeadline]);

  // Expected subject marksheets for active exam with per-subject offering & missing assessment breakdown
  const marksheetStats = useMemo(() => {
    const expectedList: Array<{
      classId: string;
      className: string;
      subjectId: string;
      subjectName: string;
      teacherId: string;
      teacherName: string;
      status: 'missing_sheet' | 'draft' | 'submitted' | 'returned' | 'approved' | 'published';
      completedCount: number;
      totalStudents: number;
      incompleteCount: number;
      missingBreakdown: MarksheetMissingBreakdown;
      hasMissingMarks: boolean;
      dosComment?: string;
    }> = [];

    for (const cls of participatingClasses) {
      for (const subId of cls.subjectIds) {
        const sub = subjectMap.get(subId);
        if (!sub || sub.archived) continue;
        const offeringStudents = filterStudentsOfferingSubject(
          activeStudents,
          subId,
          cls,
          db.combinations
        );
        const ms = db.marksheets.find(
          (m) => m.examId === activeExam.id && m.classId === cls.id && m.subjectId === subId
        );
        const breakdown = getMarksheetMissingBreakdown(
          ms,
          offeringStudents,
          cls.level,
          sub.maxMarks,
          db.settings
        );
        const teacherId = ms?.teacherId ?? cls.subjectTeacherMap[subId] ?? '';
        const teacherName = userMap.get(teacherId)?.name ?? 'Unassigned';

        expectedList.push({
          classId: cls.id,
          className: cls.name,
          subjectId: subId,
          subjectName: sub.name,
          teacherId,
          teacherName,
          status: ms ? ms.status : 'missing_sheet',
          completedCount: breakdown.completedStudents,
          totalStudents: breakdown.totalStudents,
          incompleteCount: breakdown.missingStudentsCount + breakdown.invalidCount,
          missingBreakdown: breakdown,
          hasMissingMarks:
            breakdown.totalStudents > 0 &&
            (breakdown.missingStudentsCount > 0 || Boolean(breakdown.summaryText)),
          dosComment: ms?.dosComment,
        });
      }
    }

    const totalExpected = expectedList.length;
    const submittedOrBeyond = expectedList.filter(
      (x) => x.status === 'submitted' || x.status === 'approved' || x.status === 'published'
    ).length;
    const pendingApprovals = expectedList.filter((x) => x.status === 'submitted').length;
    const approvedCount = expectedList.filter(
      (x) => x.status === 'approved' || x.status === 'published'
    ).length;
    const returnedCount = expectedList.filter((x) => x.status === 'returned').length;
    const incompleteResults = expectedList.reduce(
      (acc, x) => acc + x.missingBreakdown.missingStudentsCount,
      0
    );

    const classProgress = participatingClasses.map((cls) => {
      const items = expectedList.filter((x) => x.classId === cls.id);
      const approved = items.filter(
        (x) => x.status === 'approved' || x.status === 'published'
      ).length;
      const submitted = items.filter((x) => x.status === 'submitted').length;
      const draftOrReturned = items.length - approved - submitted;
      const pctDone =
        items.length > 0 ? Math.round(((approved + submitted) / items.length) * 100) : 0;
      return {
        cls,
        total: items.length,
        approved,
        submitted,
        draftOrReturned,
        pctDone,
      };
    });

    return {
      expectedList,
      totalExpected,
      submittedOrBeyond,
      pendingApprovals,
      approvedCount,
      returnedCount,
      incompleteResults,
      classProgress,
    };
  }, [
    participatingClasses,
    activeStudents,
    subjectMap,
    userMap,
    db.combinations,
    db.marksheets,
    db.settings,
    activeExam.id,
  ]);

  // Cross-class performance analytics entries for the active exam
  const classAnalyticsEntries = useMemo(() => {
    return participatingClasses.map((cls) => {
      const { examClass, entryMap } = buildExamClassView(activeExam, cls, db);
      const summary = calculateClassPerformance(examClass, db.settings, entryMap);
      return { examClass, summary };
    });
  }, [participatingClasses, activeExam, db]);

  const homeroomClasses = useMemo(() => {
    if (currentUser.role !== 'class_teacher') return [];
    return scopedClasses.filter(
      (c) =>
        teacherMatchesId(c.classTeacherId, currentUser) ||
        currentUser.assignedClassIds.includes(c.id)
    );
  }, [scopedClasses, currentUser]);

  const homeroomSheets = useMemo(() => {
    if (currentUser.role !== 'class_teacher') return [];
    const hrIds = new Set(homeroomClasses.map((c) => c.id));
    return marksheetStats.expectedList.filter((item) => hrIds.has(item.classId));
  }, [marksheetStats.expectedList, homeroomClasses, currentUser.role]);

  const myAssignedSheets = useMemo(() => {
    if (!isTeacher) return [];
    const priority: Record<string, number> = {
      returned: 0,
      missing_sheet: 1,
      draft: 2,
      submitted: 3,
      approved: 4,
      published: 5,
    };
    return marksheetStats.expectedList
      .filter(
        (item) =>
          teacherMatchesId(item.teacherId, currentUser) ||
          currentUser.assignedSubjectIds.includes(item.subjectId) ||
          currentUser.assignedClassIds.includes(item.classId)
      )
      .sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  }, [marksheetStats.expectedList, isTeacher, currentUser]);

  const myMissingMarkAlerts = useMemo(
    () => myAssignedSheets.filter((item) => item.hasMissingMarks),
    [myAssignedSheets]
  );

  const dosMissingMarkAlerts = useMemo(
    () =>
      marksheetStats.expectedList
        .filter((item) => item.hasMissingMarks)
        .sort((a, b) => {
          // Submitted sheets with missing marks appear first for DOS attention
          const aPri = a.status === 'submitted' ? 0 : 1;
          const bPri = b.status === 'submitted' ? 0 : 1;
          if (aPri !== bPri) return aPri - bPri;
          return (
            b.missingBreakdown.missingStudentsCount - a.missingBreakdown.missingStudentsCount
          );
        }),
    [marksheetStats.expectedList]
  );

  const allCorrectionRequests = db.correctionRequests ?? [];
  const pendingCorrectionRequests = useMemo(
    () =>
      allCorrectionRequests
        .filter((r) => r.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allCorrectionRequests]
  );

  const myCorrectionRequests = useMemo(() => {
    if (!isTeacher) return [];
    return allCorrectionRequests
      .filter(
        (r) =>
          teacherMatchesId(r.requestedByUserId, currentUser) ||
          (currentUser.staffId && r.requestedByStaffId === currentUser.staffId)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allCorrectionRequests, isTeacher, currentUser]);

  const handleApproveClick = async (requestId: string) => {
    if (!onApproveCorrectionRequest) return;
    setBusyRequestId(requestId);
    try {
      await onApproveCorrectionRequest(requestId);
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleRejectClick = async (requestId: string) => {
    if (!onRejectCorrectionRequest) return;
    setBusyRequestId(requestId);
    try {
      await onRejectCorrectionRequest(requestId);
    } finally {
      setBusyRequestId(null);
    }
  };

  const isSingleAoiLauncher =
    launcherClass?.level === 'olevel' && db.settings.cbcConfig.aoiInputMode === 'single_aoi';

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-800">
            {ROLE_DISPLAY_NAMES[normalizeUserRole(currentUser.role)]} Workspace
          </p>
          <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
            Welcome, {currentUser.name}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Active Examination: <strong className="text-slate-800">{activeExam.name}</strong> ·{' '}
            {activeExam.term} {activeExam.academicYear} · Submission Deadline:{' '}
            <span className="font-mono text-slate-700">{activeExam.submissionDeadline}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(isTeacher || currentUser.role === 'dos') && (
            <button
              type="button"
              onClick={() => onNavigate('marks-entry')}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {currentUser.role === 'class_teacher' ? 'Enter CA & Exam Marks' : 'Enter Marks'}
              </span>
            </button>
          )}
          {canReviewAsDos && (
            <button
              type="button"
              onClick={() => onNavigate('marksheets')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <ClipboardCheck className="h-3.5 w-3.5 text-blue-800" aria-hidden="true" />
              <span>Review Submissions ({marksheetStats.pendingApprovals})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
            <span>Report Cards</span>
          </button>
        </div>
      </div>

      {/* TEACHER QUICK SELECTION LAUNCHER: Exam (In Progress) -> Class -> Subject -> Assessment */}
      {isTeacher && launcherClass && (
        <section className="rounded-lg border border-blue-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Quick Marks Entry — Select Examination, Class, Subject &amp; Assessment
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pick the examination currently in progress (issued by Admin/DOS), class, subject you teach, and assessment component (U1, U2, U3, or End of Term).
              </p>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-blue-900">
              {launcherOfferingCount} student{launcherOfferingCount === 1 ? '' : 's'} offering
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label
                htmlFor="dash-launch-exam"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
              >
                1. Examination (In Progress)
              </label>
              <select
                id="dash-launch-exam"
                value={launcherExamId}
                onChange={(e) => setLauncherExamId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {inProgressLauncherExams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({ex.term}) ·{' '}
                    {ex.published ? 'Published' : ex.locked ? 'Locked' : 'In Progress'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dash-launch-class"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
              >
                2. Class
              </label>
              <select
                id="dash-launch-class"
                value={launcherClass.id}
                onChange={(e) => setLauncherClassId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {teacherClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dash-launch-subject"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
              >
                3. Subject
              </label>
              <select
                id="dash-launch-subject"
                value={launcherSubjectId}
                onChange={(e) => setLauncherSubjectId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {launcherSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dash-launch-assessment"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
              >
                4. Assessment
              </label>
              <select
                id="dash-launch-assessment"
                value={launcherAssessment}
                onChange={(e) => setLauncherAssessment(e.target.value as AssessmentComponent)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                <option value="u1">{isSingleAoiLauncher ? 'Classwork AoI (U1)' : 'U1 — Activity 1'}</option>
                {!isSingleAoiLauncher && <option value="u2">U2 — Activity 2</option>}
                {!isSingleAoiLauncher && <option value="u3">U3 — Activity 3</option>}
                <option value="eot">End of Term (EoT Exam)</option>
                <option value="all">All Assessments (U1–U3 &amp; EoT)</option>
              </select>
            </div>

            <button
              type="button"
              disabled={!launcherSubjectId}
              onClick={() =>
                onSelectClassAndNavigate(
                  launcherClass.id,
                  'marks-entry',
                  launcherSubjectId,
                  launcherAssessment,
                  launcherExamId
                )
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-950 disabled:opacity-40 whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <span>Load Students &amp; Enter Marks</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {launcherClass.level === 'alevel' && (
            <p className="text-xs text-blue-900 bg-blue-50/70 border border-blue-200 rounded-md px-3 py-2">
              <strong>A&apos;Level Class Selected ({launcherClass.name}):</strong> Confirm the in-progress examination above and choose <strong>U1</strong>, <strong>U2</strong>, <strong>U3</strong>, or <strong>EoT</strong> before entering scores.
            </p>
          )}
        </section>
      )}

      {/* TEACHER CORRECTION APPROVAL UPDATES (Approved Unlocks & Pending Requests) */}
      {isTeacher && myCorrectionRequests.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                DOS Correction Approval Status
              </h3>
              <p className="text-xs text-slate-500">
                Track requests to re-correct submitted marksheets. Approved sheets are immediately unlocked for editing.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
            {myCorrectionRequests.slice(0, 5).map((req) => {
              const clsName = classMap.get(req.classId)?.name ?? req.classId;
              const subName = subjectMap.get(req.subjectId)?.name ?? req.subjectId;
              const isApproved = req.status === 'approved';
              const isPending = req.status === 'pending';
              return (
                <div
                  key={req.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs ${
                    isApproved ? 'bg-emerald-50/70' : 'bg-white'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {clsName} · {subName}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{SCOPE_LABELS[req.assessmentScope]}</span>
                      <span className="text-slate-400">·</span>
                      <span
                        className={`font-semibold uppercase text-[11px] ${
                          isApproved
                            ? 'text-emerald-700'
                            : isPending
                              ? 'text-amber-700'
                              : req.status === 'completed'
                                ? 'text-blue-800'
                                : 'text-red-700'
                        }`}
                      >
                        {isApproved
                          ? 'Unlocked by DOS'
                          : isPending
                            ? 'Awaiting DOS Approval'
                            : req.status === 'completed'
                              ? 'Resubmitted'
                              : 'Declined'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 truncate">
                      Reason: {req.reason}
                      {req.reviewNote ? ` · DOS Note: ${req.reviewNote}` : ''}
                    </p>
                  </div>

                  {isApproved && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectClassAndNavigate(
                          req.classId,
                          'marks-entry',
                          req.subjectId,
                          req.assessmentScope
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                    >
                      <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Re-edit &amp; Resubmit</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TEACHER MISSING MARKS ALERTS */}
      {isTeacher && myMissingMarkAlerts.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/60 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-bold text-amber-950">
                  Missing Marks Alert ({myMissingMarkAlerts.length} subject
                  {myMissingMarkAlerts.length === 1 ? '' : 's'})
                </h3>
                <p className="text-xs text-amber-900">
                  Some students in your classes still have unrecorded assessment scores. This alert is also visible to the Director of Studies.
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-amber-200 border border-amber-200 rounded-md bg-white overflow-hidden">
            {myMissingMarkAlerts.map((item) => {
              const isSubmittedOrLocked =
                item.status === 'submitted' ||
                item.status === 'approved' ||
                item.status === 'published';
              const hasUnlockedReq = allCorrectionRequests.some(
                (r) =>
                  r.examId === activeExam.id &&
                  r.classId === item.classId &&
                  r.subjectId === item.subjectId &&
                  r.status === 'approved'
              );
              const previewNames = item.missingBreakdown.missingStudentNames.slice(0, 3).join(', ');
              const extraCount = Math.max(0, item.missingBreakdown.missingStudentNames.length - 3);
              return (
                <div
                  key={`${item.classId}-${item.subjectId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {item.className} · {item.subjectName}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-[11px] font-semibold text-amber-800">
                        {item.missingBreakdown.summaryText ||
                          `${item.missingBreakdown.missingStudentsCount} missing`}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-[11px] uppercase font-semibold text-slate-600">
                        {item.status === 'missing_sheet' ? 'Not Started' : item.status}
                      </span>
                    </div>
                    {previewNames && (
                      <p className="text-[11px] text-slate-600">
                        Missing for: <span className="font-medium text-slate-800">{previewNames}</span>
                        {extraCount > 0 ? ` +${extraCount} more` : ''}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onSelectClassAndNavigate(item.classId, 'marks-entry', item.subjectId, 'all')
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 whitespace-nowrap"
                  >
                    <span>
                      {isSubmittedOrLocked && !hasUnlockedReq
                        ? 'Request DOS Approval'
                        : 'Enter Missing Marks'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* DOS / ADMIN CORRECTION APPROVAL REQUESTS PANEL */}
      {canReviewAsDos && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <Clock className="h-5 w-5 text-blue-900 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Teacher Correction Approval Requests ({pendingCorrectionRequests.length} pending)
                </h3>
                <p className="text-xs text-slate-500">
                  Approve a teacher&apos;s request to instantly unlock their submitted marksheet for correction and resubmission.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marksheets')}
              className="text-xs font-semibold text-blue-800 hover:underline whitespace-nowrap"
            >
              Open Full Review Queue
            </button>
          </div>

          {pendingCorrectionRequests.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              No pending correction requests from teachers at the moment.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
              {pendingCorrectionRequests.map((req) => {
                const clsName = classMap.get(req.classId)?.name ?? req.classId;
                const subName = subjectMap.get(req.subjectId)?.name ?? req.subjectId;
                const isBusy = busyRequestId === req.id;
                return (
                  <div
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-4 bg-white px-4 py-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {req.requestedByName}
                          {req.requestedByStaffId ? ` (${req.requestedByStaffId})` : ''}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-blue-900">
                          {clsName} · {subName}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-600">{SCOPE_LABELS[req.assessmentScope]}</span>
                      </div>
                      <p className="text-slate-700">
                        Reason: &ldquo;{req.reason}&rdquo;
                      </p>
                      <p className="text-[11px] font-mono text-slate-400">
                        Requested {new Date(req.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRejectClick(req.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                        <span>Decline</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleApproveClick(req.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{isBusy ? 'Approving...' : 'Approve & Unlock'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* DOS MISSING MARKS ALERTS ACROSS ALL CLASSES */}
      {canReviewAsDos && dosMissingMarkAlerts.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/50 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-bold text-amber-950">
                  DOS Missing Marks Alerts ({dosMissingMarkAlerts.length} subject
                  {dosMissingMarkAlerts.length === 1 ? '' : 's'})
                </h3>
                <p className="text-xs text-amber-900">
                  Subject marksheets (including submitted sheets) that still have missing student assessment scores.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marksheets')}
              className="text-xs font-semibold text-amber-950 hover:underline whitespace-nowrap"
            >
              Inspect All in Queue
            </button>
          </div>

          <div className="divide-y divide-amber-200 border border-amber-200 rounded-md bg-white overflow-hidden">
            {dosMissingMarkAlerts.slice(0, 8).map((item) => {
              const previewNames = item.missingBreakdown.missingStudentNames.slice(0, 3).join(', ');
              const extraCount = Math.max(0, item.missingBreakdown.missingStudentNames.length - 3);
              return (
                <div
                  key={`${item.classId}-${item.subjectId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {item.className} · {item.subjectName}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-600">{item.teacherName}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-[11px] font-semibold text-amber-800">
                        {item.missingBreakdown.summaryText ||
                          `${item.missingBreakdown.missingStudentsCount} missing`}
                      </span>
                    </div>
                    {previewNames && (
                      <p className="text-[11px] text-slate-500">
                        Missing: {previewNames}
                        {extraCount > 0 ? ` +${extraCount} more` : ''} · Sheet status:{' '}
                        <strong className="uppercase text-slate-700">
                          {item.status === 'missing_sheet' ? 'Not Started' : item.status}
                        </strong>
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onSelectClassAndNavigate(item.classId, 'marksheets', item.subjectId)
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <span>Inspect</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4-Card Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Students</span>
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {activeStudents.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {scopedClasses.length} classes · {scopedSubjects.length} subjects
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Marksheets Submitted</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {marksheetStats.submittedOrBeyond}/{marksheetStats.totalExpected}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {marksheetStats.approvedCount} approved · {marksheetStats.incompleteResults} missing student scores
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Review / Unlocks</span>
            <ClipboardCheck className="h-4 w-4 text-amber-600" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-amber-700">
            {marksheetStats.pendingApprovals + pendingCorrectionRequests.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {marksheetStats.pendingApprovals} sheets · {pendingCorrectionRequests.length} correction requests
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Reports Printed</span>
            <FileText className="h-4 w-4 text-blue-700" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {db.reportsGeneratedCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {activeExam.published ? 'Results published' : activeExam.locked ? 'Exam locked' : 'Open for marks entry'}
          </p>
        </div>
      </div>

      {/* School Admin Quick Setup Shortcuts */}
      {isSchoolAdminRole(currentUser.role) && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">Quick Setup</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Add staff accounts, import students, or organize your classes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Users className="h-3.5 w-3.5 text-blue-800" aria-hidden="true" />
              <span>Staff Accounts</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('students')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-blue-800" aria-hidden="true" />
              <span>Import Students</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('classes')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <GraduationCap className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
              <span>Classes</span>
            </button>
          </div>
        </section>
      )}

      {/* Class Teacher Homeroom Continuous Assessment & Terminal Remarks */}
      {currentUser.role === 'class_teacher' && (
        <section className="rounded-lg border border-blue-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Homeroom Class Teacher · Continuous Assessment &amp; Remarks
              </h3>
              <p className="text-xs text-slate-500">
                Record U1–U3 AoI continuous assessment and End-of-Term marks for your assigned classes, or write terminal remarks.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marks-entry')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-800 hover:underline whitespace-nowrap"
            >
              <span>Open Marks Entry</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {homeroomClasses.length === 0 ? (
            <p className="text-xs text-slate-500 rounded-md border border-slate-200 bg-slate-50 p-3">
              No homeroom classes are assigned to your account yet. Ask your School Administrator or DOS to assign a class under Classes &amp; Streams or User Management.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {homeroomClasses.map((cls) => {
                const clsStudentCount = activeStudents.filter((s) => s.classId === cls.id).length;
                const sheets = homeroomSheets.filter((s) => s.classId === cls.id);
                const pendingCount = sheets.filter((s) => s.hasMissingMarks).length;
                return (
                  <div
                    key={cls.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-sm font-bold text-slate-900">{cls.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {cls.level === 'olevel' ? "O'Level CBC (AoI U1–U3 + EoT)" : "A'Level UACE"} ·{' '}
                          <span className="font-mono">{clsStudentCount} students</span>
                        </p>
                      </div>
                      <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-900">
                        {pendingCount > 0 ? `${pendingCount} with missing` : 'All sheets complete'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectClassAndNavigate(cls.id, 'marks-entry')}
                        className="inline-flex items-center gap-1 rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-950"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span>Enter CA &amp; Marks</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectClassAndNavigate(cls.id, 'reports')}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Class Teacher Remarks</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {homeroomSheets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200">
              {homeroomSheets.slice(0, 6).map((item) => (
                <button
                  key={`${item.classId}-${item.subjectId}`}
                  type="button"
                  onClick={() =>
                    onSelectClassAndNavigate(item.classId, 'marks-entry', item.subjectId)
                  }
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-2.5 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {item.className} · {item.subjectName}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.hasMissingMarks
                        ? item.missingBreakdown.summaryText || `${item.incompleteCount} missing`
                        : 'Ready for review'}
                    </p>
                  </div>
                  <span className="shrink-0 ml-2 font-mono text-[10px] font-semibold uppercase text-slate-600">
                    {item.status === 'missing_sheet' ? 'Pending' : item.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Teacher-Focused "My Classes & Deadlines" Panel */}
      {isTeacher && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                My Classes &amp; Deadlines ({activeExam.name})
              </h3>
              <p className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                <CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Submission deadline:</span>
                <span className="font-mono tabular-nums font-semibold text-slate-700">
                  {activeExam.submissionDeadline}
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    deadlineInfo.overdue
                      ? 'font-semibold text-red-700'
                      : deadlineInfo.urgent
                        ? 'font-semibold text-amber-700'
                        : 'text-slate-600'
                  }
                >
                  {deadlineInfo.label}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marks-entry')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-800 hover:underline whitespace-nowrap shrink-0"
            >
              <span>Open Marks Entry</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {myAssignedSheets.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              No subject marksheets are currently mapped to your account for {activeExam.name}. Ask your Director of Studies to assign your classes and subjects under Classes or Staff Accounts.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
              {myAssignedSheets.map((item) => {
                const isDone =
                  item.status === 'submitted' ||
                  item.status === 'approved' ||
                  item.status === 'published';
                const isReturned = item.status === 'returned';
                const hasApprovedUnlock = myCorrectionRequests.some(
                  (r) =>
                    r.examId === activeExam.id &&
                    r.classId === item.classId &&
                    r.subjectId === item.subjectId &&
                    r.status === 'approved'
                );
                return (
                  <div
                    key={`${item.classId}-${item.subjectId}`}
                    className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          {item.className} · {item.subjectName}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-600">
                          {item.completedCount}/{item.totalStudents} complete
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`text-[11px] font-semibold uppercase ${
                            hasApprovedUnlock
                              ? 'text-emerald-700'
                              : isReturned
                                ? 'text-red-700'
                                : isDone
                                  ? 'text-blue-800'
                                  : deadlineInfo.overdue
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                          }`}
                        >
                          {hasApprovedUnlock
                            ? 'Unlocked by DOS'
                            : item.status === 'missing_sheet'
                              ? deadlineInfo.overdue
                                ? 'Overdue · Not Started'
                                : 'Not Started'
                              : item.status}
                        </span>
                      </div>

                      {item.hasMissingMarks && (
                        <p className="text-[11px] text-amber-800">
                          Missing: {item.missingBreakdown.summaryText}
                        </p>
                      )}

                      {isReturned && item.dosComment && (
                        <p className="text-[11px] text-red-700 flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>DOS Comment: {item.dosComment}</span>
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onSelectClassAndNavigate(item.classId, 'marks-entry', item.subjectId, 'all')
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      <span>
                        {hasApprovedUnlock
                          ? 'Re-edit & Resubmit'
                          : isDone
                            ? 'View / Request Correction'
                            : isReturned
                              ? 'Fix & Resubmit'
                              : 'Enter Marks'}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Charts Row: Academic Performance + Marks Submission Progress */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Academic Performance Overview ({activeExam.name})
              </h3>
              <p className="text-xs text-slate-500">
                Mean %, median %, and pass rate across participating classes. Click any class to inspect.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('results-analysis')}
              className="text-xs font-semibold text-blue-800 hover:underline whitespace-nowrap"
            >
              Full Analysis
            </button>
          </div>
          <ClassComparisonBarChart
            entries={classAnalyticsEntries}
            activeClassId=""
            onSelectClass={(cid) => onSelectClassAndNavigate(cid, 'results-analysis')}
          />
        </section>

        <section className="xl:col-span-5 rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Marks Submission Progress
              </h3>
              <p className="text-xs text-slate-500">
                Subject marksheet completion &amp; DOS approval status per class
              </p>
            </div>
          </div>

          <div className="space-y-3.5">
            {marksheetStats.classProgress.map((cp) => (
              <div
                key={cp.cls.id}
                className="rounded-md border border-slate-200 p-3 space-y-2 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onSelectClassAndNavigate(cp.cls.id, 'marksheets')}
                    className="font-semibold text-slate-900 hover:text-blue-800 text-left"
                  >
                    {cp.cls.name}{' '}
                    <span className="font-normal text-slate-500">
                      ({cp.cls.level === 'olevel' ? "O'Level CBC" : "A'Level"})
                    </span>
                  </button>
                  <span className="font-mono tabular-nums text-slate-700 font-semibold">
                    {cp.pctDone}% submitted
                  </span>
                </div>

                <div className="flex h-2.5 w-full overflow-hidden rounded bg-slate-100">
                  {cp.total > 0 && (
                    <>
                      <div
                        style={{ width: `${(cp.approved / cp.total) * 100}%` }}
                        className="bg-emerald-600"
                        title={`Approved: ${cp.approved}`}
                      />
                      <div
                        style={{ width: `${(cp.submitted / cp.total) * 100}%` }}
                        className="bg-blue-700"
                        title={`Submitted (Pending DOS): ${cp.submitted}`}
                      />
                      <div
                        style={{ width: `${(cp.draftOrReturned / cp.total) * 100}%` }}
                        className="bg-amber-400"
                        title={`Draft / Returned: ${cp.draftOrReturned}`}
                      />
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                  <span>{cp.approved} approved</span>
                  <span>{cp.submitted} pending review</span>
                  <span>{cp.draftOrReturned} draft/returned</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Users,
} from 'lucide-react';
import type {
  CurriculumScope,
  ExaminationPeriod,
  SchoolDatabase,
  UserAccount,
  WorkspaceTab,
} from '../types';
import {
  buildExamClassView,
  calculateClassPerformance,
  validateMarksheetRecord,
} from '../utils/calculations';
import { isSchoolAdminRole, isTeachingRole, normalizeUserRole, ROLE_DISPLAY_NAMES } from '../utils/rbac';
import { ClassComparisonBarChart } from './AnalyticsCharts';

interface DashboardViewProps {
  db: SchoolDatabase;
  currentUser: UserAccount;
  activeExam: ExaminationPeriod;
  curriculumScope?: CurriculumScope;
  onNavigate: (tab: WorkspaceTab) => void;
  onSelectClassAndNavigate: (classId: string, tab: WorkspaceTab) => void;
}

export function DashboardView({
  db,
  currentUser,
  activeExam,
  curriculumScope = 'olevel_alevel',
  onNavigate,
  onSelectClassAndNavigate,
}: DashboardViewProps) {
  const scopedClasses = useMemo(() => {
    const filtered = db.classes.filter((c) =>
      curriculumScope === 'olevel_only'
        ? c.level === 'olevel'
        : curriculumScope === 'alevel_only'
          ? c.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : db.classes;
  }, [db.classes, curriculumScope]);

  const scopedSubjects = useMemo(() => {
    const filtered = db.subjects.filter((s) =>
      curriculumScope === 'olevel_only'
        ? s.level === 'olevel'
        : curriculumScope === 'alevel_only'
          ? s.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : db.subjects;
  }, [db.subjects, curriculumScope]);

  const activeStudents = useMemo(
    () => db.students.filter((s) => s.status === 'active'),
    [db.students]
  );

  const participatingClasses = useMemo(
    () => scopedClasses.filter((c) => activeExam.classIds.includes(c.id)),
    [scopedClasses, activeExam.classIds]
  );

  // Expected subject marksheets for active exam
  const marksheetStats = useMemo(() => {
    const expectedList: Array<{
      classId: string;
      className: string;
      subjectId: string;
      subjectName: string;
      teacherId: string;
      status: 'missing_sheet' | 'draft' | 'submitted' | 'returned' | 'approved' | 'published';
      incompleteCount: number;
    }> = [];

    const subjectMap = new Map(db.subjects.map((s) => [s.id, s]));

    for (const cls of participatingClasses) {
      const clsStudents = activeStudents.filter((s) => s.classId === cls.id);
      for (const subId of cls.subjectIds) {
        const sub = subjectMap.get(subId);
        if (!sub) continue;
        const ms = db.marksheets.find(
          (m) => m.examId === activeExam.id && m.classId === cls.id && m.subjectId === subId
        );
        const validation = validateMarksheetRecord(
          ms,
          clsStudents,
          cls.level,
          sub.maxMarks,
          db.settings
        );

        expectedList.push({
          classId: cls.id,
          className: cls.name,
          subjectId: subId,
          subjectName: sub.name,
          teacherId: ms?.teacherId ?? cls.subjectTeacherMap[subId] ?? '',
          status: ms ? ms.status : 'missing_sheet',
          incompleteCount: validation.missingCount + validation.invalidCount,
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
    const incompleteResults = expectedList.reduce((acc, x) => acc + x.incompleteCount, 0);

    // Per-class submission breakdown
    const classProgress = participatingClasses.map((cls) => {
      const items = expectedList.filter((x) => x.classId === cls.id);
      const approved = items.filter((x) => x.status === 'approved' || x.status === 'published').length;
      const submitted = items.filter((x) => x.status === 'submitted').length;
      const draftOrReturned = items.length - approved - submitted;
      const pctDone = items.length > 0 ? Math.round(((approved + submitted) / items.length) * 100) : 0;
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
  }, [participatingClasses, activeStudents, db.subjects, db.marksheets, db.settings, activeExam.id]);

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
    return db.classes.filter(
      (c) =>
        c.classTeacherId === currentUser.id ||
        currentUser.assignedClassIds.includes(c.id)
    );
  }, [db.classes, currentUser]);

  const homeroomSheets = useMemo(() => {
    if (currentUser.role !== 'class_teacher') return [];
    const hrIds = new Set(homeroomClasses.map((c) => c.id));
    return marksheetStats.expectedList.filter((item) => hrIds.has(item.classId));
  }, [marksheetStats.expectedList, homeroomClasses, currentUser.role]);

  const myAssignedSheets = useMemo(() => {
    if (!isTeachingRole(currentUser.role)) return [];
    return marksheetStats.expectedList.filter(
      (item) =>
        item.teacherId === currentUser.id ||
        currentUser.assignedSubjectIds.includes(item.subjectId)
    );
  }, [marksheetStats.expectedList, currentUser]);

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
          {(isTeachingRole(currentUser.role) || currentUser.role === 'dos') && (
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
          {(currentUser.role === 'dos' || currentUser.role === 'headteacher') && (
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
            {marksheetStats.approvedCount} approved · {marksheetStats.incompleteResults} missing entries
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Review</span>
            <ClipboardCheck className="h-4 w-4 text-amber-600" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-amber-700">
            {marksheetStats.pendingApprovals}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {marksheetStats.returnedCount} returned for correction
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
                const pendingCount = sheets.filter((s) => s.incompleteCount > 0).length;
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
                        {pendingCount > 0 ? `${pendingCount} sheets open` : 'All sheets complete'}
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
                  onClick={() => onSelectClassAndNavigate(item.classId, 'marks-entry')}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-2.5 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {item.className} · {item.subjectName}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.incompleteCount > 0
                        ? `${item.incompleteCount} missing/invalid`
                        : 'Ready for review'}
                    </p>
                  </div>
                  <span className="shrink-0 ml-2 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                    {item.status === 'missing_sheet' ? 'Pending' : item.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Teacher-Focused Assignment Queue */}
      {isTeachingRole(currentUser.role) && myAssignedSheets.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                My Assigned Marksheets ({activeExam.name})
              </h3>
              <p className="text-xs text-slate-500">
                Direct shortcuts to enter, validate, and submit your subject marksheets.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myAssignedSheets.slice(0, 6).map((item) => (
              <button
                key={`${item.classId}-${item.subjectId}`}
                type="button"
                onClick={() => onSelectClassAndNavigate(item.classId, 'marks-entry')}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/50 p-3 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {item.className} · {item.subjectName}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {item.incompleteCount > 0
                      ? `${item.incompleteCount} missing/invalid marks`
                      : 'All student marks recorded'}
                  </p>
                </div>
                <span
                  className={`shrink-0 ml-2 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    item.status === 'approved' || item.status === 'published'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : item.status === 'submitted'
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : item.status === 'returned'
                          ? 'bg-red-50 text-red-800 border border-red-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {item.status === 'missing_sheet' ? 'Pending' : item.status}
                </span>
              </button>
            ))}
          </div>
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

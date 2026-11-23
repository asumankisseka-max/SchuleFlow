import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  RotateCcw,
  ShieldCheck,
  Unlock,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AssessmentComponent,
  ExaminationPeriod,
  MarksheetCorrectionRequest,
  MarksheetRecord,
  MarksheetStatus,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
} from '../types';
import {
  filterStudentsOfferingSubject,
  getMarksheetMissingBreakdown,
  validateMarksheetRecord,
} from '../utils/calculations';
import { canApproveOrPublishResults } from '../utils/rbac';

interface MarksheetsApprovalViewProps {
  currentUser: UserAccount;
  activeExam: ExaminationPeriod;
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  combinations?: SubjectCombination[];
  students: StudentProfile[];
  users: UserAccount[];
  marksheets: MarksheetRecord[];
  correctionRequests?: MarksheetCorrectionRequest[];
  settings: SchoolSettings;
  onApproveMarksheet: (examId: string, classId: string, subjectId: string) => void;
  onReturnMarksheet: (examId: string, classId: string, subjectId: string, comment: string) => void;
  onReopenMarksheet: (examId: string, classId: string, subjectId: string) => void;
  onPublishAllApproved: (examId: string) => void;
  onApproveCorrectionRequest?: (requestId: string, reviewNote?: string) => Promise<void>;
  onRejectCorrectionRequest?: (requestId: string, reviewNote?: string) => Promise<void>;
}

const SCOPE_LABELS: Record<AssessmentComponent, string> = {
  all: 'Full Marksheet',
  u1: 'U1 (Activity 1)',
  u2: 'U2 (Activity 2)',
  u3: 'U3 (Activity 3)',
  eot: 'End of Term (EoT)',
};

type StatusFilter = 'all' | 'submitted' | 'returned' | 'approved' | 'published' | 'incomplete';

export function MarksheetsApprovalView({
  currentUser,
  activeExam,
  classes,
  subjects,
  combinations = [],
  students,
  users,
  marksheets,
  correctionRequests = [],
  settings,
  onApproveMarksheet,
  onReturnMarksheet,
  onReopenMarksheet,
  onPublishAllApproved,
  onApproveCorrectionRequest,
  onRejectCorrectionRequest,
}: MarksheetsApprovalViewProps) {
  const canApprove = canApproveOrPublishResults(currentUser.role);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [busyReqId, setBusyReqId] = useState<string | null>(null);

  const [inspectTarget, setInspectTarget] = useState<{
    cls: StreamClass;
    sub: SubjectDefinition;
    sheet?: MarksheetRecord;
  } | null>(null);
  const [returnComment, setReturnComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const pendingCorrections = useMemo(
    () =>
      correctionRequests
        .filter((r) => r.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [correctionRequests]
  );

  const rows = useMemo(() => {
    const participating = classes.filter((c) => activeExam.classIds.includes(c.id));
    const list: Array<{
      cls: StreamClass;
      sub: SubjectDefinition;
      teacherName: string;
      sheet?: MarksheetRecord;
      status: MarksheetStatus | 'not_started';
      missingCount: number;
      invalidCount: number;
      completedCount: number;
      totalStudents: number;
      missingSummary: string;
    }> = [];

    for (const cls of participating) {
      if (classFilter !== 'all' && cls.id !== classFilter) continue;

      for (const subId of cls.subjectIds) {
        const sub = subjectMap.get(subId);
        if (!sub) continue;
        const offeringStudents = filterStudentsOfferingSubject(
          students,
          subId,
          cls,
          combinations
        );
        const sheet = marksheets.find(
          (m) => m.examId === activeExam.id && m.classId === cls.id && m.subjectId === subId
        );
        const teacherId = sheet?.teacherId ?? cls.subjectTeacherMap[subId] ?? '';
        const teacherName = userMap.get(teacherId)?.name ?? 'Unassigned';
        const breakdown = getMarksheetMissingBreakdown(
          sheet,
          offeringStudents,
          cls.level,
          sub.maxMarks,
          settings
        );

        list.push({
          cls,
          sub,
          teacherName,
          sheet,
          status: sheet ? sheet.status : 'not_started',
          missingCount: breakdown.missingStudentsCount,
          invalidCount: breakdown.invalidCount,
          completedCount: breakdown.completedStudents,
          totalStudents: breakdown.totalStudents,
          missingSummary: breakdown.summaryText,
        });
      }
    }

    return list.filter((row) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'incomplete') {
        return row.missingCount > 0 || row.invalidCount > 0 || row.status === 'not_started' || row.status === 'draft';
      }
      return row.status === statusFilter;
    });
  }, [
    classes,
    activeExam.classIds,
    activeExam.id,
    classFilter,
    students,
    combinations,
    subjectMap,
    marksheets,
    userMap,
    settings,
    statusFilter,
  ]);

  const approvedCount = rows.filter((r) => r.status === 'approved').length;

  const inspectValidation = useMemo(() => {
    if (!inspectTarget) return null;
    const offeringStudents = filterStudentsOfferingSubject(
      students,
      inspectTarget.sub.id,
      inspectTarget.cls,
      combinations
    );
    return {
      students: offeringStudents,
      validation: validateMarksheetRecord(
        inspectTarget.sheet,
        offeringStudents,
        inspectTarget.cls.level,
        inspectTarget.sub.maxMarks,
        settings
      ),
    };
  }, [inspectTarget, students, combinations, settings]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Marksheets Verification &amp; DOS Approval Queue
          </h2>
          <p className="text-xs text-slate-500">
            Review teacher submissions, audit missing or invalid marks, approve marksheets, and publish verified results ({activeExam.name})
          </p>
        </div>

        {canApprove && approvedCount > 0 && (
          <button
            type="button"
            onClick={() => onPublishAllApproved(activeExam.id)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Publish All Approved ({approvedCount})</span>
          </button>
        )}
      </div>

      {/* Pending Teacher Correction Requests */}
      {canApprove && pendingCorrections.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-950">
            <Clock className="h-4 w-4 text-amber-700 shrink-0" />
            <h3 className="font-display text-sm font-bold">
              Teacher Requests to Re-correct Submitted Results ({pendingCorrections.length})
            </h3>
          </div>
          <div className="divide-y divide-amber-200 border border-amber-200 rounded-md bg-white overflow-hidden">
            {pendingCorrections.map((req) => {
              const clsName = classMap.get(req.classId)?.name ?? req.classId;
              const subName = subjectMap.get(req.subjectId)?.name ?? req.subjectId;
              const isBusy = busyReqId === req.id;
              return (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
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
                    <p className="text-slate-700">Reason: &ldquo;{req.reason}&rdquo;</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onRejectCorrectionRequest && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyReqId(req.id);
                          try {
                            await onRejectCorrectionRequest(req.id);
                          } finally {
                            setBusyReqId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <XCircle className="h-3 w-3 text-red-600" />
                        <span>Decline</span>
                      </button>
                    )}
                    {onApproveCorrectionRequest && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyReqId(req.id);
                          try {
                            await onApproveCorrectionRequest(req.id);
                          } finally {
                            setBusyReqId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                      >
                        <Unlock className="h-3 w-3" />
                        <span>{isBusy ? 'Approving...' : 'Approve & Unlock'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', label: 'All Marksheets' },
              { id: 'submitted', label: 'Submitted (Pending DOS)' },
              { id: 'returned', label: 'Returned' },
              { id: 'approved', label: 'Approved' },
              { id: 'published', label: 'Published' },
              { id: 'incomplete', label: 'Draft / Incomplete' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                statusFilter === f.id
                  ? 'bg-blue-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
        >
          <option value="all">All Participating Classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Queue Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <th className="py-2.5 px-3">Class</th>
                <th className="py-2.5 px-3">Subject</th>
                <th className="py-2.5 px-3">Assigned Teacher</th>
                <th className="py-2.5 px-3 text-right">Completion</th>
                <th className="py-2.5 px-3 text-right">Validation Checks</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Review Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <tr key={`${row.cls.id}-${row.sub.id}`} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                    {row.cls.name}{' '}
                    <span className="font-normal text-slate-400">
                      ({row.cls.level === 'olevel' ? "O'Level" : "A'Level"})
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-800">
                    {row.sub.name}{' '}
                    <span className="font-mono text-slate-400">({row.sub.code})</span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{row.teacherName}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                    {row.completedCount}/{row.totalStudents}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {row.invalidCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {row.invalidCount} invalid
                      </span>
                    ) : row.missingCount > 0 ? (
                      <span
                        className="text-amber-700 font-medium"
                        title={row.missingSummary || undefined}
                      >
                        {row.missingSummary || `${row.missingCount} missing`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Verified
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold capitalize ${
                        row.status === 'published'
                          ? 'bg-emerald-700 text-white'
                          : row.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : row.status === 'submitted'
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : row.status === 'returned'
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {row.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setInspectTarget({ cls: row.cls, sub: row.sub, sheet: row.sheet });
                          setReturnComment(row.sheet?.dosComment ?? '');
                          setCommentError(null);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Inspect</span>
                      </button>

                      {canApprove && row.status === 'submitted' && (
                        <button
                          type="button"
                          onClick={() =>
                            onApproveMarksheet(activeExam.id, row.cls.id, row.sub.id)
                          }
                          className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                        >
                          <ClipboardCheck className="h-3 w-3" />
                          <span>Approve</span>
                        </button>
                      )}

                      {canApprove && (row.status === 'approved' || row.status === 'published') && (
                        <button
                          type="button"
                          onClick={() =>
                            onReopenMarksheet(activeExam.id, row.cls.id, row.sub.id)
                          }
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Unlock className="h-3 w-3" />
                          <span>Unlock</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspection & Return/Approve Modal */}
      {inspectTarget && inspectValidation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  {inspectTarget.cls.name} · {inspectTarget.sub.name} ({inspectTarget.sub.code})
                </h3>
                <p className="text-xs text-slate-500">
                  {inspectValidation.validation.completedCount}/
                  {inspectValidation.validation.totalStudents} complete ·{' '}
                  {inspectValidation.validation.missingCount} missing ·{' '}
                  {inspectValidation.validation.invalidCount} invalid
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {inspectValidation.validation.issues.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1 text-amber-900">
                  <p className="font-semibold">Validation Findings:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {inspectValidation.validation.issues.slice(0, 6).map((iss, i) => (
                      <li key={i}>
                        <strong>{iss.admissionNo}</strong> ({iss.studentName}): {iss.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <th className="py-2 px-3">Adm No</th>
                      <th className="py-2 px-3">Student Name</th>
                      {inspectTarget.cls.level === 'olevel' ? (
                        <>
                          <th className="py-2 px-3 text-right">U1</th>
                          <th className="py-2 px-3 text-right">U2</th>
                          <th className="py-2 px-3 text-right">U3</th>
                          <th className="py-2 px-3 text-right">EoT</th>
                        </>
                      ) : (
                        <th className="py-2 px-3 text-right">Exam Mark</th>
                      )}
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {inspectValidation.students.map((stu) => {
                      const entry = inspectTarget.sheet?.entries[stu.id];
                      return (
                        <tr key={stu.id}>
                          <td className="py-2 px-3 font-mono">{stu.admissionNo}</td>
                          <td className="py-2 px-3 font-medium">{stu.fullName}</td>
                          {inspectTarget.cls.level === 'olevel' ? (
                            <>
                              <td className="py-2 px-3 text-right font-mono">{entry?.u1 || '—'}</td>
                              <td className="py-2 px-3 text-right font-mono">{entry?.u2 || '—'}</td>
                              <td className="py-2 px-3 text-right font-mono">{entry?.u3 || '—'}</td>
                              <td className="py-2 px-3 text-right font-mono">{entry?.eot || '—'}</td>
                            </>
                          ) : (
                            <td className="py-2 px-3 text-right font-mono">{entry?.mark || '—'}</td>
                          )}
                          <td className="py-2 px-3 text-slate-500">
                            {entry?.exempted ? 'Exempted' : entry?.missed ? 'Did Not Sit' : 'Recorded'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canApprove && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <label className="block font-semibold text-slate-800">
                    DOS Review / Return Comment
                  </label>
                  {commentError && (
                    <p className="text-red-700 font-medium">{commentError}</p>
                  )}
                  <textarea
                    rows={2}
                    value={returnComment}
                    onChange={(e) => {
                      setReturnComment(e.target.value);
                      setCommentError(null);
                    }}
                    placeholder="Optional note for approval, or required reason when returning for revision..."
                    className="w-full rounded border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              )}
            </div>

            {canApprove && (
              <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => {
                    if (!returnComment.trim()) {
                      setCommentError('Please enter a brief explanation before returning to teacher.');
                      return;
                    }
                    onReturnMarksheet(
                      activeExam.id,
                      inspectTarget.cls.id,
                      inspectTarget.sub.id,
                      returnComment.trim()
                    );
                    setInspectTarget(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-3.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Return for Revision</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onApproveMarksheet(
                      activeExam.id,
                      inspectTarget.cls.id,
                      inspectTarget.sub.id
                    );
                    setInspectTarget(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Approve Marksheet</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

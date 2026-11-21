import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CheckCircle2,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import type {
  CurriculumScope,
  ExamType,
  ExaminationPeriod,
  MarksheetRecord,
  StreamClass,
  UserRole,
} from '../types';
import { canApproveOrPublishResults } from '../utils/rbac';

interface ExaminationsViewProps {
  exams: ExaminationPeriod[];
  activeExamId: string;
  classes: StreamClass[];
  marksheets: MarksheetRecord[];
  academicYear: string;
  termName: string;
  userRole: UserRole;
  curriculumScope?: CurriculumScope;
  onSelectExam: (examId: string) => void;
  onAddExam: (exam: ExaminationPeriod) => void;
  onUpdateExam: (exam: ExaminationPeriod) => void;
  onArchiveOrDeleteExam?: (examId: string, mode: 'archive' | 'restore' | 'delete') => void;
}

export function ExaminationsView({
  exams,
  activeExamId,
  classes,
  marksheets,
  academicYear,
  termName,
  userRole,
  curriculumScope = 'olevel_alevel',
  onSelectExam,
  onAddExam,
  onUpdateExam,
  onArchiveOrDeleteExam,
}: ExaminationsViewProps) {
  const canManage = canApproveOrPublishResults(userRole);
  const allowOlevel = curriculumScope !== 'alevel_only';
  const allowAlevel = curriculumScope !== 'olevel_only';
  const scopedClasses = classes.filter((c) =>
    c.level === 'olevel' ? allowOlevel : allowAlevel
  );
  const defaultScope: 'all' | 'olevel' | 'alevel' =
    allowOlevel && allowAlevel ? 'all' : allowOlevel ? 'olevel' : 'alevel';

  const [showNew, setShowNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [name, setName] = useState('Midterm Assessment');
  const [examType, setExamType] = useState<ExamType>('Midterm');
  const [term, setTerm] = useState(termName);
  const [year, setYear] = useState(academicYear);
  const [levelScope, setLevelScope] = useState<'all' | 'olevel' | 'alevel'>(defaultScope);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>(
    scopedClasses.map((c) => c.id)
  );
  const [examDate, setExamDate] = useState('2026-11-18');
  const [deadline, setDeadline] = useState('2026-11-28');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedClassIds.length === 0) return;
    const newExam: ExaminationPeriod = {
      id: `exam-${Date.now()}`,
      name: name.trim(),
      examType,
      term: term.trim() || termName,
      academicYear: year.trim() || academicYear,
      levelScope,
      classIds: selectedClassIds,
      examDate,
      submissionDeadline: deadline,
      locked: false,
      published: false,
      createdAt: new Date().toISOString(),
    };
    onAddExam(newExam);
    onSelectExam(newExam.id);
    setShowNew(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Examinations &amp; Assessment Periods
          </h2>
          <p className="text-xs text-slate-500">
            Schedule BOT, Midterm, and End of Term exams, manage submission deadlines, and control lock/publish state
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer mr-1">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show Archived</span>
          </label>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Examination</span>
            </button>
          )}
        </div>
      </div>

      {showNew && canManage && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-blue-200 bg-blue-50/40 p-5 space-y-4 text-xs"
        >
          <h3 className="font-display text-sm font-bold text-slate-900">
            New Examination Period
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Exam Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Assessment Type</label>
              <select
                value={examType}
                onChange={(e) => setExamType(e.target.value as ExamType)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="BOT">Beginning of Term (BOT)</option>
                <option value="Midterm">Midterm Assessment</option>
                <option value="End of Term">End of Term</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Term &amp; Year</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="w-1/2 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                />
                <input
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-1/2 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Level Scope</label>
              <select
                value={levelScope}
                onChange={(e) => {
                  const sc = e.target.value as 'all' | 'olevel' | 'alevel';
                  setLevelScope(sc);
                  setSelectedClassIds(
                    scopedClasses
                      .filter((c) => sc === 'all' || c.level === sc)
                      .map((c) => c.id)
                  );
                }}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {allowOlevel && allowAlevel && (
                  <option value="all">All Levels (O&apos;Level &amp; A&apos;Level)</option>
                )}
                {allowOlevel && <option value="olevel">O&apos;Level Only</option>}
                {allowAlevel && <option value="alevel">A&apos;Level Only</option>}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Examination Date</label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Submission Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1.5">Participating Classes</label>
            <div className="flex flex-wrap gap-2">
              {scopedClasses.map((cls) => (
                <label
                  key={cls.id}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedClassIds.includes(cls.id)}
                    onChange={(e) =>
                      setSelectedClassIds((prev) =>
                        e.target.checked ? [...prev, cls.id] : prev.filter((x) => x !== cls.id)
                      )
                    }
                  />
                  <span>{cls.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-blue-900 px-4 py-1.5 font-medium text-white"
            >
              Create Examination
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {exams
          .filter((ex) => showArchived || !ex.archived)
          .map((ex) => {
          const isActive = ex.id === activeExamId;
          const totalExpected = classes
            .filter((c) => ex.classIds.includes(c.id))
            .reduce((acc, c) => acc + c.subjectIds.length, 0);
          const examSheets = marksheets.filter((m) => m.examId === ex.id);
          const approvedCount = examSheets.filter(
            (m) => m.status === 'approved' || m.status === 'published'
          ).length;

          return (
            <div
              key={ex.id}
              className={`rounded-lg border p-5 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                isActive ? 'border-blue-700 bg-blue-50/30' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-blue-800" />
                  <h3 className="font-display text-base font-bold text-slate-900">{ex.name}</h3>
                  <span className="font-mono text-xs text-slate-500">
                    {ex.term} · {ex.academicYear} · {ex.examType}
                  </span>
                  {isActive && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-900">
                      Active Workspace Exam
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  Classes:{' '}
                  {ex.classIds
                    .map((id) => classes.find((c) => c.id === id)?.name)
                    .filter(Boolean)
                    .join(', ')}{' '}
                  · Exam Date: <span className="font-mono">{ex.examDate}</span> · Deadline:{' '}
                  <span className="font-mono">{ex.submissionDeadline}</span>
                </p>
                <p className="text-xs font-mono tabular-nums text-slate-500">
                  Approval progress: {approvedCount} / {totalExpected} subject marksheets approved
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => onSelectExam(ex.id)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Set Active
                  </button>
                )}

                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => onUpdateExam({ ...ex, locked: !ex.locked })}
                      className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
                        ex.locked
                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {ex.locked ? (
                        <>
                          <Lock className="h-3.5 w-3.5" />
                          <span>Locked (Click to Unlock)</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="h-3.5 w-3.5" />
                          <span>Open (Click to Lock)</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateExam({
                          ...ex,
                          published: !ex.published,
                          locked: !ex.published ? true : ex.locked,
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                        ex.published
                          ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                          : 'border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{ex.published ? 'Published' : 'Publish Exam'}</span>
                    </button>

                    {onArchiveOrDeleteExam && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onArchiveOrDeleteExam(ex.id, ex.archived ? 'restore' : 'archive')
                          }
                          title={ex.archived ? 'Restore examination' : 'Archive examination'}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {ex.archived ? (
                            <>
                              <ArchiveRestore className="h-3.5 w-3.5 text-emerald-700" />
                              <span>Restore</span>
                            </>
                          ) : (
                            <>
                              <Archive className="h-3.5 w-3.5 text-amber-700" />
                              <span>Archive</span>
                            </>
                          )}
                        </button>
                        {!ex.published && !ex.locked && examSheets.length === 0 && (
                          <button
                            type="button"
                            onClick={() => onArchiveOrDeleteExam(ex.id, 'delete')}
                            title="Delete empty examination"
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

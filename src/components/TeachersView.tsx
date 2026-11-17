import { Award, CheckCircle2, Clock, Mail, Phone } from 'lucide-react';
import type {
  ExaminationPeriod,
  MarksheetRecord,
  StreamClass,
  SubjectDefinition,
  UserAccount,
} from '../types';
import { ROLE_DISPLAY_NAMES } from '../utils/rbac';

interface TeachersViewProps {
  users: UserAccount[];
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  marksheets: MarksheetRecord[];
  activeExam: ExaminationPeriod;
}

export function TeachersView({
  users,
  classes,
  subjects,
  marksheets,
  activeExam,
}: TeachersViewProps) {
  const teachingStaff = users.filter(
    (u) => u.role === 'teacher' || u.role === 'class_teacher' || u.role === 'dos'
  );
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-display text-lg font-bold text-slate-900">
          Teaching Staff &amp; Subject Allocations
        </h2>
        <p className="text-xs text-slate-500">
          Assigned classes, subject responsibilities, and submission compliance for {activeExam.name}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {teachingStaff.map((teacher) => {
          const classTeacherOf = classes.filter((c) => c.classTeacherId === teacher.id);
          const teachingAssignments: Array<{ className: string; subjectName: string; code: string; status: string }> = [];

          for (const cls of classes) {
            for (const subId of cls.subjectIds) {
              if (cls.subjectTeacherMap[subId] === teacher.id) {
                const sub = subjectMap.get(subId);
                const ms = marksheets.find(
                  (m) =>
                    m.examId === activeExam.id && m.classId === cls.id && m.subjectId === subId
                );
                teachingAssignments.push({
                  className: cls.name,
                  subjectName: sub?.name ?? subId,
                  code: sub?.code ?? '',
                  status: ms?.status ?? 'pending',
                });
              }
            }
          }

          const completedCount = teachingAssignments.filter(
            (a) => a.status === 'submitted' || a.status === 'approved' || a.status === 'published'
          ).length;

          return (
            <div
              key={teacher.id}
              className="rounded-lg border border-slate-200 bg-white p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-900 border border-blue-200 shrink-0">
                    <Award className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {teacher.name}
                    </h3>
                    <p className="text-xs text-slate-500">{ROLE_DISPLAY_NAMES[teacher.role]}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {teacher.email}
                      </span>
                      {teacher.phone && (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Phone className="h-3 w-3" />
                          {teacher.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    teacher.active
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {teacher.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {classTeacherOf.length > 0 && (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <strong>Class Teacher:</strong>{' '}
                  {classTeacherOf.map((c) => c.name).join(', ')}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                  <span>Assigned Subject Marksheets ({activeExam.name})</span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {completedCount}/{teachingAssignments.length} submitted
                  </span>
                </div>
                {teachingAssignments.length === 0 ? (
                  <p className="text-xs text-slate-400">No subject marksheets assigned.</p>
                ) : (
                  <div className="space-y-1.5">
                    {teachingAssignments.map((a, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs rounded border border-slate-200 px-2.5 py-1.5"
                      >
                        <span className="text-slate-800">
                          <strong>{a.className}</strong> · {a.subjectName}{' '}
                          <span className="font-mono text-slate-400">({a.code})</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold capitalize ${
                            a.status === 'approved' || a.status === 'published'
                              ? 'text-emerald-700'
                              : a.status === 'submitted'
                                ? 'text-blue-700'
                                : a.status === 'returned'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                          }`}
                        >
                          {a.status === 'approved' || a.status === 'published' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          {a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

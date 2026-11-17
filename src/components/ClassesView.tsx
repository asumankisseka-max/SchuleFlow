import { useMemo, useState } from 'react';
import { Layers, Plus, Trash2, Users } from 'lucide-react';
import type {
  CurriculumScope,
  EducationLevel,
  StreamClass,
  StudentProfile,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
  UserRole,
} from '../types';
import { canManageAcademicSetup } from '../utils/rbac';

interface ClassesViewProps {
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  combinations: SubjectCombination[];
  students: StudentProfile[];
  users: UserAccount[];
  userRole: UserRole;
  curriculumScope?: CurriculumScope;
  onAddClass: (cls: StreamClass) => void;
  onUpdateClass: (cls: StreamClass) => void;
  onAddCombination: (combo: SubjectCombination) => void;
  onDeleteCombination: (comboId: string) => void;
}

export function ClassesView({
  classes,
  subjects,
  combinations,
  students,
  users,
  userRole,
  curriculumScope = 'olevel_alevel',
  onAddClass,
  onUpdateClass,
  onAddCombination,
  onDeleteCombination,
}: ClassesViewProps) {
  const canEdit = canManageAcademicSetup(userRole);
  const allowOlevel = curriculumScope !== 'alevel_only';
  const allowAlevel = curriculumScope !== 'olevel_only';

  const visibleClasses = useMemo(
    () => classes.filter((c) => (c.level === 'olevel' ? allowOlevel : allowAlevel)),
    [classes, allowOlevel, allowAlevel]
  );

  const allowedGrades = useMemo(() => {
    if (allowOlevel && allowAlevel) return ['S.1', 'S.2', 'S.3', 'S.4', 'S.5', 'S.6'];
    if (allowAlevel) return ['S.5', 'S.6'];
    return ['S.1', 'S.2', 'S.3', 'S.4'];
  }, [allowOlevel, allowAlevel]);

  const teachers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.active &&
          (u.role === 'teacher' || u.role === 'class_teacher' || u.role === 'dos')
      ),
    [users]
  );

  const [selectedClassId, setSelectedClassId] = useState(visibleClasses[0]?.id ?? '');
  const activeClass = visibleClasses.find((c) => c.id === selectedClassId) ?? visibleClasses[0];

  // New class form
  const [showNewClass, setShowNewClass] = useState(false);
  const [gradeLevel, setGradeLevel] = useState(allowedGrades[0] ?? 'S.1');
  const [stream, setStream] = useState('North');
  const [level, setLevel] = useState<EducationLevel>(allowOlevel ? 'olevel' : 'alevel');
  const [classTeacherId, setClassTeacherId] = useState(teachers[0]?.id ?? '');

  // New A'Level combination form
  const [showNewCombo, setShowNewCombo] = useState(false);
  const [comboCode, setComboCode] = useState('');
  const [comboName, setComboName] = useState('');
  const [comboPrincipals, setComboPrincipals] = useState<string[]>([]);
  const [comboSubs, setComboSubs] = useState<string[]>([]);

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultSubs = subjects
      .filter((s) => s.level === level)
      .slice(0, level === 'olevel' ? 6 : 5)
      .map((s) => s.id);
    const teacherMap: Record<string, string> = {};
    defaultSubs.forEach((sid) => {
      teacherMap[sid] = classTeacherId || teachers[0]?.id || '';
    });
    const newCls: StreamClass = {
      id: `cls-${Date.now()}`,
      name: `${gradeLevel} ${stream.trim()}`.trim(),
      gradeLevel,
      stream: stream.trim() || 'A',
      level,
      classTeacherId: classTeacherId || teachers[0]?.id || '',
      subjectIds: defaultSubs,
      subjectTeacherMap: teacherMap,
    };
    onAddClass(newCls);
    setSelectedClassId(newCls.id);
    setShowNewClass(false);
  };

  const toggleClassSubject = (subjectId: string) => {
    if (!activeClass || !canEdit) return;
    const exists = activeClass.subjectIds.includes(subjectId);
    const updatedSubjectIds = exists
      ? activeClass.subjectIds.filter((id) => id !== subjectId)
      : [...activeClass.subjectIds, subjectId];
    const updatedMap = { ...activeClass.subjectTeacherMap };
    if (!exists && !updatedMap[subjectId]) {
      updatedMap[subjectId] = activeClass.classTeacherId;
    }
    onUpdateClass({
      ...activeClass,
      subjectIds: updatedSubjectIds,
      subjectTeacherMap: updatedMap,
    });
  };

  const updateSubjectTeacher = (subjectId: string, teacherId: string) => {
    if (!activeClass || !canEdit) return;
    onUpdateClass({
      ...activeClass,
      subjectTeacherMap: {
        ...activeClass.subjectTeacherMap,
        [subjectId]: teacherId,
      },
    });
  };

  const alevelSubjects = subjects.filter((s) => s.level === 'alevel');

  const handleCreateCombo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comboCode.trim() || comboPrincipals.length === 0) return;
    onAddCombination({
      id: `comb-${Date.now()}`,
      code: comboCode.trim().toUpperCase(),
      name: comboName.trim() || comboCode.trim().toUpperCase(),
      principalSubjectIds: comboPrincipals,
      subsidiarySubjectIds: comboSubs,
    });
    setComboCode('');
    setComboName('');
    setComboPrincipals([]);
    setComboSubs([]);
    setShowNewCombo(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {allowAlevel ? "Classes, Streams & A'Level Combinations" : 'Classes & Streams'}
          </h2>
          <p className="text-xs text-slate-500">
            Configure {allowedGrades[0]}–{allowedGrades[allowedGrades.length - 1]} streams, class
            teachers, subject offerings, and subject teacher assignments
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowNewClass((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Class / Stream</span>
          </button>
        )}
      </div>

      {showNewClass && canEdit && (
        <form
          onSubmit={handleCreateClass}
          className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end text-xs"
        >
          <div>
            <label className="block font-medium text-slate-700 mb-1">Class Level</label>
            <select
              value={gradeLevel}
              onChange={(e) => {
                const g = e.target.value;
                setGradeLevel(g);
                setLevel(g === 'S.5' || g === 'S.6' ? 'alevel' : 'olevel');
              }}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-900"
            >
              {allowedGrades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Stream Name</label>
            <input
              type="text"
              required
              value={stream}
              onChange={(e) => setStream(e.target.value)}
              placeholder="East / West / Science"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Curriculum Level</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as EducationLevel)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-900"
            >
              {allowOlevel && <option value="olevel">O&apos;Level (CBC)</option>}
              {allowAlevel && <option value="alevel">A&apos;Level (UACE)</option>}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Class Teacher</label>
            <select
              value={classTeacherId}
              onChange={(e) => setClassTeacherId(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-900"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded bg-blue-900 px-3 py-1.5 font-medium text-white hover:bg-blue-950"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewClass(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Two-column Classes List + Subject Assignment Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-2">
          {visibleClasses.map((cls) => {
            const count = students.filter((s) => s.classId === cls.id && s.status === 'active').length;
            const teacher = users.find((u) => u.id === cls.classTeacherId);
            const active = activeClass?.id === cls.id;
            return (
              <button
                key={cls.id}
                type="button"
                onClick={() => setSelectedClassId(cls.id)}
                className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-blue-700 bg-blue-50/60'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-slate-900">{cls.name}</span>
                  <span className="text-[11px] font-medium text-blue-900">
                    {cls.level === 'olevel' ? "O'Level CBC" : "A'Level"}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                  <span>{teacher?.name ?? 'Unassigned'}</span>
                  <span className="font-mono tabular-nums inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {count} · {cls.subjectIds.length} subj
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {activeClass && (
          <div className="lg:col-span-8 rounded-lg border border-slate-200 bg-white p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  {activeClass.name} Configuration
                </h3>
                <p className="text-xs text-slate-500">
                  {activeClass.level === 'olevel'
                    ? "Lower Secondary O'Level Competency-Based Curriculum"
                    : "Upper Secondary A'Level Principal & Subsidiary Papers"}
                </p>
              </div>
              <div className="text-xs">
                <label className="block text-slate-500 mb-1">Class Teacher</label>
                <select
                  disabled={!canEdit}
                  value={activeClass.classTeacherId}
                  onChange={(e) =>
                    onUpdateClass({ ...activeClass, classTeacherId: e.target.value })
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-900 disabled:bg-slate-50"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-800 mb-2.5">
                Subject Offerings &amp; Assigned Teachers
              </h4>
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <th className="py-2 px-3 w-10">Offer</th>
                      <th className="py-2 px-3">Code</th>
                      <th className="py-2 px-3">Subject</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Assigned Teacher</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {subjects
                      .filter((s) => s.level === activeClass.level)
                      .map((sub) => {
                        const offered = activeClass.subjectIds.includes(sub.id);
                        return (
                          <tr key={sub.id} className={offered ? 'bg-white' : 'bg-slate-50/50 opacity-75'}>
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                disabled={!canEdit}
                                checked={offered}
                                onChange={() => toggleClassSubject(sub.id)}
                              />
                            </td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-700">
                              {sub.code}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900">{sub.name}</td>
                            <td className="py-2 px-3 capitalize text-slate-500">{sub.category}</td>
                            <td className="py-2 px-3">
                              {offered ? (
                                <select
                                  disabled={!canEdit}
                                  value={activeClass.subjectTeacherMap[sub.id] ?? ''}
                                  onChange={(e) => updateSubjectTeacher(sub.id, e.target.value)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 disabled:bg-slate-50"
                                >
                                  <option value="">Unassigned</option>
                                  {teachers.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-slate-400">Not offered</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* A'Level Subject Combinations Section (Module 13A) */}
      {allowAlevel && (
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-blue-800" />
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                A&apos;Level Subject Combinations
              </h3>
              <p className="text-xs text-slate-500">
                Principal + Subsidiary combinations (e.g. PCM/ICT, BCM/ICT, HEG/SubMath)
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowNewCombo((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Combination</span>
            </button>
          )}
        </div>

        {showNewCombo && canEdit && (
          <form
            onSubmit={handleCreateCombo}
            className="rounded-md border border-blue-200 bg-blue-50/40 p-4 space-y-3 text-xs"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Combination Code *</label>
                <input
                  type="text"
                  required
                  value={comboCode}
                  onChange={(e) => setComboCode(e.target.value)}
                  placeholder="e.g. MEG/ICT"
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={comboName}
                  onChange={(e) => setComboName(e.target.value)}
                  placeholder="Mathematics, Economics, Geography + Sub-ICT"
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Principal Subjects</label>
                <div className="flex flex-wrap gap-2">
                  {alevelSubjects
                    .filter((s) => s.category === 'principal')
                    .map((s) => (
                      <label key={s.id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1">
                        <input
                          type="checkbox"
                          checked={comboPrincipals.includes(s.id)}
                          onChange={(e) =>
                            setComboPrincipals((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                            )
                          }
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Subsidiary Subjects</label>
                <div className="flex flex-wrap gap-2">
                  {alevelSubjects
                    .filter((s) => s.category === 'subsidiary')
                    .map((s) => (
                      <label key={s.id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1">
                        <input
                          type="checkbox"
                          checked={comboSubs.includes(s.id)}
                          onChange={(e) =>
                            setComboSubs((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                            )
                          }
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewCombo(false)}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-blue-900 px-3.5 py-1.5 font-medium text-white"
              >
                Save Combination
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {combinations.map((cb) => (
            <div key={cb.id} className="rounded-md border border-slate-200 p-3.5 bg-slate-50/50 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-slate-900">{cb.code}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onDeleteCombination(cb.id)}
                    className="text-slate-400 hover:text-red-700"
                    title="Delete combination"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="text-slate-600">{cb.name}</p>
              <p className="text-[11px] text-slate-500">
                Principals:{' '}
                {cb.principalSubjectIds
                  .map((id) => subjects.find((s) => s.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')}
              </p>
              <p className="text-[11px] text-slate-500">
                Subsidiaries:{' '}
                {cb.subsidiarySubjectIds
                  .map((id) => subjects.find((s) => s.id === id)?.name)
                  .filter(Boolean)
                  .join(', ') || 'None'}
              </p>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import type {
  CurriculumScope,
  EducationLevel,
  SubjectCategory,
  SubjectDefinition,
  UserRole,
} from '../types';
import { canManageAcademicSetup } from '../utils/rbac';

interface SubjectsViewProps {
  subjects: SubjectDefinition[];
  userRole: UserRole;
  curriculumScope?: CurriculumScope;
  onAddSubject: (subject: SubjectDefinition) => void;
  onUpdateSubject: (subject: SubjectDefinition) => void;
}

export function SubjectsView({
  subjects,
  userRole,
  curriculumScope = 'olevel_alevel',
  onAddSubject,
  onUpdateSubject,
}: SubjectsViewProps) {
  const canEdit = canManageAcademicSetup(userRole);
  const allowOlevel = curriculumScope !== 'alevel_only';
  const allowAlevel = curriculumScope !== 'olevel_only';

  const [levelFilter, setLevelFilter] = useState<'all' | EducationLevel>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState<EducationLevel>(allowOlevel ? 'olevel' : 'alevel');
  const [category, setCategory] = useState<SubjectCategory>(
    allowOlevel ? 'compulsory' : 'principal'
  );
  const [maxMarks, setMaxMarks] = useState(100);
  const [passMark, setPassMark] = useState(50);
  const [competencyText, setCompetencyText] = useState('');

  const scopedSubjects = subjects.filter((s) =>
    s.level === 'olevel' ? allowOlevel : allowAlevel
  );
  const filtered = scopedSubjects.filter((s) => levelFilter === 'all' || s.level === levelFilter);

  const openNew = () => {
    const defaultLevel: EducationLevel = allowOlevel ? 'olevel' : 'alevel';
    setEditingId(null);
    setCode('');
    setName('');
    setLevel(defaultLevel);
    setCategory(defaultLevel === 'olevel' ? 'compulsory' : 'principal');
    setMaxMarks(100);
    setPassMark(50);
    setCompetencyText('');
    setShowAdd(true);
  };

  const openEdit = (s: SubjectDefinition) => {
    setEditingId(s.id);
    setCode(s.code);
    setName(s.name);
    setLevel(s.level);
    setCategory(s.category);
    setMaxMarks(s.maxMarks);
    setPassMark(s.passMark);
    setCompetencyText(s.competencies.join('\n'));
    setShowAdd(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const competencies = competencyText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const payload: SubjectDefinition = {
      id: editingId ?? `sub-${Date.now()}`,
      code: code.trim().toUpperCase(),
      name: name.trim(),
      level,
      category,
      maxMarks: Number(maxMarks) || 100,
      passMark: Number(passMark) || 50,
      competencies,
    };

    if (editingId) {
      onUpdateSubject(payload);
    } else {
      onAddSubject(payload);
    }
    setShowAdd(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Subjects &amp; CBC Competencies
          </h2>
          <p className="text-xs text-slate-500">
            {allowOlevel && allowAlevel
              ? "Manage O'Level CBC learning outcomes and A'Level Principal / Subsidiary papers"
              : allowOlevel
                ? "Manage O'Level CBC subjects and learning outcomes"
                : "Manage A'Level Principal and Subsidiary papers"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {allowOlevel && allowAlevel && (
            <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 border border-slate-200 text-xs">
              {(
                [
                  { id: 'all', label: 'All Levels' },
                  { id: 'olevel', label: "O'Level CBC" },
                  { id: 'alevel', label: "A'Level" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLevelFilter(opt.id)}
                  className={`px-2.5 py-1 rounded font-medium ${
                    levelFilter === opt.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Subject</span>
            </button>
          )}
        </div>
      </div>

      {showAdd && canEdit && (
        <form
          onSubmit={handleSave}
          className="rounded-lg border border-blue-200 bg-blue-50/40 p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900">
              {editingId ? 'Edit Subject' : 'Register New Subject'}
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Subject Code *</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. MATH or P425"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Subject Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Level</label>
              <select
                value={level}
                onChange={(e) => {
                  const lv = e.target.value as EducationLevel;
                  setLevel(lv);
                  setCategory(lv === 'olevel' ? 'compulsory' : 'principal');
                }}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {allowOlevel && <option value="olevel">O&apos;Level (CBC)</option>}
                {allowAlevel && <option value="alevel">A&apos;Level (UACE)</option>}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SubjectCategory)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                {level === 'olevel' ? (
                  <>
                    <option value="compulsory">Compulsory</option>
                    <option value="elective">Elective</option>
                  </>
                ) : (
                  <>
                    <option value="principal">Principal Subject</option>
                    <option value="subsidiary">Subsidiary Subject</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Max Marks</label>
              <input
                type="number"
                value={maxMarks}
                onChange={(e) => setMaxMarks(Number(e.target.value))}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Pass Mark</label>
              <input
                type="number"
                value={passMark}
                onChange={(e) => setPassMark(Number(e.target.value))}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              CBC Competencies / Learning Outcomes (one per line)
            </label>
            <textarea
              rows={3}
              value={competencyText}
              onChange={(e) => setCompetencyText(e.target.value)}
              placeholder="Enter key competencies assessed in this subject..."
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded border border-slate-300 bg-white px-3.5 py-1.5 font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-blue-900 px-4 py-1.5 font-medium text-white"
            >
              Save Subject
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((sub) => (
          <div
            key={sub.id}
            className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col justify-between gap-3"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-800 shrink-0" />
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">{sub.name}</h3>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {sub.code} · {sub.level === 'olevel' ? "O'Level CBC" : "A'Level"} ·{' '}
                      <span className="capitalize font-sans">{sub.category}</span>
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => openEdit(sub)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-blue-800 hover:bg-blue-50"
                  >
                    Edit
                  </button>
                )}
              </div>

              {sub.competencies.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-slate-600 list-disc pl-4">
                  {sub.competencies.map((comp, i) => (
                    <li key={i}>{comp}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>Max: {sub.maxMarks}</span>
              <span>Pass Mark: {sub.passMark}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

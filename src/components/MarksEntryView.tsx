import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Lock,
  Save,
  Send,
  Upload,
  X,
} from 'lucide-react';
import type {
  ExaminationPeriod,
  MarkEntryItem,
  MarksheetRecord,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  SubjectCombination,
  SubjectDefinition,
  UserAccount,
} from '../types';
import {
  applyRounding,
  computeCbcIdentifier,
  getGradingScaleForLevel,
  resolveGrade,
  validateMarksheetRecord,
} from '../utils/calculations';
import {
  downloadSubjectMarksheetTemplate,
  matchSubjectExcelRows,
  parseExcelFile,
  type SubjectExcelImportResult,
} from '../utils/excel';
import { isTeachingRole } from '../utils/rbac';

interface MarksEntryViewProps {
  currentUser: UserAccount;
  activeExam: ExaminationPeriod;
  activeClass: StreamClass;
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  combinations: SubjectCombination[];
  students: StudentProfile[];
  marksheets: MarksheetRecord[];
  settings: SchoolSettings;
  onSelectClass: (classId: string) => void;
  onSaveMarksheetEntries: (
    examId: string,
    classId: string,
    subjectId: string,
    entries: Record<string, MarkEntryItem>,
    actionNote?: string
  ) => void;
  onSubmitMarksheet: (
    examId: string,
    classId: string,
    subjectId: string,
    entries: Record<string, MarkEntryItem>
  ) => void;
}

export function MarksEntryView({
  currentUser,
  activeExam,
  activeClass,
  classes,
  subjects,
  combinations,
  students,
  marksheets,
  settings,
  onSelectClass,
  onSaveMarksheetEntries,
  onSubmitMarksheet,
}: MarksEntryViewProps) {
  const classSubjects = useMemo(() => {
    const map = new Map(subjects.map((s) => [s.id, s]));
    return activeClass.subjectIds
      .map((id) => map.get(id))
      .filter((s): s is SubjectDefinition => Boolean(s));
  }, [activeClass.subjectIds, subjects]);

  const isHomeroomClassTeacher =
    currentUser.role === 'class_teacher' &&
    (activeClass.classTeacherId === currentUser.id ||
      currentUser.assignedClassIds.includes(activeClass.id));

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() => {
    if (isTeachingRole(currentUser.role)) {
      const assigned = classSubjects.find(
        (s) =>
          activeClass.subjectTeacherMap[s.id] === currentUser.id ||
          currentUser.assignedSubjectIds.includes(s.id)
      );
      if (assigned) return assigned.id;
    }
    return classSubjects[0]?.id ?? '';
  });

  const activeSubject =
    classSubjects.find((s) => s.id === selectedSubjectId) ?? classSubjects[0];

  const existingSheet = useMemo(
    () =>
      marksheets.find(
        (m) =>
          m.examId === activeExam.id &&
          m.classId === activeClass.id &&
          m.subjectId === activeSubject?.id
      ),
    [marksheets, activeExam.id, activeClass.id, activeSubject?.id]
  );

  // Local draft buffer keyed by `${examId}:${classId}:${subjectId}`
  const sheetKey = `${activeExam.id}:${activeClass.id}:${activeSubject?.id ?? ''}`;
  const [draftBuffer, setDraftBuffer] = useState<{
    key: string;
    entries: Record<string, MarkEntryItem>;
  } | null>(null);

  const currentEntries =
    draftBuffer && draftBuffer.key === sheetKey
      ? draftBuffer.entries
      : existingSheet?.entries ?? {};

  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [excelPreview, setExcelPreview] = useState<SubjectExcelImportResult | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const classStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === activeClass.id && s.status === 'active')
        .sort((a, b) => a.admissionNo.localeCompare(b.admissionNo)),
    [students, activeClass.id]
  );

  const comboMap = useMemo(() => new Map(combinations.map((c) => [c.id, c])), [combinations]);

  const isOlevel = activeClass.level === 'olevel';
  const cbc = settings.cbcConfig;
  const aPolicy = settings.alevelPolicy;
  const scale = getGradingScaleForLevel(activeClass.level, settings);

  const sheetStatus = existingSheet?.status ?? 'draft';
  const isLockedForTeacher =
    activeExam.locked ||
    activeExam.published ||
    ((sheetStatus === 'submitted' || sheetStatus === 'approved' || sheetStatus === 'published') &&
      isTeachingRole(currentUser.role));

  const isAssignedToCurrentTeacher =
    !isTeachingRole(currentUser.role) ||
    isHomeroomClassTeacher ||
    (activeSubject &&
      (activeClass.subjectTeacherMap[activeSubject.id] === currentUser.id ||
        currentUser.assignedSubjectIds.includes(activeSubject.id)));

  const readOnly = isLockedForTeacher || !isAssignedToCurrentTeacher;

  const virtualSheet: MarksheetRecord = useMemo(
    () => ({
      id: existingSheet?.id ?? `ms-${sheetKey}`,
      examId: activeExam.id,
      classId: activeClass.id,
      subjectId: activeSubject?.id ?? '',
      teacherId: existingSheet?.teacherId ?? currentUser.id,
      status: sheetStatus,
      entries: currentEntries,
      lastModified: existingSheet?.lastModified ?? new Date().toISOString(),
      auditHistory: existingSheet?.auditHistory ?? [],
    }),
    [existingSheet, sheetKey, activeExam.id, activeClass.id, activeSubject?.id, currentUser.id, sheetStatus, currentEntries]
  );

  const validation = useMemo(
    () =>
      validateMarksheetRecord(
        virtualSheet,
        classStudents,
        activeClass.level,
        activeSubject?.maxMarks ?? 100,
        settings
      ),
    [virtualSheet, classStudents, activeClass.level, activeSubject?.maxMarks, settings]
  );

  const issueByStudent = useMemo(() => {
    const map = new Map<string, string[]>();
    validation.issues.forEach((iss) => {
      const arr = map.get(iss.studentId) ?? [];
      arr.push(`${iss.field}: ${iss.message}`);
      map.set(iss.studentId, arr);
    });
    return map;
  }, [validation.issues]);

  const updateEntry = (studentId: string, patch: Partial<MarkEntryItem>) => {
    if (readOnly) return;
    setSubmitWarning(null);
    const prev = currentEntries[studentId] ?? {};
    const nextEntries: Record<string, MarkEntryItem> = {
      ...currentEntries,
      [studentId]: { ...prev, ...patch },
    };
    setDraftBuffer({ key: sheetKey, entries: nextEntries });
  };

  const handleSaveDraft = () => {
    if (!activeSubject || readOnly) return;
    onSaveMarksheetEntries(
      activeExam.id,
      activeClass.id,
      activeSubject.id,
      currentEntries,
      'Saved marksheet draft'
    );
    setDraftBuffer(null);
  };

  const handleSubmitToDos = () => {
    if (!activeSubject || readOnly) return;
    if (validation.invalidCount > 0) {
      setSubmitWarning(
        `Cannot submit: ${validation.invalidCount} score(s) are invalid or out of range. Please correct highlighted entries first.`
      );
      return;
    }
    if (validation.missingCount > 0) {
      setSubmitWarning(
        `${validation.missingCount} student(s) still have missing marks. Either record scores or mark them Exempt / Did Not Sit before submitting.`
      );
      return;
    }
    onSubmitMarksheet(activeExam.id, activeClass.id, activeSubject.id, currentEntries);
    setDraftBuffer(null);
    setSubmitWarning(null);
  };

  const handleExcelUpload = async (file: File) => {
    if (!activeSubject) return;
    setExcelError(null);
    try {
      const wb = await parseExcelFile(file);
      const sheet = wb.sheets[0];
      if (!sheet || sheet.rows.length < 2) {
        setExcelError('The uploaded Excel file is empty or has no data rows.');
        return;
      }
      const matched = matchSubjectExcelRows(
        sheet.rows,
        classStudents,
        activeClass.level,
        activeSubject.maxMarks,
        settings
      );
      setExcelPreview(matched);
    } catch {
      setExcelError('Unable to parse Excel file. Please upload a valid .xlsx, .xls, or .csv file.');
    }
  };

  const applyExcelPreview = () => {
    if (!excelPreview || readOnly) return;
    const merged: Record<string, MarkEntryItem> = { ...currentEntries };
    excelPreview.rows.forEach((row) => {
      if (row.status === 'matched' && row.matchedStudentId) {
        merged[row.matchedStudentId] = {
          ...merged[row.matchedStudentId],
          ...row.entry,
          exempted: false,
          missed: false,
        };
      }
    });
    setDraftBuffer({ key: sheetKey, entries: merged });
    setExcelPreview(null);
  };

  const hasUnsavedChanges = Boolean(draftBuffer && draftBuffer.key === sheetKey);

  if (!activeSubject) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No subjects are assigned to {activeClass.name}. Configure subject offerings under Classes &amp; Streams first.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Control Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Subject Marks Entry · {activeClass.name}
            </h2>
            <p className="text-xs text-slate-500">
              {activeExam.name} ({activeExam.term} {activeExam.academicYear}) ·{' '}
              {isOlevel
                ? `O'Level CBC (${cbc.formativeWeight}% AoI /${cbc.aoiMaxMark} + ${cbc.summativeWeight}% EoT /${cbc.eotMaxMark})`
                : `A'Level ${activeSubject.category === 'subsidiary' ? 'Subsidiary' : 'Principal'} Paper (/${activeSubject.maxMarks})`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeClass.id}
              onChange={(e) => onSelectClass(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                </option>
              ))}
            </select>

            <select
              value={activeSubject.id}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
            >
              {classSubjects.map((s) => {
                const mine =
                  activeClass.subjectTeacherMap[s.id] === currentUser.id ||
                  currentUser.assignedSubjectIds.includes(s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                    {isTeachingRole(currentUser.role) && (mine || isHomeroomClassTeacher)
                      ? mine
                        ? ' ★ Assigned'
                        : ' ★ Homeroom'
                      : ''}
                  </option>
                );
              })}
            </select>

            <button
              type="button"
              onClick={() => setShowAuditDrawer(true)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <History className="h-3.5 w-3.5" />
              <span>Audit Log ({existingSheet?.auditHistory.length ?? 0})</span>
            </button>
          </div>
        </div>

        {/* Status & Action Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-semibold capitalize ${
                sheetStatus === 'approved' || sheetStatus === 'published'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : sheetStatus === 'submitted'
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : sheetStatus === 'returned'
                      ? 'bg-red-50 text-red-800 border border-red-200'
                      : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              {readOnly && <Lock className="h-3 w-3" />}
              Status: {sheetStatus}
            </span>

            <span className="font-mono tabular-nums text-slate-600">
              Completed: <strong>{validation.completedCount}</strong>/{validation.totalStudents}
            </span>

            {validation.missingCount > 0 && (
              <span className="text-amber-700 font-medium">
                {validation.missingCount} missing
              </span>
            )}
            {validation.invalidCount > 0 && (
              <span className="text-red-700 font-semibold">
                {validation.invalidCount} invalid / out-of-range
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-blue-800 font-medium">Unsaved draft changes</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadSubjectMarksheetTemplate(
                  activeClass,
                  activeSubject,
                  students,
                  currentEntries,
                  settings,
                  true
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export / Template</span>
            </button>

            {!readOnly && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExcelUpload(f);
                    e.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-emerald-700" />
                  <span>Import Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveDraft}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save Draft</span>
                </button>

                <button
                  type="button"
                  onClick={handleSubmitToDos}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Submit to DOS</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* DOS Returned Comment or Lock Notice */}
      {existingSheet?.dosComment && sheetStatus === 'returned' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Returned by Director of Studies for Revision:</p>
            <p className="mt-0.5">{existingSheet.dosComment}</p>
          </div>
        </div>
      )}

      {isHomeroomClassTeacher && (
        <div className="rounded-md border border-blue-200 bg-blue-50/50 px-4 py-2 text-xs text-blue-900">
          <strong>Homeroom Class Teacher Access:</strong> You are authorized to record Continuous Assessment (AoI U1–U3) and End-of-Term marks for {activeClass.name}.
        </div>
      )}

      {!isAssignedToCurrentTeacher && (
        <div className="rounded-md border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs text-slate-700">
          View-only mode: This subject/class is assigned to another teacher. Select an assigned class or subject marked with ★ to edit.
        </div>
      )}

      {isLockedForTeacher && isAssignedToCurrentTeacher && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900 flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            This marksheet is currently <strong>{activeExam.locked ? 'locked by examination period' : sheetStatus}</strong> and protected against edits. Request DOS return if corrections are needed.
          </span>
        </div>
      )}

      {(submitWarning || excelError) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{submitWarning || excelError}</span>
        </div>
      )}

      {/* Spreadsheet Marks Entry Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <th className="py-2.5 px-3">Adm No.</th>
                <th className="py-2.5 px-3">Student Name</th>
                {!isOlevel && <th className="py-2.5 px-3">Comb.</th>}
                {isOlevel ? (
                  <>
                    {cbc.aoiInputMode === 'single_aoi' ? (
                      <th className="py-2.5 px-2 text-center">Classwork (/{cbc.aoiMaxMark})</th>
                    ) : (
                      <>
                        <th className="py-2.5 px-2 text-center">U1 (/{cbc.aoiMaxMark})</th>
                        <th className="py-2.5 px-2 text-center">U2 (/{cbc.aoiMaxMark})</th>
                        <th className="py-2.5 px-2 text-center">U3 (/{cbc.aoiMaxMark})</th>
                      </>
                    )}
                    <th className="py-2.5 px-2 text-right">AoI ({cbc.formativeWeight}%)</th>
                    <th className="py-2.5 px-2 text-center">Exam (/{cbc.eotMaxMark})</th>
                    <th className="py-2.5 px-2 text-right">EoT ({cbc.summativeWeight}%)</th>
                    <th className="py-2.5 px-3 text-right">Final Score</th>
                    <th className="py-2.5 px-2 text-center">ID</th>
                    <th className="py-2.5 px-2 text-center">Grade</th>
                    <th className="py-2.5 px-3">Competency Observation</th>
                  </>
                ) : (
                  <>
                    <th className="py-2.5 px-3 text-center">
                      Mark (/{activeSubject.maxMarks})
                    </th>
                    <th className="py-2.5 px-3 text-center">Grade</th>
                    <th className="py-2.5 px-3 text-center">Points</th>
                    <th className="py-2.5 px-3">Descriptor</th>
                  </>
                )}
                <th className="py-2.5 px-3 text-center">Attendance / Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {classStudents.map((stu) => {
                const entry = currentEntries[stu.id] ?? {};
                const isExempt = Boolean(entry.exempted);
                const isMissed = Boolean(entry.missed);
                const rowIssues = issueByStudent.get(stu.id) ?? [];
                const combo = stu.combinationId ? comboMap.get(stu.combinationId) : undefined;

                // Live calculations per row
                let finalDisplay = '—';
                let gradeDisplay = '—';
                let descriptorDisplay = '—';
                let aoi20Display = '—';
                let eot80Display = '—';
                let idDisplay = '—';
                let pointsDisplay = '—';

                if (isExempt) {
                  finalDisplay = 'EX';
                  gradeDisplay = 'EX';
                  descriptorDisplay = 'Exempted';
                } else if (isMissed) {
                  finalDisplay = 'ABS';
                  gradeDisplay = 'ABS';
                  descriptorDisplay = 'Did Not Sit';
                } else if (isOlevel) {
                  const vals =
                    cbc.aoiInputMode === 'single_aoi'
                      ? [entry.u1]
                      : [entry.u1, entry.u2, entry.u3];
                  const nums = vals
                    .map((v) => Number((v ?? '').trim()))
                    .filter((n, i) => (vals[i] ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 && n <= cbc.aoiMaxMark);
                  const aoiRatio =
                    nums.length > 0 && cbc.aoiMaxMark > 0
                      ? nums.reduce((a, b) => a + b, 0) / nums.length / cbc.aoiMaxMark
                      : null;
                  const aoi20 =
                    aoiRatio !== null
                      ? applyRounding(aoiRatio * cbc.formativeWeight, cbc.roundingMode)
                      : null;
                  const eotNum =
                    (entry.eot ?? '').trim() !== '' &&
                    Number.isFinite(Number(entry.eot)) &&
                    Number(entry.eot) >= 0 &&
                    Number(entry.eot) <= cbc.eotMaxMark
                      ? Number(entry.eot)
                      : null;
                  const eot80 =
                    eotNum !== null && cbc.eotMaxMark > 0
                      ? applyRounding((eotNum / cbc.eotMaxMark) * cbc.summativeWeight, cbc.roundingMode)
                      : null;

                  if (aoi20 !== null) aoi20Display = aoi20.toFixed(1);
                  if (eot80 !== null) eot80Display = eot80.toFixed(1);
                  const cid = computeCbcIdentifier(aoiRatio);
                  if (cid !== null) idDisplay = String(cid);

                  if (aoi20 !== null && eot80 !== null) {
                    const tot = applyRounding(aoi20 + eot80, cbc.roundingMode);
                    finalDisplay = `${tot.toFixed(1)}%`;
                    const band = resolveGrade(tot, scale);
                    gradeDisplay = band.grade;
                    descriptorDisplay = band.label;
                  }
                } else {
                  const rawM = (entry.mark ?? '').trim();
                  const n = rawM !== '' ? Number(rawM) : NaN;
                  if (Number.isFinite(n) && n >= 0 && n <= activeSubject.maxMarks) {
                    const pct = (n / activeSubject.maxMarks) * 100;
                    finalDisplay = `${n}`;
                    if (activeSubject.category === 'subsidiary') {
                      const pass = pct >= aPolicy.subsidiaryPassMark;
                      gradeDisplay = pass ? 'O' : 'F';
                      pointsDisplay = pass ? '1' : '0';
                      descriptorDisplay = pass ? 'Subsidiary Pass' : 'Fail';
                    } else {
                      const band = resolveGrade(pct, scale);
                      gradeDisplay = band.grade;
                      pointsDisplay = String(band.gpa);
                      descriptorDisplay = band.label;
                    }
                  }
                }

                const hasInvalid = rowIssues.some((msg) => !msg.includes('Missing'));

                return (
                  <tr
                    key={stu.id}
                    className={
                      hasInvalid
                        ? 'bg-red-50/60'
                        : rowIssues.length > 0
                          ? 'bg-amber-50/40'
                          : 'hover:bg-slate-50/60'
                    }
                  >
                    <td className="py-2 px-3 font-mono font-medium tabular-nums text-slate-700 whitespace-nowrap">
                      {stu.admissionNo}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                      <div>{stu.fullName}</div>
                      {rowIssues.length > 0 && (
                        <div className="text-[10px] text-red-700 font-normal">
                          {rowIssues[0]}
                        </div>
                      )}
                    </td>
                    {!isOlevel && (
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {combo?.code ?? '—'}
                      </td>
                    )}

                    {isOlevel ? (
                      <>
                        {(cbc.aoiInputMode === 'single_aoi'
                          ? (['u1'] as const)
                          : (['u1', 'u2', 'u3'] as const)
                        ).map((field) => {
                          const val = entry[field] ?? '';
                          const num = Number(val);
                          const bad =
                            val.trim() !== '' &&
                            (!Number.isFinite(num) || num < 0 || num > cbc.aoiMaxMark);
                          return (
                            <td key={field} className="py-1.5 px-1.5 text-center">
                              <input
                                type="text"
                                inputMode="decimal"
                                disabled={readOnly || isExempt || isMissed}
                                value={isExempt || isMissed ? '' : val}
                                placeholder="0–3"
                                onChange={(e) =>
                                  updateEntry(stu.id, { [field]: e.target.value })
                                }
                                className={`w-14 rounded border px-1.5 py-1 text-center font-mono tabular-nums text-xs focus:outline-none ${
                                  bad
                                    ? 'border-red-500 bg-red-50 text-red-900'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-blue-800'
                                } disabled:bg-slate-100 disabled:text-slate-400`}
                              />
                            </td>
                          );
                        })}

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700">
                          {aoi20Display}
                        </td>

                        <td className="py-1.5 px-1.5 text-center">
                          {(() => {
                            const val = entry.eot ?? '';
                            const num = Number(val);
                            const bad =
                              val.trim() !== '' &&
                              (!Number.isFinite(num) || num < 0 || num > cbc.eotMaxMark);
                            return (
                              <input
                                type="text"
                                inputMode="decimal"
                                disabled={readOnly || isExempt || isMissed}
                                value={isExempt || isMissed ? '' : val}
                                placeholder="0–100"
                                onChange={(e) =>
                                  updateEntry(stu.id, { eot: e.target.value })
                                }
                                className={`w-16 rounded border px-1.5 py-1 text-center font-mono tabular-nums text-xs focus:outline-none ${
                                  bad
                                    ? 'border-red-500 bg-red-50 text-red-900'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-blue-800'
                                } disabled:bg-slate-100 disabled:text-slate-400`}
                              />
                            );
                          })()}
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700">
                          {eot80Display}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-slate-900">
                          {finalDisplay}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-slate-700">
                          {idDisplay}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-900">
                          {gradeDisplay}
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            disabled={readOnly}
                            value={entry.competencyObservation ?? ''}
                            placeholder="Optional CBC remark..."
                            onChange={(e) =>
                              updateEntry(stu.id, { competencyObservation: e.target.value })
                            }
                            className="w-44 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-800 focus:outline-none disabled:bg-slate-100"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 px-3 text-center">
                          {(() => {
                            const val = entry.mark ?? '';
                            const num = Number(val);
                            const bad =
                              val.trim() !== '' &&
                              (!Number.isFinite(num) || num < 0 || num > activeSubject.maxMarks);
                            return (
                              <input
                                type="text"
                                inputMode="decimal"
                                disabled={readOnly || isExempt || isMissed}
                                value={isExempt || isMissed ? '' : val}
                                placeholder={`0–${activeSubject.maxMarks}`}
                                onChange={(e) =>
                                  updateEntry(stu.id, { mark: e.target.value })
                                }
                                className={`w-20 rounded border px-2 py-1 text-center font-mono tabular-nums text-xs focus:outline-none ${
                                  bad
                                    ? 'border-red-500 bg-red-50 text-red-900'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-blue-800'
                                } disabled:bg-slate-100 disabled:text-slate-400`}
                              />
                            );
                          })()}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-slate-900">
                          {gradeDisplay}
                        </td>
                        <td className="py-2 px-3 text-center font-mono tabular-nums text-slate-800">
                          {pointsDisplay}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{descriptorDisplay}</td>
                      </>
                    )}

                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <select
                        disabled={readOnly}
                        value={isExempt ? 'exempt' : isMissed ? 'missed' : 'normal'}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateEntry(stu.id, {
                            exempted: v === 'exempt',
                            missed: v === 'missed',
                          });
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 disabled:bg-slate-100"
                      >
                        <option value="normal">Sat Exam</option>
                        <option value="missed">Did Not Sit</option>
                        <option value="exempt">Exempted</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excel Import Match Confirmation Modal */}
      {excelPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[86vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Confirm Excel Marksheet Import · {activeSubject.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Matched by Admission No: {excelPreview.matchedCount} valid ·{' '}
                    {excelPreview.unmatchedCount} unmatched · {excelPreview.duplicateCount} duplicate ·{' '}
                    {excelPreview.invalidCount} out-of-range
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExcelPreview(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto text-xs space-y-3">
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <th className="py-2 px-3">Row</th>
                      <th className="py-2 px-3">Adm No</th>
                      <th className="py-2 px-3">Excel Name</th>
                      <th className="py-2 px-3">Matched Student</th>
                      <th className="py-2 px-3">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {excelPreview.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="py-2 px-3 font-mono text-slate-500">{r.rowNumber}</td>
                        <td className="py-2 px-3 font-mono">{r.admissionNo || '—'}</td>
                        <td className="py-2 px-3">{r.studentName}</td>
                        <td className="py-2 px-3 font-medium">
                          {r.matchedStudentName ?? <span className="text-red-700">No match</span>}
                        </td>
                        <td className="py-2 px-3">
                          {r.status === 'matched' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Ready
                            </span>
                          ) : (
                            <span className="text-red-700">{r.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setExcelPreview(null)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={excelPreview.matchedCount === 0}
                onClick={applyExcelPreview}
                className="rounded-md bg-blue-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-950 disabled:opacity-40"
              >
                Apply {excelPreview.matchedCount} Matched Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Trail Modal */}
      {showAuditDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-bold text-slate-900">
                Marksheet Audit Trail · {activeSubject.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowAuditDrawer(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              {!existingSheet || existingSheet.auditHistory.length === 0 ? (
                <p className="text-slate-500">No saved events for this marksheet yet.</p>
              ) : (
                [...existingSheet.auditHistory].reverse().map((ev) => (
                  <div key={ev.id} className="rounded-md border border-slate-200 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{ev.action}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-600">{ev.details}</p>
                    <p className="text-[11px] text-slate-400">
                      By {ev.actorName} ({ev.actorRole.toUpperCase()})
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

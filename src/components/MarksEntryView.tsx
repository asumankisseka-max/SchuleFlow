import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  History,
  Lock,
  Save,
  Send,
  ShieldCheck,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import type {
  AssessmentComponent,
  ExaminationPeriod,
  MarkEntryItem,
  MarksheetCorrectionRequest,
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
  filterStudentsOfferingSubject,
  getGradingScaleForLevel,
  getMarksheetMissingBreakdown,
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
  exams?: ExaminationPeriod[];
  activeClass: StreamClass;
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  combinations: SubjectCombination[];
  students: StudentProfile[];
  marksheets: MarksheetRecord[];
  correctionRequests?: MarksheetCorrectionRequest[];
  settings: SchoolSettings;
  initialSubjectId?: string;
  initialAssessment?: AssessmentComponent;
  onSelectExam?: (examId: string) => void;
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
    entries: Record<string, MarkEntryItem>,
    missingSummary?: string
  ) => void;
  onRequestCorrection?: (
    examId: string,
    classId: string,
    subjectId: string,
    assessmentScope: AssessmentComponent,
    reason: string
  ) => Promise<void>;
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

const ASSESSMENT_LABELS: Record<AssessmentComponent, string> = {
  all: 'All Assessments (U1–U3 & EoT)',
  u1: 'U1 — Activity 1',
  u2: 'U2 — Activity 2',
  u3: 'U3 — Activity 3',
  eot: 'End of Term (EoT Exam)',
};

export function MarksEntryView({
  currentUser,
  activeExam,
  exams,
  activeClass,
  classes,
  subjects,
  combinations,
  students,
  marksheets,
  correctionRequests = [],
  settings,
  initialSubjectId,
  initialAssessment = 'all',
  onSelectExam,
  onSelectClass,
  onSaveMarksheetEntries,
  onSubmitMarksheet,
  onRequestCorrection,
}: MarksEntryViewProps) {
  const isTeacher = isTeachingRole(currentUser.role);
  const [showAllClassesForTeacher, setShowAllClassesForTeacher] = useState(false);
  const [showClosedExams, setShowClosedExams] = useState(false);

  const examPool = useMemo(() => {
    const list = exams && exams.length > 0 ? exams : [activeExam];
    return list.filter((e) => !e.archived);
  }, [exams, activeExam]);

  const inProgressExams = useMemo(() => {
    const open = examPool.filter((e) => !e.archived && !e.locked && !e.published);
    const classMatching = open.filter((e) => e.classIds.includes(activeClass.id));
    return classMatching.length > 0 ? classMatching : open;
  }, [examPool, activeClass.id]);

  const displayedExams = useMemo(() => {
    if (!showClosedExams && inProgressExams.length > 0) {
      return inProgressExams;
    }
    return examPool.length > 0 ? examPool : [activeExam];
  }, [showClosedExams, inProgressExams, examPool, activeExam]);

  // If teacher lands on a locked/published exam while open in-progress exams exist, auto-snap to the first in-progress exam
  useEffect(() => {
    if (
      !showClosedExams &&
      onSelectExam &&
      inProgressExams.length > 0 &&
      (activeExam.locked || activeExam.published || activeExam.archived)
    ) {
      onSelectExam(inProgressExams[0].id);
    }
  }, [
    showClosedExams,
    onSelectExam,
    inProgressExams,
    activeExam.locked,
    activeExam.published,
    activeExam.archived,
  ]);

  const teacherAssignedClasses = useMemo(() => {
    if (!isTeacher) return classes;
    const assigned = classes.filter((cls) => {
      if (teacherMatchesId(cls.classTeacherId, currentUser)) return true;
      if (currentUser.assignedClassIds.includes(cls.id)) return true;
      return cls.subjectIds.some(
        (subId) =>
          teacherMatchesId(cls.subjectTeacherMap[subId], currentUser) ||
          currentUser.assignedSubjectIds.includes(subId)
      );
    });
    return assigned.length > 0 ? assigned : classes;
  }, [classes, currentUser, isTeacher]);

  const selectableClasses =
    isTeacher && !showAllClassesForTeacher ? teacherAssignedClasses : classes;

  // When a teacher lands on Marks Entry without a specific assigned class selected, snap to their first assigned class
  useEffect(() => {
    if (
      isTeacher &&
      !showAllClassesForTeacher &&
      teacherAssignedClasses.length > 0 &&
      !teacherAssignedClasses.some((c) => c.id === activeClass.id)
    ) {
      onSelectClass(teacherAssignedClasses[0].id);
    }
  }, [isTeacher, showAllClassesForTeacher, teacherAssignedClasses, activeClass.id, onSelectClass]);

  const allClassSubjects = useMemo(() => {
    const map = new Map(subjects.map((s) => [s.id, s]));
    return activeClass.subjectIds
      .map((id) => map.get(id))
      .filter((s): s is SubjectDefinition => Boolean(s));
  }, [activeClass.subjectIds, subjects]);

  const isHomeroomClassTeacher =
    currentUser.role === 'class_teacher' &&
    (teacherMatchesId(activeClass.classTeacherId, currentUser) ||
      currentUser.assignedClassIds.includes(activeClass.id));

  const teacherClassSubjects = useMemo(() => {
    if (!isTeacher || isHomeroomClassTeacher) return allClassSubjects;
    const mine = allClassSubjects.filter(
      (s) =>
        teacherMatchesId(activeClass.subjectTeacherMap[s.id], currentUser) ||
        currentUser.assignedSubjectIds.includes(s.id)
    );
    return mine.length > 0 ? mine : allClassSubjects;
  }, [allClassSubjects, isTeacher, isHomeroomClassTeacher, activeClass.subjectTeacherMap, currentUser]);

  const classSubjects =
    isTeacher && !showAllClassesForTeacher ? teacherClassSubjects : allClassSubjects;

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() => {
    if (initialSubjectId && classSubjects.some((s) => s.id === initialSubjectId)) {
      return initialSubjectId;
    }
    return classSubjects[0]?.id ?? '';
  });

  const [selectedAssessment, setSelectedAssessment] =
    useState<AssessmentComponent>(initialAssessment);

  const [alevelConfirmedClassId, setAlevelConfirmedClassId] = useState<string | null>(() =>
    activeClass.level === 'alevel' && initialAssessment !== 'all' ? activeClass.id : null
  );

  useEffect(() => {
    setSelectedAssessment(initialAssessment);
    if (activeClass.level === 'alevel' && initialAssessment !== 'all') {
      setAlevelConfirmedClassId(activeClass.id);
    }
  }, [initialAssessment, activeClass.id, activeClass.level]);

  const showAlevelPrompt =
    activeClass.level === 'alevel' && alevelConfirmedClassId !== activeClass.id;

  useEffect(() => {
    if (initialSubjectId && classSubjects.some((s) => s.id === initialSubjectId)) {
      setSelectedSubjectId(initialSubjectId);
      return;
    }
    if (!classSubjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(classSubjects[0]?.id ?? '');
    }
  }, [initialSubjectId, classSubjects, selectedSubjectId]);

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

  // Correction Requests linked to this marksheet
  const sheetCorrectionRequests = useMemo(() => {
    if (!activeSubject) return [];
    return correctionRequests
      .filter(
        (r) =>
          r.examId === activeExam.id &&
          r.classId === activeClass.id &&
          r.subjectId === activeSubject.id
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [correctionRequests, activeExam.id, activeClass.id, activeSubject]);

  const approvedCorrection = sheetCorrectionRequests.find((r) => r.status === 'approved');
  const pendingCorrection = sheetCorrectionRequests.find((r) => r.status === 'pending');
  const latestRejected =
    !approvedCorrection && !pendingCorrection
      ? sheetCorrectionRequests.find((r) => r.status === 'rejected')
      : undefined;

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

  // Correction Request modal state
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionScope, setCorrectionScope] = useState<AssessmentComponent>('all');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load ONLY active students in this class who actually offer this subject
  const classStudents = useMemo(() => {
    if (!activeSubject) return [];
    return filterStudentsOfferingSubject(
      students,
      activeSubject.id,
      activeClass,
      combinations
    ).sort((a, b) => a.admissionNo.localeCompare(b.admissionNo));
  }, [students, activeSubject, activeClass, combinations]);

  const totalClassActiveCount = useMemo(
    () => students.filter((s) => s.classId === activeClass.id && s.status === 'active').length,
    [students, activeClass.id]
  );

  const comboMap = useMemo(() => new Map(combinations.map((c) => [c.id, c])), [combinations]);

  const isOlevel = activeClass.level === 'olevel';
  const cbc = settings.cbcConfig;
  const aPolicy = settings.alevelPolicy;
  const scale = getGradingScaleForLevel(activeClass.level, settings);
  const isSingleAoi = isOlevel && cbc.aoiInputMode === 'single_aoi';

  const sheetStatus = existingSheet?.status ?? 'draft';
  const isLockedByWorkflow =
    activeExam.locked ||
    activeExam.published ||
    ((sheetStatus === 'submitted' || sheetStatus === 'approved' || sheetStatus === 'published') &&
      isTeacher);

  const isLockedForTeacher = isLockedByWorkflow && !approvedCorrection;

  const isAssignedToCurrentTeacher =
    !isTeacher ||
    isHomeroomClassTeacher ||
    Boolean(
      activeSubject &&
        (teacherMatchesId(activeClass.subjectTeacherMap[activeSubject.id], currentUser) ||
          currentUser.assignedSubjectIds.includes(activeSubject.id))
    );

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
      version: existingSheet?.version,
      lastModified: existingSheet?.lastModified ?? new Date().toISOString(),
      auditHistory: existingSheet?.auditHistory ?? [],
    }),
    [
      existingSheet,
      sheetKey,
      activeExam.id,
      activeClass.id,
      activeSubject?.id,
      currentUser.id,
      sheetStatus,
      currentEntries,
    ]
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

  const missingBreakdown = useMemo(
    () =>
      getMarksheetMissingBreakdown(
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

  const handleSubmitResults = () => {
    if (!activeSubject || readOnly) return;
    if (classStudents.length === 0) {
      setSubmitWarning('No active students in this class offer this subject.');
      return;
    }
    if (validation.invalidCount > 0) {
      setSubmitWarning(
        `Cannot submit: ${validation.invalidCount} score(s) are invalid or out of range. Please correct highlighted entries first.`
      );
      return;
    }
    const missingSummary =
      missingBreakdown.missingStudentsCount > 0 || missingBreakdown.summaryText
        ? missingBreakdown.summaryText ||
          `${missingBreakdown.missingStudentsCount} student(s) missing marks`
        : undefined;

    onSubmitMarksheet(
      activeExam.id,
      activeClass.id,
      activeSubject.id,
      currentEntries,
      missingSummary
    );
    setDraftBuffer(null);
    setSubmitWarning(null);
  };

  const handleOpenCorrectionModal = () => {
    setCorrectionScope(selectedAssessment);
    setCorrectionReason('');
    setCorrectionError(null);
    setCorrectionModalOpen(true);
  };

  const handleSubmitCorrectionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubject || !onRequestCorrection) return;
    const cleanReason = correctionReason.trim();
    if (cleanReason.length < 5) {
      setCorrectionError('Please provide a clear reason (at least 5 characters) for DOS approval.');
      return;
    }
    setCorrectionSubmitting(true);
    setCorrectionError(null);
    try {
      await onRequestCorrection(
        activeExam.id,
        activeClass.id,
        activeSubject.id,
        correctionScope,
        cleanReason
      );
      setCorrectionModalOpen(false);
    } catch (err: unknown) {
      setCorrectionError(
        err instanceof Error ? err.message : 'Unable to send correction request.'
      );
    } finally {
      setCorrectionSubmitting(false);
    }
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

  // Determine which assessment columns are displayed for focused vs full view
  const showOlevelU1 =
    selectedAssessment === 'all' || selectedAssessment === 'u1';
  const showOlevelU2 =
    !isSingleAoi && (selectedAssessment === 'all' || selectedAssessment === 'u2');
  const showOlevelU3 =
    !isSingleAoi && (selectedAssessment === 'all' || selectedAssessment === 'u3');
  const showOlevelEot =
    selectedAssessment === 'all' || selectedAssessment === 'eot';

  const showAlevelU1 = selectedAssessment === 'all' || selectedAssessment === 'u1';
  const showAlevelU2 = selectedAssessment === 'all' || selectedAssessment === 'u2';
  const showAlevelU3 = selectedAssessment === 'all' || selectedAssessment === 'u3';
  const showAlevelEot = selectedAssessment === 'all' || selectedAssessment === 'eot';

  if (!activeSubject) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No subjects are assigned for marks entry in {activeClass.name}.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top 3-Step Selection & Control Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {activeSubject.name} · {activeClass.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeExam.name} ({activeExam.term} {activeExam.academicYear}) ·{' '}
              {isOlevel
                ? `O'Level CBC (${cbc.formativeWeight}% AoI /${cbc.aoiMaxMark} + ${cbc.summativeWeight}% EoT /${cbc.eotMaxMark})`
                : `A'Level ${activeSubject.category === 'subsidiary' ? 'Subsidiary' : 'Principal'} Paper (/${activeSubject.maxMarks})`}{' '}
              ·{' '}
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                {classStudents.length}
              </span>{' '}
              student{classStudents.length === 1 ? '' : 's'} offering {activeSubject.name}
              {totalClassActiveCount !== classStudents.length && (
                <span className="text-slate-400"> (of {totalClassActiveCount} in class)</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isTeacher && (
              <button
                type="button"
                onClick={() => setShowAllClassesForTeacher((v) => !v)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                {showAllClassesForTeacher ? 'My Assigned Only' : 'View All School Classes'}
              </button>
            )}
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

        {/* 1. Examination (In Progress) -> 2. Class -> 3. Subject -> 4. Assessment Selector Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                htmlFor="marks-exam-select"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                1. Examination (In Progress)
              </label>
              {examPool.length > inProgressExams.length && (
                <label className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={showClosedExams}
                    onChange={(e) => setShowClosedExams(e.target.checked)}
                  />
                  <span>Closed</span>
                </label>
              )}
            </div>
            <select
              id="marks-exam-select"
              value={activeExam.id}
              onChange={(e) => onSelectExam?.(e.target.value)}
              disabled={!onSelectExam}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none disabled:bg-slate-50"
            >
              {displayedExams.map((ex) => {
                const statusTag = ex.published
                  ? 'Final Published'
                  : ex.locked
                    ? 'Locked'
                    : 'In Progress';
                return (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({ex.term}) · {statusTag}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label
              htmlFor="marks-class-select"
              className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
            >
              2. Select Class
            </label>
            <select
              id="marks-class-select"
              value={activeClass.id}
              onChange={(e) => {
                setAlevelConfirmedClassId(null);
                onSelectClass(e.target.value);
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none"
            >
              {selectableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="marks-subject-select"
              className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
            >
              3. Select Subject
            </label>
            <select
              id="marks-subject-select"
              value={activeSubject.id}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none"
            >
              {classSubjects.map((s) => {
                const mine =
                  teacherMatchesId(activeClass.subjectTeacherMap[s.id], currentUser) ||
                  currentUser.assignedSubjectIds.includes(s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                    {isTeacher && (mine || isHomeroomClassTeacher) ? ' · Assigned' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label
              htmlFor="marks-assessment-select"
              className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1"
            >
              4. Assessment Component
            </label>
            <select
              id="marks-assessment-select"
              value={selectedAssessment}
              onChange={(e) => {
                setSelectedAssessment(e.target.value as AssessmentComponent);
                if (activeClass.level === 'alevel') {
                  setAlevelConfirmedClassId(activeClass.id);
                }
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-800 focus:outline-none"
            >
              <option value="all">{ASSESSMENT_LABELS.all}</option>
              <option value="u1">{isSingleAoi ? 'Classwork AoI (U1)' : ASSESSMENT_LABELS.u1}</option>
              {!isSingleAoi && <option value="u2">{ASSESSMENT_LABELS.u2}</option>}
              {!isSingleAoi && <option value="u3">{ASSESSMENT_LABELS.u3}</option>}
              <option value="eot">{ASSESSMENT_LABELS.eot}</option>
            </select>
          </div>
        </div>

        {/* Status & Action Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span
              className={`inline-flex items-center gap-1 font-semibold capitalize ${
                approvedCorrection
                  ? 'text-emerald-800'
                  : sheetStatus === 'approved' || sheetStatus === 'published'
                    ? 'text-emerald-800'
                    : sheetStatus === 'submitted'
                      ? 'text-blue-800'
                      : sheetStatus === 'returned'
                        ? 'text-red-700'
                        : 'text-slate-700'
              }`}
            >
              {readOnly ? <Lock className="h-3.5 w-3.5" /> : approvedCorrection ? <Unlock className="h-3.5 w-3.5" /> : null}
              {approvedCorrection ? 'Unlocked for Correction' : `Status: ${sheetStatus}`}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>

            <span className="font-mono tabular-nums text-slate-500">
              v{existingSheet?.version ?? 1}
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              Complete: <strong>{missingBreakdown.completedStudents}</strong>/{classStudents.length}
            </span>

            {missingBreakdown.missingStudentsCount > 0 && (
              <span className="text-amber-700 font-semibold font-mono tabular-nums">
                {missingBreakdown.missingStudentsCount} student(s) with missing marks
              </span>
            )}
            {validation.invalidCount > 0 && (
              <span className="text-red-700 font-semibold font-mono tabular-nums">
                {validation.invalidCount} invalid / out-of-range
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="text-blue-800 font-medium">Unsaved changes</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadSubjectMarksheetTemplate(
                  activeClass,
                  activeSubject,
                  classStudents,
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
                  onClick={handleSubmitResults}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{approvedCorrection ? 'Resubmit Corrected Results' : 'Submit Results'}</span>
                </button>
              </>
            )}

            {isLockedForTeacher && isAssignedToCurrentTeacher && onRequestCorrection && !pendingCorrection && (
              <button
                type="button"
                onClick={handleOpenCorrectionModal}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
              >
                <Unlock className="h-3.5 w-3.5" />
                <span>Request DOS Approval to Re-correct</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Approved Correction Unlock Banner */}
      {approvedCorrection && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-950 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Correction Approved by DOS ({approvedCorrection.reviewedByName ?? 'Director of Studies'})
            </p>
            <p className="mt-0.5 text-emerald-900">
              You are unlocked to re-edit marks for{' '}
              <strong>{ASSESSMENT_LABELS[approvedCorrection.assessmentScope]}</strong>. Update the scores below and click{' '}
              <strong>Resubmit Corrected Results</strong> to load the corrected results back into the system.
            </p>
          </div>
        </div>
      )}

      {/* Pending DOS Approval Banner */}
      {isLockedForTeacher && pendingCorrection && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex items-start gap-2.5">
          <Clock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Correction Request Sent — Awaiting DOS Approval
            </p>
            <p className="mt-0.5 text-amber-900">
              Scope: <strong>{ASSESSMENT_LABELS[pendingCorrection.assessmentScope]}</strong> · Reason: &ldquo;{pendingCorrection.reason}&rdquo;. As soon as the DOS clicks Approve on their dashboard, this sheet will unlock automatically for editing.
            </p>
          </div>
        </div>
      )}

      {/* Declined Correction Request Notice */}
      {isLockedForTeacher && latestRejected && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Previous Correction Request Declined by {latestRejected.reviewedByName ?? 'DOS'}</p>
            <p className="mt-0.5">{latestRejected.reviewNote || 'No note provided.'} You may submit a new request with updated details if needed.</p>
          </div>
        </div>
      )}

      {/* DOS Returned Comment */}
      {existingSheet?.dosComment && sheetStatus === 'returned' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Returned by Director of Studies for Revision:</p>
            <p className="mt-0.5">{existingSheet.dosComment}</p>
          </div>
        </div>
      )}

      {/* Missing Marks Alert Banner */}
      {classStudents.length > 0 && (missingBreakdown.missingStudentsCount > 0 || missingBreakdown.summaryText) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3 text-xs text-amber-950 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                Missing Marks Alert · {missingBreakdown.summaryText || `${missingBreakdown.missingStudentsCount} student(s) incomplete`}
              </p>
              <p className="mt-0.5 text-amber-900">
                Students with missing marks:{' '}
                <span className="font-medium">
                  {missingBreakdown.missingStudentNames.slice(0, 6).join(', ')}
                  {missingBreakdown.missingStudentNames.length > 6
                    ? ` +${missingBreakdown.missingStudentNames.length - 6} more`
                    : ''}
                </span>
                . You can submit available marks directly into the system; missing marks remain alerted on your dashboard and the DOS dashboard until entered.
              </p>
            </div>
          </div>
        </div>
      )}

      {!isAssignedToCurrentTeacher && (
        <div className="rounded-md border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs text-slate-700">
          View-only mode: This subject/class is assigned to another teacher.
        </div>
      )}

      {isLockedForTeacher && isAssignedToCurrentTeacher && !pendingCorrection && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              Results are loaded and locked ({activeExam.locked ? 'exam period locked' : `status: ${sheetStatus}`}). To change any student&apos;s submitted marks, request DOS approval.
            </span>
          </div>
        </div>
      )}

      {(submitWarning || excelError) && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{submitWarning || excelError}</span>
        </div>
      )}

      {/* A'Level Assessment & In-Progress Examination Selection Prompt */}
      {showAlevelPrompt && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Choose A&apos;Level Examination &amp; Assessment ({activeClass.name})
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Confirm the in-progress examination issued by Admin/DOS and select whether you are entering U1, U2, U3, or End of Term (EoT) marks.
              </p>
            </div>
            {inProgressExams.length === 0 ? (
              <span className="text-xs font-semibold text-amber-800">
                No open examination in progress — ask Admin/DOS to reopen or create an exam
              </span>
            ) : (
              <span className="text-xs font-medium text-blue-900">
                In Progress: <strong>{activeExam.name}</strong> ({activeExam.term} {activeExam.academicYear})
              </span>
            )}
          </div>

          {onSelectExam && inProgressExams.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">In-Progress Exam:</span>
              {inProgressExams.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => onSelectExam(ex.id)}
                  className={`rounded-md px-3 py-1.5 font-medium whitespace-nowrap shrink-0 border ${
                    ex.id === activeExam.id
                      ? 'border-blue-900 bg-blue-900 text-white'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {ex.name} ({ex.term})
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'u1', label: 'U1 — Activity 1' },
                { id: 'u2', label: 'U2 — Activity 2' },
                { id: 'u3', label: 'U3 — Activity 3' },
                { id: 'eot', label: 'EoT — End of Term' },
                { id: 'all', label: 'All Assessments (U1–U3 & EoT)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSelectedAssessment(opt.id);
                  setAlevelConfirmedClassId(activeClass.id);
                }}
                className={`rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors ${
                  selectedAssessment === opt.id
                    ? 'border-blue-900 bg-blue-900 text-white'
                    : 'border-blue-200 bg-white text-blue-950 hover:bg-blue-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Spreadsheet Marks Entry Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {classStudents.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No active students in <strong>{activeClass.name}</strong> currently offer{' '}
            <strong>{activeSubject.name}</strong>. Check student combinations or subject offerings in Students Directory.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <th className="py-2.5 px-3">Adm No.</th>
                  <th className="py-2.5 px-3">Student Name</th>
                  {!isOlevel && <th className="py-2.5 px-3">Comb.</th>}
                  {isOlevel ? (
                    <>
                      {showOlevelU1 && (
                        <th className="py-2.5 px-2 text-center">
                          {isSingleAoi ? `Classwork (/${cbc.aoiMaxMark})` : `U1 (/${cbc.aoiMaxMark})`}
                        </th>
                      )}
                      {showOlevelU2 && (
                        <th className="py-2.5 px-2 text-center">U2 (/{cbc.aoiMaxMark})</th>
                      )}
                      {showOlevelU3 && (
                        <th className="py-2.5 px-2 text-center">U3 (/{cbc.aoiMaxMark})</th>
                      )}
                      <th className="py-2.5 px-2 text-right">AoI ({cbc.formativeWeight}%)</th>
                      {showOlevelEot && (
                        <th className="py-2.5 px-2 text-center">EoT Exam (/{cbc.eotMaxMark})</th>
                      )}
                      <th className="py-2.5 px-2 text-right">EoT ({cbc.summativeWeight}%)</th>
                      <th className="py-2.5 px-3 text-right">Final</th>
                      <th className="py-2.5 px-2 text-center">ID</th>
                      <th className="py-2.5 px-2 text-center">Grade</th>
                      {selectedAssessment === 'all' && (
                        <th className="py-2.5 px-3">Competency Observation</th>
                      )}
                    </>
                  ) : (
                    <>
                      {showAlevelU1 && (
                        <th className="py-2.5 px-2 text-center">U1 (/{activeSubject.maxMarks})</th>
                      )}
                      {showAlevelU2 && (
                        <th className="py-2.5 px-2 text-center">U2 (/{activeSubject.maxMarks})</th>
                      )}
                      {showAlevelU3 && (
                        <th className="py-2.5 px-2 text-center">U3 (/{activeSubject.maxMarks})</th>
                      )}
                      {showAlevelEot && (
                        <th className="py-2.5 px-3 text-center">
                          EoT Mark (/{activeSubject.maxMarks})
                        </th>
                      )}
                      <th className="py-2.5 px-3 text-center">Grade</th>
                      <th className="py-2.5 px-3 text-center">Points</th>
                      <th className="py-2.5 px-3">Descriptor</th>
                    </>
                  )}
                  <th className="py-2.5 px-3 text-center">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {classStudents.map((stu) => {
                  const entry = currentEntries[stu.id] ?? {};
                  const isExempt = Boolean(entry.exempted);
                  const isMissed = Boolean(entry.missed);
                  const rowIssues = issueByStudent.get(stu.id) ?? [];
                  const combo = stu.combinationId ? comboMap.get(stu.combinationId) : undefined;

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
                    const vals = isSingleAoi ? [entry.u1] : [entry.u1, entry.u2, entry.u3];
                    const nums = vals
                      .map((v) => Number((v ?? '').trim()))
                      .filter(
                        (n, i) =>
                          (vals[i] ?? '').trim() !== '' &&
                          Number.isFinite(n) &&
                          n >= 0 &&
                          n <= cbc.aoiMaxMark
                      );
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
                    const activeFieldRaw =
                      selectedAssessment === 'u1'
                        ? (entry.u1 ?? '')
                        : selectedAssessment === 'u2'
                          ? (entry.u2 ?? '')
                          : selectedAssessment === 'u3'
                            ? (entry.u3 ?? '')
                            : (entry.mark ?? entry.eot ?? '');
                    const rawM = activeFieldRaw.trim();
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
                          <div className="text-[10px] text-amber-800 font-normal">
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
                          {(['u1', 'u2', 'u3'] as const).map((field) => {
                            if (field === 'u1' && !showOlevelU1) return null;
                            if (field === 'u2' && !showOlevelU2) return null;
                            if (field === 'u3' && !showOlevelU3) return null;
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
                                  placeholder={`0–${cbc.aoiMaxMark}`}
                                  onChange={(e) =>
                                    updateEntry(stu.id, { [field]: e.target.value })
                                  }
                                  className={`w-16 rounded border px-1.5 py-1 text-center font-mono tabular-nums text-xs focus:outline-none ${
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

                          {showOlevelEot && (
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
                                    placeholder={`0–${cbc.eotMaxMark}`}
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
                          )}

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
                          {selectedAssessment === 'all' && (
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
                          )}
                        </>
                      ) : (
                        <>
                          {(['u1', 'u2', 'u3'] as const).map((field) => {
                            const visible =
                              (field === 'u1' && showAlevelU1) ||
                              (field === 'u2' && showAlevelU2) ||
                              (field === 'u3' && showAlevelU3);
                            if (!visible) return null;
                            const val = entry[field] ?? '';
                            const num = Number(val);
                            const bad =
                              val.trim() !== '' &&
                              (!Number.isFinite(num) || num < 0 || num > activeSubject.maxMarks);
                            return (
                              <td key={field} className="py-1.5 px-3 text-center">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  disabled={readOnly || isExempt || isMissed}
                                  value={isExempt || isMissed ? '' : val}
                                  placeholder={`0–${activeSubject.maxMarks}`}
                                  onChange={(e) =>
                                    updateEntry(stu.id, { [field]: e.target.value })
                                  }
                                  className={`w-20 rounded border px-2 py-1 text-center font-mono tabular-nums text-xs focus:outline-none ${
                                    bad
                                      ? 'border-red-500 bg-red-50 text-red-900'
                                      : 'border-slate-300 bg-white text-slate-900 focus:border-blue-800'
                                  } disabled:bg-slate-100 disabled:text-slate-400`}
                                />
                              </td>
                            );
                          })}

                          {showAlevelEot && (
                            <td className="py-1.5 px-3 text-center">
                              {(() => {
                                const val = entry.mark ?? entry.eot ?? '';
                                const num = Number(val);
                                const bad =
                                  val.trim() !== '' &&
                                  (!Number.isFinite(num) ||
                                    num < 0 ||
                                    num > activeSubject.maxMarks);
                                return (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    disabled={readOnly || isExempt || isMissed}
                                    value={isExempt || isMissed ? '' : val}
                                    placeholder={`0–${activeSubject.maxMarks}`}
                                    onChange={(e) =>
                                      updateEntry(stu.id, {
                                        mark: e.target.value,
                                        eot: e.target.value,
                                      })
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
                          )}
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
        )}
      </div>

      {/* Request DOS Correction Approval Modal */}
      {correctionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Request DOS Correction Approval
                </h3>
                <p className="text-xs text-slate-500">
                  {activeClass.name} · {activeSubject.name} ({activeExam.name})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCorrectionModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCorrectionRequest} className="p-5 space-y-4 text-xs">
              {correctionError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {correctionError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assessment Component to Correct
                </label>
                <select
                  value={correctionScope}
                  onChange={(e) => setCorrectionScope(e.target.value as AssessmentComponent)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="all">{ASSESSMENT_LABELS.all}</option>
                  <option value="u1">{isSingleAoi ? 'Classwork AoI (U1)' : ASSESSMENT_LABELS.u1}</option>
                  {!isSingleAoi && <option value="u2">{ASSESSMENT_LABELS.u2}</option>}
                  {!isSingleAoi && <option value="u3">{ASSESSMENT_LABELS.u3}</option>}
                  <option value="eot">{ASSESSMENT_LABELS.eot}</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason for Re-correcting Submitted Marks *
                </label>
                <textarea
                  rows={3}
                  required
                  value={correctionReason}
                  onChange={(e) => {
                    setCorrectionReason(e.target.value);
                    setCorrectionError(null);
                  }}
                  placeholder="e.g. Need to enter missing U3 mark for Okot Emmanuel or correct mark transcription error."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCorrectionModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={correctionSubmitting}
                  className="rounded-md bg-blue-900 px-4 py-1.5 font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
                >
                  {correctionSubmitting ? 'Sending Request...' : 'Send Request to DOS'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

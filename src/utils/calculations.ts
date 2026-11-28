import type {
  CbcConfig,
  ClassPerformanceSummary,
  EducationLevel,
  ExamClass,
  ExaminationPeriod,
  GradeBand,
  MarkEntryItem,
  MarkValidationIssue,
  MarksheetRecord,
  MarksheetValidationSummary,
  SchoolDatabase,
  SchoolSettings,
  StreamClass,
  StudentCalculatedResult,
  StudentProfile,
  StudentRecord,
  StudentTermHistoryPoint,
  SubjectCombination,
  SubjectConfig,
  SubjectStudentResult,
  SubjectSummary,
} from '../types';

export function doesStudentOfferSubject(
  student: StudentProfile,
  subjectId: string,
  streamClass: StreamClass,
  combinations: SubjectCombination[] = []
): boolean {
  if (student.offeredSubjectIds && student.offeredSubjectIds.length > 0) {
    return student.offeredSubjectIds.includes(subjectId);
  }
  if (streamClass.level === 'alevel' && student.combinationId) {
    const combo = combinations.find((c) => c.id === student.combinationId);
    if (combo) {
      return (
        combo.principalSubjectIds.includes(subjectId) ||
        combo.subsidiarySubjectIds.includes(subjectId)
      );
    }
  }
  return streamClass.subjectIds.includes(subjectId);
}

export function filterStudentsOfferingSubject(
  students: StudentProfile[],
  subjectId: string,
  streamClass: StreamClass,
  combinations: SubjectCombination[] = []
): StudentProfile[] {
  return students.filter(
    (s) =>
      s.classId === streamClass.id &&
      s.status === 'active' &&
      doesStudentOfferSubject(s, subjectId, streamClass, combinations)
  );
}

export interface MarksheetMissingBreakdown {
  totalStudents: number;
  completedStudents: number;
  missingStudentsCount: number;
  invalidCount: number;
  missingStudentNames: string[];
  missingByAssessment: {
    u1: number;
    u2: number;
    u3: number;
    eot: number;
  };
  enteredByAssessment: {
    u1: number;
    u2: number;
    u3: number;
    eot: number;
  };
  summaryText: string;
}

export function getMarksheetMissingBreakdown(
  marksheet: MarksheetRecord | undefined,
  offeringStudents: StudentProfile[],
  level: EducationLevel,
  subjectMaxMarks: number,
  settings: SchoolSettings
): MarksheetMissingBreakdown {
  const activeStudents = offeringStudents.filter((s) => s.status === 'active');
  const validation = validateMarksheetRecord(
    marksheet,
    activeStudents,
    level,
    subjectMaxMarks,
    settings
  );

  const missingByAssessment = { u1: 0, u2: 0, u3: 0, eot: 0 };
  const enteredByAssessment = { u1: 0, u2: 0, u3: 0, eot: 0 };
  const missingNamesSet = new Set<string>();
  const singleAoi = settings.cbcConfig.aoiInputMode === 'single_aoi';

  let assessedStudentsCount = 0;
  for (const stu of activeStudents) {
    const entry = marksheet?.entries?.[stu.id];
    if (entry?.exempted || entry?.missed) {
      assessedStudentsCount += 1;
      continue;
    }

    if (level === 'olevel') {
      const hasU1 = Boolean((entry?.u1 ?? '').trim());
      const hasU2 = Boolean((entry?.u2 ?? '').trim());
      const hasU3 = Boolean((entry?.u3 ?? '').trim());
      const hasEot = Boolean((entry?.eot ?? '').trim());

      if (hasU1) enteredByAssessment.u1 += 1;
      else missingByAssessment.u1 += 1;

      if (!singleAoi) {
        if (hasU2) enteredByAssessment.u2 += 1;
        else missingByAssessment.u2 += 1;

        if (hasU3) enteredByAssessment.u3 += 1;
        else missingByAssessment.u3 += 1;
      }

      if (hasEot) enteredByAssessment.eot += 1;
      else missingByAssessment.eot += 1;

      const isComplete = singleAoi
        ? hasU1 && hasEot
        : hasU1 && hasU2 && hasU3 && hasEot;
      if (!isComplete) {
        missingNamesSet.add(stu.fullName);
      } else {
        assessedStudentsCount += 1;
      }
    } else {
      const hasU1 = Boolean((entry?.u1 ?? '').trim());
      const hasU2 = Boolean((entry?.u2 ?? '').trim());
      const hasU3 = Boolean((entry?.u3 ?? '').trim());
      const hasEot = Boolean((entry?.mark ?? '').trim() || (entry?.eot ?? '').trim());

      if (hasU1) enteredByAssessment.u1 += 1;
      else missingByAssessment.u1 += 1;
      if (hasU2) enteredByAssessment.u2 += 1;
      else missingByAssessment.u2 += 1;
      if (hasU3) enteredByAssessment.u3 += 1;
      else missingByAssessment.u3 += 1;
      if (hasEot) enteredByAssessment.eot += 1;
      else missingByAssessment.eot += 1;

      if (!hasEot) {
        missingNamesSet.add(stu.fullName);
      } else {
        assessedStudentsCount += 1;
      }
    }
  }

  // For A'Level, only flag u1/u2/u3 missing if that formative component was partially started
  if (level === 'alevel') {
    if (enteredByAssessment.u1 === 0) missingByAssessment.u1 = 0;
    if (enteredByAssessment.u2 === 0) missingByAssessment.u2 = 0;
    if (enteredByAssessment.u3 === 0) missingByAssessment.u3 = 0;
  }

  const parts: string[] = [];
  if (missingByAssessment.u1 > 0) parts.push(`U1: ${missingByAssessment.u1} missing`);
  if (missingByAssessment.u2 > 0) parts.push(`U2: ${missingByAssessment.u2} missing`);
  if (missingByAssessment.u3 > 0) parts.push(`U3: ${missingByAssessment.u3} missing`);
  if (missingByAssessment.eot > 0) parts.push(`EoT: ${missingByAssessment.eot} missing`);

  return {
    totalStudents: activeStudents.length,
    completedStudents: assessedStudentsCount,
    missingStudentsCount: missingNamesSet.size,
    invalidCount: validation.invalidCount,
    missingStudentNames: Array.from(missingNamesSet),
    missingByAssessment,
    enteredByAssessment,
    summaryText: parts.join(' · '),
  };
}

export function getGradingScaleForLevel(
  level: EducationLevel,
  settings: SchoolSettings
): GradeBand[] {
  return level === 'olevel' ? settings.olevelGradingScale : settings.alevelGradingScale;
}

export function resolveGrade(percentage: number, scale: GradeBand[]): GradeBand {
  const sorted = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);
  for (const band of sorted) {
    if (percentage >= band.minPercentage) {
      return band;
    }
  }
  return (
    sorted[sorted.length - 1] ?? {
      grade: 'F',
      minPercentage: 0,
      label: 'Needs Support',
      gpa: 0,
    }
  );
}

export function applyRounding(
  value: number,
  mode: SchoolSettings['cbcConfig']['roundingMode']
): number {
  if (mode === 'whole') return Math.round(value);
  if (mode === 'two_decimals') return Number(value.toFixed(2));
  return Number(value.toFixed(1));
}

export function computeCbcIdentifier(avgRatio: number | null): number | null {
  if (avgRatio === null) return null;
  if (avgRatio >= 0.8) return 3; // Outstanding
  if (avgRatio >= 0.5) return 2; // Moderate
  return 1; // Basic
}

function parseStrictNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return num;
}

function parseClampedNumber(raw: string | undefined, maxCap?: number): number | null {
  const num = parseStrictNumber(raw);
  if (num === null || num < 0) return null;
  if (maxCap !== undefined && num > maxCap) return maxCap;
  return num;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  const variance = sqDiffs.reduce((acc, v) => acc + v, 0) / values.length;
  return Math.sqrt(variance);
}

function buildAutoRemark(
  name: string,
  level: EducationLevel,
  percentage: number,
  gradeBand: GradeBand,
  failedSubjects: string[],
  strongestSubject: string | null,
  weakestSubject: string | null,
  assessedCount: number,
  totalPoints?: number
): string {
  const firstName = name.trim().split(/\s+/)[0] || 'Student';
  if (assessedCount === 0) {
    return `Assessment marks for ${firstName} are currently being recorded.`;
  }
  if (level === 'alevel' && totalPoints !== undefined) {
    if (totalPoints >= 16) {
      return `Outstanding A'Level performance (${totalPoints} pts). Strong mastery in ${strongestSubject ?? 'core principals'}.`;
    }
    if (totalPoints >= 12) {
      return `Commendable A'Level progress (${totalPoints} pts). Additional practice in ${weakestSubject ?? 'borderline papers'} will raise total points.`;
    }
    if (failedSubjects.length === 0) {
      return `Satisfactory principal attainment (${totalPoints} pts). Aim for higher distinctions next term.`;
    }
    return `Requires focused academic coaching in ${failedSubjects.slice(0, 2).join(', ')} to secure principal passes.`;
  }
  if (percentage >= 80) {
    return strongestSubject
      ? `Exemplary competency performance across subjects, excelling particularly in ${strongestSubject}.`
      : `Exemplary performance (${gradeBand.label}). Keep up the high standard.`;
  }
  if (percentage >= 65) {
    return strongestSubject && weakestSubject && strongestSubject !== weakestSubject
      ? `Commendable progress, especially in ${strongestSubject}. Further practice in ${weakestSubject} will elevate overall standing.`
      : `Solid and consistent examination performance across all subjects.`;
  }
  if (failedSubjects.length === 0) {
    return weakestSubject
      ? `Satisfactory attainment (${gradeBand.label}). Additional guided revision in ${weakestSubject} is encouraged.`
      : `Satisfactory performance. Consistent daily practice will strengthen results.`;
  }
  if (failedSubjects.length === 1) {
    return `Achieved required standard in most subjects; targeted reinforcement recommended in ${failedSubjects[0]}.`;
  }
  return `Requires structured academic support and focused revision in ${failedSubjects.slice(0, 3).join(', ')}.`;
}

function buildHeadTeacherRemark(
  level: EducationLevel,
  percentage: number,
  assessedCount: number,
  totalPoints: number
): string {
  if (assessedCount === 0) return 'Awaiting full term assessment scores.';
  if (level === 'alevel') {
    if (totalPoints >= 16) return 'Excellent UACE-track performance. Keep aiming for university excellence.';
    if (totalPoints >= 11) return 'Promising term progress. Push for stronger principal grades next term.';
    return 'Closer revision and consultation with subject teachers strongly advised.';
  }
  if (percentage >= 80) return 'Excellent CBC competency attainment. Keep aiming higher.';
  if (percentage >= 65) return 'Good progress shown this term. Aim for exceptional mastery next term.';
  if (percentage >= 50) return 'Fair effort. Greater consistency across AoI activities will yield stronger grades.';
  return 'Needs closer academic supervision and holiday revision.';
}

/**
 * Validates a single subject marksheet against active class students and level rules.
 */
export function validateMarksheetRecord(
  marksheet: MarksheetRecord | undefined,
  students: StudentProfile[],
  level: EducationLevel,
  subjectMaxMarks: number,
  settings: SchoolSettings
): MarksheetValidationSummary {
  const activeStudents = students.filter((s) => s.status === 'active');
  const issues: MarkValidationIssue[] = [];
  let completedCount = 0;
  let missingCount = 0;
  let invalidCount = 0;
  let exemptOrMissedCount = 0;

  const cbc = settings.cbcConfig;

  for (const stu of activeStudents) {
    const entry: MarkEntryItem | undefined = marksheet?.entries[stu.id];
    if (entry?.exempted || entry?.missed) {
      exemptOrMissedCount += 1;
      completedCount += 1;
      continue;
    }

    if (level === 'olevel') {
      const aoiFields: Array<{ key: 'u1' | 'u2' | 'u3'; label: string; val: string | undefined }> =
        cbc.aoiInputMode === 'single_aoi'
          ? [{ key: 'u1', label: 'Classwork AoI', val: entry?.u1 }]
          : [
              { key: 'u1', label: 'U1', val: entry?.u1 },
              { key: 'u2', label: 'U2', val: entry?.u2 },
              { key: 'u3', label: 'U3', val: entry?.u3 },
            ];

      let studentHasInvalid = false;
      let hasAnyAoi = false;

      for (const f of aoiFields) {
        const raw = (f.val ?? '').trim();
        if (!raw) continue;
        hasAnyAoi = true;
        const n = parseStrictNumber(raw);
        if (n === null) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: f.label,
            type: 'invalid_number',
            message: `${f.label} "${raw}" is not a valid number.`,
          });
        } else if (n < 0 || n > cbc.aoiMaxMark) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: f.label,
            type: 'out_of_range',
            message: `${f.label} (${n}) must be between 0 and ${cbc.aoiMaxMark}.`,
          });
        }
      }

      const rawEot = (entry?.eot ?? '').trim();
      if (rawEot) {
        const nEot = parseStrictNumber(rawEot);
        if (nEot === null) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: 'EoT Exam',
            type: 'invalid_number',
            message: `EoT Exam "${rawEot}" is not a valid number.`,
          });
        } else if (nEot < 0 || nEot > cbc.eotMaxMark) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: 'EoT Exam',
            type: 'out_of_range',
            message: `EoT Exam (${nEot}) must be between 0 and ${cbc.eotMaxMark}.`,
          });
        }
      }

      if (!hasAnyAoi || !rawEot) {
        missingCount += 1;
        issues.push({
          studentId: stu.id,
          admissionNo: stu.admissionNo,
          studentName: stu.fullName,
          field: !hasAnyAoi && !rawEot ? 'AoI & EoT' : !hasAnyAoi ? 'AoI' : 'EoT Exam',
          type: 'missing',
          message: !hasAnyAoi && !rawEot
            ? 'Missing both formative AoI and End of Term exam mark.'
            : !hasAnyAoi
              ? 'Missing formative AoI activity score.'
              : 'Missing End of Term exam mark.',
        });
      } else if (!studentHasInvalid) {
        completedCount += 1;
      }
    } else {
      const alevelFormativeFields: Array<{ key: 'u1' | 'u2' | 'u3'; label: string }> = [
        { key: 'u1', label: 'U1' },
        { key: 'u2', label: 'U2' },
        { key: 'u3', label: 'U3' },
      ];
      let studentHasInvalid = false;

      for (const f of alevelFormativeFields) {
        const rawForm = (entry?.[f.key] ?? '').trim();
        if (!rawForm) continue;
        const nForm = parseStrictNumber(rawForm);
        if (nForm === null) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: f.label,
            type: 'invalid_number',
            message: `${f.label} "${rawForm}" is not a valid number.`,
          });
        } else if (nForm < 0 || nForm > subjectMaxMarks) {
          studentHasInvalid = true;
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: f.label,
            type: 'out_of_range',
            message: `${f.label} (${nForm}) exceeds valid range 0–${subjectMaxMarks}.`,
          });
        }
      }

      const raw = (entry?.mark ?? entry?.eot ?? '').trim();
      if (!raw) {
        missingCount += 1;
        issues.push({
          studentId: stu.id,
          admissionNo: stu.admissionNo,
          studentName: stu.fullName,
          field: 'EoT Mark',
          type: 'missing',
          message: 'Missing End of Term assessment mark.',
        });
      } else {
        const n = parseStrictNumber(raw);
        if (n === null) {
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: 'EoT Mark',
            type: 'invalid_number',
            message: `Mark "${raw}" is not a valid number.`,
          });
        } else if (n < 0 || n > subjectMaxMarks) {
          invalidCount += 1;
          issues.push({
            studentId: stu.id,
            admissionNo: stu.admissionNo,
            studentName: stu.fullName,
            field: 'EoT Mark',
            type: 'out_of_range',
            message: `Mark (${n}) exceeds valid range 0–${subjectMaxMarks}.`,
          });
        } else if (!studentHasInvalid) {
          completedCount += 1;
        }
      }
    }
  }

  return {
    isReadyForSubmission: activeStudents.length > 0 && missingCount === 0 && invalidCount === 0,
    totalStudents: activeStudents.length,
    completedCount,
    missingCount,
    invalidCount,
    exemptOrMissedCount,
    issues,
  };
}

/**
 * Builds an ExamClass projection from relational SchoolDatabase for a given examId + classId,
 * then computes full ClassPerformanceSummary.
 */
export function buildExamClassView(
  exam: ExaminationPeriod,
  streamClass: StreamClass,
  db: SchoolDatabase
): {
  examClass: ExamClass;
  entryMap: Record<string, Record<string, MarkEntryItem>>;
} {
  const userMap = new Map(db.users.map((u) => [u.id, u]));
  const subjectMap = new Map(db.subjects.map((s) => [s.id, s]));
  const comboMap = new Map(db.combinations.map((c) => [c.id, c]));

  const subjects: SubjectConfig[] = streamClass.subjectIds
    .map((sid): SubjectConfig | null => {
      const def = subjectMap.get(sid);
      if (!def) return null;
      const teacherId = streamClass.subjectTeacherMap[sid];
      return {
        id: def.id,
        code: def.code,
        name: def.name,
        category: def.category,
        maxMarks: def.maxMarks,
        passMark: def.passMark,
        teacher: teacherId ? userMap.get(teacherId)?.name : undefined,
        competencies: def.competencies,
      };
    })
    .filter((s): s is SubjectConfig => s !== null);

  const classMarksheets = db.marksheets.filter(
    (m) => m.examId === exam.id && m.classId === streamClass.id
  );
  const marksheetBySubject = new Map(classMarksheets.map((m) => [m.subjectId, m]));

  const entryMap: Record<string, Record<string, MarkEntryItem>> = {};
  const classStudents = db.students.filter(
    (st) => st.classId === streamClass.id && st.status === 'active'
  );

  const students: StudentRecord[] = classStudents.map((stu) => {
    const marks: Record<string, string> = {};
    const cbcMarks: Record<string, { u1: string; u2: string; u3: string; eot: string }> = {};
    entryMap[stu.id] = {};
    const offeredSubjectIds: string[] = [];

    for (const sub of subjects) {
      if (!doesStudentOfferSubject(stu, sub.id, streamClass, db.combinations)) {
        continue;
      }
      offeredSubjectIds.push(sub.id);
      const ms = marksheetBySubject.get(sub.id);
      const entry = ms?.entries[stu.id];
      if (entry) {
        entryMap[stu.id][sub.id] = entry;
      }
      if (streamClass.level === 'olevel') {
        cbcMarks[sub.id] = {
          u1: entry?.u1 ?? '',
          u2: entry?.u2 ?? '',
          u3: entry?.u3 ?? '',
          eot: entry?.eot ?? '',
        };
      } else {
        marks[sub.id] = entry?.mark ?? entry?.eot ?? '';
      }
    }

    const combo = stu.combinationId ? comboMap.get(stu.combinationId) : undefined;
    const remarks = db.studentRemarks[`${exam.id}:${stu.id}`];

    return {
      id: stu.id,
      admissionNo: stu.admissionNo,
      name: stu.fullName,
      gender: stu.gender,
      combinationCode: combo?.code,
      combinationName: combo?.name,
      offeredSubjectIds,
      photoDataUrl: stu.photoDataUrl,
      marks,
      cbcMarks,
      teacherRemark: remarks?.classTeacherRemark,
      dosRemark: remarks?.dosRemark,
      headTeacherRemark: remarks?.headTeacherRemark,
    };
  });

  const classTeacherName = userMap.get(streamClass.classTeacherId)?.name ?? 'Assigned Class Teacher';

  const examClass: ExamClass = {
    id: `${exam.id}:${streamClass.id}`,
    examId: exam.id,
    classId: streamClass.id,
    className: streamClass.name,
    level: streamClass.level,
    examTitle: `${exam.name} (${exam.term} ${exam.academicYear})`,
    classTeacher: classTeacherName,
    examDate: exam.examDate,
    subjects,
    students,
    lastModified: exam.createdAt,
  };

  return { examClass, entryMap };
}

export function calculateClassPerformance(
  examClass: ExamClass,
  settings: SchoolSettings,
  entryMap?: Record<string, Record<string, MarkEntryItem>>
): ClassPerformanceSummary {
  const level: EducationLevel = examClass.level ?? 'alevel';
  const scale = getGradingScaleForLevel(level, settings);
  const cbc = settings.cbcConfig;
  const aPolicy = settings.alevelPolicy;

  const totalMaxAllSubjects =
    level === 'olevel'
      ? examClass.subjects.length * (cbc.formativeWeight + cbc.summativeWeight)
      : examClass.subjects.reduce((acc, s) => acc + s.maxMarks, 0);

  const studentResults: StudentCalculatedResult[] = examClass.students.map((student) => {
    const subjectResults: Record<string, SubjectStudentResult> = {};
    let totalObtained = 0;
    let assessedCount = 0;
    let totalPoints = 0;
    let principalPassesCount = 0;
    let subsidiaryPassesCount = 0;
    const principalPointList: number[] = [];
    const subsidiaryPointList: number[] = [];
    const failedSubjects: string[] = [];
    const validSubjectPercents: Array<{ id: string; name: string; pct: number }> = [];

    const offeredForStudent =
      student.offeredSubjectIds && student.offeredSubjectIds.length > 0
        ? examClass.subjects.filter((s) => student.offeredSubjectIds!.includes(s.id))
        : examClass.subjects;
    const studentTotalMax =
      level === 'olevel'
        ? offeredForStudent.length * (cbc.formativeWeight + cbc.summativeWeight)
        : offeredForStudent.reduce((acc, s) => acc + s.maxMarks, 0);

    for (const subject of offeredForStudent) {
      const metaEntry = entryMap?.[student.id]?.[subject.id];
      const exempted = Boolean(metaEntry?.exempted);
      const missed = Boolean(metaEntry?.missed);
      const competencyObservation = metaEntry?.competencyObservation;

      if (exempted || missed) {
        subjectResults[subject.id] = {
          subjectId: subject.id,
          category: subject.category,
          rawValue: exempted ? 'EX' : 'ABS',
          numericValue: null,
          maxMarks: level === 'olevel' ? cbc.formativeWeight + cbc.summativeWeight : subject.maxMarks,
          percentage: null,
          grade: exempted ? 'EX' : 'ABS',
          gradeLabel: exempted ? 'Exempted' : 'Did Not Sit',
          points: 0,
          passed: null,
          exempted,
          missed,
          competencyObservation,
          u1: null,
          u2: null,
          u3: null,
          aoiAverage: null,
          aoiScore20: null,
          identifier: null,
          eotScore: null,
          eotScore80: null,
        };
        continue;
      }

      if (level === 'olevel') {
        const entry = student.cbcMarks?.[subject.id];
        const u1 = parseClampedNumber(entry?.u1, cbc.aoiMaxMark);
        const u2 =
          cbc.aoiInputMode === 'single_aoi' ? null : parseClampedNumber(entry?.u2, cbc.aoiMaxMark);
        const u3 =
          cbc.aoiInputMode === 'single_aoi' ? null : parseClampedNumber(entry?.u3, cbc.aoiMaxMark);
        const eot = parseClampedNumber(entry?.eot, cbc.eotMaxMark);

        const enteredAois = [u1, u2, u3].filter((v): v is number => v !== null);
        const aoiAverage =
          enteredAois.length > 0
            ? Number(
                (enteredAois.reduce((acc, v) => acc + v, 0) / enteredAois.length).toFixed(2)
              )
            : null;

        const aoiRatio =
          aoiAverage !== null && cbc.aoiMaxMark > 0 ? aoiAverage / cbc.aoiMaxMark : null;
        const aoiScore20 =
          aoiRatio !== null ? applyRounding(aoiRatio * cbc.formativeWeight, cbc.roundingMode) : null;
        const identifier = computeCbcIdentifier(aoiRatio);

        const eotScore80 =
          eot !== null && cbc.eotMaxMark > 0
            ? applyRounding((eot / cbc.eotMaxMark) * cbc.summativeWeight, cbc.roundingMode)
            : null;

        let numericValue: number | null = null;
        let pct: number | null = null;

        if (aoiScore20 !== null && eotScore80 !== null) {
          numericValue = applyRounding(aoiScore20 + eotScore80, cbc.roundingMode);
          const combinedMax = cbc.formativeWeight + cbc.summativeWeight;
          pct = combinedMax > 0 ? applyRounding((numericValue / combinedMax) * 100, cbc.roundingMode) : 0;
        } else if (aoiScore20 !== null) {
          numericValue = aoiScore20;
          pct =
            cbc.formativeWeight > 0
              ? applyRounding((aoiScore20 / cbc.formativeWeight) * 100, cbc.roundingMode)
              : 0;
        } else if (eotScore80 !== null) {
          numericValue = eotScore80;
          pct =
            cbc.summativeWeight > 0
              ? applyRounding((eotScore80 / cbc.summativeWeight) * 100, cbc.roundingMode)
              : 0;
        }

        const band = pct !== null ? resolveGrade(pct, scale) : null;
        const passed = pct !== null ? pct >= subject.passMark : null;

        if (pct !== null && numericValue !== null && band) {
          if (passed === false) failedSubjects.push(subject.name);
          totalObtained += numericValue;
          totalPoints += band.gpa;
          assessedCount += 1;
          validSubjectPercents.push({ id: subject.id, name: subject.name, pct });
        }

        subjectResults[subject.id] = {
          subjectId: subject.id,
          category: subject.category,
          rawValue: numericValue !== null ? String(numericValue) : '',
          numericValue,
          maxMarks: cbc.formativeWeight + cbc.summativeWeight,
          percentage: pct,
          grade: band ? band.grade : '—',
          gradeLabel: band ? band.label : '—',
          points: band ? band.gpa : 0,
          passed,
          exempted: false,
          missed: false,
          competencyObservation,
          u1,
          u2,
          u3,
          aoiAverage,
          aoiScore20,
          identifier,
          eotScore: eot,
          eotScore80,
        };
      } else {
        // A'Level Dual Principal / Subsidiary Grading
        const rawValue = (student.marks[subject.id] ?? '').trim();
        const numericValue = parseClampedNumber(rawValue, subject.maxMarks);
        let pct: number | null = null;
        let grade = '—';
        let gradeLabel = '—';
        let points = 0;
        let passed: boolean | null = null;

        if (numericValue !== null) {
          pct =
            subject.maxMarks > 0
              ? applyRounding((numericValue / subject.maxMarks) * 100, cbc.roundingMode)
              : 0;

          if (subject.category === 'subsidiary') {
            const subPassThreshold = aPolicy.subsidiaryPassMark ?? 50;
            const isSubPass = pct >= subPassThreshold;
            passed = isSubPass;
            grade = isSubPass ? 'O' : 'F';
            gradeLabel = isSubPass ? (pct >= 75 ? 'Distinction (Sub)' : pct >= 60 ? 'Credit (Sub)' : 'Pass (Sub)') : 'Fail';
            points = isSubPass ? 1 : 0;
            if (isSubPass) subsidiaryPassesCount += 1;
            else failedSubjects.push(subject.name);
            subsidiaryPointList.push(points);
          } else {
            const band = resolveGrade(pct, scale);
            grade = band.grade;
            gradeLabel = band.label;
            points = band.gpa;
            passed = numericValue >= subject.passMark;
            if (points >= 2) principalPassesCount += 1;
            if (!passed) failedSubjects.push(subject.name);
            principalPointList.push(points);
          }

          totalObtained += numericValue;
          assessedCount += 1;
          validSubjectPercents.push({ id: subject.id, name: subject.name, pct });
        }

        const aU1 = parseClampedNumber(metaEntry?.u1, subject.maxMarks);
        const aU2 = parseClampedNumber(metaEntry?.u2, subject.maxMarks);
        const aU3 = parseClampedNumber(metaEntry?.u3, subject.maxMarks);
        const aEot = parseClampedNumber(
          metaEntry?.eot ?? metaEntry?.mark ?? rawValue,
          subject.maxMarks
        );

        subjectResults[subject.id] = {
          subjectId: subject.id,
          category: subject.category,
          rawValue,
          numericValue,
          maxMarks: subject.maxMarks,
          percentage: pct,
          grade,
          gradeLabel,
          points,
          passed,
          exempted: false,
          missed: false,
          competencyObservation,
          u1: aU1,
          u2: aU2,
          u3: aU3,
          aoiAverage: null,
          aoiScore20: null,
          identifier: null,
          eotScore: aEot ?? numericValue,
          eotScore80: null,
        };
      }
    }

    if (level === 'alevel') {
      const topPrincipals = [...principalPointList]
        .sort((a, b) => b - a)
        .slice(0, aPolicy.maxPrincipalsCount)
        .reduce((a, b) => a + b, 0);
      const topSubs = aPolicy.includeSubsidiaryPoints
        ? [...subsidiaryPointList]
            .sort((a, b) => b - a)
            .slice(0, aPolicy.maxSubsidiariesCount)
            .reduce((a, b) => a + b, 0)
        : 0;
      totalPoints = topPrincipals + topSubs;
    }

    const totalMax =
      student.offeredSubjectIds && student.offeredSubjectIds.length > 0
        ? studentTotalMax
        : totalMaxAllSubjects;
    const percentage =
      validSubjectPercents.length > 0
        ? applyRounding(
            validSubjectPercents.reduce((acc, item) => acc + item.pct, 0) /
              validSubjectPercents.length,
            cbc.roundingMode
          )
        : 0;

    const gradeBand = resolveGrade(percentage, scale);

    let status: StudentCalculatedResult['status'] = 'Passed';
    if (assessedCount === 0) {
      status = 'In Progress';
    } else if (
      level === 'alevel'
        ? principalPassesCount < 2 || percentage < 45
        : failedSubjects.length > 0 || percentage < 50
    ) {
      status = 'Needs Support';
    }

    const sortedValid = [...validSubjectPercents].sort((a, b) => b.pct - a.pct);
    const strongestSubject = sortedValid[0]?.name ?? null;
    const weakestSubject = sortedValid[sortedValid.length - 1]?.name ?? null;

    const autoRemark = buildAutoRemark(
      student.name,
      level,
      percentage,
      gradeBand,
      failedSubjects,
      strongestSubject,
      weakestSubject,
      assessedCount,
      level === 'alevel' ? totalPoints : undefined
    );

    const autoHeadRemark = buildHeadTeacherRemark(level, percentage, assessedCount, totalPoints);
    const autoDosRemark =
      assessedCount === 0
        ? 'Pending full subject marksheets.'
        : status === 'Passed'
          ? `Verified by Academic Office · Strong ${level === 'alevel' ? `${totalPoints} pts standing` : 'CBC attainment'}.`
          : 'Academic Office recommends targeted remedial support next term.';

    return {
      studentId: student.id,
      admissionNo: student.admissionNo,
      name: student.name,
      gender: student.gender,
      combinationCode: student.combinationCode,
      combinationName: student.combinationName,
      photoDataUrl: student.photoDataUrl,
      subjectResults,
      totalObtained: Number(totalObtained.toFixed(1)),
      totalMax,
      assessedCount,
      subjectCount: offeredForStudent.length,
      percentage,
      grade: assessedCount > 0 ? gradeBand.grade : '—',
      gradeLabel: assessedCount > 0 ? gradeBand.label : 'Pending',
      gpa: assessedCount > 0 ? gradeBand.gpa : 0,
      totalPoints: Number(totalPoints.toFixed(1)),
      principalPassesCount,
      subsidiaryPassesCount,
      passedAll: failedSubjects.length === 0 && assessedCount > 0,
      failedSubjects,
      status,
      rank: 0,
      autoRemark,
      teacherRemark: student.teacherRemark?.trim() ? student.teacherRemark : autoRemark,
      dosRemark: student.dosRemark?.trim() ? student.dosRemark : autoDosRemark,
      headTeacherRemark: student.headTeacherRemark?.trim()
        ? student.headTeacherRemark
        : autoHeadRemark,
    };
  });

  // Ranking: A'Level ranks by Total Points first then percentage; O'Level ranks by percentage
  const rankedOrder = [...studentResults].sort((a, b) => {
    if (level === 'alevel' && b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    if (b.percentage !== a.percentage) return b.percentage - a.percentage;
    if (b.totalObtained !== a.totalObtained) return b.totalObtained - a.totalObtained;
    return a.name.localeCompare(b.name);
  });

  let currentRank = 0;
  let lastKey = '';
  rankedOrder.forEach((res, idx) => {
    const key = level === 'alevel' ? `${res.totalPoints}:${res.percentage}` : `${res.percentage}`;
    if (key !== lastKey) {
      currentRank = idx + 1;
      lastKey = key;
    }
    const target = studentResults.find((s) => s.studentId === res.studentId);
    if (target) target.rank = currentRank;
  });

  // Subject summaries & per-subject rankings
  const subjectSummaries: SubjectSummary[] = examClass.subjects.map((subject) => {
    const validEntries: Array<{
      studentId: string;
      studentName: string;
      score: number;
      pct: number;
      grade: string;
    }> = [];
    const gradeCounts: Record<string, number> = {};
    for (const band of scale) {
      gradeCounts[band.grade] = 0;
    }

    const subjMax =
      level === 'olevel' ? cbc.formativeWeight + cbc.summativeWeight : subject.maxMarks;

    let missingCount = 0;
    let exemptCount = 0;
    let missedCount = 0;

    for (const sr of studentResults) {
      const cell = sr.subjectResults[subject.id];
      if (!cell) {
        // Student does not offer this subject (filtered by offeredSubjectIds/combination)
        continue;
      }
      if (cell.exempted) {
        exemptCount += 1;
        continue;
      }
      if (cell.missed) {
        missedCount += 1;
        continue;
      }
      if (cell.numericValue === null || cell.percentage === null) {
        missingCount += 1;
        continue;
      }
      gradeCounts[cell.grade] = (gradeCounts[cell.grade] ?? 0) + 1;
      validEntries.push({
        studentId: sr.studentId,
        studentName: sr.name,
        score: cell.numericValue,
        pct: cell.percentage,
        grade: cell.grade,
      });
    }

    const sortedEntries = [...validEntries].sort((a, b) => b.pct - a.pct);
    let subjRank = 0;
    let lastSubjPct: number | null = null;
    sortedEntries.forEach((entry, idx) => {
      if (lastSubjPct === null || entry.pct !== lastSubjPct) {
        subjRank = idx + 1;
        lastSubjPct = entry.pct;
      }
      const sr = studentResults.find((s) => s.studentId === entry.studentId);
      if (sr && sr.subjectResults[subject.id]) {
        sr.subjectResults[subject.id].subjectRank = subjRank;
      }
    });

    const scores = validEntries.map((e) => e.score);
    const pcts = validEntries.map((e) => e.pct);
    const mean = scores.length > 0 ? scores.reduce((acc, v) => acc + v, 0) / scores.length : 0;
    const meanPercent =
      pcts.length > 0 ? pcts.reduce((acc, v) => acc + v, 0) / pcts.length : 0;
    const median = computeMedian(scores);
    const medianPercent = computeMedian(pcts);
    const stdDev = computeStdDev(scores, mean);
    const highest = scores.length > 0 ? Math.max(...scores) : 0;
    const lowest = scores.length > 0 ? Math.min(...scores) : 0;
    const highestPercent = pcts.length > 0 ? Math.max(...pcts) : 0;
    const lowestPercent = pcts.length > 0 ? Math.min(...pcts) : 0;
    const highestStudents = validEntries
      .filter((e) => e.score === highest)
      .map((e) => e.studentName);
    const lowestStudents = validEntries
      .filter((e) => e.score === lowest)
      .map((e) => e.studentName);
    const passThresholdPct =
      level === 'olevel'
        ? 50
        : subject.category === 'subsidiary'
          ? aPolicy.subsidiaryPassMark
          : (subject.passMark / subject.maxMarks) * 100;
    const passCount = validEntries.filter((e) => e.pct >= passThresholdPct).length;
    const failCount = validEntries.length - passCount;
    const passRate = validEntries.length > 0 ? (passCount / validEntries.length) * 100 : 0;

    return {
      subjectId: subject.id,
      code: subject.code,
      name: subject.name,
      category: subject.category,
      teacher: subject.teacher,
      maxMarks: subjMax,
      passMark: level === 'olevel' ? 50 : subject.category === 'subsidiary' ? aPolicy.subsidiaryPassMark : subject.passMark,
      enteredCount: validEntries.length,
      missingCount,
      exemptCount,
      missedCount,
      mean: Number(mean.toFixed(1)),
      meanPercent: Number(meanPercent.toFixed(1)),
      median: Number(median.toFixed(1)),
      medianPercent: Number(medianPercent.toFixed(1)),
      highest: Number(highest.toFixed(1)),
      highestPercent: Number(highestPercent.toFixed(1)),
      highestStudents,
      lowest: Number(lowest.toFixed(1)),
      lowestPercent: Number(lowestPercent.toFixed(1)),
      lowestStudents,
      passCount,
      failCount,
      passRate: Number(passRate.toFixed(1)),
      stdDev: Number(stdDev.toFixed(1)),
      gradeCounts,
    };
  });

  const assessedStudents = studentResults.filter((s) => s.assessedCount > 0);
  const percentages = assessedStudents.map((s) => s.percentage);
  const classMeanPercent =
    percentages.length > 0
      ? Number((percentages.reduce((a, b) => a + b, 0) / percentages.length).toFixed(1))
      : 0;
  const classMedianPercent = Number(computeMedian(percentages).toFixed(1));
  const passedCount = studentResults.filter((s) => s.status === 'Passed').length;
  const needsSupportCount = studentResults.filter((s) => s.status === 'Needs Support').length;
  const passRate =
    assessedStudents.length > 0
      ? Number(((passedCount / assessedStudents.length) * 100).toFixed(1))
      : 0;

  const sortedByRank = [...studentResults].sort((a, b) => a.rank - b.rank);
  const highestStudent = sortedByRank[0] ?? null;

  const topSubject =
    [...subjectSummaries].sort((a, b) => b.meanPercent - a.meanPercent)[0] ?? null;

  const sortedScale = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);
  const gradeDistribution = sortedScale.map((band) => {
    const count = assessedStudents.filter((s) => s.grade === band.grade).length;
    const percent =
      assessedStudents.length > 0
        ? Number(((count / assessedStudents.length) * 100).toFixed(1))
        : 0;
    return {
      grade: band.grade,
      label: band.label,
      count,
      percent,
    };
  });

  const topPerformers = sortedByRank.slice(0, 5);
  const needsSupportStudents = studentResults
    .filter((s) => s.status === 'Needs Support' || s.failedSubjects.length > 0)
    .sort((a, b) => a.percentage - b.percentage);

  return {
    level,
    studentResults,
    subjectSummaries,
    classMeanPercent,
    classMedianPercent,
    passRate,
    passedCount,
    needsSupportCount,
    highestStudent,
    topSubject,
    gradeDistribution,
    topPerformers,
    needsSupportStudents,
  };
}

/**
 * Computes longitudinal term-over-term academic progression for a single student.
 */
export function getStudentAcademicHistory(
  studentId: string,
  db: SchoolDatabase
): StudentTermHistoryPoint[] {
  const student = db.students.find((s) => s.id === studentId);
  if (!student) return [];
  const streamClass = db.classes.find((c) => c.id === student.classId);
  if (!streamClass) return [];

  const sortedExams = [...db.exams]
    .filter((e) => e.classIds.includes(streamClass.id))
    .sort((a, b) => a.examDate.localeCompare(b.examDate));

  const points: StudentTermHistoryPoint[] = [];

  for (const exam of sortedExams) {
    const { examClass, entryMap } = buildExamClassView(exam, streamClass, db);
    const summary = calculateClassPerformance(examClass, db.settings, entryMap);
    const sr = summary.studentResults.find((r) => r.studentId === studentId);
    if (!sr || sr.assessedCount === 0) continue;

    points.push({
      examId: exam.id,
      examName: exam.name,
      term: exam.term,
      academicYear: exam.academicYear,
      examDate: exam.examDate,
      className: streamClass.name,
      level: streamClass.level,
      percentage: sr.percentage,
      grade: sr.grade,
      totalPoints: sr.totalPoints,
      rank: sr.rank,
      classSize: summary.studentResults.length,
      subjectScores: examClass.subjects.map((sub) => {
        const cell = sr.subjectResults[sub.id];
        return {
          subjectId: sub.id,
          subjectCode: sub.code,
          subjectName: sub.name,
          score: cell?.percentage ?? null,
          grade: cell?.grade ?? '—',
        };
      }),
    });
  }

  return points;
}

export interface ReportCardVisibleAssessments {
  showU1: boolean;
  showU2: boolean;
  showU3: boolean;
  showAoiSummary: boolean;
  showEot: boolean;
}

/**
 * Determines which assessment columns actually have recorded scores for a report card
 * so report cards only show assessments made (e.g. U1 + EoT only when U2/U3 were not assessed).
 */
export function getReportCardVisibleAssessments(
  subjects: Array<{ id: string }>,
  studentResult: StudentCalculatedResult,
  level: EducationLevel,
  cbc: CbcConfig
): ReportCardVisibleAssessments {
  const isSingleAoi = level === 'olevel' && cbc.aoiInputMode === 'single_aoi';
  let showU1 = false;
  let showU2 = false;
  let showU3 = false;
  let showEot = false;

  for (const sub of subjects) {
    const cell = studentResult.subjectResults[sub.id];
    if (!cell) continue;
    if (cell.u1 !== null && cell.u1 !== undefined) showU1 = true;
    if (!isSingleAoi && cell.u2 !== null && cell.u2 !== undefined) showU2 = true;
    if (!isSingleAoi && cell.u3 !== null && cell.u3 !== undefined) showU3 = true;
    if (
      level === 'olevel'
        ? (cell.eotScore !== null && cell.eotScore !== undefined) ||
          (cell.eotScore80 !== null && cell.eotScore80 !== undefined)
        : (cell.eotScore !== null && cell.eotScore !== undefined) ||
          (cell.numericValue !== null && cell.numericValue !== undefined)
    ) {
      showEot = true;
    }
  }

  const hasAnyFormative = showU1 || showU2 || showU3;
  const showAoiSummary = level === 'olevel' && hasAnyFormative;

  if (!hasAnyFormative && !showEot) {
    showEot = true;
  }

  return {
    showU1,
    showU2,
    showU3,
    showAoiSummary,
    showEot,
  };
}

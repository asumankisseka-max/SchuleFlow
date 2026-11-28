import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_SCHOOL_SETTINGS,
} from '../src/data/sampleData.ts';
import type { ExamClass, MarkEntryItem, SchoolSettings } from '../src/types.ts';
import {
  applyRounding,
  calculateClassPerformance,
  computeCbcIdentifier,
  filterStudentsOfferingSubject,
  getMarksheetMissingBreakdown,
  getReportCardVisibleAssessments,
  resolveGrade,
  validateMarksheetRecord,
} from '../src/utils/calculations.ts';

function makeSettings(overrides?: Partial<SchoolSettings>): SchoolSettings {
  return {
    ...DEFAULT_SCHOOL_SETTINGS,
    cbcConfig: { ...DEFAULT_CBC_CONFIG },
    alevelPolicy: { ...DEFAULT_ALEVEL_POLICY },
    olevelGradingScale: [...DEFAULT_OLEVEL_GRADING_SCALE],
    alevelGradingScale: [...DEFAULT_ALEVEL_GRADING_SCALE],
    ...overrides,
  };
}

describe('Uganda O-Level CBC & A-Level UACE Calculation Engine', () => {
  it('computes CBC identifiers and rounding modes accurately', () => {
    assert.equal(computeCbcIdentifier(null), null);
    assert.equal(computeCbcIdentifier(0.85), 3);
    assert.equal(computeCbcIdentifier(0.8), 3);
    assert.equal(computeCbcIdentifier(0.65), 2);
    assert.equal(computeCbcIdentifier(0.5), 2);
    assert.equal(computeCbcIdentifier(0.49), 1);

    assert.equal(applyRounding(74.46, 'whole'), 74);
    assert.equal(applyRounding(74.46, 'one_decimal'), 74.5);
    assert.equal(applyRounding(74.467, 'two_decimals'), 74.47);
  });

  it('weights O-Level formative AoI (20%) and EoT (80%) in u1_u3 mode', () => {
    const settings = makeSettings();
    const examClass: ExamClass = {
      id: 'ex:s1',
      examId: 'ex-1',
      classId: 'cls-s1',
      className: 'S.1',
      level: 'olevel',
      examTitle: 'End of Term III',
      classTeacher: 'Ms. Kiconco',
      examDate: '2026-11-10',
      subjects: [
        {
          id: 'sub-math',
          code: 'MTC',
          name: 'Mathematics',
          category: 'compulsory',
          maxMarks: 100,
          passMark: 50,
        },
        {
          id: 'sub-eng',
          code: 'ENG',
          name: 'English Language',
          category: 'compulsory',
          maxMarks: 100,
          passMark: 50,
        },
      ],
      students: [
        {
          id: 'stu-1',
          admissionNo: 'KHS-STD-001',
          name: 'Nakato Grace',
          gender: 'F',
          marks: {},
          cbcMarks: {
            // AoI avg = (3 + 2.4 + 2.7)/3 = 2.7; ratio = 0.9; AoI/20 = 18.0; EoT = 75 -> 60.0; total = 78.0 (B)
            'sub-math': { u1: '3', u2: '2.4', u3: '2.7', eot: '75' },
            // EX exempted
            'sub-eng': { u1: '', u2: '', u3: '', eot: '' },
          },
        },
        {
          id: 'stu-2',
          admissionNo: 'KHS-STD-002',
          name: 'Okello Moses',
          gender: 'M',
          marks: {},
          cbcMarks: {
            // AoI avg = 1.5; ratio = 0.5; AoI/20 = 10.0; EoT = 90 -> 72.0; total = 82.0 (A)
            'sub-math': { u1: '1.5', u2: '1.5', u3: '1.5', eot: '90' },
            'sub-eng': { u1: '2', u2: '2', u3: '2', eot: '60' },
          },
        },
      ],
      lastModified: new Date().toISOString(),
    };

    const entryMap: Record<string, Record<string, MarkEntryItem>> = {
      'stu-1': {
        'sub-eng': { exempted: true, competencyObservation: 'Medical exemption approved' },
      },
      'stu-2': {},
    };

    const summary = calculateClassPerformance(examClass, settings, entryMap);
    const grace = summary.studentResults.find((s) => s.studentId === 'stu-1');
    const moses = summary.studentResults.find((s) => s.studentId === 'stu-2');

    assert.ok(grace);
    assert.ok(moses);

    const graceMath = grace.subjectResults['sub-math'];
    assert.equal(graceMath.aoiScore20, 18);
    assert.equal(graceMath.eotScore80, 60);
    assert.equal(graceMath.numericValue, 78);
    assert.equal(graceMath.identifier, 3);
    assert.equal(graceMath.grade, 'B');

    const graceEng = grace.subjectResults['sub-eng'];
    assert.equal(graceEng.grade, 'EX');
    assert.equal(graceEng.exempted, true);
    assert.equal(grace.failedSubjects.length, 0);

    // Grace has 78% overall (1 assessed subject), Moses has (82 + 61.3)/2 = 71.7%
    assert.equal(grace.rank, 1);
    assert.equal(moses.rank, 2);
  });

  it('supports single_aoi mode where u1 alone defines formative AoI', () => {
    const settings = makeSettings({
      cbcConfig: { ...DEFAULT_CBC_CONFIG, aoiInputMode: 'single_aoi' },
    });
    const examClass: ExamClass = {
      id: 'ex:s2',
      examId: 'ex-1',
      classId: 'cls-s2',
      className: 'S.2',
      level: 'olevel',
      examTitle: 'BOT',
      classTeacher: 'Mr. Ssempijja',
      examDate: '2026-10-01',
      subjects: [
        {
          id: 'sub-bio',
          code: 'BIO',
          name: 'Biology',
          category: 'compulsory',
          maxMarks: 100,
          passMark: 50,
        },
      ],
      students: [
        {
          id: 'stu-a',
          admissionNo: 'KHS-STD-010',
          name: 'Namuli Ruth',
          gender: 'F',
          marks: {},
          cbcMarks: {
            // u2/u3 should be ignored in single_aoi mode; u1 = 3 -> 20.0, eot = 50 -> 40.0 => 60.0 (C)
            'sub-bio': { u1: '3', u2: '0', u3: '0', eot: '50' },
          },
        },
      ],
      lastModified: new Date().toISOString(),
    };

    const summary = calculateClassPerformance(examClass, settings);
    const res = summary.studentResults[0].subjectResults['sub-bio'];
    assert.equal(res.aoiScore20, 20);
    assert.equal(res.eotScore80, 40);
    assert.equal(res.numericValue, 60);
    assert.equal(res.grade, 'C');
  });

  it('computes A-Level UACE principal (max 6 pts) + subsidiary (max 1 pt) totals', () => {
    const settings = makeSettings();
    const examClass: ExamClass = {
      id: 'ex:s6',
      examId: 'ex-1',
      classId: 'cls-s6',
      className: 'S.6',
      level: 'alevel',
      examTitle: 'Mock UACE',
      classTeacher: 'Mr. Kato',
      examDate: '2026-11-12',
      subjects: [
        { id: 'p-phy', code: 'PHY', name: 'Physics', category: 'principal', maxMarks: 100, passMark: 45 },
        { id: 'p-chm', code: 'CHM', name: 'Chemistry', category: 'principal', maxMarks: 100, passMark: 45 },
        { id: 'p-mat', code: 'MTC', name: 'Mathematics', category: 'principal', maxMarks: 100, passMark: 45 },
        { id: 's-gp', code: 'GP', name: 'General Paper', category: 'subsidiary', maxMarks: 100, passMark: 50 },
      ],
      students: [
        {
          id: 'stu-al1',
          admissionNo: 'KHS-STD-200',
          name: 'Wasswa Brian',
          gender: 'M',
          // A(6) + B(5) + C(4) + GP Pass(1) = 16 pts
          marks: { 'p-phy': '84', 'p-chm': '73', 'p-mat': '64', 's-gp': '68' },
        },
        {
          id: 'stu-al2',
          admissionNo: 'KHS-STD-201',
          name: 'Babirye Joan',
          gender: 'F',
          // E(2) + F(0) + O(1) + GP Fail(0) = 3 pts -> Needs Support
          marks: { 'p-phy': '46', 'p-chm': '28', 'p-mat': '38', 's-gp': '42' },
        },
      ],
      lastModified: new Date().toISOString(),
    };

    const summary = calculateClassPerformance(examClass, settings);
    const brian = summary.studentResults.find((s) => s.studentId === 'stu-al1');
    const joan = summary.studentResults.find((s) => s.studentId === 'stu-al2');

    assert.ok(brian);
    assert.ok(joan);
    assert.equal(brian.totalPoints, 16);
    assert.equal(brian.principalPassesCount, 3);
    assert.equal(brian.subsidiaryPassesCount, 1);
    assert.equal(brian.status, 'Passed');
    assert.equal(brian.rank, 1);

    assert.equal(joan.totalPoints, 3);
    assert.equal(joan.principalPassesCount, 1);
    assert.equal(joan.status, 'Needs Support');
    assert.equal(joan.rank, 2);

    assert.equal(resolveGrade(80, DEFAULT_ALEVEL_GRADING_SCALE).grade, 'A');
  });

  it('flags missing and out-of-range scores during marksheet validation', () => {
    const settings = makeSettings();
    const students = [
      {
        id: 'stu-1',
        admissionNo: 'A1',
        fullName: 'Alice',
        gender: 'F' as const,
        classId: 'c1',
        academicYear: '2026',
        status: 'active' as const,
      },
      {
        id: 'stu-2',
        admissionNo: 'A2',
        fullName: 'Bob',
        gender: 'M' as const,
        classId: 'c1',
        academicYear: '2026',
        status: 'active' as const,
      },
    ];

    const summary = validateMarksheetRecord(
      {
        id: 'ms-1',
        examId: 'ex-1',
        classId: 'c1',
        subjectId: 's1',
        teacherId: 't1',
        status: 'draft',
        entries: {
          'stu-1': { u1: '4.5', eot: '80' }, // u1 > 3 out_of_range
          'stu-2': { u1: '2', eot: '' }, // missing eot
        },
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
      students,
      'olevel',
      100,
      settings
    );

    assert.equal(summary.isReadyForSubmission, false);
    assert.equal(summary.invalidCount, 1);
    assert.equal(summary.missingCount, 1);
  });

  it('filters students strictly by subject offerings & A-Level combinations and computes missing marks breakdown', () => {
    const settings = makeSettings();
    const olevelClass = {
      id: 'cls-s2',
      name: 'S.2 East',
      gradeLevel: 'S.2',
      level: 'olevel' as const,
      classTeacherId: 't1',
      subjectIds: ['sub-math', 'sub-geo'],
      subjectTeacherMap: {},
    };
    const alevelClass = {
      id: 'cls-s5',
      name: 'S.5 Science',
      gradeLevel: 'S.5',
      level: 'alevel' as const,
      classTeacherId: 't1',
      subjectIds: ['sub-a-math', 'sub-a-bio'],
      subjectTeacherMap: {},
    };
    const combinations = [
      {
        id: 'comb-pcm',
        code: 'PCM/ICT',
        name: 'Physics Chemistry Mathematics',
        principalSubjectIds: ['sub-a-math'],
        subsidiarySubjectIds: [],
      },
      {
        id: 'comb-bcm',
        code: 'BCM/ICT',
        name: 'Biology Chemistry Mathematics',
        principalSubjectIds: ['sub-a-bio'],
        subsidiarySubjectIds: [],
      },
    ];
    const students = [
      {
        id: 'stu-1',
        admissionNo: 'S1',
        fullName: 'Grace Namukasa',
        gender: 'F' as const,
        classId: 'cls-s2',
        academicYear: '2026',
        status: 'active' as const,
        offeredSubjectIds: ['sub-math'], // drops sub-geo
      },
      {
        id: 'stu-2',
        admissionNo: 'S2',
        fullName: 'Peter Okello',
        gender: 'M' as const,
        classId: 'cls-s2',
        academicYear: '2026',
        status: 'active' as const,
      },
      {
        id: 'stu-3',
        admissionNo: 'S3',
        fullName: 'A-Level Math Student',
        gender: 'M' as const,
        classId: 'cls-s5',
        academicYear: '2026',
        status: 'active' as const,
        combinationId: 'comb-pcm',
      },
      {
        id: 'stu-4',
        admissionNo: 'S4',
        fullName: 'A-Level Bio Student',
        gender: 'F' as const,
        classId: 'cls-s5',
        academicYear: '2026',
        status: 'active' as const,
        combinationId: 'comb-bcm',
      },
    ];

    const geoStudents = filterStudentsOfferingSubject(students, 'sub-geo', olevelClass, combinations);
    assert.deepEqual(
      geoStudents.map((s) => s.id),
      ['stu-2']
    );

    const aMathStudents = filterStudentsOfferingSubject(
      students,
      'sub-a-math',
      alevelClass,
      combinations
    );
    assert.deepEqual(
      aMathStudents.map((s) => s.id),
      ['stu-3']
    );

    // Partial U1-only marksheet triggers missing breakdown for U2, U3, EoT
    const mathStudents = filterStudentsOfferingSubject(students, 'sub-math', olevelClass, combinations);
    const partialBreakdown = getMarksheetMissingBreakdown(
      {
        id: 'ms-partial',
        examId: 'ex-1',
        classId: 'cls-s2',
        subjectId: 'sub-math',
        teacherId: 't1',
        status: 'submitted',
        entries: {
          'stu-1': { u1: '2.5' },
          'stu-2': { u1: '3', u2: '2.5', u3: '2.8', eot: '78' },
        },
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
      mathStudents,
      'olevel',
      100,
      settings
    );

    assert.equal(partialBreakdown.totalStudents, 2);
    assert.equal(partialBreakdown.completedStudents, 1);
    assert.equal(partialBreakdown.missingStudentsCount, 1);
    assert.deepEqual(partialBreakdown.missingStudentNames, ['Grace Namukasa']);
    assert.equal(partialBreakdown.missingByAssessment.u1, 0);
    assert.equal(partialBreakdown.missingByAssessment.u2, 1);
    assert.equal(partialBreakdown.missingByAssessment.u3, 1);
    assert.equal(partialBreakdown.missingByAssessment.eot, 1);
    assert.ok(partialBreakdown.summaryText.includes('U2: 1 missing'));
  });

  it('validates A-Level U1/U2/U3 scores within maxMarks while permitting partial U1-only sheets', () => {
    const settings = makeSettings();
    const students = [
      {
        id: 'stu-al1',
        admissionNo: 'AL-1',
        fullName: 'Kato Brian',
        gender: 'M' as const,
        classId: 'cls-s5',
        academicYear: '2026',
        status: 'active' as const,
      },
      {
        id: 'stu-al2',
        admissionNo: 'AL-2',
        fullName: 'Namono Sarah',
        gender: 'F' as const,
        classId: 'cls-s5',
        academicYear: '2026',
        status: 'active' as const,
      },
    ];

    const summary = validateMarksheetRecord(
      {
        id: 'ms-alevel',
        examId: 'ex-1',
        classId: 'cls-s5',
        subjectId: 'sub-phy',
        teacherId: 't1',
        status: 'draft',
        entries: {
          'stu-al1': { u1: '78' }, // Valid U1-only entry; missing EoT flagged without invalidCount
          'stu-al2': { u1: '112', eot: '84' }, // Out-of-range U1 > 100
        },
        lastModified: new Date().toISOString(),
        auditHistory: [],
      },
      students,
      'alevel',
      100,
      settings
    );

    assert.equal(summary.invalidCount, 1);
    assert.equal(summary.missingCount, 1);
    assert.equal(summary.issues.some((i) => i.studentId === 'stu-al2' && i.field === 'U1' && i.type === 'out_of_range'), true);
    assert.equal(summary.issues.some((i) => i.studentId === 'stu-al1' && i.field === 'EoT Mark' && i.type === 'missing'), true);
  });

  it('shows only assessments actually made on O-Level and A-Level report cards', () => {
    const settings = makeSettings();
    const olevelExamClass: ExamClass = {
      id: 'ex:s1-vis',
      examId: 'ex-vis',
      classId: 'cls-s1-vis',
      className: 'S.1',
      level: 'olevel',
      examTitle: 'Term Test',
      classTeacher: 'Teacher X',
      examDate: '2026-11-12',
      lastModified: '2026-11-12T00:00:00.000Z',
      subjects: [
        { id: 'sub-math', code: 'MTC', name: 'Mathematics', category: 'compulsory', maxMarks: 100, passMark: 50 },
        { id: 'sub-eng', code: 'ENG', name: 'English', category: 'compulsory', maxMarks: 100, passMark: 50 },
      ],
      students: [
        {
          id: 'stu-u1-eot',
          admissionNo: 'U1',
          name: 'U1 And EoT Only',
          gender: 'F',
          marks: {},
          cbcMarks: {
            'sub-math': { u1: '2.6', u2: '', u3: '', eot: '76' },
            'sub-eng': { u1: '2.4', u2: '', u3: '', eot: '70' },
          },
        },
        {
          id: 'stu-eot-only',
          admissionNo: 'U2',
          name: 'EoT Only Student',
          gender: 'M',
          marks: {},
          cbcMarks: {
            'sub-math': { u1: '', u2: '', u3: '', eot: '82' },
            'sub-eng': { u1: '', u2: '', u3: '', eot: '68' },
          },
        },
        {
          id: 'stu-u1-u2',
          admissionNo: 'U3',
          name: 'U1 And U2 Only',
          gender: 'F',
          marks: {},
          cbcMarks: {
            'sub-math': { u1: '2.5', u2: '2.8', u3: '', eot: '' },
            'sub-eng': { u1: '2.0', u2: '2.2', u3: '', eot: '' },
          },
        },
      ],
    };

    const oSummary = calculateClassPerformance(olevelExamClass, settings);
    const visU1Eot = getReportCardVisibleAssessments(
      olevelExamClass.subjects,
      oSummary.studentResults.find((r) => r.studentId === 'stu-u1-eot')!,
      'olevel',
      settings.cbcConfig
    );
    assert.deepEqual(visU1Eot, {
      showU1: true,
      showU2: false,
      showU3: false,
      showAoiSummary: true,
      showEot: true,
    });

    const visEotOnly = getReportCardVisibleAssessments(
      olevelExamClass.subjects,
      oSummary.studentResults.find((r) => r.studentId === 'stu-eot-only')!,
      'olevel',
      settings.cbcConfig
    );
    assert.deepEqual(visEotOnly, {
      showU1: false,
      showU2: false,
      showU3: false,
      showAoiSummary: false,
      showEot: true,
    });

    const visU1U2 = getReportCardVisibleAssessments(
      olevelExamClass.subjects,
      oSummary.studentResults.find((r) => r.studentId === 'stu-u1-u2')!,
      'olevel',
      settings.cbcConfig
    );
    assert.deepEqual(visU1U2, {
      showU1: true,
      showU2: true,
      showU3: false,
      showAoiSummary: true,
      showEot: false,
    });

    // A'Level with U1 + EoT recorded in entryMap
    const alevelExamClass: ExamClass = {
      id: 'ex:s5-vis',
      examId: 'ex-vis',
      classId: 'cls-s5-vis',
      className: 'S.5',
      level: 'alevel',
      examTitle: 'End of Term',
      classTeacher: 'Teacher Y',
      examDate: '2026-11-12',
      lastModified: '2026-11-12T00:00:00.000Z',
      subjects: [
        { id: 'sub-phy', code: 'PHY', name: 'Physics', category: 'principal', maxMarks: 100, passMark: 50 },
      ],
      students: [
        {
          id: 'stu-a1',
          admissionNo: 'A1',
          name: 'A-Level U1+EoT',
          gender: 'M',
          marks: { 'sub-phy': '84' },
        },
      ],
    };
    const entryMap: Record<string, Record<string, MarkEntryItem>> = {
      'stu-a1': {
        'sub-phy': { u1: '78', eot: '84', mark: '84' },
      },
    };
    const aSummary = calculateClassPerformance(alevelExamClass, settings, entryMap);
    const visALevel = getReportCardVisibleAssessments(
      alevelExamClass.subjects,
      aSummary.studentResults[0],
      'alevel',
      settings.cbcConfig
    );
    assert.deepEqual(visALevel, {
      showU1: true,
      showU2: false,
      showU3: false,
      showAoiSummary: false,
      showEot: true,
    });
    assert.equal(aSummary.studentResults[0].subjectResults['sub-phy'].u1, 78);
    assert.equal(aSummary.studentResults[0].subjectResults['sub-phy'].eotScore, 84);
  });
});

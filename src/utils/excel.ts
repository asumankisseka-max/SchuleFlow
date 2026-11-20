import * as XLSX from 'xlsx';
import type {
  ClassPerformanceSummary,
  EducationLevel,
  ExamClass,
  MarkEntryItem,
  SchoolSettings,
  StreamClass,
  StudentProfile,
  SubjectDefinition,
  UserRole,
} from '../types';
import { validateUgandanPhone } from './validation';

export interface ParsedSheetData {
  sheetName: string;
  rows: string[][];
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheetData[];
}

export interface SubjectExcelMatchRow {
  rowNumber: number;
  admissionNo: string;
  studentName: string;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  status: 'matched' | 'unmatched' | 'duplicate' | 'invalid';
  reason?: string;
  entry: MarkEntryItem;
}

export interface SubjectExcelImportResult {
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  duplicateCount: number;
  invalidCount: number;
  rows: SubjectExcelMatchRow[];
}

export interface StudentDirectoryImportRow {
  rowNumber: number;
  admissionNo: string;
  fullName: string;
  gender: 'M' | 'F';
  dateOfBirth?: string;
  parentName?: string;
  parentContact?: string;
  phoneInvalid?: boolean;
  phoneError?: string;
  isDuplicate: boolean;
}

export interface StaffDirectoryImportRow {
  rowNumber: number;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  phone?: string;
  phoneInvalid?: boolean;
  phoneError?: string;
  assignedClassNames: string[];
  assignedClassIds: string[];
  isDuplicate: boolean;
}

export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheets: ParsedSheetData[] = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    const rows = rawRows.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        return String(cell).trim();
      })
    );

    return { sheetName, rows };
  });

  return {
    fileName: file.name,
    sheets,
  };
}

function findHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const maxScan = Math.min(rows.length, 8);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r];
    const nonEmpty = row.filter((c) => c.length > 0);
    if (nonEmpty.length < 2) continue;
    let score = nonEmpty.length;
    const joined = nonEmpty.join(' ').toLowerCase();
    if (/(adm|reg|id|roll)/.test(joined)) score += 6;
    if (/(name|student|pupil|learner)/.test(joined)) score += 5;
    if (/(u1|u2|u3|aoi|classwork|eot|exam|mark|score)/.test(joined)) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = r;
    }
  }
  return bestIndex;
}

export function matchSubjectExcelRows(
  rows: string[][],
  classStudents: StudentProfile[],
  level: EducationLevel,
  subjectMaxMarks: number,
  settings: SchoolSettings
): SubjectExcelImportResult {
  const headerIdx = findHeaderRow(rows);
  const header = (rows[headerIdx] ?? []).map((h) => h.toLowerCase());

  const findCol = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
  const admCol = findCol(/(adm|student\s*id|reg|roll|no\.?)/);
  const nameCol = findCol(/(student\s*name|full\s*name|name|learner)/);
  const u1Col = findCol(/(^u1\b|\bu1\b|classwork|aoi\s*1|aoi)/);
  const u2Col = findCol(/(^u2\b|\bu2\b|aoi\s*2)/);
  const u3Col = findCol(/(^u3\b|\bu3\b|aoi\s*3)/);
  const eotCol = findCol(/(eot|end\s*of\s*term|exam|summative)/);
  const markCol = findCol(/(mark|score|exam|total)/);
  const obsCol = findCol(/(observation|competenc|remark|comment)/);

  const studentByAdm = new Map<string, StudentProfile>();
  classStudents.forEach((s) => {
    studentByAdm.set(s.admissionNo.trim().toLowerCase(), s);
  });

  const seenAdms = new Set<string>();
  const parsedRows: SubjectExcelMatchRow[] = [];
  const cbc = settings.cbcConfig;

  const dataRows = rows.slice(headerIdx + 1);
  dataRows.forEach((row, idx) => {
    const rawAdm = (admCol >= 0 ? row[admCol] : row[0] ?? '').trim();
    const rawName = (nameCol >= 0 ? row[nameCol] : row[1] ?? '').trim();
    if (!rawAdm && !rawName) return;
    if (/^(class\s*average|average|mean|total|summary)$/i.test(rawName)) return;

    const admKey = rawAdm.toLowerCase();
    const matchedStudent = admKey ? studentByAdm.get(admKey) ?? null : null;

    const entry: MarkEntryItem = {};
    let invalidReason: string | undefined;

    if (level === 'olevel') {
      const u1 = u1Col >= 0 ? (row[u1Col] ?? '').trim() : '';
      const u2 = u2Col >= 0 ? (row[u2Col] ?? '').trim() : '';
      const u3 = u3Col >= 0 ? (row[u3Col] ?? '').trim() : '';
      const eot = eotCol >= 0 ? (row[eotCol] ?? '').trim() : markCol >= 0 ? (row[markCol] ?? '').trim() : '';
      const obs = obsCol >= 0 ? (row[obsCol] ?? '').trim() : '';
      entry.u1 = u1;
      entry.u2 = u2;
      entry.u3 = u3;
      entry.eot = eot;
      if (obs) entry.competencyObservation = obs;

      for (const [label, val, max] of [
        ['U1', u1, cbc.aoiMaxMark],
        ['U2', u2, cbc.aoiMaxMark],
        ['U3', u3, cbc.aoiMaxMark],
        ['EoT', eot, cbc.eotMaxMark],
      ] as const) {
        if (!val) continue;
        const num = Number(val);
        if (!Number.isFinite(num) || num < 0 || num > max) {
          invalidReason = `${label} value "${val}" is outside valid range 0–${max}.`;
          break;
        }
      }
    } else {
      const mCol = markCol >= 0 ? markCol : 2;
      const markVal = (row[mCol] ?? '').trim();
      entry.mark = markVal;
      if (markVal) {
        const num = Number(markVal);
        if (!Number.isFinite(num) || num < 0 || num > subjectMaxMarks) {
          invalidReason = `Mark "${markVal}" is outside valid range 0–${subjectMaxMarks}.`;
        }
      }
    }

    let status: SubjectExcelMatchRow['status'] = 'matched';
    let reason: string | undefined;

    if (!rawAdm || !matchedStudent) {
      status = 'unmatched';
      reason = rawAdm
        ? `Admission No "${rawAdm}" does not match any active student in this class.`
        : 'Missing Admission No.';
    } else if (seenAdms.has(admKey)) {
      status = 'duplicate';
      reason = `Duplicate Admission No "${rawAdm}" in uploaded sheet.`;
    } else if (invalidReason) {
      status = 'invalid';
      reason = invalidReason;
    }

    if (admKey) seenAdms.add(admKey);

    parsedRows.push({
      rowNumber: headerIdx + idx + 2,
      admissionNo: rawAdm,
      studentName: rawName || matchedStudent?.fullName || 'Unknown',
      matchedStudentId: matchedStudent?.id ?? null,
      matchedStudentName: matchedStudent?.fullName ?? null,
      status,
      reason,
      entry,
    });
  });

  return {
    totalRows: parsedRows.length,
    matchedCount: parsedRows.filter((r) => r.status === 'matched').length,
    unmatchedCount: parsedRows.filter((r) => r.status === 'unmatched').length,
    duplicateCount: parsedRows.filter((r) => r.status === 'duplicate').length,
    invalidCount: parsedRows.filter((r) => r.status === 'invalid').length,
    rows: parsedRows,
  };
}

export function downloadSubjectMarksheetTemplate(
  streamClass: StreamClass,
  subject: SubjectDefinition,
  students: StudentProfile[],
  existingEntries: Record<string, MarkEntryItem>,
  settings: SchoolSettings,
  includeExistingMarks: boolean
) {
  const activeStudents = students.filter((s) => s.status === 'active');
  const isOlevel = streamClass.level === 'olevel';
  const cbc = settings.cbcConfig;

  const headers = isOlevel
    ? cbc.aoiInputMode === 'single_aoi'
      ? [
          'Admission No',
          'Student Name',
          `Classwork AoI (/${cbc.aoiMaxMark})`,
          `EoT Exam (/${cbc.eotMaxMark})`,
          'Competency Observation',
        ]
      : [
          'Admission No',
          'Student Name',
          `U1 (/${cbc.aoiMaxMark})`,
          `U2 (/${cbc.aoiMaxMark})`,
          `U3 (/${cbc.aoiMaxMark})`,
          `EoT Exam (/${cbc.eotMaxMark})`,
          'Competency Observation',
        ]
    : ['Admission No', 'Student Name', `Exam Mark (/${subject.maxMarks})`];

  const rows = activeStudents.map((stu) => {
    const entry = existingEntries[stu.id];
    if (isOlevel) {
      if (cbc.aoiInputMode === 'single_aoi') {
        return [
          stu.admissionNo,
          stu.fullName,
          includeExistingMarks ? entry?.u1 ?? '' : '',
          includeExistingMarks ? entry?.eot ?? '' : '',
          includeExistingMarks ? entry?.competencyObservation ?? '' : '',
        ];
      }
      return [
        stu.admissionNo,
        stu.fullName,
        includeExistingMarks ? entry?.u1 ?? '' : '',
        includeExistingMarks ? entry?.u2 ?? '' : '',
        includeExistingMarks ? entry?.u3 ?? '' : '',
        includeExistingMarks ? entry?.eot ?? '' : '',
        includeExistingMarks ? entry?.competencyObservation ?? '' : '',
      ];
    }
    return [stu.admissionNo, stu.fullName, includeExistingMarks ? entry?.mark ?? '' : ''];
  });

  const wsData = [
    [`${settings.schoolName} — Subject Marksheet Template`],
    [`Class: ${streamClass.name} | Subject: ${subject.name} (${subject.code}) | Level: ${isOlevel ? "O'Level CBC" : "A'Level"}`],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 24 },
    ...(isOlevel ? [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 32 }] : [{ wch: 18 }]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Subject Marksheet');

  const safeName = `${streamClass.name}_${subject.code}`.replace(/[^a-zA-Z0-9]+/g, '_');
  XLSX.writeFile(
    wb,
    `${safeName}_${includeExistingMarks ? 'Current_Marks' : 'Blank_Template'}.xlsx`
  );
}

export function parseStudentDirectoryExcel(
  rows: string[][],
  existingAdmissions: Set<string>
): StudentDirectoryImportRow[] {
  const headerIdx = findHeaderRow(rows);
  const header = (rows[headerIdx] ?? []).map((h) => h.toLowerCase());
  const findCol = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));

  const admCol = findCol(/(adm|id|reg|no)/);
  const nameCol = findCol(/(name|student|learner|pupil)/);
  const genderCol = findCol(/(gender|sex)/);
  const dobCol = findCol(/(dob|birth)/);
  const parentNameCol = findCol(/(parent|guardian)/);
  const contactCol = findCol(/(contact|phone|tel|mobile)/);

  const seen = new Set<string>();
  const parsed: StudentDirectoryImportRow[] = [];

  rows.slice(headerIdx + 1).forEach((row, idx) => {
    const adm = (admCol >= 0 ? row[admCol] : row[0] ?? '').trim();
    const fullName = (nameCol >= 0 ? row[nameCol] : row[1] ?? '').trim();
    if (!adm && !fullName) return;

    const rawGender = (genderCol >= 0 ? row[genderCol] : '').trim().toUpperCase();
    const gender: 'M' | 'F' = rawGender.startsWith('F') ? 'F' : 'M';
    const key = adm.toLowerCase();
    const isDuplicate = Boolean(key && (existingAdmissions.has(key) || seen.has(key)));
    if (key) seen.add(key);

    const rawContact = contactCol >= 0 ? (row[contactCol] ?? '').trim() : '';
    const phoneCheck = validateUgandanPhone(rawContact, false);

    parsed.push({
      rowNumber: headerIdx + idx + 2,
      admissionNo: adm,
      fullName,
      gender,
      dateOfBirth: dobCol >= 0 ? (row[dobCol] ?? '').trim() : undefined,
      parentName: parentNameCol >= 0 ? (row[parentNameCol] ?? '').trim() : undefined,
      parentContact: phoneCheck.valid && phoneCheck.normalized ? phoneCheck.normalized : rawContact || undefined,
      phoneInvalid: rawContact.length > 0 && !phoneCheck.valid,
      phoneError: phoneCheck.error,
      isDuplicate,
    });
  });

  return parsed;
}

export function downloadStudentImportTemplate(schoolName: string) {
  const wsData = [
    [`${schoolName} — Student Directory Import Template (Leave Admission No blank to auto-generate)`],
    ['Admission No (Optional)', 'Full Name', 'Gender (M/F)', 'Date of Birth (YYYY-MM-DD)', 'Parent/Guardian Name', 'Parent Contact (+256/07...)'],
    ['', 'Kiggundu Esther', 'F', '2011-04-12', 'Mr. Moses Kiggundu', '0772100220'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 22 }, { wch: 24 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'SchuleFlow_Student_Import_Template.xlsx');
}

function normalizeStaffRole(raw: string): UserRole {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s.includes('class')) return 'class_teacher';
  if (s.includes('bursar') || s.includes('account') || s.includes('finance')) return 'bursar';
  if (s.includes('dos') || s.includes('director')) return 'dos';
  if (s.includes('head')) return 'headteacher';
  if (s.includes('admin')) return 'school_admin';
  return 'teacher';
}

export function parseStaffDirectoryExcel(
  rows: string[][],
  existingEmails: Set<string>,
  classes: StreamClass[]
): StaffDirectoryImportRow[] {
  const headerIdx = findHeaderRow(rows);
  const header = (rows[headerIdx] ?? []).map((h) => h.toLowerCase());
  const findCol = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));

  const nameCol = findCol(/(full\s*name|staff\s*name|teacher|name)/);
  const emailCol = findCol(/(email|e-mail)/);
  const userCol = findCol(/(username|user\s*id|handle)/);
  const roleCol = findCol(/(role|position|title)/);
  const phoneCol = findCol(/(phone|contact|tel|mobile|whatsapp)/);
  const classCol = findCol(/(class|stream|homeroom)/);

  const classByName = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const seenEmails = new Set<string>();
  const parsed: StaffDirectoryImportRow[] = [];

  rows.slice(headerIdx + 1).forEach((row, idx) => {
    const name = (nameCol >= 0 ? row[nameCol] : row[0] ?? '').trim();
    const email = (emailCol >= 0 ? row[emailCol] : row[1] ?? '').trim().toLowerCase();
    if (!name && !email) return;

    const rawUser = (userCol >= 0 ? row[userCol] : '').trim().toLowerCase();
    const username = rawUser || email.split('@')[0] || `staff${idx + 1}`;
    const role = normalizeStaffRole(roleCol >= 0 ? row[roleCol] ?? '' : 'teacher');
    const rawPhone = (phoneCol >= 0 ? row[phoneCol] : '').trim();
    const phoneCheck = validateUgandanPhone(rawPhone, false);

    const rawClasses = (classCol >= 0 ? row[classCol] : '')
      .split(/[,;|]/)
      .map((c) => c.trim())
      .filter(Boolean);
    const assignedClassIds = rawClasses
      .map((cname) => classByName.get(cname.toLowerCase()))
      .filter((id): id is string => Boolean(id));

    const isDuplicate = !email || existingEmails.has(email) || seenEmails.has(email);
    if (email) seenEmails.add(email);

    parsed.push({
      rowNumber: headerIdx + idx + 2,
      name,
      email,
      username,
      role,
      phone: phoneCheck.valid && phoneCheck.normalized ? phoneCheck.normalized : rawPhone || undefined,
      phoneInvalid: rawPhone.length > 0 && !phoneCheck.valid,
      phoneError: phoneCheck.error,
      assignedClassNames: rawClasses,
      assignedClassIds,
      isDuplicate,
    });
  });

  return parsed;
}

export function downloadStaffImportTemplate(schoolName: string, classes: StreamClass[]) {
  const sampleClass = classes[0]?.name ?? 'S.1 East';
  const wsData = [
    [`${schoolName} — Bulk Teachers & Staff Import Template`],
    ['Full Name', 'Email', 'Username', 'Role (class_teacher / teacher / dos / bursar / headteacher / school_admin)', 'Phone (+256/07...)', 'Assigned Classes'],
    ['Ms. Grace Namono', 'gnamono@school.ac.ug', 'gnamono', 'class_teacher', '0772410885', sampleClass],
    ['Mr. Peter Okello', 'pokello@school.ac.ug', 'pokello', 'bursar', '+256701884210', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 24 }, { wch: 26 }, { wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff_Teachers');
  XLSX.writeFile(wb, 'SchuleFlow_Staff_Import_Template.xlsx');
}

export function exportClassResultsWorkbook(
  examClass: ExamClass,
  summary: ClassPerformanceSummary,
  settings: SchoolSettings
) {
  const wb = XLSX.utils.book_new();
  const isOlevel = examClass.level === 'olevel';

  const studentHeaders = [
    'Rank',
    'Admission No',
    'Student Name',
    'Gender',
    ...(isOlevel ? [] : ['Combination']),
    ...examClass.subjects.map((s) =>
      isOlevel ? `${s.name} (100%)` : `${s.name} (/${s.maxMarks})`
    ),
    'Average (%)',
    'Grade',
    ...(isOlevel ? [] : ['Total Points', 'Principal Passes']),
    'Standing',
    'Class Teacher Remark',
  ];

  const sortedStudents = [...summary.studentResults].sort((a, b) => a.rank - b.rank);
  const studentRows = sortedStudents.map((sr) => [
    sr.rank,
    sr.admissionNo,
    sr.name,
    sr.gender,
    ...(isOlevel ? [] : [sr.combinationCode ?? '—']),
    ...examClass.subjects.map((s) => {
      const cell = sr.subjectResults[s.id];
      if (cell?.exempted) return 'EX';
      if (cell?.missed) return 'ABS';
      return cell?.numericValue !== null && cell?.numericValue !== undefined
        ? cell.numericValue
        : '—';
    }),
    sr.percentage,
    sr.grade,
    ...(isOlevel ? [] : [sr.totalPoints, sr.principalPassesCount]),
    sr.status,
    sr.teacherRemark,
  ]);

  const wsStudents = XLSX.utils.aoa_to_sheet([
    [`${settings.schoolName} — ${settings.termName} (${settings.academicYear})`],
    [
      `${examClass.className} · ${isOlevel ? "O'Level CBC" : "A'Level"} · ${examClass.examTitle} · Class Teacher: ${examClass.classTeacher}`,
    ],
    [],
    studentHeaders,
    ...studentRows,
  ]);
  wsStudents['!cols'] = [
    { wch: 7 },
    { wch: 15 },
    { wch: 24 },
    { wch: 8 },
    ...(isOlevel ? [] : [{ wch: 12 }]),
    ...examClass.subjects.map(() => ({ wch: 16 })),
    { wch: 14 },
    { wch: 8 },
    ...(isOlevel ? [] : [{ wch: 12 }, { wch: 14 }]),
    { wch: 15 },
    { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Student Results');

  const summaryRows: Array<Array<string | number>> = [
    [`${settings.schoolName} — Class Performance Summary`],
    [
      `Class: ${examClass.className} (${isOlevel ? "O'Level CBC" : "A'Level"})`,
      `Exam: ${examClass.examTitle}`,
      `Date: ${examClass.examDate}`,
    ],
    [],
    ['Overall Metric', 'Value'],
    ['Total Students', summary.studentResults.length],
    ['Class Mean (%)', summary.classMeanPercent],
    ['Class Median (%)', summary.classMedianPercent],
    ['Pass Rate (%)', summary.passRate],
    ['Students Passed', summary.passedCount],
    ['Students Needing Support', summary.needsSupportCount],
    [
      'Top Student',
      summary.highestStudent
        ? `${summary.highestStudent.name} (${isOlevel ? `${summary.highestStudent.percentage}%` : `${summary.highestStudent.totalPoints} pts`})`
        : '—',
    ],
    [],
    [
      'Subject',
      'Code',
      'Category',
      'Max Marks',
      'Pass Mark',
      'Mean',
      'Mean (%)',
      'Median',
      'Highest',
      'Lowest',
      'Pass Rate (%)',
      'Std Dev',
    ],
    ...summary.subjectSummaries.map((sub) => [
      sub.name,
      sub.code,
      sub.category,
      sub.maxMarks,
      sub.passMark,
      sub.mean,
      sub.meanPercent,
      sub.median,
      sub.highest,
      sub.lowest,
      sub.passRate,
      sub.stdDev,
    ]),
    [],
    ['Grade', 'Descriptor', 'Student Count', 'Class Share (%)'],
    ...summary.gradeDistribution.map((g) => [g.grade, g.label, g.count, g.percent]),
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Class Summary');

  const safeFile = `${examClass.className}_${examClass.examTitle}`
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  XLSX.writeFile(wb, `${safeFile}_Results_Summary.xlsx`);
}

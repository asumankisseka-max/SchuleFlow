import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  LayoutTemplate,
  Printer,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { DEFAULT_REPORT_CARD_LAYOUT } from '../data/sampleData';
import type {
  ClassPerformanceSummary,
  ExamClass,
  ExaminationPeriod,
  ReportCardAccent,
  ReportCardLayoutConfig,
  SchoolDatabase,
  SchoolSettings,
  StudentCalculatedResult,
  UserRole,
} from '../types';
import {
  buildExamClassView,
  calculateClassPerformance,
  getGradingScaleForLevel,
} from '../utils/calculations';
import { processStudentPhoto } from '../utils/photo';
import { ReportCardCustomizer } from './ReportCardCustomizer';

interface ReportCardsViewProps {
  db: SchoolDatabase;
  activeExam: ExaminationPeriod;
  activeClassId: string;
  userRole: UserRole;
  selectedStudentId: string | null;
  onSelectClass: (classId: string) => void;
  onSelectStudent: (studentId: string) => void;
  onUpdateSettings: (updated: SchoolSettings) => void;
  onUpdateStudentRemark: (
    examId: string,
    studentId: string,
    field: 'classTeacherRemark' | 'dosRemark' | 'headTeacherRemark',
    value: string
  ) => void;
  onUpdateStudentPhoto: (studentId: string, photoDataUrl: string | undefined) => void;
  onIncrementReportsPrinted: (count: number) => void;
}

const ACCENT_PALETTE: Record<
  ReportCardAccent,
  {
    hex: string;
    border: string;
    headerBg: string;
    softBg: string;
    text: string;
    tableHead: string;
  }
> = {
  navy: {
    hex: '#1e3a8a',
    border: 'border-blue-900',
    headerBg: 'bg-blue-900 text-white',
    softBg: 'bg-blue-50/70',
    text: 'text-blue-900',
    tableHead: 'bg-slate-50 text-slate-800',
  },
  emerald: {
    hex: '#065f46',
    border: 'border-emerald-900',
    headerBg: 'bg-emerald-900 text-white',
    softBg: 'bg-emerald-50/70',
    text: 'text-emerald-900',
    tableHead: 'bg-emerald-50/50 text-emerald-950',
  },
  burgundy: {
    hex: '#881337',
    border: 'border-rose-950',
    headerBg: 'bg-rose-900 text-white',
    softBg: 'bg-rose-50/60',
    text: 'text-rose-950',
    tableHead: 'bg-rose-50/40 text-rose-950',
  },
  indigo: {
    hex: '#3730a3',
    border: 'border-indigo-900',
    headerBg: 'bg-indigo-900 text-white',
    softBg: 'bg-indigo-50/60',
    text: 'text-indigo-900',
    tableHead: 'bg-indigo-50/40 text-indigo-950',
  },
  slate: {
    hex: '#0f172a',
    border: 'border-slate-900',
    headerBg: 'bg-slate-900 text-white',
    softBg: 'bg-slate-100/80',
    text: 'text-slate-900',
    tableHead: 'bg-slate-100 text-slate-800',
  },
};

function CrestMark({
  layout,
  accentHex,
  inverted = false,
}: {
  layout: ReportCardLayoutConfig;
  accentHex: string;
  inverted?: boolean;
}) {
  if (layout.crestType === 'none') return null;
  if (layout.crestType === 'custom' && layout.customLogoDataUrl) {
    return (
      <img
        src={layout.customLogoDataUrl}
        alt="School crest"
        className="h-12 w-12 object-contain rounded shrink-0 bg-white p-0.5"
      />
    );
  }

  const iconProps = {
    className: 'h-6 w-6',
    style: { color: inverted ? '#ffffff' : accentHex },
    'aria-hidden': true as const,
  };

  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border ${
        inverted ? 'border-white/25 bg-white/10' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {layout.crestType === 'book' ? (
        <BookOpen {...iconProps} />
      ) : layout.crestType === 'award' ? (
        <Award {...iconProps} />
      ) : layout.crestType === 'graduation' ? (
        <GraduationCap {...iconProps} />
      ) : (
        <Shield {...iconProps} />
      )}
    </div>
  );
}

function StudentVsClassMiniChart({
  examClass,
  studentResult,
  subjectMeanPercentMap,
  accentHex,
}: {
  examClass: ExamClass;
  studentResult: StudentCalculatedResult;
  subjectMeanPercentMap: Map<string, number>;
  accentHex: string;
}) {
  const rows = examClass.subjects.map((sub) => {
    const cell = studentResult.subjectResults[sub.id];
    return {
      id: sub.id,
      name: sub.name,
      studentPct: cell?.percentage ?? 0,
      hasValue: cell?.percentage !== null && cell?.percentage !== undefined,
      classPct: subjectMeanPercentMap.get(sub.id) ?? 0,
    };
  });

  if (rows.length === 0) return null;

  return (
    <section className="mt-4 rounded-md border border-slate-200 p-3.5 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <span className="text-xs font-semibold text-slate-800">
          Subject Performance vs. Class Mean (%)
        </span>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span
              className="h-2 w-2.5 rounded-xs inline-block"
              style={{ backgroundColor: accentHex }}
            />
            Student %
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2.5 rounded-xs bg-slate-300 inline-block" />
            Class Mean %
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map((r) => (
          <div key={r.id} className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700 truncate pr-2">{r.name}</span>
              <span className="font-mono tabular-nums text-slate-700 shrink-0">
                {r.hasValue ? `${r.studentPct.toFixed(0)}%` : '—'} vs {r.classPct.toFixed(0)}%
              </span>
            </div>
            <div className="relative h-2.5 w-full rounded-xs bg-slate-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-slate-300/80"
                style={{ width: `${Math.min(100, Math.max(0, r.classPct))}%` }}
              />
              {r.hasValue && (
                <div
                  className="absolute top-0.5 bottom-0.5 left-0 rounded-r-xs"
                  style={{
                    width: `${Math.min(100, Math.max(0, r.studentPct))}%`,
                    backgroundColor: accentHex,
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportCardSheet({
  studentResult,
  examClass,
  summary,
  settings,
  editable,
  onUpdateRemark,
  onUpdatePhoto,
}: {
  studentResult: StudentCalculatedResult;
  examClass: ExamClass;
  summary: ClassPerformanceSummary;
  settings: SchoolSettings;
  editable?: boolean;
  onUpdateRemark?: (
    field: 'classTeacherRemark' | 'dosRemark' | 'headTeacherRemark',
    value: string
  ) => void;
  onUpdatePhoto?: (photoDataUrl: string | undefined) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const layout: ReportCardLayoutConfig = {
    ...DEFAULT_REPORT_CARD_LAYOUT,
    ...(settings.reportLayout ?? {}),
  };
  const accent = ACCENT_PALETTE[layout.accentColor] ?? ACCENT_PALETTE.navy;
  const isOlevel = examClass.level === 'olevel';
  const cbc = settings.cbcConfig;
  const aPolicy = settings.alevelPolicy;
  const activeScale = getGradingScaleForLevel(examClass.level, settings);

  const subjectMeanPercentMap = useMemo(
    () => new Map(summary.subjectSummaries.map((s) => [s.subjectId, s.meanPercent])),
    [summary.subjectSummaries]
  );

  const subjectMeanMap = useMemo(
    () => new Map(summary.subjectSummaries.map((s) => [s.subjectId, s.mean])),
    [summary.subjectSummaries]
  );

  const studentRecord = examClass.students.find((s) => s.id === studentResult.studentId);
  const hasCustomTeacherRemark = Boolean(studentRecord?.teacherRemark?.trim());
  const hasCustomDosRemark = Boolean(studentRecord?.dosRemark?.trim());
  const hasCustomHeadRemark = Boolean(studentRecord?.headTeacherRemark?.trim());

  const isModern = layout.style === 'modern';
  const isCompact = layout.style === 'compact';
  const isCentered = layout.headerAlignment === 'centered';

  const cellPad = isCompact ? 'py-1.5 px-2' : 'py-2 px-2';
  const sheetPad = isCompact ? 'p-5 sm:p-6' : 'p-6 sm:p-8';

  const principalSubjects = examClass.subjects.filter((s) => s.category !== 'subsidiary');
  const subsidiarySubjects = examClass.subjects.filter((s) => s.category === 'subsidiary');

  const handlePhotoSelect = async (file: File) => {
    if (!onUpdatePhoto) return;
    try {
      const processed = await processStudentPhoto(file);
      onUpdatePhoto(processed);
    } catch {
      // Ignore unreadable image
    }
  };

  return (
    <article
      className={`mx-auto max-w-4xl rounded-lg border border-slate-300 bg-white ${sheetPad} text-slate-900 print:border-slate-400 print:rounded-none print:max-w-none print:p-5`}
    >
      {/* Institutional Letterhead */}
      {isModern ? (
        <header
          className={`rounded-md ${accent.headerBg} px-5 py-4 ${
            isCentered ? 'text-center' : 'flex flex-wrap items-center justify-between gap-4'
          }`}
        >
          <div
            className={`flex items-center gap-3.5 ${
              isCentered ? 'justify-center flex-col' : ''
            }`}
          >
            <CrestMark layout={layout} accentHex={accent.hex} inverted />
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight text-white">
                {settings.schoolName}
              </h2>
              {layout.schoolMotto && (
                <p className="text-xs text-white/80 italic">{layout.schoolMotto}</p>
              )}
              {layout.schoolContact && (
                <p className="text-[11px] text-white/75 mt-0.5">{layout.schoolContact}</p>
              )}
            </div>
          </div>
          <div className={isCentered ? 'mt-2 pt-2 border-t border-white/20' : 'text-right'}>
            <p className="font-display text-sm font-semibold text-white">
              {layout.reportTitle || 'Official Terminal Academic Report'}
            </p>
            <p className="text-xs text-white/85 mt-0.5">
              {isOlevel ? "O'Level Competency-Based Report" : "A'Level UACE Academic Report"} ·{' '}
              {settings.academicYear}
            </p>
            <p className="text-[11px] text-white/75">{examClass.examTitle}</p>
          </div>
        </header>
      ) : (
        <header
          className={`border-b-2 ${accent.border} pb-4 ${
            isCentered ? 'text-center space-y-2' : 'flex flex-wrap items-start justify-between gap-4'
          }`}
        >
          <div
            className={`flex items-center gap-3.5 ${
              isCentered ? 'justify-center flex-col' : ''
            }`}
          >
            <CrestMark layout={layout} accentHex={accent.hex} />
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
                {settings.schoolName}
              </h2>
              {layout.schoolMotto && (
                <p className="text-xs text-slate-600 italic">{layout.schoolMotto}</p>
              )}
              <p className="text-xs text-slate-600 mt-0.5">{examClass.examTitle}</p>
              {layout.schoolContact && (
                <p className="text-[11px] text-slate-500 mt-0.5">{layout.schoolContact}</p>
              )}
            </div>
          </div>
          <div className={isCentered ? 'pt-1' : 'text-right'}>
            <p className={`font-display text-sm font-semibold ${accent.text}`}>
              {layout.reportTitle || 'Official Terminal Academic Report'}
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              {isOlevel
                ? "Lower Secondary · O'Level CBC"
                : "Upper Secondary · A'Level Principal & Subsidiary"}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              Exam Date: {examClass.examDate}
            </p>
          </div>
        </header>
      )}

      {/* Student Metadata + Optional Passport Photo */}
      <section
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          isCompact ? 'py-3' : 'py-4'
        } border-b border-slate-200 text-xs`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
          <div>
            <span className="block text-slate-500">Student Name</span>
            <span className="mt-0.5 block text-sm font-semibold text-slate-900">
              {studentResult.name}
            </span>
            <span className="block text-[11px] text-slate-500">Gender: {studentResult.gender}</span>
          </div>
          <div>
            <span className="block text-slate-500">Admission No.</span>
            <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-slate-900">
              {studentResult.admissionNo}
            </span>
            {!isOlevel && studentResult.combinationCode && (
              <span className="block font-mono text-[11px] font-semibold text-blue-900">
                Comb: {studentResult.combinationCode}
              </span>
            )}
          </div>
          <div>
            <span className="block text-slate-500">Class &amp; Teacher</span>
            <span className="mt-0.5 block text-sm font-medium text-slate-900">
              {examClass.className}
            </span>
            <span className="block text-[11px] text-slate-500">{examClass.classTeacher}</span>
          </div>
          <div>
            <span className="block text-slate-500">
              {layout.showClassPosition ? 'Class Position' : 'Academic Standing'}
            </span>
            {layout.showClassPosition ? (
              <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-slate-900">
                #{studentResult.rank} of {summary.studentResults.length}
              </span>
            ) : (
              <span className="mt-0.5 block text-sm font-semibold text-slate-900">
                {studentResult.status}
              </span>
            )}
          </div>
        </div>

        {/* Passport Photo Frame */}
        {layout.showStudentPhoto && (
          <div className="shrink-0 flex sm:flex-col items-center gap-2">
            <div className="relative h-24 w-20 rounded border border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
              {studentResult.photoDataUrl ? (
                <img
                  src={studentResult.photoDataUrl}
                  alt={`${studentResult.name} passport`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 px-1 text-center">
                  <User className="h-7 w-7 stroke-[1.5]" aria-hidden="true" />
                  <span className="text-[9px] font-medium mt-1 leading-tight">Passport Photo</span>
                </div>
              )}
            </div>

            {editable && onUpdatePhoto && (
              <div className="no-print flex items-center gap-1.5">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhotoSelect(f);
                    e.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Camera className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>{studentResult.photoDataUrl ? 'Change' : 'Upload'}</span>
                </button>
                {studentResult.photoDataUrl && (
                  <button
                    type="button"
                    onClick={() => onUpdatePhoto(undefined)}
                    title="Remove photo"
                    aria-label="Remove student photo"
                    className="rounded border border-slate-300 bg-white p-0.5 text-slate-500 hover:text-red-600"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Subject Marks Table: Distinct O'Level CBC vs A'Level Principal+Subsidiary */}
      <section className={isCompact ? 'mt-3.5 overflow-x-auto' : 'mt-5 overflow-x-auto'}>
        {isOlevel ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className={`border-y border-slate-300 ${accent.tableHead} font-semibold`}>
                <th className={cellPad}>Subject</th>
                {layout.showSubjectTeacher && <th className={cellPad}>Teacher</th>}
                {cbc.aoiInputMode === 'single_aoi' ? (
                  <th className={`${cellPad} text-right`}>Classwork /{cbc.aoiMaxMark}</th>
                ) : (
                  <>
                    <th className={`${cellPad} text-right`}>U1</th>
                    <th className={`${cellPad} text-right`}>U2</th>
                    <th className={`${cellPad} text-right`}>U3</th>
                  </>
                )}
                <th className={`${cellPad} text-right`}>AoI ({cbc.formativeWeight}%)</th>
                <th className={`${cellPad} text-right`}>EoT ({cbc.summativeWeight}%)</th>
                <th className={`${cellPad} text-right`}>Total (100%)</th>
                <th className={`${cellPad} text-center`}>ID</th>
                {layout.showClassAverage && <th className={`${cellPad} text-right`}>Class Avg</th>}
                {layout.showSubjectRank && <th className={`${cellPad} text-center`}>Pos.</th>}
                <th className={`${cellPad} text-center`}>Grade</th>
                <th className={`${cellPad} text-right`}>Descriptor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {examClass.subjects.map((sub) => {
                const cell = studentResult.subjectResults[sub.id];
                const classMeanPct = subjectMeanPercentMap.get(sub.id) ?? 0;
                const isFail = cell?.passed === false;

                return (
                  <tr key={sub.id}>
                    <td className={`${cellPad} font-medium text-slate-900`}>
                      {sub.name}{' '}
                      {layout.showSubjectCode && (
                        <span className="font-mono text-[11px] text-slate-400">({sub.code})</span>
                      )}
                    </td>
                    {layout.showSubjectTeacher && (
                      <td className={`${cellPad} text-slate-600`}>{sub.teacher || '—'}</td>
                    )}
                    {cbc.aoiInputMode === 'single_aoi' ? (
                      <td className={`${cellPad} text-right font-mono tabular-nums text-slate-600`}>
                        {cell?.u1 !== null && cell?.u1 !== undefined ? cell.u1.toFixed(1) : '—'}
                      </td>
                    ) : (
                      <>
                        <td className={`${cellPad} text-right font-mono tabular-nums text-slate-600`}>
                          {cell?.u1 !== null && cell?.u1 !== undefined ? cell.u1.toFixed(1) : '—'}
                        </td>
                        <td className={`${cellPad} text-right font-mono tabular-nums text-slate-600`}>
                          {cell?.u2 !== null && cell?.u2 !== undefined ? cell.u2.toFixed(1) : '—'}
                        </td>
                        <td className={`${cellPad} text-right font-mono tabular-nums text-slate-600`}>
                          {cell?.u3 !== null && cell?.u3 !== undefined ? cell.u3.toFixed(1) : '—'}
                        </td>
                      </>
                    )}
                    <td className={`${cellPad} text-right font-mono tabular-nums text-slate-800 font-medium`}>
                      {cell?.aoiScore20 !== null && cell?.aoiScore20 !== undefined
                        ? cell.aoiScore20.toFixed(1)
                        : '—'}
                    </td>
                    <td className={`${cellPad} text-right font-mono tabular-nums text-slate-800 font-medium`}>
                      {cell?.eotScore80 !== null && cell?.eotScore80 !== undefined
                        ? cell.eotScore80.toFixed(1)
                        : '—'}
                    </td>
                    <td
                      className={`${cellPad} text-right font-mono tabular-nums font-semibold ${
                        isFail ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {cell?.exempted
                        ? 'EX'
                        : cell?.missed
                          ? 'ABS'
                          : cell?.percentage !== null && cell?.percentage !== undefined
                            ? `${cell.percentage.toFixed(1)}%`
                            : '—'}
                    </td>
                    <td className={`${cellPad} text-center font-mono tabular-nums text-slate-800`}>
                      {cell?.identifier ?? '—'}
                    </td>
                    {layout.showClassAverage && (
                      <td className={`${cellPad} text-right font-mono tabular-nums text-slate-500`}>
                        {classMeanPct.toFixed(1)}%
                      </td>
                    )}
                    {layout.showSubjectRank && (
                      <td className={`${cellPad} text-center font-mono tabular-nums text-slate-700`}>
                        {cell?.subjectRank ? `#${cell.subjectRank}` : '—'}
                      </td>
                    )}
                    <td className={`${cellPad} text-center font-mono font-semibold text-slate-900`}>
                      {cell?.grade ?? '—'}
                    </td>
                    <td className={`${cellPad} text-right text-slate-700`}>
                      {cell?.gradeLabel ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={`border-t-2 ${accent.border} bg-slate-50 font-semibold text-slate-900`}>
                <td className={cellPad}>Overall CBC Standing</td>
                {layout.showSubjectTeacher && <td className={cellPad} />}
                <td
                  colSpan={cbc.aoiInputMode === 'single_aoi' ? 1 : 3}
                  className={`${cellPad} text-right text-[11px] font-normal text-slate-500`}
                >
                  Mean ({studentResult.assessedCount} subjects)
                </td>
                <td className={cellPad} />
                <td className={cellPad} />
                <td className={`${cellPad} text-right font-mono tabular-nums`}>
                  {studentResult.percentage.toFixed(1)}%
                </td>
                <td className={cellPad} />
                {layout.showClassAverage && (
                  <td className={`${cellPad} text-right font-mono tabular-nums text-slate-600`}>
                    {summary.classMeanPercent.toFixed(1)}%
                  </td>
                )}
                {layout.showSubjectRank && (
                  <td className={`${cellPad} text-center font-mono tabular-nums`}>
                    {layout.showClassPosition ? `#${studentResult.rank}` : '—'}
                  </td>
                )}
                <td className={`${cellPad} text-center font-mono`}>{studentResult.grade}</td>
                <td className={`${cellPad} text-right`}>{studentResult.gradeLabel}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="space-y-4">
            {/* A'Level Principal Subjects Table */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Principal Subjects {studentResult.combinationCode ? `(${studentResult.combinationCode})` : ''}
              </p>
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className={`border-y border-slate-300 ${accent.tableHead} font-semibold`}>
                    <th className={cellPad}>Principal Subject</th>
                    {layout.showSubjectTeacher && <th className={cellPad}>Teacher</th>}
                    <th className={`${cellPad} text-right`}>Mark (100)</th>
                    {layout.showClassAverage && <th className={`${cellPad} text-right`}>Class Avg</th>}
                    {layout.showSubjectRank && <th className={`${cellPad} text-center`}>Pos.</th>}
                    <th className={`${cellPad} text-center`}>Grade</th>
                    <th className={`${cellPad} text-right`}>Points</th>
                    <th className={`${cellPad} text-right`}>Descriptor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {principalSubjects.map((sub) => {
                    const cell = studentResult.subjectResults[sub.id];
                    const classMean = subjectMeanMap.get(sub.id) ?? 0;
                    const isFail = cell?.passed === false;
                    return (
                      <tr key={sub.id}>
                        <td className={`${cellPad} font-medium text-slate-900`}>
                          {sub.name}{' '}
                          {layout.showSubjectCode && (
                            <span className="font-mono text-[11px] text-slate-400">({sub.code})</span>
                          )}
                        </td>
                        {layout.showSubjectTeacher && (
                          <td className={`${cellPad} text-slate-600`}>{sub.teacher || '—'}</td>
                        )}
                        <td
                          className={`${cellPad} text-right font-mono tabular-nums font-semibold ${
                            isFail ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {cell?.exempted
                            ? 'EX'
                            : cell?.missed
                              ? 'ABS'
                              : cell?.numericValue !== null && cell?.numericValue !== undefined
                                ? cell.numericValue
                                : '—'}
                        </td>
                        {layout.showClassAverage && (
                          <td className={`${cellPad} text-right font-mono tabular-nums text-slate-500`}>
                            {classMean.toFixed(1)}
                          </td>
                        )}
                        {layout.showSubjectRank && (
                          <td className={`${cellPad} text-center font-mono tabular-nums text-slate-700`}>
                            {cell?.subjectRank ? `#${cell.subjectRank}` : '—'}
                          </td>
                        )}
                        <td className={`${cellPad} text-center font-mono font-bold text-slate-900`}>
                          {cell?.grade ?? '—'}
                        </td>
                        <td className={`${cellPad} text-right font-mono tabular-nums font-semibold text-slate-900`}>
                          {cell?.numericValue !== null && cell?.numericValue !== undefined
                            ? cell.points
                            : '—'}
                        </td>
                        <td className={`${cellPad} text-right text-slate-700`}>
                          {cell?.gradeLabel ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* A'Level Subsidiary Subjects Table */}
            {subsidiarySubjects.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Subsidiary Subjects (Pass Mark: {aPolicy.subsidiaryPassMark}%)
                </p>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className={`border-y border-slate-300 ${accent.tableHead} font-semibold`}>
                      <th className={cellPad}>Subsidiary Paper</th>
                      {layout.showSubjectTeacher && <th className={cellPad}>Teacher</th>}
                      <th className={`${cellPad} text-right`}>Mark (100)</th>
                      {layout.showClassAverage && <th className={`${cellPad} text-right`}>Class Avg</th>}
                      {layout.showSubjectRank && <th className={`${cellPad} text-center`}>Pos.</th>}
                      <th className={`${cellPad} text-center`}>Grade</th>
                      <th className={`${cellPad} text-right`}>Points</th>
                      <th className={`${cellPad} text-right`}>Standing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {subsidiarySubjects.map((sub) => {
                      const cell = studentResult.subjectResults[sub.id];
                      const classMean = subjectMeanMap.get(sub.id) ?? 0;
                      const isFail = cell?.passed === false;
                      return (
                        <tr key={sub.id}>
                          <td className={`${cellPad} font-medium text-slate-900`}>
                            {sub.name}{' '}
                            {layout.showSubjectCode && (
                              <span className="font-mono text-[11px] text-slate-400">({sub.code})</span>
                            )}
                          </td>
                          {layout.showSubjectTeacher && (
                            <td className={`${cellPad} text-slate-600`}>{sub.teacher || '—'}</td>
                          )}
                          <td
                            className={`${cellPad} text-right font-mono tabular-nums font-semibold ${
                              isFail ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {cell?.exempted
                              ? 'EX'
                              : cell?.missed
                                ? 'ABS'
                                : cell?.numericValue !== null && cell?.numericValue !== undefined
                                  ? cell.numericValue
                                  : '—'}
                          </td>
                          {layout.showClassAverage && (
                            <td className={`${cellPad} text-right font-mono tabular-nums text-slate-500`}>
                              {classMean.toFixed(1)}
                            </td>
                          )}
                          {layout.showSubjectRank && (
                            <td className={`${cellPad} text-center font-mono tabular-nums text-slate-700`}>
                              {cell?.subjectRank ? `#${cell.subjectRank}` : '—'}
                            </td>
                          )}
                          <td className={`${cellPad} text-center font-mono font-bold text-slate-900`}>
                            {cell?.grade ?? '—'}
                          </td>
                          <td className={`${cellPad} text-right font-mono tabular-nums font-semibold text-slate-900`}>
                            {cell?.numericValue !== null && cell?.numericValue !== undefined
                              ? cell.points
                              : '—'}
                          </td>
                          <td className={`${cellPad} text-right text-slate-700`}>
                            {cell?.gradeLabel ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Overall Result Summary Strip */}
      {layout.showOverallSummaryStrip && (
        <section
          className={`${
            isCompact ? 'mt-3.5 p-3' : 'mt-5 p-3.5'
          } grid grid-cols-2 sm:grid-cols-4 gap-3 border border-slate-200 rounded-md ${
            accent.softBg
          } text-xs`}
        >
          <div>
            <span className="text-slate-600">
              {isOlevel ? 'Overall CBC Grade' : 'Total UACE Points'}
            </span>
            <p className="mt-0.5 font-display text-base font-bold text-slate-900">
              {isOlevel
                ? `${studentResult.grade} · ${studentResult.gradeLabel}`
                : `${studentResult.totalPoints} / ${aPolicy.maxPrincipalsCount * 6 + (aPolicy.includeSubsidiaryPoints ? aPolicy.maxSubsidiariesCount : 0)} pts`}
            </p>
          </div>
          <div>
            <span className="text-slate-600">
              {isOlevel ? 'Term Average (%)' : 'Principal Passes'}
            </span>
            <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-slate-900">
              {isOlevel
                ? `${studentResult.percentage.toFixed(1)}%`
                : `${studentResult.principalPassesCount}P + ${studentResult.subsidiaryPassesCount}S`}
            </p>
          </div>
          <div>
            <span className="text-slate-600">Subjects Passed</span>
            <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-slate-900">
              {Math.max(0, studentResult.assessedCount - studentResult.failedSubjects.length)} /{' '}
              {studentResult.subjectCount}
            </p>
          </div>
          <div>
            <span className="text-slate-600">Academic Standing</span>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
              {studentResult.status === 'Passed' ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span className="text-emerald-800">Passed</span>
                </>
              ) : (
                <>
                  <TrendingUp className="h-4 w-4 text-blue-800 shrink-0" />
                  <span className="text-slate-900">{studentResult.status}</span>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* O'Level CBC Competency Observations (when recorded & enabled) */}
      {isOlevel && layout.showCompetenciesSection && (
        (() => {
          const obsList = examClass.subjects
            .map((s) => ({
              name: s.name,
              obs: studentResult.subjectResults[s.id]?.competencyObservation,
            }))
            .filter((o) => Boolean(o.obs));
          if (obsList.length === 0) return null;
          return (
            <section className="mt-4 rounded-md border border-slate-200 p-3 text-[11px] bg-slate-50/50 space-y-1">
              <p className="font-semibold text-slate-800">CBC Competency Observations</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-700">
                {obsList.map((o) => (
                  <p key={o.name}>
                    <strong className="text-slate-900">{o.name}:</strong> {o.obs}
                  </p>
                ))}
              </div>
            </section>
          );
        })()
      )}

      {/* Visual Subject Comparison Bar Chart */}
      {layout.showPerformanceChart && (
        <StudentVsClassMiniChart
          examClass={examClass}
          studentResult={studentResult}
          subjectMeanPercentMap={subjectMeanPercentMap}
          accentHex={accent.hex}
        />
      )}

      {/* Remarks Section: Class Teacher + DOS + Headteacher */}
      <section className={`${isCompact ? 'mt-3.5' : 'mt-5'} grid grid-cols-1 sm:grid-cols-2 gap-4`}>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-700">
              Class Teacher’s Remark
            </label>
            {editable && hasCustomTeacherRemark && onUpdateRemark && (
              <button
                type="button"
                onClick={() => onUpdateRemark('classTeacherRemark', '')}
                className="no-print inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Auto</span>
              </button>
            )}
          </div>
          {editable && onUpdateRemark ? (
            <>
              <textarea
                rows={isCompact ? 1 : 2}
                value={studentResult.teacherRemark}
                onChange={(e) => onUpdateRemark('classTeacherRemark', e.target.value)}
                className="no-print w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
              />
              <p className="hidden print:block rounded border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800">
                {studentResult.teacherRemark}
              </p>
            </>
          ) : (
            <p className="rounded border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800">
              {studentResult.teacherRemark}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-700">
              Headteacher’s Remark
            </label>
            {editable && hasCustomHeadRemark && onUpdateRemark && (
              <button
                type="button"
                onClick={() => onUpdateRemark('headTeacherRemark', '')}
                className="no-print inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Auto</span>
              </button>
            )}
          </div>
          {editable && onUpdateRemark ? (
            <>
              <textarea
                rows={isCompact ? 1 : 2}
                value={studentResult.headTeacherRemark}
                onChange={(e) => onUpdateRemark('headTeacherRemark', e.target.value)}
                className="no-print w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
              />
              <p className="hidden print:block rounded border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800">
                {studentResult.headTeacherRemark}
              </p>
            </>
          ) : (
            <p className="rounded border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800">
              {studentResult.headTeacherRemark}
            </p>
          )}
        </div>
      </section>

      {layout.showDosComment && (
        <section className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-700">
              Director of Studies (DOS) Comment
            </label>
            {editable && hasCustomDosRemark && onUpdateRemark && (
              <button
                type="button"
                onClick={() => onUpdateRemark('dosRemark', '')}
                className="no-print inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 hover:underline"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Auto</span>
              </button>
            )}
          </div>
          {editable && onUpdateRemark ? (
            <>
              <input
                type="text"
                value={studentResult.dosRemark}
                onChange={(e) => onUpdateRemark('dosRemark', e.target.value)}
                className="no-print w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
              />
              <p className="hidden print:block rounded border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-800">
                {studentResult.dosRemark}
              </p>
            </>
          ) : (
            <p className="rounded border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-800">
              {studentResult.dosRemark}
            </p>
          )}
        </section>
      )}

      {/* Term Closing & Next Term Opening Notice */}
      {layout.showNextTermDate && (layout.nextTermDate || layout.nextTermClosingDate) && (
        <section className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
          {layout.nextTermClosingDate && (
            <span>
              Term Closed On:{' '}
              <strong className="font-mono text-slate-900">{layout.nextTermClosingDate}</strong>
            </span>
          )}
          {layout.nextTermDate && (
            <span>
              Next Term Begins On:{' '}
              <strong className="font-mono text-slate-900">{layout.nextTermDate}</strong>
            </span>
          )}
        </section>
      )}

      {/* Grading Key */}
      {layout.showGradingKey && (
        <section className="mt-4 pt-3 border-t border-slate-200 space-y-1.5 text-[11px] text-slate-500">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-600">
              {isOlevel ? "O'Level CBC Grading Key:" : "A'Level Principal Grading Key:"}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
              {[...activeScale]
                .sort((a, b) => b.minPercentage - a.minPercentage)
                .map((band) => (
                  <span key={band.grade}>
                    {band.grade} ({band.minPercentage}%+ {band.label}
                    {!isOlevel ? ` · ${band.gpa}pt` : ''})
                  </span>
                ))}
            </div>
          </div>
          {isOlevel && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">CBC Identifiers (ID):</span>
              <span>
                1 = Basic (&lt;50%) · 2 = Moderate (50–79%) · 3 = Outstanding (80%+) | AoI (
                {cbc.formativeWeight}%) + EoT ({cbc.summativeWeight}%)
              </span>
            </div>
          )}
        </section>
      )}

      {/* Signatures & Optional Official Stamp */}
      <footer
        className={`${isCompact ? 'mt-5 pt-3' : 'mt-8 pt-4'} grid gap-6 text-xs ${
          layout.showParentSignature || layout.showSchoolStampBox
            ? 'grid-cols-1 sm:grid-cols-3'
            : 'grid-cols-2'
        }`}
      >
        <div>
          <div className="h-8 border-b border-slate-400" />
          <p className="mt-1.5 font-medium text-slate-800">{examClass.classTeacher}</p>
          <p className="text-[11px] text-slate-500">{layout.leftSignatureLabel}</p>
        </div>
        <div>
          <div className="h-8 border-b border-slate-400" />
          <p className="mt-1.5 font-medium text-slate-800">{settings.principalName}</p>
          <p className="text-[11px] text-slate-500">{layout.rightSignatureLabel}</p>
        </div>
        {layout.showParentSignature && (
          <div>
            <div className="h-8 border-b border-slate-400" />
            <p className="mt-1.5 font-medium text-slate-800">Parent / Guardian</p>
            <p className="text-[11px] text-slate-500">{layout.parentSignatureLabel}</p>
          </div>
        )}
        {layout.showSchoolStampBox && !layout.showParentSignature && (
          <div className="flex items-center justify-center">
            <div className="h-14 w-36 rounded border border-dashed border-slate-400 flex items-center justify-center text-[11px] text-slate-400">
              Official School Stamp
            </div>
          </div>
        )}
      </footer>

      {layout.showSchoolStampBox && layout.showParentSignature && (
        <div className="mt-4 flex justify-end">
          <div className="h-12 w-40 rounded border border-dashed border-slate-400 flex items-center justify-center text-[11px] text-slate-400">
            Official School Stamp
          </div>
        </div>
      )}

      {layout.footerNote && (
        <p className="mt-4 pt-2 border-t border-slate-100 text-center text-[11px] text-slate-400">
          {layout.footerNote}
        </p>
      )}
    </article>
  );
}

export function ReportCardsView({
  db,
  activeExam,
  activeClassId,
  userRole,
  selectedStudentId,
  onSelectClass,
  onSelectStudent,
  onUpdateSettings,
  onUpdateStudentRemark,
  onUpdateStudentPhoto,
  onIncrementReportsPrinted,
}: ReportCardsViewProps) {
  const [search, setSearch] = useState('');
  const [printMode, setPrintMode] = useState<'single' | 'all'>('single');
  const [leftPanelTab, setLeftPanelTab] = useState<'students' | 'customize'>('students');

  const scope = db.settings.curriculumScope ?? 'olevel_alevel';
  const scopedClasses = useMemo(() => {
    const filtered = db.classes.filter((c) =>
      scope === 'olevel_only'
        ? c.level === 'olevel'
        : scope === 'alevel_only'
          ? c.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : db.classes;
  }, [db.classes, scope]);

  const activeStreamClass = scopedClasses.find((c) => c.id === activeClassId) ?? scopedClasses[0];
  const { examClass, summary } = useMemo(() => {
    const view = buildExamClassView(activeExam, activeStreamClass, db);
    const perf = calculateClassPerformance(view.examClass, db.settings, view.entryMap);
    return { examClass: view.examClass, summary: perf };
  }, [activeExam, activeStreamClass, db]);

  const orderedResults = useMemo(
    () => [...summary.studentResults].sort((a, b) => a.rank - b.rank),
    [summary.studentResults]
  );

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderedResults;
    return orderedResults.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q)
    );
  }, [orderedResults, search]);

  const activeResult =
    orderedResults.find((s) => s.studentId === selectedStudentId) ?? orderedResults[0] ?? null;

  const activeIndex = activeResult
    ? orderedResults.findIndex((s) => s.studentId === activeResult.studentId)
    : -1;

  useEffect(() => {
    const handleAfterPrint = () => setPrintMode('single');
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const canEditRemarks = userRole !== 'teacher' || true;

  const triggerPrintSingle = () => {
    setPrintMode('single');
    onIncrementReportsPrinted(1);
    setTimeout(() => window.print(), 40);
  };

  const triggerPrintAll = () => {
    setPrintMode('all');
    onIncrementReportsPrinted(orderedResults.length);
    setTimeout(() => window.print(), 60);
  };

  if (!activeResult) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No active students in {activeStreamClass.name}. Register students first to generate report cards.
      </div>
    );
  }

  return (
    <div>
      <div className={printMode === 'all' ? 'print:hidden' : ''}>
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 no-print">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeStreamClass.id}
              onChange={(e) => onSelectClass(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
            >
              {scopedClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.level === 'olevel' ? "O'Level CBC" : "A'Level"})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={activeIndex <= 0}
              onClick={() => {
                if (activeIndex > 0) {
                  onSelectStudent(orderedResults[activeIndex - 1].studentId);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Prev</span>
            </button>
            <span className="font-mono text-xs tabular-nums text-slate-600 px-1">
              {activeIndex + 1} / {orderedResults.length}
            </span>
            <button
              type="button"
              disabled={activeIndex >= orderedResults.length - 1}
              onClick={() => {
                if (activeIndex < orderedResults.length - 1) {
                  onSelectStudent(orderedResults[activeIndex + 1].studentId);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setLeftPanelTab((prev) => (prev === 'customize' ? 'students' : 'customize'))
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                leftPanelTab === 'customize'
                  ? 'border-blue-700 bg-blue-50 text-blue-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{leftPanelTab === 'customize' ? 'Done Customizing' : 'Customize Layout'}</span>
            </button>
            <button
              type="button"
              onClick={triggerPrintAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Bulk Print ({orderedResults.length})</span>
            </button>
            <button
              type="button"
              onClick={triggerPrintSingle}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print Report Card</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-4 rounded-lg border border-slate-200 bg-white p-4 no-print">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md border border-slate-200 mb-3">
              <button
                type="button"
                onClick={() => setLeftPanelTab('students')}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors ${
                  leftPanelTab === 'students'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Students ({orderedResults.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftPanelTab('customize')}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors ${
                  leftPanelTab === 'customize'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Customize</span>
              </button>
            </div>

            {leftPanelTab === 'students' ? (
              <>
                <div className="relative mb-3">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find student by name or ID..."
                    className="w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                  {filteredList.map((stu) => {
                    const isSelected = stu.studentId === activeResult.studentId;
                    return (
                      <button
                        key={stu.studentId}
                        type="button"
                        onClick={() => onSelectStudent(stu.studentId)}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-blue-50 text-blue-950 font-medium border border-blue-200'
                            : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {stu.photoDataUrl ? (
                            <img
                              src={stu.photoDataUrl}
                              alt=""
                              className="h-7 w-6 rounded-xs object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="h-7 w-6 rounded-xs bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                              <User className="h-3.5 w-3.5 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{stu.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              #{stu.rank} · {stu.admissionNo}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono tabular-nums text-slate-900 font-semibold ml-2 shrink-0">
                          {examClass.level === 'olevel'
                            ? `${stu.percentage.toFixed(1)}%`
                            : `${stu.totalPoints} pts`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <ReportCardCustomizer
                compact
                layout={{ ...DEFAULT_REPORT_CARD_LAYOUT, ...db.settings.reportLayout }}
                onChange={(updatedLayout) =>
                  onUpdateSettings({ ...db.settings, reportLayout: updatedLayout })
                }
              />
            )}
          </div>

          <div className="xl:col-span-8">
            <ReportCardSheet
              studentResult={activeResult}
              examClass={examClass}
              summary={summary}
              settings={db.settings}
              editable={canEditRemarks}
              onUpdateRemark={(field, val) =>
                onUpdateStudentRemark(activeExam.id, activeResult.studentId, field, val)
              }
              onUpdatePhoto={(photo) => onUpdateStudentPhoto(activeResult.studentId, photo)}
            />
          </div>
        </div>
      </div>

      {/* Batch Print Stack */}
      {printMode === 'all' && (
        <div className="hidden print:block">
          {orderedResults.map((stu, idx) => (
            <div
              key={stu.studentId}
              className={idx < orderedResults.length - 1 ? 'report-page-break' : ''}
            >
              <ReportCardSheet
                studentResult={stu}
                examClass={examClass}
                summary={summary}
                settings={db.settings}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

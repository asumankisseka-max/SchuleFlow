import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Download,
  FileText,
  TrendingUp,
} from 'lucide-react';
import type {
  ClassPerformanceSummary,
  ExamClass,
  ExaminationPeriod,
  SchoolDatabase,
} from '../types';
import {
  buildExamClassView,
  calculateClassPerformance,
  getGradingScaleForLevel,
} from '../utils/calculations';
import { exportClassResultsWorkbook } from '../utils/excel';
import {
  ClassComparisonBarChart,
  ClassGradeMixChart,
  ScoreDistributionHistogram,
  SubjectPerformanceChart,
  SubjectStudentBarsChart,
} from './AnalyticsCharts';

interface ResultsAnalysisViewProps {
  db: SchoolDatabase;
  activeExam: ExaminationPeriod;
  activeClassId: string;
  onSelectClass: (classId: string) => void;
  onOpenReportCard: (studentId: string) => void;
}

export function ResultsAnalysisView({
  db,
  activeExam,
  activeClassId,
  onSelectClass,
  onOpenReportCard,
}: ResultsAnalysisViewProps) {
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

  const activeStreamClass =
    scopedClasses.find((c) => c.id === activeClassId) ?? scopedClasses[0];

  const { examClass, summary } = useMemo(() => {
    const view = buildExamClassView(activeExam, activeStreamClass, db);
    const perf = calculateClassPerformance(view.examClass, db.settings, view.entryMap);
    return { examClass: view.examClass, summary: perf };
  }, [activeExam, activeStreamClass, db]);

  const sameLevelEntries = useMemo(() => {
    return scopedClasses
      .filter((c) => c.level === activeStreamClass.level && activeExam.classIds.includes(c.id))
      .map((c) => {
        const view = buildExamClassView(activeExam, c, db);
        const sum: ClassPerformanceSummary = calculateClassPerformance(
          view.examClass,
          db.settings,
          view.entryMap
        );
        return { examClass: view.examClass, summary: sum };
      });
  }, [db, activeStreamClass.level, activeExam]);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    summary.subjectSummaries[0]?.subjectId ?? ''
  );

  useEffect(() => {
    if (!summary.subjectSummaries.some((s) => s.subjectId === selectedSubjectId)) {
      setSelectedSubjectId(summary.subjectSummaries[0]?.subjectId ?? '');
    }
  }, [summary.subjectSummaries, selectedSubjectId]);

  const selectedSubject =
    summary.subjectSummaries.find((s) => s.subjectId === selectedSubjectId) ??
    summary.subjectSummaries[0] ??
    null;

  const activeScale = getGradingScaleForLevel(examClass.level, db.settings);
  const isOlevel = examClass.level === 'olevel';

  // A'Level Combination breakdown
  const combinationBreakdown = useMemo(() => {
    if (isOlevel) return [];
    const groups = new Map<string, typeof summary.studentResults>();
    for (const sr of summary.studentResults) {
      const code = sr.combinationCode ?? 'General';
      const arr = groups.get(code) ?? [];
      arr.push(sr);
      groups.set(code, arr);
    }
    return Array.from(groups.entries()).map(([code, members]) => {
      const avgPts =
        members.length > 0
          ? Number(
              (members.reduce((a, m) => a + m.totalPoints, 0) / members.length).toFixed(1)
            )
          : 0;
      const avgPct =
        members.length > 0
          ? Number((members.reduce((a, m) => a + m.percentage, 0) / members.length).toFixed(1))
          : 0;
      return { code, count: members.length, avgPts, avgPct };
    });
  }, [isOlevel, summary.studentResults]);

  return (
    <div className="space-y-6">
      {/* Header & Export */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Results &amp; Academic Performance Analysis
          </h2>
          <p className="text-xs text-slate-500">
            {examClass.className} ({isOlevel ? "O'Level CBC" : "A'Level"}) · {examClass.examTitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeStreamClass.id}
            onChange={(e) => onSelectClass(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
          >
            {scopedClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => exportClassResultsWorkbook(examClass, summary, db.settings)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Results Excel</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Class Mean Average</span>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {summary.classMeanPercent.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Median: {summary.classMedianPercent.toFixed(1)}%
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Class Pass Rate</span>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {summary.passRate.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {summary.passedCount} passed · {summary.needsSupportCount} need support
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Top Student</span>
          <p className="mt-1.5 font-display text-base font-bold text-slate-900 truncate">
            {summary.highestStudent?.name ?? '—'}
          </p>
          <p className="text-[11px] font-mono text-slate-600 mt-0.5">
            {summary.highestStudent
              ? isOlevel
                ? `${summary.highestStudent.percentage.toFixed(1)}% (${summary.highestStudent.grade})`
                : `${summary.highestStudent.totalPoints} pts (${summary.highestStudent.percentage.toFixed(1)}%)`
              : 'Pending'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Strongest Subject</span>
          <p className="mt-1.5 font-display text-base font-bold text-slate-900 truncate">
            {summary.topSubject?.name ?? '—'}
          </p>
          <p className="text-[11px] font-mono text-slate-600 mt-0.5">
            {summary.topSubject
              ? `Mean ${summary.topSubject.meanPercent.toFixed(1)}% · Pass ${summary.topSubject.passRate.toFixed(0)}%`
              : 'Pending'}
          </p>
        </div>
      </div>

      {/* Cross-Class Performance & Grade Composition */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-blue-800" />
            <h3 className="font-display text-base font-bold text-slate-900">
              {isOlevel ? "O'Level Classes Comparison" : "A'Level Classes Comparison"}
            </h3>
          </div>
          <ClassComparisonBarChart
            entries={sameLevelEntries}
            activeClassId={examClass.id}
            onSelectClass={(eid) => {
              const target = sameLevelEntries.find((e) => e.examClass.id === eid);
              if (target) onSelectClass(target.examClass.classId);
            }}
          />
        </section>

        <section className="xl:col-span-5 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-display text-base font-bold text-slate-900 mb-3">
            Score Distribution Histogram ({examClass.className})
          </h3>
          <ScoreDistributionHistogram
            studentResults={summary.studentResults}
            classMeanPercent={summary.classMeanPercent}
          />
        </section>
      </div>

      {/* Subject Performance Chart + Student Drilldown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-display text-base font-bold text-slate-900 mb-3">
            Subject Mean, Pass Rate &amp; Min–Max Spread
          </h3>
          <SubjectPerformanceChart
            subjects={summary.subjectSummaries}
            gradingScale={activeScale}
            selectedSubjectId={selectedSubject?.subjectId}
            onSelectSubject={setSelectedSubjectId}
          />
        </section>

        <section className="xl:col-span-5 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-display text-base font-bold text-slate-900 mb-3">
            {selectedSubject
              ? `${selectedSubject.name} — Student Ranking`
              : 'Subject Student Breakdown'}
          </h3>
          {selectedSubject ? (
            <SubjectStudentBarsChart
              subject={selectedSubject}
              studentResults={summary.studentResults}
              onOpenReportCard={onOpenReportCard}
            />
          ) : (
            <p className="text-xs text-slate-500">Select a subject bar to inspect scores.</p>
          )}
        </section>
      </div>

      {/* Grade Mix & A'Level Combinations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          className={`${
            combinationBreakdown.length > 0 ? 'lg:col-span-7' : 'lg:col-span-12'
          } rounded-lg border border-slate-200 bg-white p-5`}
        >
          <h3 className="font-display text-base font-bold text-slate-900 mb-3">
            Class Grade Distribution Composition
          </h3>
          <ClassGradeMixChart
            entries={sameLevelEntries}
            gradingScale={activeScale}
            activeClassId={examClass.id}
            onSelectClass={(eid) => {
              const target = sameLevelEntries.find((e) => e.examClass.id === eid);
              if (target) onSelectClass(target.examClass.classId);
            }}
          />
        </section>

        {combinationBreakdown.length > 0 && (
          <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="font-display text-base font-bold text-slate-900">
              A&apos;Level Subject Combination Performance
            </h3>
            <div className="space-y-2.5">
              {combinationBreakdown.map((cb) => (
                <div
                  key={cb.code}
                  className="rounded-md border border-slate-200 p-3 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-900">{cb.code}</span>
                    <span className="text-slate-500 ml-2">({cb.count} students)</span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-800 font-semibold">
                    Avg {cb.avgPts} pts · {cb.avgPct}%
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Subject Summary Table with Missing Marks Tracker */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-slate-900">
            Subject Statistical Summary &amp; Missing Marks Tracker
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <th className="py-2.5 px-3">Subject</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3 text-right">Recorded</th>
                <th className="py-2.5 px-3 text-right">Missing</th>
                <th className="py-2.5 px-3 text-right">Mean %</th>
                <th className="py-2.5 px-3 text-right">Highest</th>
                <th className="py-2.5 px-3 text-right">Lowest</th>
                <th className="py-2.5 px-3 text-right">Pass Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {summary.subjectSummaries.map((sub) => (
                <tr key={sub.subjectId} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 font-medium text-slate-900">
                    {sub.name}{' '}
                    <span className="font-mono text-slate-400">({sub.code})</span>
                  </td>
                  <td className="py-2.5 px-3 capitalize text-slate-600">{sub.category}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {sub.enteredCount}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                      sub.missingCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {sub.missingCount}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {sub.meanPercent.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {sub.highest}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {sub.lowest}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {sub.passRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top Performers & Students Needing Academic Support */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-blue-800" />
            <h3 className="font-display text-base font-bold text-slate-900">
              Top Performers ({examClass.className})
            </h3>
          </div>
          <div className="divide-y divide-slate-200 text-xs">
            {summary.topPerformers.map((sr) => (
              <div key={sr.studentId} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-bold text-blue-900 mr-2">#{sr.rank}</span>
                  <span className="font-semibold text-slate-900">{sr.name}</span>
                  <span className="ml-2 font-mono text-slate-400">{sr.admissionNo}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {isOlevel ? `${sr.percentage.toFixed(1)}% (${sr.grade})` : `${sr.totalPoints} pts · ${sr.percentage.toFixed(1)}%`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenReportCard(sr.studentId)}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-blue-800 hover:bg-blue-50"
                  >
                    <FileText className="h-3 w-3" />
                    <span>Report</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="font-display text-base font-bold text-slate-900">
              Students Needing Academic Support
            </h3>
          </div>
          {summary.needsSupportStudents.length === 0 ? (
            <div className="py-6 text-center text-xs text-emerald-700 flex items-center justify-center gap-1.5">
              <TrendingUp className="h-4 w-4" />
              <span>All assessed students met pass benchmarks in this class.</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 text-xs">
              {summary.needsSupportStudents.map((sr) => (
                <div key={sr.studentId} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">
                      {sr.name}{' '}
                      <span className="font-mono font-normal text-slate-400">
                        ({sr.admissionNo})
                      </span>
                    </div>
                    <div className="text-[11px] text-red-700 truncate">
                      Support needed: {sr.failedSubjects.join(', ') || 'Low overall average'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono tabular-nums font-semibold text-red-700">
                      {sr.percentage.toFixed(1)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenReportCard(sr.studentId)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-blue-800 hover:bg-blue-50"
                    >
                      <FileText className="h-3 w-3" />
                      <span>Report</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

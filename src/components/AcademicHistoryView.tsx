import { useMemo, useState } from 'react';
import { FileText, History, Search, TrendingUp } from 'lucide-react';
import type { SchoolDatabase } from '../types';
import { getStudentAcademicHistory } from '../utils/calculations';

interface AcademicHistoryViewProps {
  db: SchoolDatabase;
  selectedStudentId: string | null;
  onSelectStudent: (studentId: string) => void;
  onOpenReportCard: (classId: string, studentId: string, examId: string) => void;
}

export function AcademicHistoryView({
  db,
  selectedStudentId,
  onSelectStudent,
  onOpenReportCard,
}: AcademicHistoryViewProps) {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');

  const activeStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.students
      .filter((s) => {
        if (classFilter !== 'all' && s.classId !== classFilter) return false;
        if (q) {
          return (
            s.fullName.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [db.students, classFilter, search]);

  const currentStudent =
    db.students.find((s) => s.id === selectedStudentId) ?? activeStudents[0] ?? db.students[0];

  const currentClass = db.classes.find((c) => c.id === currentStudent?.classId);
  const combo = currentStudent?.combinationId
    ? db.combinations.find((c) => c.id === currentStudent.combinationId)
    : undefined;

  const historyPoints = useMemo(
    () => (currentStudent ? getStudentAcademicHistory(currentStudent.id, db) : []),
    [currentStudent, db]
  );

  // Collect union of all subjects seen across history points
  const subjectColumns = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    historyPoints.forEach((pt) => {
      pt.subjectScores.forEach((sc) => {
        if (!map.has(sc.subjectId)) {
          map.set(sc.subjectId, { code: sc.subjectCode, name: sc.subjectName });
        }
      });
    });
    return Array.from(map.entries()).map(([id, meta]) => ({ id, ...meta }));
  }, [historyPoints]);

  // SVG Trend Line Geometry
  const chartW = 620;
  const chartH = 210;
  const pad = { top: 20, right: 30, bottom: 38, left: 42 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Student Academic History &amp; Term Progression
          </h2>
          <p className="text-xs text-slate-500">
            Multi-term longitudinal tracking across Term I, Term II, and Term III examinations
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Student Selector */}
        <div className="xl:col-span-4 rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student or admission no..."
              className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Classes</option>
            {db.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
            {activeStudents.map((stu) => {
              const cls = db.classes.find((c) => c.id === stu.classId);
              const active = stu.id === currentStudent?.id;
              return (
                <button
                  key={stu.id}
                  type="button"
                  onClick={() => onSelectStudent(stu.id)}
                  className={`w-full px-3 py-2.5 text-left transition-colors ${
                    active ? 'bg-blue-50 text-blue-950' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900">{stu.fullName}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {stu.admissionNo} · {cls?.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Progression Dashboard */}
        {currentStudent && (
          <div className="xl:col-span-8 space-y-5">
            {/* Student Profile Header */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-blue-800" />
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    {currentStudent.fullName}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  {currentStudent.admissionNo} · {currentClass?.name} (
                  {currentClass?.level === 'olevel' ? "O'Level CBC" : `A'Level ${combo?.code ?? ''}`}) ·{' '}
                  Gender: {currentStudent.gender}
                </p>
              </div>
              {historyPoints.length >= 2 && (
                <div className="text-right">
                  <span className="text-xs text-slate-500 block">Overall Trajectory</span>
                  {(() => {
                    const first = historyPoints[0].percentage;
                    const last = historyPoints[historyPoints.length - 1].percentage;
                    const diff = Number((last - first).toFixed(1));
                    return (
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-sm font-bold ${
                          diff >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        <TrendingUp className="h-4 w-4" />
                        {diff >= 0 ? `+${diff}%` : `${diff}%`} since {historyPoints[0].term}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Term-over-Term Trend SVG Chart */}
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h4 className="font-display text-sm font-bold text-slate-900 mb-3">
                Average Score Trend Across Terms (%)
              </h4>
              {historyPoints.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No recorded examination marks found for this student yet.
                </p>
              ) : (
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto overflow-visible">
                  {[0, 25, 50, 75, 100].map((tick) => {
                    const y = pad.top + plotH - (tick / 100) * plotH;
                    return (
                      <g key={tick}>
                        <line
                          x1={pad.left}
                          y1={y}
                          x2={chartW - pad.right}
                          y2={y}
                          stroke={tick === 50 ? '#94a3b8' : '#e2e8f0'}
                          strokeDasharray={tick === 50 ? '4 4' : undefined}
                        />
                        <text
                          x={pad.left - 8}
                          y={y + 3.5}
                          textAnchor="end"
                          className="fill-slate-500 font-mono text-[10px]"
                        >
                          {tick}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Connecting polyline */}
                  {historyPoints.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#1e3a8a"
                      strokeWidth={2.5}
                      points={historyPoints
                        .map((pt, idx) => {
                          const x =
                            pad.left +
                            (idx / Math.max(1, historyPoints.length - 1)) * plotW;
                          const y = pad.top + plotH - (pt.percentage / 100) * plotH;
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {historyPoints.map((pt, idx) => {
                    const x =
                      historyPoints.length === 1
                        ? pad.left + plotW / 2
                        : pad.left + (idx / (historyPoints.length - 1)) * plotW;
                    const y = pad.top + plotH - (pt.percentage / 100) * plotH;
                    return (
                      <g key={pt.examId}>
                        <circle
                          cx={x}
                          cy={y}
                          r={5}
                          fill="#1e3a8a"
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                        <text
                          x={x}
                          y={y - 10}
                          textAnchor="middle"
                          className="fill-slate-900 font-mono text-[10.5px] font-bold"
                        >
                          {pt.percentage.toFixed(1)}% ({pt.grade})
                        </text>
                        <text
                          x={x}
                          y={pad.top + plotH + 18}
                          textAnchor="middle"
                          className="fill-slate-700 text-[11px] font-semibold"
                        >
                          {pt.term} {pt.academicYear}
                        </text>
                        <text
                          x={x}
                          y={pad.top + plotH + 31}
                          textAnchor="middle"
                          className="fill-slate-400 font-mono text-[9.5px]"
                        >
                          Rank #{pt.rank}/{pt.classSize}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </section>

            {/* Subject-by-Subject Term Comparison Table */}
            {historyPoints.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-bold text-slate-900">
                    Subject Progression Matrix
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {historyPoints.map((pt) => (
                      <button
                        key={pt.examId}
                        type="button"
                        onClick={() =>
                          onOpenReportCard(currentStudent.classId, currentStudent.id, pt.examId)
                        }
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-50"
                      >
                        <FileText className="h-3 w-3" />
                        <span>{pt.term} Report</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                        <th className="py-2.5 px-3">Subject</th>
                        {historyPoints.map((pt) => (
                          <th key={pt.examId} className="py-2.5 px-3 text-right">
                            {pt.term} {pt.academicYear}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {subjectColumns.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {sub.name}{' '}
                            <span className="font-mono text-slate-400">({sub.code})</span>
                          </td>
                          {historyPoints.map((pt) => {
                            const found = pt.subjectScores.find((s) => s.subjectId === sub.id);
                            return (
                              <td
                                key={pt.examId}
                                className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800"
                              >
                                {found && found.score !== null
                                  ? `${found.score.toFixed(1)}% (${found.grade})`
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                        <td className="py-2.5 px-3 text-slate-900">Overall Average / Rank</td>
                        {historyPoints.map((pt) => (
                          <td
                            key={pt.examId}
                            className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-900"
                          >
                            {pt.percentage.toFixed(1)}% · #{pt.rank}/{pt.classSize}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

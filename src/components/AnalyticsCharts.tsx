import { useMemo, useState } from 'react';
import type {
  ClassPerformanceSummary,
  ExamClass,
  GradeBand,
  StudentCalculatedResult,
  SubjectSummary,
} from '../types';

export interface ClassAnalyticsEntry {
  examClass: ExamClass;
  summary: ClassPerformanceSummary;
}

const GRADE_COLORS: Record<string, string> = {
  A: '#1e3a8a', // deep navy
  B: '#0284c7', // cerulean blue
  C: '#0d9488', // teal
  D: '#d97706', // amber
  E: '#ea580c', // orange
  F: '#dc2626', // crimson
};

const FALLBACK_PALETTE = ['#1e3a8a', '#0284c7', '#0d9488', '#d97706', '#dc2626', '#64748b'];

function getGradeColor(grade: string, idx: number): string {
  const key = grade.trim().toUpperCase().charAt(0);
  return GRADE_COLORS[key] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

/* -------------------------------------------------------------------------- */
/* 1. Cross-Class Performance Grouped Bar Chart                               */
/* -------------------------------------------------------------------------- */

export function ClassComparisonBarChart({
  entries,
  activeClassId,
  onSelectClass,
}: {
  entries: ClassAnalyticsEntry[];
  activeClassId: string;
  onSelectClass?: (classId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-500">
        No class examinations available to compare.
      </div>
    );
  }

  const width = 680;
  const height = 270;
  const pad = { top: 24, right: 20, bottom: 52, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const groupWidth = plotW / entries.length;
  const barWidth = Math.min(26, Math.max(12, groupWidth * 0.22));
  const barGap = 4;

  const hoveredEntry = entries.find((e) => e.examClass.id === hoveredId) ?? null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Class performance comparison chart"
      >
        {/* Y-axis gridlines */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = pad.top + plotH - (tick / 100) * plotH;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke={tick === 50 ? '#cbd5e1' : '#e2e8f0'}
                strokeDasharray={tick === 50 ? '4 4' : undefined}
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[10px] tabular-nums"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Bars per class */}
        {entries.map((entry, idx) => {
          const { examClass, summary } = entry;
          const isActive = examClass.id === activeClassId;
          const isHovered = examClass.id === hoveredId;
          const cx = pad.left + idx * groupWidth + groupWidth / 2;

          const metrics = [
            { label: 'Mean %', value: summary.classMeanPercent, color: '#1e3a8a' },
            { label: 'Median %', value: summary.classMedianPercent, color: '#0284c7' },
            { label: 'Pass Rate %', value: summary.passRate, color: '#059669' },
          ];

          const totalBarsW = metrics.length * barWidth + (metrics.length - 1) * barGap;
          const startX = cx - totalBarsW / 2;

          return (
            <g
              key={examClass.id}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredId(examClass.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectClass?.(examClass.id)}
            >
              {/* Active/hover subtle backdrop column */}
              <rect
                x={pad.left + idx * groupWidth + 4}
                y={pad.top - 6}
                width={Math.max(10, groupWidth - 8)}
                height={plotH + 12}
                rx={6}
                fill={isActive ? '#eff6ff' : isHovered ? '#f8fafc' : 'transparent'}
                stroke={isActive ? '#bfdbfe' : 'transparent'}
                strokeWidth={1}
              />

              {metrics.map((m, mIdx) => {
                const bx = startX + mIdx * (barWidth + barGap);
                const bh = Math.max(2, (Math.min(100, Math.max(0, m.value)) / 100) * plotH);
                const by = pad.top + plotH - bh;
                return (
                  <g key={m.label}>
                    <rect
                      x={bx}
                      y={by}
                      width={barWidth}
                      height={bh}
                      rx={3}
                      fill={m.color}
                      opacity={hoveredId && !isHovered ? 0.6 : 1}
                    />
                    <text
                      x={bx + barWidth / 2}
                      y={by - 5}
                      textAnchor="middle"
                      className="fill-slate-700 font-mono text-[9.5px] font-medium tabular-nums"
                    >
                      {Math.round(m.value)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis Class Label */}
              <text
                x={cx}
                y={pad.top + plotH + 18}
                textAnchor="middle"
                className={`text-[11px] font-semibold ${
                  isActive ? 'fill-blue-900' : 'fill-slate-800'
                }`}
              >
                {examClass.className}
              </text>
              <text
                x={cx}
                y={pad.top + plotH + 32}
                textAnchor="middle"
                className="fill-slate-500 font-mono text-[9.5px] tabular-nums"
              >
                {examClass.students.length} students
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredEntry && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
          <div className="font-semibold text-slate-900">
            {hoveredEntry.examClass.className} · {hoveredEntry.examClass.examTitle}
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-slate-700">
            <span>Mean: {hoveredEntry.summary.classMeanPercent.toFixed(1)}%</span>
            <span>Median: {hoveredEntry.summary.classMedianPercent.toFixed(1)}%</span>
            <span>Pass Rate: {hoveredEntry.summary.passRate.toFixed(1)}%</span>
            {hoveredEntry.summary.highestStudent && (
              <span className="font-sans text-slate-600">
                Top: {hoveredEntry.summary.highestStudent.name} (
                {hoveredEntry.summary.highestStudent.percentage.toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Cross-Class Grade Composition Stacked Bars                              */
/* -------------------------------------------------------------------------- */

export function ClassGradeMixChart({
  entries,
  gradingScale,
  activeClassId,
  onSelectClass,
}: {
  entries: ClassAnalyticsEntry[];
  gradingScale: GradeBand[];
  activeClassId: string;
  onSelectClass?: (classId: string) => void;
}) {
  const orderedScale = useMemo(
    () => [...gradingScale].sort((a, b) => b.minPercentage - a.minPercentage),
    [gradingScale]
  );

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {orderedScale.map((band, idx) => (
          <span key={band.grade} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-xs inline-block"
              style={{ backgroundColor: getGradeColor(band.grade, idx) }}
            />
            <span className="font-mono font-semibold text-slate-800">{band.grade}</span>
            <span className="text-slate-500">{band.label}</span>
          </span>
        ))}
      </div>

      <div className="space-y-3">
        {entries.map(({ examClass, summary }) => {
          const isActive = examClass.id === activeClassId;
          return (
            <button
              key={examClass.id}
              type="button"
              onClick={() => onSelectClass?.(examClass.id)}
              className={`w-full text-left rounded-md border p-3 transition-colors ${
                isActive
                  ? 'border-blue-300 bg-blue-50/40'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-2">
                <span className="font-semibold text-slate-900">
                  {examClass.className}{' '}
                  <span className="font-normal text-slate-500">· {examClass.examTitle}</span>
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  Mean {summary.classMeanPercent.toFixed(1)}% · Pass {summary.passRate.toFixed(0)}%
                </span>
              </div>
              <div className="flex h-6 w-full overflow-hidden rounded bg-slate-100">
                {summary.gradeDistribution.map((g, gIdx) => {
                  if (g.percent <= 0) return null;
                  return (
                    <div
                      key={g.grade}
                      title={`${g.grade} (${g.label}): ${g.count} students (${g.percent}%)`}
                      style={{
                        width: `${g.percent}%`,
                        backgroundColor: getGradeColor(g.grade, gIdx),
                      }}
                      className="flex items-center justify-center text-[10px] font-mono font-semibold text-white tabular-nums transition-all"
                    >
                      {g.percent >= 10 ? `${g.grade} ${Math.round(g.percent)}%` : ''}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Subject Performance Interactive SVG Chart (Mean/Spread OR Grade Mix)    */
/* -------------------------------------------------------------------------- */

export function SubjectPerformanceChart({
  subjects,
  gradingScale,
  selectedSubjectId,
  onSelectSubject,
}: {
  subjects: SubjectSummary[];
  gradingScale: GradeBand[];
  selectedSubjectId?: string | null;
  onSelectSubject?: (subjectId: string) => void;
}) {
  const [chartMode, setChartMode] = useState<'metrics' | 'grades'>('metrics');
  const [hoveredSubId, setHoveredSubId] = useState<string | null>(null);

  const orderedScale = useMemo(
    () => [...gradingScale].sort((a, b) => b.minPercentage - a.minPercentage),
    [gradingScale]
  );

  if (subjects.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-500">
        No subjects configured for this examination.
      </div>
    );
  }

  const width = 720;
  const height = 290;
  const pad = { top: 24, right: 20, bottom: 54, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const colW = plotW / subjects.length;
  const hoveredSub = subjects.find((s) => s.subjectId === hoveredSubId) ?? null;

  return (
    <div>
      {/* Chart Mode Controls & Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md border border-slate-200">
          <button
            type="button"
            onClick={() => setChartMode('metrics')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              chartMode === 'metrics'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Mean, Pass Rate &amp; Range
          </button>
          <button
            type="button"
            onClick={() => setChartMode('grades')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              chartMode === 'grades'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Grade Mix per Subject
          </button>
        </div>

        {chartMode === 'metrics' ? (
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-blue-900 inline-block" />
              Mean %
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600 inline-block" />
              Pass Rate %
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-slate-500 inline-block" />
              Min–Max Spread
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {orderedScale.map((band, idx) => (
              <span key={band.grade} className="inline-flex items-center gap-1">
                <span
                  className="h-2.5 w-2.5 rounded-xs inline-block"
                  style={{ backgroundColor: getGradeColor(band.grade, idx) }}
                />
                <span className="font-mono font-medium">{band.grade}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Subject performance analytics chart"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = pad.top + plotH - (tick / 100) * plotH;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke={tick === 50 ? '#94a3b8' : '#e2e8f0'}
                strokeDasharray={tick === 50 ? '4 4' : undefined}
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[10px] tabular-nums"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {subjects.map((sub, idx) => {
          const cx = pad.left + idx * colW + colW / 2;
          const isSelected = sub.subjectId === selectedSubjectId;
          const isHovered = sub.subjectId === hoveredSubId;

          const barW = Math.min(24, Math.max(12, colW * 0.24));

          return (
            <g
              key={sub.subjectId}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredSubId(sub.subjectId)}
              onMouseLeave={() => setHoveredSubId(null)}
              onClick={() => onSelectSubject?.(sub.subjectId)}
            >
              <rect
                x={pad.left + idx * colW + 4}
                y={pad.top - 6}
                width={Math.max(10, colW - 8)}
                height={plotH + 12}
                rx={6}
                fill={isSelected ? '#eff6ff' : isHovered ? '#f8fafc' : 'transparent'}
                stroke={isSelected ? '#93c5fd' : 'transparent'}
                strokeWidth={1}
              />

              {chartMode === 'metrics' ? (
                <>
                  {/* Mean % Bar */}
                  {(() => {
                    const meanH = Math.max(
                      2,
                      (Math.min(100, Math.max(0, sub.meanPercent)) / 100) * plotH
                    );
                    const meanY = pad.top + plotH - meanH;
                    const meanX = cx - barW - 3;

                    const passH = Math.max(
                      2,
                      (Math.min(100, Math.max(0, sub.passRate)) / 100) * plotH
                    );
                    const passY = pad.top + plotH - passH;
                    const passX = cx + 1;

                    const whiskerX = passX + barW + 7;
                    const highY =
                      pad.top + plotH - (Math.min(100, Math.max(0, sub.highestPercent)) / 100) * plotH;
                    const lowY =
                      pad.top + plotH - (Math.min(100, Math.max(0, sub.lowestPercent)) / 100) * plotH;
                    const medY =
                      pad.top + plotH - (Math.min(100, Math.max(0, sub.medianPercent)) / 100) * plotH;

                    return (
                      <>
                        <rect
                          x={meanX}
                          y={meanY}
                          width={barW}
                          height={meanH}
                          rx={3}
                          fill="#1e3a8a"
                          opacity={hoveredSubId && !isHovered ? 0.65 : 1}
                        />
                        <text
                          x={meanX + barW / 2}
                          y={meanY - 5}
                          textAnchor="middle"
                          className="fill-slate-700 font-mono text-[9.5px] font-semibold tabular-nums"
                        >
                          {Math.round(sub.meanPercent)}
                        </text>

                        <rect
                          x={passX}
                          y={passY}
                          width={barW}
                          height={passH}
                          rx={3}
                          fill="#059669"
                          opacity={hoveredSubId && !isHovered ? 0.65 : 1}
                        />
                        <text
                          x={passX + barW / 2}
                          y={passY - 5}
                          textAnchor="middle"
                          className="fill-emerald-800 font-mono text-[9.5px] font-medium tabular-nums"
                        >
                          {Math.round(sub.passRate)}
                        </text>

                        {/* Min-Max Whisker */}
                        {sub.enteredCount > 0 && (
                          <g>
                            <line
                              x1={whiskerX}
                              y1={highY}
                              x2={whiskerX}
                              y2={lowY}
                              stroke="#64748b"
                              strokeWidth={1.5}
                            />
                            <line
                              x1={whiskerX - 3.5}
                              y1={highY}
                              x2={whiskerX + 3.5}
                              y2={highY}
                              stroke="#64748b"
                              strokeWidth={1.5}
                            />
                            <line
                              x1={whiskerX - 3.5}
                              y1={lowY}
                              x2={whiskerX + 3.5}
                              y2={lowY}
                              stroke="#64748b"
                              strokeWidth={1.5}
                            />
                            <circle
                              cx={whiskerX}
                              cy={medY}
                              r={3}
                              fill="#0f172a"
                              stroke="#ffffff"
                              strokeWidth={1}
                            />
                          </g>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                /* Grade Mix 100% Stacked Bar */
                (() => {
                  const stackW = Math.min(38, colW * 0.45);
                  const stackX = cx - stackW / 2;
                  const total = sub.enteredCount || 1;
                  let currentY = pad.top + plotH;

                  return orderedScale
                    .slice()
                    .reverse()
                    .map((band, revIdx) => {
                      const origIdx = orderedScale.length - 1 - revIdx;
                      const count = sub.gradeCounts[band.grade] ?? 0;
                      const segH = (count / total) * plotH;
                      if (segH <= 0) return null;
                      currentY -= segH;
                      return (
                        <rect
                          key={band.grade}
                          x={stackX}
                          y={currentY}
                          width={stackW}
                          height={segH}
                          fill={getGradeColor(band.grade, origIdx)}
                          stroke="#ffffff"
                          strokeWidth={0.75}
                        />
                      );
                    });
                })()
              )}

              {/* X-axis Subject Label */}
              <text
                x={cx}
                y={pad.top + plotH + 17}
                textAnchor="middle"
                className={`font-mono text-[10.5px] font-semibold ${
                  isSelected ? 'fill-blue-900' : 'fill-slate-800'
                }`}
              >
                {sub.code}
              </text>
              <text
                x={cx}
                y={pad.top + plotH + 31}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {sub.name.length > 13 ? `${sub.name.slice(0, 12)}…` : sub.name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover / Selected Subject Info Strip */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
        {hoveredSub ? (
          <>
            <span className="font-semibold text-slate-900">
              {hoveredSub.name} ({hoveredSub.code})
            </span>
            <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-slate-700">
              <span>
                Mean: {hoveredSub.mean}/{hoveredSub.maxMarks} ({hoveredSub.meanPercent}%)
              </span>
              <span>Median: {hoveredSub.median}</span>
              <span>
                Range: {hoveredSub.lowest}–{hoveredSub.highest}
              </span>
              <span>Pass Rate: {hoveredSub.passRate}%</span>
              <span>Std Dev: {hoveredSub.stdDev}</span>
            </div>
          </>
        ) : (
          <span className="text-slate-500">
            Hover any subject bar for detailed statistics, or click a subject to inspect student scores below.
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Class Score Distribution Histogram                                      */
/* -------------------------------------------------------------------------- */

const SCORE_BANDS = [
  { id: 'b0', label: '<40%', min: 0, max: 39.999, color: '#dc2626' },
  { id: 'b40', label: '40–49%', min: 40, max: 49.999, color: '#ea580c' },
  { id: 'b50', label: '50–59%', min: 50, max: 59.999, color: '#d97706' },
  { id: 'b60', label: '60–69%', min: 60, max: 69.999, color: '#0d9488' },
  { id: 'b70', label: '70–79%', min: 70, max: 79.999, color: '#0284c7' },
  { id: 'b80', label: '80–89%', min: 80, max: 89.999, color: '#1d4ed8' },
  { id: 'b90', label: '90–100%', min: 90, max: 100.01, color: '#1e3a8a' },
];

export function ScoreDistributionHistogram({
  studentResults,
  classMeanPercent,
}: {
  studentResults: StudentCalculatedResult[];
  classMeanPercent: number;
}) {
  const [hoveredBandId, setHoveredBandId] = useState<string | null>(null);

  const validStudents = useMemo(
    () => studentResults.filter((s) => s.assessedCount > 0),
    [studentResults]
  );

  const buckets = useMemo(
    () =>
      SCORE_BANDS.map((band) => {
        const members = validStudents.filter(
          (s) => s.percentage >= band.min && s.percentage <= band.max
        );
        return { ...band, count: members.length, members };
      }),
    [validStudents]
  );

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const width = 460;
  const height = 220;
  const pad = { top: 22, right: 14, bottom: 38, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const colW = plotW / buckets.length;

  const hoveredBucket = buckets.find((b) => b.id === hoveredBandId) ?? null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Class score distribution histogram"
      >
        {[0, Math.ceil(maxCount / 2), maxCount].map((tick, i) => {
          const y = pad.top + plotH - (tick / maxCount) * plotH;
          return (
            <g key={`${tick}-${i}`}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={pad.left - 6}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[10px] tabular-nums"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {buckets.map((bucket, idx) => {
          const barW = Math.min(34, colW * 0.65);
          const bx = pad.left + idx * colW + (colW - barW) / 2;
          const bh = bucket.count > 0 ? Math.max(4, (bucket.count / maxCount) * plotH) : 0;
          const by = pad.top + plotH - bh;
          const isHovered = hoveredBandId === bucket.id;

          return (
            <g
              key={bucket.id}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredBandId(bucket.id)}
              onMouseLeave={() => setHoveredBandId(null)}
            >
              <rect
                x={pad.left + idx * colW + 2}
                y={pad.top}
                width={colW - 4}
                height={plotH}
                rx={4}
                fill={isHovered ? '#f1f5f9' : 'transparent'}
              />
              {bh > 0 && (
                <>
                  <rect
                    x={bx}
                    y={by}
                    width={barW}
                    height={bh}
                    rx={3}
                    fill={bucket.color}
                    opacity={hoveredBandId && !isHovered ? 0.65 : 1}
                  />
                  <text
                    x={bx + barW / 2}
                    y={by - 5}
                    textAnchor="middle"
                    className="fill-slate-800 font-mono text-[10px] font-semibold tabular-nums"
                  >
                    {bucket.count}
                  </text>
                </>
              )}
              <text
                x={pad.left + idx * colW + colW / 2}
                y={pad.top + plotH + 16}
                textAnchor="middle"
                className="fill-slate-600 font-mono text-[9.5px] tabular-nums"
              >
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {hoveredBucket ? (
          hoveredBucket.count > 0 ? (
            <span>
              <strong className="text-slate-900">{hoveredBucket.label}:</strong>{' '}
              {hoveredBucket.members.map((m) => `${m.name} (${m.percentage.toFixed(1)}%)`).join(', ')}
            </span>
          ) : (
            <span>
              <strong className="text-slate-900">{hoveredBucket.label}:</strong> No students in this score range.
            </span>
          )
        ) : (
          <span>
            Class mean sits at{' '}
            <strong className="font-mono text-slate-900">{classMeanPercent.toFixed(1)}%</strong>. Hover any bar to see students in that bracket.
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Subject Deep-Dive Student Score Bars                                    */
/* -------------------------------------------------------------------------- */

export function SubjectStudentBarsChart({
  subject,
  studentResults,
  onOpenReportCard,
}: {
  subject: SubjectSummary;
  studentResults: StudentCalculatedResult[];
  onOpenReportCard?: (studentId: string) => void;
}) {
  const passPercent = subject.maxMarks > 0 ? (subject.passMark / subject.maxMarks) * 100 : 50;

  const rows = useMemo(() => {
    return studentResults
      .map((sr) => {
        const cell = sr.subjectResults[subject.subjectId];
        return {
          studentId: sr.studentId,
          name: sr.name,
          admissionNo: sr.admissionNo,
          score: cell?.numericValue ?? null,
          pct: cell?.percentage ?? null,
          grade: cell?.grade ?? '—',
          passed: cell?.passed ?? null,
          rank: cell?.subjectRank ?? null,
        };
      })
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [studentResults, subject.subjectId]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pb-1 border-b border-slate-200">
        <span>
          Sorted highest to lowest · Pass mark: {subject.passMark}/{subject.maxMarks} ({passPercent.toFixed(0)}%)
        </span>
        <span>
          Subject mean: <strong className="font-mono text-slate-800">{subject.meanPercent}%</strong>
        </span>
      </div>

      <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
        {rows.map((row) => {
          const pctVal = row.pct ?? 0;
          const isBelowPass = row.passed === false;
          const isMissing = row.score === null;

          return (
            <button
              key={row.studentId}
              type="button"
              onClick={() => onOpenReportCard?.(row.studentId)}
              className="group flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                {row.rank ? `#${row.rank}` : '—'}
              </span>
              <span className="w-36 sm:w-44 shrink-0 truncate text-xs font-medium text-slate-800 group-hover:text-blue-800">
                {row.name}
              </span>
              <div className="relative flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                {/* Pass mark vertical guide */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-slate-400/80 z-10"
                  style={{ left: `${Math.min(100, Math.max(0, passPercent))}%` }}
                />
                {/* Subject mean dashed guide */}
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-blue-700/70 z-10"
                  style={{ left: `${Math.min(100, Math.max(0, subject.meanPercent))}%` }}
                />
                {!isMissing && (
                  <div
                    className={`h-full rounded-l transition-all ${
                      isBelowPass ? 'bg-red-500' : pctVal >= 80 ? 'bg-blue-800' : 'bg-sky-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, pctVal))}%` }}
                  />
                )}
              </div>
              <span
                className={`w-24 shrink-0 text-right font-mono text-xs tabular-nums ${
                  isMissing
                    ? 'text-amber-700'
                    : isBelowPass
                      ? 'font-semibold text-red-700'
                      : 'font-medium text-slate-800'
                }`}
              >
                {isMissing ? 'Missing' : `${row.score}/${subject.maxMarks} (${row.grade})`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

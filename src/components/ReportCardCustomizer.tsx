import { useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  GraduationCap,
  Loader2,
  RotateCcw,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import { DEFAULT_REPORT_CARD_LAYOUT } from '../data/sampleData';
import type {
  ReportCardAccent,
  ReportCardCrest,
  ReportCardLayoutConfig,
  ReportCardStyle,
} from '../types';
import { processSchoolBadge } from '../utils/photo';

interface ReportCardCustomizerProps {
  layout: ReportCardLayoutConfig;
  onChange: (updated: ReportCardLayoutConfig) => void;
  onUploadLogo?: (dataUrl: string) => Promise<string>;
  compact?: boolean;
}

const STYLE_OPTIONS: Array<{ id: ReportCardStyle; label: string; desc: string }> = [
  { id: 'classic', label: 'Classic', desc: 'Formal crest & bordered grid' },
  { id: 'modern', label: 'Modern', desc: 'Accent banner & KPI strip' },
  { id: 'compact', label: 'Compact', desc: 'Dense single-page transcript' },
];

const ACCENT_OPTIONS: Array<{ id: ReportCardAccent; label: string; swatch: string }> = [
  { id: 'navy', label: 'Navy', swatch: '#1e3a8a' },
  { id: 'emerald', label: 'Forest', swatch: '#065f46' },
  { id: 'burgundy', label: 'Burgundy', swatch: '#881337' },
  { id: 'indigo', label: 'Indigo', swatch: '#3730a3' },
  { id: 'slate', label: 'Charcoal', swatch: '#0f172a' },
];

const CREST_OPTIONS: Array<{
  id: Exclude<ReportCardCrest, 'custom'>;
  label: string;
  icon: typeof Shield | null;
}> = [
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'book', label: 'Book', icon: BookOpen },
  { id: 'award', label: 'Crest', icon: Award },
  { id: 'graduation', label: 'Cap', icon: GraduationCap },
  { id: 'none', label: 'None', icon: null },
];

export function ReportCardCustomizer({
  layout,
  onChange,
  onUploadLogo,
  compact = false,
}: ReportCardCustomizerProps) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const update = <K extends keyof ReportCardLayoutConfig>(
    key: K,
    value: ReportCardLayoutConfig[K]
  ) => {
    onChange({ ...layout, [key]: value });
  };

  const handleLogoUpload = async (file: File) => {
    if (file.size > 1024 * 1024 * 4) return;
    setUploadingLogo(true);
    try {
      const processed = await processSchoolBadge(file);
      const storedUrl = onUploadLogo ? await onUploadLogo(processed) : processed;
      onChange({
        ...layout,
        crestType: 'custom',
        customLogoDataUrl: storedUrl,
      });
    } catch {
      // Ignore malformed image
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <p className="font-semibold text-slate-900 text-sm">Report Card Layout</p>
          <p className="text-slate-500 text-xs">Applies to preview &amp; batch printing</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_REPORT_CARD_LAYOUT)}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>

      {/* Template Style */}
      <div className="space-y-2">
        <label className="block font-semibold text-slate-800">Template Style</label>
        <div className="grid grid-cols-3 gap-2">
          {STYLE_OPTIONS.map((opt) => {
            const active = layout.style === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => update('style', opt.id)}
                className={`rounded-md border p-2 text-left transition-colors ${
                  active
                    ? 'border-blue-700 bg-blue-50/70 text-blue-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="font-semibold text-xs">{opt.label}</div>
                {!compact && <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Accent Color & Header Alignment */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block font-semibold text-slate-800">School Accent Color</label>
          <div className="flex items-center gap-2">
            {ACCENT_OPTIONS.map((acc) => {
              const active = layout.accentColor === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  title={acc.label}
                  aria-label={`${acc.label} accent`}
                  onClick={() => update('accentColor', acc.id)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${
                    active ? 'border-slate-900 scale-110' : 'border-white ring-1 ring-slate-300'
                  }`}
                  style={{ backgroundColor: acc.swatch }}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block font-semibold text-slate-800">Letterhead Alignment</label>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md border border-slate-200">
            <button
              type="button"
              onClick={() => update('headerAlignment', 'split')}
              className={`flex-1 py-1 text-xs font-medium rounded transition-colors ${
                layout.headerAlignment === 'split'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Left / Right
            </button>
            <button
              type="button"
              onClick={() => update('headerAlignment', 'centered')}
              className={`flex-1 py-1 text-xs font-medium rounded transition-colors ${
                layout.headerAlignment === 'centered'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Centered
            </button>
          </div>
        </div>
      </div>

      {/* School Crest / Custom Logo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-800">School Crest / Logo</label>
          {layout.customLogoDataUrl && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...layout, crestType: 'shield', customLogoDataUrl: undefined })
              }
              className="inline-flex items-center gap-1 text-[11px] text-red-700 hover:underline"
            >
              <Trash2 className="h-3 w-3" />
              <span>Remove Logo</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CREST_OPTIONS.map((crest) => {
            const Icon = crest.icon;
            const active = layout.crestType === crest.id;
            return (
              <button
                key={crest.id}
                type="button"
                onClick={() => update('crestType', crest.id)}
                className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-blue-700 bg-blue-50 text-blue-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{crest.label}</span>
              </button>
            );
          })}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleLogoUpload(f);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploadingLogo}
            onClick={() => logoInputRef.current?.click()}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              layout.crestType === 'custom'
                ? 'border-blue-700 bg-blue-50 text-blue-900'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            } disabled:opacity-60`}
          >
            {uploadingLogo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {uploadingLogo ? 'Uploading...' : layout.customLogoDataUrl ? 'Change Logo' : 'Upload Logo'}
            </span>
          </button>
        </div>
      </div>

      {/* Report Title, Motto, Contact */}
      <div className="space-y-2.5 pt-2 border-t border-slate-200">
        <div>
          <label className="block font-medium text-slate-700 mb-1">Report Card Title</label>
          <input
            type="text"
            value={layout.reportTitle}
            onChange={(e) => update('reportTitle', e.target.value)}
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block font-medium text-slate-700 mb-1">School Motto</label>
            <input
              type="text"
              value={layout.schoolMotto}
              onChange={(e) => update('schoolMotto', e.target.value)}
              placeholder="Optional motto"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Address / Contact</label>
            <input
              type="text"
              value={layout.schoolContact}
              onChange={(e) => update('schoolContact', e.target.value)}
              placeholder="Optional address or phone"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Visible Table Columns & Report Sections */}
      <div className="space-y-2 pt-2 border-t border-slate-200">
        <label className="block font-semibold text-slate-800">Visible Columns &amp; Sections</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {(
            [
              { key: 'showStudentPhoto', label: 'Student Passport Photo' },
              { key: 'showSubjectCode', label: 'Subject Codes' },
              { key: 'showPassMark', label: 'Pass Mark Column' },
              { key: 'showClassAverage', label: 'Class Average Column' },
              { key: 'showSubjectRank', label: 'Subject Rank (#1)' },
              { key: 'showSubjectTeacher', label: 'Subject Teacher Name' },
              { key: 'showClassPosition', label: 'Overall Class Position' },
              { key: 'showOverallSummaryStrip', label: 'Summary KPI Strip' },
              { key: 'showCompetenciesSection', label: 'CBC Competencies & Notes' },
              { key: 'showPerformanceChart', label: 'Student vs Class Chart' },
              { key: 'showDosComment', label: 'DOS Comment Block' },
              { key: 'showGradingKey', label: 'Grading Scale Key' },
              { key: 'showNextTermDate', label: 'Term Closing & Opening Dates' },
              { key: 'showParentSignature', label: 'Parent Signature Line' },
              { key: 'showSchoolStampBox', label: 'Official School Stamp Box' },
            ] as const
          ).map((toggle) => (
            <label
              key={toggle.key}
              className="flex items-center gap-2 cursor-pointer text-slate-700 select-none"
            >
              <input
                type="checkbox"
                checked={layout[toggle.key]}
                onChange={(e) => update(toggle.key, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-800 focus:ring-blue-700"
              />
              <span>{toggle.label}</span>
            </label>
          ))}
        </div>
      </div>

      {layout.showNextTermDate && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Term Closing Date</label>
            <input
              type="date"
              value={layout.nextTermClosingDate}
              onChange={(e) => update('nextTermClosingDate', e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Next Term Opening Date</label>
            <input
              type="date"
              value={layout.nextTermDate}
              onChange={(e) => update('nextTermDate', e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Signature Labels & Footer */}
      <div className="space-y-2.5 pt-2 border-t border-slate-200">
        <label className="block font-semibold text-slate-800">Signatures &amp; Footer</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Left Signature Title</label>
            <input
              type="text"
              value={layout.leftSignatureLabel}
              onChange={(e) => update('leftSignatureLabel', e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Right Signature Title</label>
            <input
              type="text"
              value={layout.rightSignatureLabel}
              onChange={(e) => update('rightSignatureLabel', e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>
        </div>
        {layout.showParentSignature && (
          <div>
            <label className="block font-medium text-slate-700 mb-1">Parent Signature Title</label>
            <input
              type="text"
              value={layout.parentSignatureLabel}
              onChange={(e) => update('parentSignatureLabel', e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>
        )}
        <div>
          <label className="block font-medium text-slate-700 mb-1">Footer Note</label>
          <input
            type="text"
            value={layout.footerNote}
            onChange={(e) => update('footerNote', e.target.value)}
            placeholder="Optional institutional footer note"
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
          />
        </div>
      </div>
    </div>
  );
}

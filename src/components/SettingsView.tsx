import { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  ImagePlus,
  Palette,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_ALEVEL_GRADING_SCALE,
  DEFAULT_ALEVEL_POLICY,
  DEFAULT_CBC_CONFIG,
  DEFAULT_OLEVEL_GRADING_SCALE,
  DEFAULT_REPORT_CARD_LAYOUT,
} from '../data/sampleData';
import type { CurriculumScope, GradeBand, SchoolDatabase, SchoolSettings } from '../types';
import { processSchoolBadge } from '../utils/photo';
import {
  buildSchoolThemeVars,
  DEFAULT_UNIFORM_PRIMARY,
  DEFAULT_UNIFORM_SECONDARY,
  normalizeHexColor,
  UNIFORM_COLOR_PRESETS,
} from '../utils/schoolTheme';
import { ReportCardCustomizer } from './ReportCardCustomizer';

interface SettingsViewProps {
  settings: SchoolSettings;
  curriculumScope?: CurriculumScope;
  db: SchoolDatabase;
  onUpdateSettings: (updated: SchoolSettings) => void;
  onRestoreDatabase: (restored: SchoolDatabase) => void;
  onResetSampleData: () => void;
}

export function SettingsView({
  settings,
  curriculumScope = 'olevel_alevel',
  db,
  onUpdateSettings,
  onRestoreDatabase,
  onResetSampleData,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<SchoolSettings>(() => ({
    ...settings,
    curriculumScope: settings.curriculumScope ?? curriculumScope,
    badgeDataUrl: settings.badgeDataUrl ?? settings.reportLayout.customLogoDataUrl,
    uniformPrimaryColor: settings.uniformPrimaryColor ?? DEFAULT_UNIFORM_PRIMARY,
    uniformSecondaryColor: settings.uniformSecondaryColor ?? DEFAULT_UNIFORM_SECONDARY,
  }));
  const effectiveScope: CurriculumScope = draft.curriculumScope ?? curriculumScope;
  const showOlevel = effectiveScope !== 'alevel_only';
  const showAlevel = effectiveScope !== 'olevel_only';
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const badgeInputRef = useRef<HTMLInputElement | null>(null);

  const effectivePrimaryColor = normalizeHexColor(
    draft.uniformPrimaryColor,
    DEFAULT_UNIFORM_PRIMARY
  );
  const effectiveSecondaryColor = normalizeHexColor(
    draft.uniformSecondaryColor,
    DEFAULT_UNIFORM_SECONDARY
  );
  const activeBadgeUrl = draft.badgeDataUrl ?? draft.reportLayout.customLogoDataUrl;
  const previewThemeVars = buildSchoolThemeVars(effectivePrimaryColor, effectiveSecondaryColor);

  const handleUploadBadge = async (file: File) => {
    setErrorNotice(null);
    try {
      const processed = await processSchoolBadge(file);
      setDraft((prev) => ({
        ...prev,
        badgeDataUrl: processed,
        reportLayout: {
          ...prev.reportLayout,
          crestType: 'custom',
          customLogoDataUrl: processed,
        },
      }));
    } catch (err: unknown) {
      setErrorNotice(
        err instanceof Error ? err.message : 'Failed to process school badge image.'
      );
    }
  };

  const handleRemoveBadge = () => {
    setDraft((prev) => ({
      ...prev,
      badgeDataUrl: '',
      reportLayout: {
        ...prev.reportLayout,
        crestType: prev.reportLayout.crestType === 'custom' ? 'shield' : prev.reportLayout.crestType,
        customLogoDataUrl: undefined,
      },
    }));
  };

  const weightSum =
    Number(draft.cbcConfig.formativeWeight) + Number(draft.cbcConfig.summativeWeight);
  const weightValid = Math.abs(weightSum - 100) < 0.01;

  const updateScaleRow = (
    scaleKey: 'olevelGradingScale' | 'alevelGradingScale',
    index: number,
    field: keyof GradeBand,
    value: string | number
  ) => {
    setDraft((prev) => ({
      ...prev,
      [scaleKey]: prev[scaleKey].map((row, idx) =>
        idx === index ? { ...row, [field]: value } : row
      ),
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    if (!weightValid) {
      setErrorNotice(
        `O'Level CBC weights must add up to 100% (currently ${weightSum}%). Adjust Formative AoI % and Summative EoT %.`
      );
      return;
    }
    onUpdateSettings(draft);
    setSavedNotice('School configuration, grading scales & report layout saved.');
    setTimeout(() => setSavedNotice(null), 3500);
  };

  const handleExportJsonBackup = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SchuleFlow_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonBackup = async (file: File) => {
    setErrorNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SchoolDatabase;
      if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.students) || !parsed.settings) {
        setErrorNotice('Invalid backup file format. Expected a valid SchuleFlow JSON backup.');
        return;
      }
      onRestoreDatabase(parsed);
      setDraft(parsed.settings);
      setSavedNotice('School database restored from JSON backup.');
    } catch {
      setErrorNotice('Could not parse JSON backup file.');
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            School Profile, Grading Rules &amp; System Backup
          </h2>
          <p className="text-xs text-slate-500">
            Configure institutional identity, curriculum sections
            {showOlevel ? ", O'Level CBC weights" : ''}
            {showAlevel ? ", A'Level points policy" : ''}, report card layout, and backups
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {savedNotice}
            </span>
          )}
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Save All Settings</span>
          </button>
        </div>
      </div>

      {errorNotice && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* School Identity */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <h3 className="font-display text-base font-bold text-slate-900">
          School Identity &amp; Academic Session
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">School Name</label>
            <input
              type="text"
              required
              value={draft.schoolName}
              onChange={(e) => setDraft({ ...draft, schoolName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Academic Year</label>
            <input
              type="text"
              required
              value={draft.academicYear}
              onChange={(e) => setDraft({ ...draft, academicYear: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Current Term</label>
            <input
              type="text"
              required
              value={draft.termName}
              onChange={(e) => setDraft({ ...draft, termName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Headteacher / Principal</label>
            <input
              type="text"
              required
              value={draft.principalName}
              onChange={(e) => setDraft({ ...draft, principalName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Director of Studies (DOS)</label>
            <input
              type="text"
              required
              value={draft.dosName}
              onChange={(e) => setDraft({ ...draft, dosName: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Official School Email</label>
            <input
              type="email"
              value={draft.schoolEmail}
              onChange={(e) => setDraft({ ...draft, schoolEmail: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-100">
            <label className="block font-medium text-slate-700 mb-1">
              School Sections / Curriculum Level
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={effectiveScope}
                onChange={(e) =>
                  setDraft({ ...draft, curriculumScope: e.target.value as CurriculumScope })
                }
                className="w-full sm:w-80 rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 font-medium"
              >
                <option value="olevel_alevel">
                  Both O&apos;Level &amp; A&apos;Level (S.1–S.6)
                </option>
                <option value="olevel_only">
                  O&apos;Level Only (S.1–S.4 CBC)
                </option>
                {effectiveScope === 'alevel_only' && (
                  <option value="alevel_only">
                    A&apos;Level Only (S.5–S.6 UACE)
                  </option>
                )}
              </select>
              <p className="text-[11px] text-slate-500">
                Choose whether your school offers both O&apos;Level and A&apos;Level or O&apos;Level only. A&apos;Level combinations, S.5–S.6 classes, and UACE scales are hidden when O&apos;Level Only is selected.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* School Badge & Uniform Colors (Strict per-school branding) */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Palette className="h-4 w-4 text-slate-600" aria-hidden="true" />
              <span>School Badge &amp; Uniform Colors</span>
            </h3>
            <p className="text-xs text-slate-500">
              Applies exclusively to {draft.schoolName || 'your school'} across the sidebar, login preview, buttons, and report cards.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                uniformPrimaryColor: DEFAULT_UNIFORM_PRIMARY,
                uniformSecondaryColor: DEFAULT_UNIFORM_SECONDARY,
              }))
            }
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Default Colors</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* School Badge Upload */}
          <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div className="flex items-start gap-4">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 bg-white p-1.5 overflow-hidden"
                style={{ borderColor: effectiveSecondaryColor }}
              >
                {activeBadgeUrl ? (
                  <img
                    src={activeBadgeUrl}
                    alt={`${draft.schoolName} badge preview`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Shield className="h-8 w-8 text-slate-300" aria-hidden="true" />
                )}
              </div>

              <div className="space-y-2 text-xs min-w-0">
                <div>
                  <p className="font-semibold text-slate-900">Official School Badge / Crest</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    PNG, JPG, or WebP up to 4 MB. Transparent PNG badges look crispest.
                  </p>
                </div>

                <input
                  ref={badgeInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUploadBadge(file);
                    e.currentTarget.value = '';
                  }}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => badgeInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{activeBadgeUrl ? 'Change Badge' : 'Upload Badge'}</span>
                  </button>
                  {activeBadgeUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveBadge}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Uniform Colors Picker & Presets */}
          <div className="lg:col-span-7 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Primary Uniform Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Primary Uniform Color"
                    value={effectivePrimaryColor}
                    onChange={(e) =>
                      setDraft({ ...draft, uniformPrimaryColor: e.target.value })
                    }
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                  />
                  <input
                    type="text"
                    value={draft.uniformPrimaryColor ?? effectivePrimaryColor}
                    onChange={(e) =>
                      setDraft({ ...draft, uniformPrimaryColor: e.target.value })
                    }
                    placeholder="#1e3a8a"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Secondary / Trim Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Secondary Uniform Color"
                    value={effectiveSecondaryColor}
                    onChange={(e) =>
                      setDraft({ ...draft, uniformSecondaryColor: e.target.value })
                    }
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                  />
                  <input
                    type="text"
                    value={draft.uniformSecondaryColor ?? effectiveSecondaryColor}
                    onChange={(e) =>
                      setDraft({ ...draft, uniformSecondaryColor: e.target.value })
                    }
                    placeholder="#b45309"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                  />
                </div>
              </div>
            </div>

            <div>
              <span className="block font-medium text-slate-700 mb-1.5">
                Quick Uniform Color Presets
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {UNIFORM_COLOR_PRESETS.map((preset) => {
                  const selected =
                    effectivePrimaryColor === preset.primary &&
                    effectiveSecondaryColor === preset.secondary;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          uniformPrimaryColor: preset.primary,
                          uniformSecondaryColor: preset.secondary,
                        }))
                      }
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                        selected
                          ? 'border-slate-900 bg-slate-100 font-semibold text-slate-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center shrink-0">
                        <span
                          className="h-4 w-4 rounded-l border border-slate-300"
                          style={{ backgroundColor: preset.primary }}
                        />
                        <span
                          className="h-4 w-2 rounded-r border-y border-r border-slate-300"
                          style={{ backgroundColor: preset.secondary }}
                        />
                      </span>
                      <span className="truncate text-[11px]">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live Preview Strip */}
            <div
              style={{
                ...previewThemeVars,
                borderBottomColor: effectiveSecondaryColor,
              }}
              className="school-themed rounded-lg border border-slate-200 border-b-2 bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 bg-white p-0.5 overflow-hidden">
                  {activeBadgeUrl ? (
                    <img
                      src={activeBadgeUrl}
                      alt="School preview badge"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Shield className="h-4 w-4 text-slate-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">
                    {draft.schoolName || 'School Preview'}
                  </p>
                  <p className="text-[11px] text-slate-500">Live workspace theme preview</p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-md bg-blue-900 px-3 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap">
                Active Button Style
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* O'Level CBC & A'Level Rules */}
      <div
        className={`grid grid-cols-1 ${showOlevel && showAlevel ? 'lg:grid-cols-2' : ''} gap-6`}
      >
        {showOlevel && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                O&apos;Level CBC Assessment Formula
              </h3>
              <p className="text-xs text-slate-500">
                Formative AoI weight + Summative Exam weight must equal 100%
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, cbcConfig: DEFAULT_CBC_CONFIG })}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Default</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">AoI Max Mark</label>
              <input
                type="number"
                min={1}
                step={0.5}
                value={draft.cbcConfig.aoiMaxMark}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: { ...draft.cbcConfig, aoiMaxMark: Number(e.target.value) || 3 },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">EoT Exam Max Mark</label>
              <input
                type="number"
                min={10}
                value={draft.cbcConfig.eotMaxMark}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: { ...draft.cbcConfig, eotMaxMark: Number(e.target.value) || 100 },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Formative Weight (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.cbcConfig.formativeWeight}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: { ...draft.cbcConfig, formativeWeight: Number(e.target.value) },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Summative Weight (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.cbcConfig.summativeWeight}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: { ...draft.cbcConfig, summativeWeight: Number(e.target.value) },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">AoI Entry Mode</label>
              <select
                value={draft.cbcConfig.aoiInputMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: {
                      ...draft.cbcConfig,
                      aoiInputMode: e.target.value as 'u1_u3' | 'single_aoi',
                    },
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="u1_u3">U1 – U3 Activities Average (/3)</option>
                <option value="single_aoi">Single Classwork AoI (/3)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Rounding Rule</label>
              <select
                value={draft.cbcConfig.roundingMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cbcConfig: {
                      ...draft.cbcConfig,
                      roundingMode: e.target.value as 'one_decimal' | 'two_decimals' | 'whole',
                    },
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="one_decimal">1 Decimal Place (84.5%)</option>
                <option value="two_decimals">2 Decimal Places (84.53%)</option>
                <option value="whole">Nearest Whole Number (85%)</option>
              </select>
            </div>
          </div>

          <div
            className={`rounded px-3 py-2 text-xs font-mono ${
              weightValid
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            Total Weight Sum: {weightSum}% {weightValid ? '(Valid: 100%)' : '(Must equal 100%)'}
          </div>
          </section>
        )}

        {showAlevel && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                A&apos;Level Aggregation Policy (UACE-Style)
              </h3>
              <p className="text-xs text-slate-500">
                Configure Principal &amp; Subsidiary point limits and subsidiary pass threshold
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, alevelPolicy: DEFAULT_ALEVEL_POLICY })}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Default</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Principal Subjects Counted
              </label>
              <input
                type="number"
                min={1}
                max={4}
                value={draft.alevelPolicy.maxPrincipalsCount}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    alevelPolicy: {
                      ...draft.alevelPolicy,
                      maxPrincipalsCount: Number(e.target.value) || 3,
                    },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Subsidiaries Counted (1 pt each)
              </label>
              <input
                type="number"
                min={0}
                max={2}
                value={draft.alevelPolicy.maxSubsidiariesCount}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    alevelPolicy: {
                      ...draft.alevelPolicy,
                      maxSubsidiariesCount: Number(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Subsidiary Pass Threshold (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.alevelPolicy.subsidiaryPassMark}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    alevelPolicy: {
                      ...draft.alevelPolicy,
                      subsidiaryPassMark: Number(e.target.value) || 50,
                    },
                  })
                }
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-800">
                <input
                  type="checkbox"
                  checked={draft.alevelPolicy.includeSubsidiaryPoints}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      alevelPolicy: {
                        ...draft.alevelPolicy,
                        includeSubsidiaryPoints: e.target.checked,
                      },
                    })
                  }
                />
                <span>Include Subsidiary Points in Aggregate</span>
              </label>
            </div>
          </div>

          <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            Maximum achievable UACE-format aggregate:{' '}
            <strong className="font-mono text-slate-900">
              {draft.alevelPolicy.maxPrincipalsCount * 6 +
                (draft.alevelPolicy.includeSubsidiaryPoints
                  ? draft.alevelPolicy.maxSubsidiariesCount
                  : 0)}{' '}
              points
            </strong>
          </div>
          </section>
        )}
      </div>

      {/* Editable Grading Scales */}
      <div
        className={`grid grid-cols-1 ${showOlevel && showAlevel ? 'lg:grid-cols-2' : ''} gap-6`}
      >
        {showOlevel && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900">
              O&apos;Level CBC Grading Scale
            </h3>
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, olevelGradingScale: DEFAULT_OLEVEL_GRADING_SCALE })
              }
              className="text-xs font-medium text-blue-800 hover:underline"
            >
              Reset Default
            </button>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-2">Grade</th>
                <th className="py-1.5 px-2">Min %</th>
                <th className="py-1.5 px-2">Descriptor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.olevelGradingScale.map((band, idx) => (
                <tr key={idx}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={band.grade}
                      onChange={(e) =>
                        updateScaleRow('olevelGradingScale', idx, 'grade', e.target.value)
                      }
                      className="w-12 rounded border border-slate-300 px-2 py-1 font-mono font-semibold"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="number"
                      value={band.minPercentage}
                      onChange={(e) =>
                        updateScaleRow(
                          'olevelGradingScale',
                          idx,
                          'minPercentage',
                          Number(e.target.value)
                        )
                      }
                      className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="text"
                      value={band.label}
                      onChange={(e) =>
                        updateScaleRow('olevelGradingScale', idx, 'label', e.target.value)
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </section>
        )}

        {showAlevel && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900">
              A&apos;Level Principal Grading &amp; Points Scale
            </h3>
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, alevelGradingScale: DEFAULT_ALEVEL_GRADING_SCALE })
              }
              className="text-xs font-medium text-blue-800 hover:underline"
            >
              Reset Default
            </button>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-2">Grade</th>
                <th className="py-1.5 px-2">Min %</th>
                <th className="py-1.5 px-2">Pts</th>
                <th className="py-1.5 px-2">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.alevelGradingScale.map((band, idx) => (
                <tr key={idx}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={band.grade}
                      onChange={(e) =>
                        updateScaleRow('alevelGradingScale', idx, 'grade', e.target.value)
                      }
                      className="w-12 rounded border border-slate-300 px-2 py-1 font-mono font-semibold"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="number"
                      value={band.minPercentage}
                      onChange={(e) =>
                        updateScaleRow(
                          'alevelGradingScale',
                          idx,
                          'minPercentage',
                          Number(e.target.value)
                        )
                      }
                      className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="number"
                      value={band.gpa}
                      onChange={(e) =>
                        updateScaleRow('alevelGradingScale', idx, 'gpa', Number(e.target.value))
                      }
                      className="w-14 rounded border border-slate-300 px-2 py-1 font-mono"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="text"
                      value={band.label}
                      onChange={(e) =>
                        updateScaleRow('alevelGradingScale', idx, 'label', e.target.value)
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </section>
        )}
      </div>

      {/* Report Card Customizer */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <ReportCardCustomizer
          layout={{ ...DEFAULT_REPORT_CARD_LAYOUT, ...draft.reportLayout }}
          onChange={(updatedLayout) =>
            setDraft((prev) => ({
              ...prev,
              badgeDataUrl:
                updatedLayout.customLogoDataUrl !== prev.reportLayout.customLogoDataUrl
                  ? updatedLayout.customLogoDataUrl ?? ''
                  : prev.badgeDataUrl,
              reportLayout: updatedLayout,
            }))
          }
        />
      </section>

      {/* Module 16: Database Backup & Restore */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-blue-800 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              System Data Backup &amp; Restore
            </h3>
            <p className="text-xs text-slate-500">
              Download an encrypted-ready JSON snapshot of all students, marksheets, exams, and school settings, or restore from a previous backup.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJsonBackup}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON Backup</span>
          </button>

          <input
            ref={restoreInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportJsonBackup(f);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Restore Backup</span>
          </button>

          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Reset Sample Data
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onResetSampleData();
                  setConfirmReset(false);
                }}
                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
              >
                Confirm Reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
    </form>
  );
}

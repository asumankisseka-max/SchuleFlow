import { useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  X,
} from 'lucide-react';
import type {
  CurriculumScope,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
} from '../types';
import { platformApi } from '../utils/apiClient';
import { SUBSCRIPTION_PACKAGES } from '../utils/plans';
import { validateUgandanPhone } from '../utils/validation';

interface SchoolOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onOnboarded: (school: SchoolTenant) => void;
}

const CURRICULUM_OPTIONS: Array<{
  id: CurriculumScope;
  title: string;
  subtitle: string;
  classesSeeded: string;
}> = [
  {
    id: 'olevel_alevel',
    title: "Secondary (S.1–S.6 · O & A-Level)",
    subtitle: 'Full NCDC Lower Secondary CBC + UNEB UACE Upper Secondary',
    classesSeeded: 'Seeds S.1–S.4 CBC streams, S.5 Science & S.6 Arts, and UACE combinations',
  },
  {
    id: 'olevel_only',
    title: "O'Level Only (S.1–S.4 · NCDC CBC)",
    subtitle: 'Competency-Based Curriculum (20% AoI U1–U3 + 80% EoT)',
    classesSeeded: 'Seeds S.1 East, S.2 East, S.3 West, S.4 West & CBC subjects',
  },
  {
    id: 'alevel_only',
    title: "A'Level Only (S.5–S.6 · UNEB UACE)",
    subtitle: 'Principal (A–F/O) & Subsidiary papers with Points aggregation',
    classesSeeded: 'Seeds S.5 Science, S.6 Arts, Principal/Subsidiary subjects & PCM/HEG',
  },
];

function defaultDateOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function SchoolOnboardingModal({
  open,
  onClose,
  onOnboarded,
}: SchoolOnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [ministryRegNo, setMinistryRegNo] = useState('');
  const [subCounty, setSubCounty] = useState('');
  const [motto, setMotto] = useState('Knowledge & Integrity');
  const [district, setDistrict] = useState('Wakiso');
  const [region, setRegion] = useState('Central');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('+256 772 000 100');
  const [email, setEmail] = useState('');

  const [principalName, setPrincipalName] = useState('');
  const [dosName, setDosName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [academicYear, setAcademicYear] = useState('2026');
  const [termName, setTermName] = useState('Term III');

  const [plan, setPlan] = useState<SubscriptionPlan>('standard');
  const [curriculumScope, setCurriculumScope] = useState<CurriculumScope>('olevel_alevel');
  const [status, setStatus] = useState<SchoolStatus>('active');
  const [licenseExpiresAt, setLicenseExpiresAt] = useState<string>(() => defaultDateOffset(365));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisionedSchool, setProvisionedSchool] = useState<SchoolTenant | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!open) return null;

  const phoneValidation = validateUgandanPhone(phone, true);
  const adminPhoneValidation = validateUgandanPhone(adminPhone, false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!subdomainEdited) {
      const slug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 24);
      setSubdomain(slug);
    }
  };

  const handleAdminEmailChange = (val: string) => {
    setAdminEmail(val);
    if (!adminUsername && val.includes('@')) {
      setAdminUsername(val.split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, ''));
    }
  };

  const handleStatusSelect = (next: SchoolStatus) => {
    setStatus(next);
    if (next === 'trial') {
      setLicenseExpiresAt(defaultDateOffset(30));
    } else if (next === 'active') {
      setLicenseExpiresAt(defaultDateOffset(365));
    }
  };

  const handleStepNext = () => {
    setError(null);
    if (step === 1 && !phoneValidation.valid) {
      setError(phoneValidation.error ?? 'Invalid Ugandan mobile phone number.');
      return;
    }
    if (step === 2 && !adminPhoneValidation.valid) {
      setError(adminPhoneValidation.error ?? 'Invalid School Admin phone number.');
      return;
    }
    if (step === 2 && adminPassword.trim().length < 6) {
      setError('Initial School Admin password must be at least 6 characters.');
      return;
    }
    setStep((step + 1) as 2 | 3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!phoneValidation.valid) {
      setError(phoneValidation.error ?? 'Invalid Ugandan mobile phone number.');
      setStep(1);
      return;
    }
    if (!adminPhoneValidation.valid) {
      setError(adminPhoneValidation.error ?? 'Invalid School Admin phone number.');
      setStep(2);
      return;
    }
    if (adminPassword.trim().length < 6) {
      setError('Initial School Admin password must be at least 6 characters.');
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      const res = await platformApi.onboardSchool({
        name,
        subdomain,
        ministryRegNo: ministryRegNo.trim() || undefined,
        subCounty: subCounty.trim() || undefined,
        motto,
        district,
        region,
        address: address || `${district} District, Uganda`,
        phone: phoneValidation.normalized,
        email: email || adminEmail,
        principalName: principalName || adminName,
        dosName: dosName || adminName,
        adminName,
        adminEmail,
        adminPhone: adminPhoneValidation.normalized || undefined,
        adminUsername: adminUsername.trim() || undefined,
        adminPassword: adminPassword.trim(),
        plan,
        curriculumScope,
        status,
        subscriptionStatus: status,
        licenseExpiresAt: licenseExpiresAt ? new Date(`${licenseExpiresAt}T23:59:59Z`).toISOString() : undefined,
        academicYear,
        termName,
      });
      setProvisionedSchool(res.school);
      onOnboarded(res.school);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to provision new school tenant.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseAfterSummary = () => {
    setProvisionedSchool(null);
    setCopiedCode(false);
    setStep(1);
    onClose();
  };

  if (provisionedSchool) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-emerald-50/70">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  School Onboarded Successfully
                </h3>
                <p className="text-xs text-slate-600">
                  Share these private access credentials with the school administration
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCloseAfterSummary}
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200"
              aria-label="Close onboarding summary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-6 space-y-4 text-xs">
            <div>
              <div className="text-sm font-bold text-slate-900">{provisionedSchool.name}</div>
              <div className="text-slate-500 mt-0.5">
                {provisionedSchool.ministryRegNo || 'MoES/SEC/—'} · {provisionedSchool.district}
              </div>
            </div>

            <div className="rounded-lg border-2 border-blue-900/20 bg-blue-50/60 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Unique School Code (Required at Login)</span>
                </div>
                <div className="font-mono text-2xl font-bold tracking-wider text-slate-950 mt-1">
                  {provisionedSchool.schoolCode}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const summary = `School: ${provisionedSchool.name}\nSchool Code: ${provisionedSchool.schoolCode}\nAdmin Staff ID: ${provisionedSchool.adminStaffId ?? '—'}\nAdmin Email: ${adminEmail}`;
                  void navigator.clipboard?.writeText(summary);
                  setCopiedCode(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-50"
              >
                {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy Handover'}</span>
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 font-mono text-[11px] text-slate-800">
              <div className="font-sans text-xs font-semibold text-slate-900 mb-1">
                Primary School Admin Account
              </div>
              <div>
                Staff ID: <span className="font-bold text-blue-950">{provisionedSchool.adminStaffId ?? '—'}</span>
              </div>
              <div>Email: {adminEmail.trim().toLowerCase()}</div>
              <div>Username: {adminUsername.trim().toLowerCase() || adminEmail.split('@')[0]}</div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Schools are kept strictly private and never appear in public login dropdowns. Staff
              must enter <strong>{provisionedSchool.schoolCode}</strong> together with their Staff ID
              or email and personal password to access this workspace.
            </p>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCloseAfterSummary}
                className="rounded-md bg-blue-900 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-950"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-blue-800" />
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                School Tenant Onboarding
              </h3>
              <p className="text-xs text-slate-500">
                Step {step} of 3 · Registers MoES school metadata, license expiry &amp; primary School Admin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200"
            aria-label="Close onboarding wizard"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-3 border-b border-slate-200 text-xs font-medium shrink-0">
          {[
            { num: 1, label: '1. School & MoES Details' },
            { num: 2, label: '2. Primary School Admin' },
            { num: 3, label: '3. License & Curriculum' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as 1 | 2 | 3)}
              className={`py-2.5 px-3 text-center border-b-2 transition-colors ${
                step === s.num
                  ? 'border-blue-800 text-blue-900 bg-blue-50/40 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  School / Institution Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Gayaza Heritage Secondary School"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Tenant Subdomain Slug *
                </label>
                <div className="flex items-center rounded-md border border-slate-300 overflow-hidden">
                  <input
                    type="text"
                    required
                    value={subdomain}
                    onChange={(e) => {
                      setSubdomainEdited(true);
                      setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    }}
                    placeholder="gayazaheritage"
                    className="w-full px-3 py-2 font-mono text-slate-900 focus:outline-none"
                  />
                  <span className="bg-slate-100 px-2.5 py-2 text-[11px] text-slate-500 border-l border-slate-300 whitespace-nowrap">
                    .schuleflow.ug
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Ministry Registration No. *
                </label>
                <input
                  type="text"
                  required
                  value={ministryRegNo}
                  onChange={(e) => setMinistryRegNo(e.target.value)}
                  placeholder="e.g. MoES/SEC/0419/WKS"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Sub-county / Division *</label>
                <input
                  type="text"
                  required
                  value={subCounty}
                  onChange={(e) => setSubCounty(e.target.value)}
                  placeholder="e.g. Kasangati Town Council"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">District *</label>
                <input
                  type="text"
                  required
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Region</label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="Central">Central</option>
                  <option value="Eastern">Eastern</option>
                  <option value="Western">Western</option>
                  <option value="Northern">Northern</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Official Phone (+256 / 07...) *
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => {
                    setError(null);
                    setPhone(e.target.value);
                  }}
                  placeholder="+256772000100 or 0772000100"
                  className={`w-full rounded-md border px-3 py-2 font-mono text-slate-900 ${
                    phone.trim() && !phoneValidation.valid
                      ? 'border-red-400 bg-red-50/40'
                      : 'border-slate-300'
                  }`}
                />
                {phone.trim() && !phoneValidation.valid && (
                  <p className="mt-1 text-[11px] text-red-700">{phoneValidation.error}</p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Official School Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="office@school.ac.ug"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Physical Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="P.O. Box or Plot Address"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Primary School Admin Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="e.g. Mr. Samuel Kato"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  School Admin Email *
                </label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => handleAdminEmailChange(e.target.value)}
                  placeholder="admin@school.ac.ug"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  School Admin Phone (+256 / 07...)
                </label>
                <input
                  type="text"
                  value={adminPhone}
                  onChange={(e) => {
                    setError(null);
                    setAdminPhone(e.target.value);
                  }}
                  placeholder="Optional (defaults to school phone)"
                  className={`w-full rounded-md border px-3 py-2 font-mono text-slate-900 ${
                    adminPhone.trim() && !adminPhoneValidation.valid
                      ? 'border-red-400 bg-red-50/40'
                      : 'border-slate-300'
                  }`}
                />
                {adminPhone.trim() && !adminPhoneValidation.valid && (
                  <p className="mt-1 text-[11px] text-red-700">{adminPhoneValidation.error}</p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  School Admin Username *
                </label>
                <input
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value.toLowerCase())}
                  placeholder="schooladmin"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Initial Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full rounded-md border border-slate-300 pl-3 pr-9 py-2 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Headteacher / Principal
                </label>
                <input
                  type="text"
                  value={principalName}
                  onChange={(e) => setPrincipalName(e.target.value)}
                  placeholder="Optional (defaults to Admin)"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Director of Studies (DoS)
                </label>
                <input
                  type="text"
                  value={dosName}
                  onChange={(e) => setDosName(e.target.value)}
                  placeholder="Optional (defaults to Admin)"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Academic Year</label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Initial Term</label>
                <input
                  type="text"
                  value={termName}
                  onChange={(e) => setTermName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">School Motto</label>
                <input
                  type="text"
                  value={motto}
                  onChange={(e) => setMotto(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-2">
                  Ugandan Curriculum Structure (CBC / UNEB Auto-Seeding)
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {CURRICULUM_OPTIONS.map((curr) => (
                    <button
                      key={curr.id}
                      type="button"
                      onClick={() => setCurriculumScope(curr.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        curriculumScope === curr.id
                          ? 'border-blue-800 bg-blue-50/50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{curr.title}</span>
                        <span className="text-[11px] font-medium text-blue-900">
                          {curr.id === 'olevel_only'
                            ? 'S.1–S.4'
                            : curr.id === 'alevel_only'
                              ? 'S.5–S.6'
                              : 'S.1–S.6'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{curr.subtitle}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-2">
                  Subscription Package &amp; Student Seat Capacity
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUBSCRIPTION_PACKAGES.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setPlan(opt.id);
                        handleStatusSelect(opt.defaultStatus);
                      }}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        plan === opt.id
                          ? 'border-blue-800 bg-blue-50/50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{opt.name}</span>
                        <span className="font-mono text-xs font-bold text-blue-900 tabular-nums">
                          {opt.studentQuota} Students
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">{opt.tagline}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Initial License Status *
                  </label>
                  <select
                    value={status}
                    onChange={(e) => handleStatusSelect(e.target.value as SchoolStatus)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  >
                    <option value="active">Active (Licensed)</option>
                    <option value="trial">Trial (30-Day Evaluation)</option>
                    <option value="suspended">Suspended</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    License Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={licenseExpiresAt}
                    onChange={(e) => setLicenseExpiresAt(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-slate-600">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>Provisioning Summary</span>
                </div>
                <p>
                  Onboards <strong>{name || 'New School'}</strong> (Reg:{' '}
                  <span className="font-mono">{ministryRegNo || 'MoES/SEC/...'}</span>,{' '}
                  {subCounty || 'Sub-county'}, {district}) and creates primary{' '}
                  <strong>School Admin</strong> credentials for{' '}
                  <span className="font-mono">{adminEmail || 'admin@school.ac.ug'}</span>.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3) : onClose())}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {step > 1 ? 'Back' : 'Cancel'}
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={handleStepNext}
                disabled={
                  step === 1
                    ? !name.trim() ||
                      !subdomain.trim() ||
                      !ministryRegNo.trim() ||
                      !subCounty.trim() ||
                      !email.trim() ||
                      !phoneValidation.valid
                    : !adminName.trim() ||
                        !adminEmail.trim() ||
                        !adminPassword.trim() ||
                        !adminPhoneValidation.valid
                }
                className="rounded-md bg-blue-900 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting || !name.trim() || !subdomain.trim() || !adminEmail.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{submitting ? 'Provisioning...' : 'Onboard School & Admin'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

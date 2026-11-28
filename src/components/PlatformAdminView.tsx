import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClockAlert,
  Loader2,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  AuditLogRecord,
  AuthSessionProfile,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
} from '../types';
import { platformApi } from '../utils/apiClient';
import { SchoolOnboardingModal } from './SchoolOnboardingModal';

interface PlatformAdminViewProps {
  authProfile: AuthSessionProfile;
  schools: SchoolTenant[];
  auditLogs: AuditLogRecord[];
  onRefreshPlatform: () => Promise<void>;
  onLogout: () => Promise<void>;
}

const STATUS_BADGE: Record<SchoolStatus, string> = {
  active: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  trial: 'bg-amber-50 text-amber-800 border-amber-200',
  suspended: 'bg-red-50 text-red-800 border-red-200',
  expired: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function PlatformAdminView({
  authProfile,
  schools,
  auditLogs,
  onRefreshPlatform,
  onLogout,
}: PlatformAdminViewProps) {
  const [search, setSearch] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchoolTenant | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resettingBaseline, setResettingBaseline] = useState(false);

  const metrics = useMemo(() => {
    const activeCount = schools.filter((s) => s.subscriptionStatus === 'active').length;
    const trialCount = schools.filter((s) => s.subscriptionStatus === 'trial').length;
    const restrictedCount = schools.filter(
      (s) => s.subscriptionStatus === 'suspended' || s.subscriptionStatus === 'expired'
    ).length;
    const totalStudents = schools.reduce((sum, s) => sum + (s.activeStudentCount ?? 0), 0);
    const totalQuota = schools.reduce((sum, s) => sum + s.studentQuota, 0);

    return {
      total: schools.length,
      activeCount,
      trialCount,
      restrictedCount,
      totalStudents,
      totalQuota,
    };
  }, [schools]);

  const filteredSchools = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.schoolCode ?? '').toLowerCase().includes(q) ||
        s.subdomain.toLowerCase().includes(q) ||
        (s.ministryRegNo ?? '').toLowerCase().includes(q) ||
        (s.subCounty ?? '').toLowerCase().includes(q) ||
        s.district.toLowerCase().includes(q)
    );
  }, [schools, search]);

  const filteredLogs = useMemo(() => {
    const q = logFilter.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.userEmail.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        (l.schoolName ?? '').toLowerCase().includes(q)
    );
  }, [auditLogs, logFilter]);

  const handleStatusChange = async (school: SchoolTenant, nextStatus: SchoolStatus) => {
    setBusyId(school.id);
    setErrorBanner(null);
    try {
      await platformApi.updateSchoolSubscription(school.id, {
        status: nextStatus,
        subscriptionStatus: nextStatus,
      });
      await onRefreshPlatform();
      setNotice(`Updated ${school.name} subscription status to "${nextStatus}".`);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update subscription status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRenewLicense = async (school: SchoolTenant, days = 365) => {
    setBusyId(school.id);
    setErrorBanner(null);
    try {
      const baseMs = Math.max(Date.now(), new Date(school.licenseExpiresAt).getTime());
      const nextExpiry = new Date(baseMs + days * 86400000).toISOString();
      await platformApi.updateSchoolSubscription(school.id, {
        status: 'active',
        subscriptionStatus: 'active',
        licenseExpiresAt: nextExpiry,
      });
      await onRefreshPlatform();
      setNotice(`Renewed ${school.name} license through ${nextExpiry.slice(0, 10)}.`);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to renew school license.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePlanChange = async (school: SchoolTenant, plan: SubscriptionPlan) => {
    const quotaMap: Record<SubscriptionPlan, number> = {
      trial: 80,
      starter: 200,
      standard: 500,
      enterprise: 1500,
    };
    const nextQuota = quotaMap[plan] ?? 500;
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
    setBusyId(school.id);
    setErrorBanner(null);
    try {
      await platformApi.updateSchoolSubscription(school.id, {
        plan,
        studentQuota: nextQuota,
        termFeePerStudentUgx: 0,
      });
      await onRefreshPlatform();
      setNotice(`Updated ${school.name} package to ${planLabel} (${nextQuota} seats).`);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to change school package.');
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateInvoice = async (school: SchoolTenant) => {
    setBusyId(school.id);
    setErrorBanner(null);
    try {
      const res = await platformApi.generateSchoolInvoice(school.id);
      await onRefreshPlatform();
      setNotice(
        `Issued invoice ${res.invoice.id} for ${school.name} (${res.invoice.termName} ${res.invoice.academicYear} · UGX ${res.invoice.totalAmountUgx.toLocaleString()} · ${res.invoice.activeStudentsCount} active students).`
      );
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to issue school invoice.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toLowerCase() !== deleteTarget.subdomain.toLowerCase()) {
      setErrorBanner(`Please type "${deleteTarget.subdomain}" exactly to confirm deletion.`);
      return;
    }
    setDeleting(true);
    setErrorBanner(null);
    try {
      await platformApi.deleteSchool(deleteTarget.id);
      const removedName = deleteTarget.name;
      setDeleteTarget(null);
      setDeleteConfirmText('');
      await onRefreshPlatform();
      setNotice(`Permanently deleted "${removedName}" and all associated tenant records.`);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete school tenant.');
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmResetBaseline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetConfirmText.trim().toUpperCase() !== 'RESET') {
      setErrorBanner('Please type RESET exactly to confirm.');
      return;
    }
    setResettingBaseline(true);
    setErrorBanner(null);
    try {
      const result = await platformApi.resetToBaseline('RESET');
      setResetModalOpen(false);
      setResetConfirmText('');
      await onRefreshPlatform();
      setNotice(
        `Cloud database renewed to clean preview baseline: ${result.schoolName} (${result.schoolCode}).`
      );
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to reset cloud database.');
    } finally {
      setResettingBaseline(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Platform Super Admin Header (Strictly Isolated from School Academic Workspaces) */}
      <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-900 text-white">
            <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="font-semibold text-blue-900">SchuleFlow Platform</span>
              <span>/</span>
              <span>Super Admin Console</span>
            </div>
            <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              School Onboarding, Licensing &amp; Audit Governance
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-800" />
            <span className="font-medium text-slate-800">{authProfile.name}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">Platform Super Admin</span>
          </div>

          <button
            type="button"
            onClick={() => void onLogout()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Top Action Bar */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Registered Institutions &amp; Subscription Licensing
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Onboard secondary schools, issue primary School Admin credentials, manage license expirations, and review platform audit events
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefreshPlatform();
                } finally {
                  setRefreshing(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorBanner(null);
                setResetConfirmText('');
                setResetModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
              title="Reset published database to clean Jangu International School preview baseline"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Renew Cloud Data</span>
            </button>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-950 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Onboard New School</span>
            </button>
          </div>
        </div>

        {notice && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {errorBanner && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-red-700 hover:text-red-900"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* KPI Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Onboarded Schools</div>
            <div className="font-mono text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {metrics.total}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {metrics.activeCount} Active · {metrics.trialCount} Trial · {metrics.restrictedCount} Suspended/Expired
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Licensed Seat Utilization</div>
            <div className="font-mono text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {metrics.totalStudents} / {metrics.totalQuota}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Active students across tenants</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Subscription Gatekeeper</div>
            <div className="font-display text-lg font-bold text-emerald-800 mt-1">Enforced</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Locks expired schools to Subscription Portal
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Recent Audit Events</div>
            <div className="font-mono text-2xl font-bold text-blue-900 mt-1 tabular-nums">
              {auditLogs.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Onboarding, licensing &amp; auth logs</div>
          </div>
        </div>

        {/* School & License Management Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-800" />
              <span>School &amp; License Management</span>
            </h3>

            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search school, MoES reg no, district..."
                className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs text-slate-900"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">School &amp; MoES Reg No</th>
                  <th className="py-3 px-4">Sub-county / District</th>
                  <th className="py-3 px-4">Package &amp; Seats</th>
                  <th className="py-3 px-4">License Expiry</th>
                  <th className="py-3 px-4">Subscription Status</th>
                  <th className="py-3 px-4 text-right">License Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSchools.map((school) => {
                  const enrolled = school.activeStudentCount ?? 0;
                  const expiryDate = school.licenseExpiresAt.slice(0, 10);
                  const isPastExpiry = new Date(school.licenseExpiresAt).getTime() < Date.now();
                  const effectiveStatus = school.subscriptionStatus || school.status;

                  return (
                    <tr key={school.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{school.name}</span>
                          <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-900">
                            {school.schoolCode}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {school.ministryRegNo || 'MoES/SEC/—'} · {school.subdomain}.schuleflow.ug
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {school.email} · {school.phone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <div>{school.subCounty || 'Central Division'}</div>
                        <div className="text-[11px] text-slate-500">
                          {school.district} · {school.region}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={school.plan}
                          disabled={busyId === school.id}
                          onChange={(e) =>
                            handlePlanChange(school, e.target.value as SubscriptionPlan)
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                        >
                          <option value="trial">Trial (80)</option>
                          <option value="starter">Starter (200)</option>
                          <option value="standard">Standard (500)</option>
                          <option value="enterprise">Enterprise (1500)</option>
                        </select>
                        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500 mt-1 tabular-nums">
                          <Users className="h-3 w-3 text-slate-400" />
                          <span>
                            {enrolled} / {school.studentQuota} seats · {school.staffCount ?? 0} staff
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div
                          className={`inline-flex items-center gap-1 font-mono tabular-nums font-medium ${
                            isPastExpiry ? 'text-red-700' : 'text-slate-800'
                          }`}
                        >
                          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                          <span>{expiryDate}</span>
                        </div>
                        {isPastExpiry && (
                          <div className="text-[10px] font-semibold text-red-700 mt-0.5">
                            Past due
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            STATUS_BADGE[effectiveStatus]
                          }`}
                        >
                          {effectiveStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === school.id}
                            onClick={() => handleRenewLicense(school, 365)}
                            className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100 whitespace-nowrap"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Renew +1 Yr</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyId === school.id}
                            onClick={() => void handleGenerateInvoice(school)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          >
                            <Receipt className="h-3 w-3" />
                            <span>Issue Invoice</span>
                          </button>

                          {effectiveStatus !== 'active' && (
                            <button
                              type="button"
                              disabled={busyId === school.id}
                              onClick={() => handleStatusChange(school, 'active')}
                              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Activate</span>
                            </button>
                          )}

                          {effectiveStatus !== 'suspended' && (
                            <button
                              type="button"
                              disabled={busyId === school.id}
                              onClick={() => handleStatusChange(school, 'suspended')}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                            >
                              <Ban className="h-3 w-3" />
                              <span>Suspend</span>
                            </button>
                          )}

                          {effectiveStatus !== 'expired' && (
                            <button
                              type="button"
                              disabled={busyId === school.id}
                              onClick={() => handleStatusChange(school, 'expired')}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            >
                              <ClockAlert className="h-3 w-3" />
                              <span>Expire</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busyId === school.id}
                            onClick={() => {
                              setErrorBanner(null);
                              setDeleteConfirmText('');
                              setDeleteTarget(school);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-800 hover:bg-red-100"
                            title={`Delete ${school.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chronological System Audit Logs */}
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-800" />
                <span>System Audit Logs</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Chronological feed of school onboarding, license mutations, staff provisioning, and sign-in events
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Filter action, user, school..."
                className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs text-slate-900"
              />
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Event Action</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Institution</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No platform audit events recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] font-semibold text-blue-900 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-slate-900 font-medium">{log.userEmail}</div>
                        <div className="text-[10px] text-slate-500 uppercase">{log.userRole}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {log.schoolName ?? 'Platform Global'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <SchoolOnboardingModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onOnboarded={async (created) => {
          await onRefreshPlatform();
          setNotice(
            `Onboarded "${created.name}" (${created.schoolCode}${created.adminStaffId ? ` · Admin ${created.adminStaffId}` : ''}).`
          );
        }}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-red-50/70">
              <div className="flex items-center gap-2.5 text-red-900">
                <AlertTriangle className="h-5 w-5 text-red-700 shrink-0" />
                <h3 className="font-display text-sm font-bold">Delete School Tenant</h3>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmText('');
                }}
                className="p-1 rounded text-slate-500 hover:bg-slate-200"
                aria-label="Close delete confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteSchool} className="p-5 space-y-4 text-xs">
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 space-y-1 text-red-900">
                <p className="font-semibold">{deleteTarget.name}</p>
                <p className="font-mono text-[11px] text-red-800">
                  {deleteTarget.ministryRegNo || 'MoES/SEC/—'} · {deleteTarget.subdomain}.schuleflow.ug
                </p>
                <p className="text-[11px] text-red-800">
                  {deleteTarget.activeStudentCount ?? 0} active students · {deleteTarget.staffCount ?? 0} staff accounts
                </p>
              </div>

              <p className="text-slate-600 leading-relaxed">
                This action is permanent and will delete the school along with all its students,
                classes, subjects, examinations, marksheets, billing records, and institutional user
                logins.
              </p>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Type <span className="font-mono font-bold text-slate-900">{deleteTarget.subdomain}</span> to confirm:
                </label>
                <input
                  type="text"
                  required
                  disabled={deleting}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deleteTarget.subdomain}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-red-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirmText('');
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    deleting ||
                    deleteConfirmText.trim().toLowerCase() !== deleteTarget.subdomain.toLowerCase()
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span>{deleting ? 'Deleting...' : 'Permanently Delete School'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-amber-50/80">
              <div className="flex items-center gap-2.5 text-amber-950">
                <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
                <h3 className="font-display text-sm font-bold">Renew Cloud Data to Preview Baseline</h3>
              </div>
              <button
                type="button"
                disabled={resettingBaseline}
                onClick={() => {
                  setResetModalOpen(false);
                  setResetConfirmText('');
                }}
                className="p-1 rounded text-slate-500 hover:bg-slate-200"
                aria-label="Close renew confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmResetBaseline} className="p-5 space-y-4 text-xs">
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-1 text-amber-950">
                <p className="font-semibold">Clean Baseline: Jangu International School (JIS-101)</p>
                <p className="text-[11px] text-amber-900">
                  Clears all existing schools, staff, students, exams, marksheets, and audit logs in this
                  database, then restores the exact preview baseline (Super Admin + JIS-101 with staff 001–004).
                </p>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Type <span className="font-mono font-bold text-slate-900">RESET</span> to confirm:
                </label>
                <input
                  type="text"
                  required
                  disabled={resettingBaseline}
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="RESET"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={resettingBaseline}
                  onClick={() => {
                    setResetModalOpen(false);
                    setResetConfirmText('');
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingBaseline || resetConfirmText.trim().toUpperCase() !== 'RESET'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-4 py-2 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {resettingBaseline ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>{resettingBaseline ? 'Renewing...' : 'Renew Cloud Database'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

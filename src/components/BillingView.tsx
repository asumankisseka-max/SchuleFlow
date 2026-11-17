import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CreditCard,
  Info,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { SchoolTenant, SubscriptionInvoice } from '../types';
import {
  getPackageDefinition,
  isSchoolSubscriptionExpired,
  SUBSCRIPTION_PACKAGES,
} from '../utils/plans';

interface BillingViewProps {
  school: SchoolTenant;
  activeStudentsCount: number;
  invoices: SubscriptionInvoice[];
  expiredLocked?: boolean;
  onRefreshStatus?: () => Promise<void> | void;
  onLogout?: () => void;
}

export function BillingView({
  school,
  activeStudentsCount,
  invoices,
  expiredLocked = false,
  onRefreshStatus,
  onLogout,
}: BillingViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPkg = getPackageDefinition(school.plan);
  const isExpired = expiredLocked || isSchoolSubscriptionExpired(school);
  const usagePercent = Math.min(
    100,
    Math.round((activeStudentsCount / Math.max(1, school.studentQuota)) * 100)
  );
  const expiryDate = school.licenseExpiresAt ? school.licenseExpiresAt.slice(0, 10) : '—';

  const handleRefresh = async () => {
    if (!onRefreshStatus) return;
    setError(null);
    setRefreshing(true);
    try {
      await onRefreshStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not refresh license status.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {isExpired && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-bold text-red-950">
                School Subscription Expired — View Only
              </h2>
              <p className="text-xs text-red-900 mt-1 max-w-2xl leading-relaxed">
                <strong>{school.name}</strong>&apos;s license expired on{' '}
                <span className="font-mono font-semibold">{expiryDate}</span>. Academic modules
                (Marks Entry, Students, Results, and Report Cards) are temporarily locked until the{' '}
                <strong>Platform Super Admin</strong> renews or assigns an active subscription
                package for your school.
              </p>
              <p className="text-xs font-medium text-red-950 mt-2">
                Schools can view package tiers below. Contact your Platform Super Admin to update or
                renew your subscription, then click Check License Status.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onRefreshStatus && (
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-950 disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{refreshing ? 'Checking...' : 'Check License Status'}</span>
              </button>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-900 hover:bg-red-100 whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      )}

      {!isExpired && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Subscription Packages &amp; Licensing (View Only)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {school.name} · {school.subdomain}.schuleflow.ug · {school.termName}{' '}
              {school.academicYear}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-slate-600">
              Active Package: <strong className="text-slate-900">{currentPkg.name}</strong> · Valid
              until <span className="font-mono text-slate-900">{expiryDate}</span>
            </div>
            {onRefreshStatus && (
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {usagePercent >= 90 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Your school is using <strong>{usagePercent}%</strong> of its licensed student seats (
            {activeStudentsCount} / {school.studentQuota}). Contact the Platform Super Admin to
            upgrade your school package before registering new students.
          </span>
        </div>
      )}

      {/* Current License Status Cards (Read-Only, No Prices) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Current Package</span>
            <CreditCard className="h-4 w-4 text-blue-800" aria-hidden="true" />
          </div>
          <div className="font-display text-xl font-bold text-slate-900">{currentPkg.name}</div>
          <div className="text-xs text-slate-500">{currentPkg.tagline}</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Student Seat Capacity</span>
            <Users className="h-4 w-4 text-blue-800" aria-hidden="true" />
          </div>
          <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">
            {activeStudentsCount} / {school.studentQuota}
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                usagePercent >= 90 ? 'bg-amber-600' : 'bg-blue-800'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>License Expiry</span>
            <CalendarClock className="h-4 w-4 text-blue-800" aria-hidden="true" />
          </div>
          <div
            className={`font-mono text-xl font-bold tabular-nums ${
              isExpired ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {expiryDate}
          </div>
          <div className="text-xs text-slate-500 capitalize">
            Status: {isExpired ? 'Expired' : school.subscriptionStatus || school.status}
          </div>
        </div>
      </div>

      {/* Four Subscription Packages (View-Only, Trial Inclusive, No Prices) */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Platform Licensing Packages
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Overview of the four school licensing packages (Trial inclusive). Package changes and
              renewals are performed exclusively by the Platform Super Admin.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-800 shrink-0" aria-hidden="true" />
            <span>View Only · Managed by Platform Super Admin</span>
          </div>
        </div>

        <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3.5 py-2.5 text-xs text-blue-950 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-800 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Need to upgrade seat capacity, switch tiers, or renew your school license? Contact your{' '}
            <strong>Platform Super Admin</strong> to update your assigned package.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SUBSCRIPTION_PACKAGES.map((pkg) => {
            const isCurrent = school.plan === pkg.id;

            return (
              <div
                key={pkg.id}
                className={`rounded-lg border p-4 flex flex-col justify-between gap-4 ${
                  isCurrent ? 'border-blue-800 bg-blue-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-display text-base font-bold text-slate-900">
                        {pkg.name}
                      </h4>
                      {isCurrent && (
                        <span className="rounded border border-blue-200 bg-blue-100/70 px-2 py-0.5 text-[11px] font-semibold text-blue-900">
                          Current Package
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{pkg.tagline}</p>
                  </div>

                  <div className="font-mono text-sm font-bold text-blue-900 tabular-nums">
                    Up to {pkg.studentQuota.toLocaleString()} Students
                  </div>

                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {pkg.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-1.5">
                        <Check
                          className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2.5 border-t border-slate-100 text-[11px] font-medium text-slate-500">
                  {isCurrent
                    ? `Assigned to ${school.name}`
                    : 'Assigned by Platform Super Admin'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Subscription Activity Log (Read-Only, No Prices) */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Subscription &amp; Renewal History
          </h3>
          <span className="text-xs text-slate-500 tabular-nums">
            {invoices.length} record(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Package / Term</th>
                <th className="py-3 px-4">Year</th>
                <th className="py-3 px-4">Students / Quota</th>
                <th className="py-3 px-4">Issued</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No subscription activity recorded yet.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-semibold text-slate-900">{inv.termName}</td>
                    <td className="py-3 px-4 font-mono text-slate-700">{inv.academicYear}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                      {inv.activeStudentsCount} / {inv.licensedQuota}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">{inv.issuedAt}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          inv.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : inv.status === 'overdue'
                              ? 'bg-red-50 text-red-800 border-red-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {inv.status === 'paid' ? 'Active' : inv.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

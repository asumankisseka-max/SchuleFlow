import type { SchoolStatus, SchoolTenant, SubscriptionPlan } from '../types.ts';

export interface PackageDefinition {
  id: SubscriptionPlan;
  name: string;
  tagline: string;
  studentQuota: number;
  defaultDurationDays: number;
  defaultStatus: SchoolStatus;
  highlights: string[];
}

export const SUBSCRIPTION_PACKAGES: PackageDefinition[] = [
  {
    id: 'trial',
    name: 'Trial',
    tagline: '30-day school evaluation',
    studentQuota: 80,
    defaultDurationDays: 30,
    defaultStatus: 'trial',
    highlights: [
      'Up to 80 active students',
      "O'Level CBC & A'Level grading",
      'Marksheets & report card preview',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: "For single-section & O'Level schools",
    studentQuota: 200,
    defaultDurationDays: 365,
    defaultStatus: 'active',
    highlights: [
      'Up to 200 active students',
      'Unlimited teacher & staff accounts',
      'Customisable A4 report cards',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    tagline: "For growing O'Level & A'Level schools",
    studentQuota: 500,
    defaultDurationDays: 365,
    defaultStatus: 'active',
    highlights: [
      'Up to 500 active students',
      "Full O'Level CBC & A'Level UACE",
      'Excel imports & student history',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large multi-stream institutions',
    studentQuota: 1500,
    defaultDurationDays: 365,
    defaultStatus: 'active',
    highlights: [
      'Up to 1,500 active students',
      'All academic, admin & DOS tools',
      'Priority onboarding & support',
    ],
  },
];

export const PACKAGE_QUOTA_MAP: Record<SubscriptionPlan, number> = {
  trial: 80,
  starter: 200,
  standard: 500,
  enterprise: 1500,
};

export function getPackageDefinition(plan?: string | null): PackageDefinition {
  return (
    SUBSCRIPTION_PACKAGES.find((p) => p.id === plan) ??
    SUBSCRIPTION_PACKAGES[2] // standard fallback
  );
}

export function isSchoolSuspended(school?: Pick<SchoolTenant, 'status' | 'subscriptionStatus'> | null): boolean {
  if (!school) return false;
  const eff = school.subscriptionStatus || school.status;
  return eff === 'suspended';
}

export function isSchoolSubscriptionExpired(
  school?: Pick<SchoolTenant, 'status' | 'subscriptionStatus' | 'licenseExpiresAt'> | null
): boolean {
  if (!school) return false;
  const eff = school.subscriptionStatus || school.status;
  if (eff === 'suspended') return false;
  if (eff === 'expired') return true;
  if (!school.licenseExpiresAt) return false;
  const expiryMs = new Date(school.licenseExpiresAt).getTime();
  return !Number.isNaN(expiryMs) && expiryMs < Date.now();
}

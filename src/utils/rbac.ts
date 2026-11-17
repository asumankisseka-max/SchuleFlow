import type { GlobalRole, UserRole, WorkspaceTab } from '../types';

export function normalizeUserRole(role?: string | null): UserRole {
  if (!role || role === 'admin' || role === 'school_admin') return 'school_admin';
  if (
    role === 'dos' ||
    role === 'class_teacher' ||
    role === 'teacher' ||
    role === 'bursar' ||
    role === 'headteacher'
  ) {
    return role;
  }
  return 'teacher';
}

export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
  school_admin: 'School Administrator',
  admin: 'School Administrator',
  dos: 'Director of Studies',
  class_teacher: 'Class Teacher',
  teacher: 'Subject Teacher',
  bursar: 'School Bursar',
  headteacher: 'Headteacher',
};

const ROLE_ALLOWED_TABS: Record<UserRole, WorkspaceTab[]> = {
  school_admin: [
    'dashboard',
    'students',
    'classes',
    'subjects',
    'teachers',
    'examinations',
    'marksheets',
    'results-analysis',
    'reports',
    'academic-history',
    'settings',
    'users',
    'billing',
  ],
  admin: [
    'dashboard',
    'students',
    'classes',
    'subjects',
    'teachers',
    'examinations',
    'marksheets',
    'results-analysis',
    'reports',
    'academic-history',
    'settings',
    'users',
    'billing',
  ],
  dos: [
    'dashboard',
    'students',
    'classes',
    'subjects',
    'teachers',
    'examinations',
    'marks-entry',
    'marksheets',
    'results-analysis',
    'reports',
    'academic-history',
    'settings',
  ],
  class_teacher: [
    'dashboard',
    'students',
    'marks-entry',
    'results-analysis',
    'reports',
    'academic-history',
  ],
  teacher: [
    'dashboard',
    'students',
    'marks-entry',
    'results-analysis',
    'reports',
    'academic-history',
  ],
  bursar: ['billing'],
  headteacher: [
    'dashboard',
    'students',
    'classes',
    'examinations',
    'marksheets',
    'results-analysis',
    'reports',
    'academic-history',
    'settings',
    'billing',
  ],
};

export function isTeachingRole(role: UserRole): boolean {
  const r = normalizeUserRole(role);
  return r === 'teacher' || r === 'class_teacher';
}

export function isSchoolAdminRole(role: UserRole): boolean {
  const r = normalizeUserRole(role);
  return r === 'school_admin';
}

export function canAccessTab(
  role: UserRole,
  tab: WorkspaceTab,
  globalRole: GlobalRole = 'school_user'
): boolean {
  // Strict Super Admin Isolation: platform owner manages onboarding, licensing, and audit logs only
  if (globalRole === 'super_admin') {
    return tab === 'platform-admin';
  }
  if (tab === 'platform-admin') {
    return false;
  }
  const normalized = normalizeUserRole(role);
  return ROLE_ALLOWED_TABS[normalized].includes(tab);
}

export function getAllowedTabs(
  role: UserRole,
  globalRole: GlobalRole = 'school_user'
): WorkspaceTab[] {
  if (globalRole === 'super_admin') {
    return ['platform-admin'];
  }
  const normalized = normalizeUserRole(role);
  return [...ROLE_ALLOWED_TABS[normalized]];
}

export function getDefaultTabForRole(
  globalRole: GlobalRole,
  schoolRole: UserRole
): WorkspaceTab {
  if (globalRole === 'super_admin') return 'platform-admin';
  const normalized = normalizeUserRole(schoolRole);
  if (normalized === 'bursar') return 'billing';
  return 'dashboard';
}

export type RoleDashboardPath =
  | '/platform/dashboard'
  | '/school/dashboard'
  | '/teacher/dashboard'
  | '/bursar/dashboard';

export function getDashboardPathForRole(
  globalRole: GlobalRole,
  schoolRole: UserRole
): RoleDashboardPath {
  if (globalRole === 'super_admin') return '/platform/dashboard';
  const normalized = normalizeUserRole(schoolRole);
  if (normalized === 'bursar') return '/bursar/dashboard';
  if (normalized === 'teacher' || normalized === 'class_teacher') return '/teacher/dashboard';
  return '/school/dashboard';
}

export function canApproveOrPublishResults(role: UserRole): boolean {
  const r = normalizeUserRole(role);
  return r === 'dos' || r === 'headteacher' || r === 'school_admin';
}

export function canManageAcademicSetup(role: UserRole): boolean {
  const r = normalizeUserRole(role);
  return r === 'school_admin' || r === 'dos';
}

export function canManageUsers(role: UserRole): boolean {
  return normalizeUserRole(role) === 'school_admin';
}

export function canManageBilling(role: UserRole): boolean {
  const r = normalizeUserRole(role);
  return r === 'bursar' || r === 'school_admin' || r === 'headteacher';
}

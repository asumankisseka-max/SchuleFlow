import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuditLogRecord,
  AuthSessionProfile,
  SchoolDatabase,
  SchoolTenant,
  SubscriptionInvoice,
  UserAccount,
} from '../types';
import { ApiError, configureApiClient, createTenantApi, platformApi } from '../utils/apiClient';
import { isSchoolSubscriptionExpired } from '../utils/plans';
import { ROLE_DISPLAY_NAMES } from '../utils/rbac';

const SESSION_STORAGE_KEY = 'schuleflow_auth_token';
const RECENT_ACCOUNTS_KEY = 'schuleflow_recent_accounts';

export interface RememberedAccountHint {
  identifier: string;
  staffId?: string;
  name: string;
  schoolId: string | null;
  schoolCode: string | null;
  schoolName: string;
  roleLabel: string;
  mode: 'school' | 'super_admin';
}

export interface CredentialSignInParams {
  schoolCode?: string;
  identifier: string;
  password: string;
  mode?: 'school' | 'super_admin';
  rememberMe?: boolean;
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    window.sessionStorage.getItem(SESSION_STORAGE_KEY) ||
    window.localStorage.getItem(SESSION_STORAGE_KEY)
  );
}

function saveStoredToken(token: string, rememberMe: boolean): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  if (rememberMe) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  } else {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  }
}

function clearStoredToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function readRecentAccounts(): RememberedAccountHint[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RememberedAccountHint =>
          Boolean(item) &&
          typeof item.identifier === 'string' &&
          typeof item.name === 'string' &&
          typeof item.schoolName === 'string' &&
          typeof item.roleLabel === 'string'
      )
      .map((item): RememberedAccountHint => ({
        ...item,
        schoolCode: typeof item.schoolCode === 'string' ? item.schoolCode : null,
        mode:
          item.mode === 'super_admin' || item.schoolId === null ? 'super_admin' : 'school',
      }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function writeRecentAccounts(accounts: RememberedAccountHint[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, 5)));
  } catch {
    // Ignore storage quota errors
  }
}

function formatFriendlyAuthError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : 'Sign-in failed. Please try again.';

  return raw.replace(/^(Forbidden|Unauthorized):\s*/i, '').trim() || 'Sign-in failed.';
}

function findMatchingStaffInDb(
  staffList: UserAccount[],
  profile: AuthSessionProfile,
  schoolId: string
): UserAccount | undefined {
  const cleanStaffId = profile.staffId?.trim().toLowerCase() ?? '';
  const cleanEmail = profile.email.trim().toLowerCase();
  const uid = profile.uid;
  return staffList.find((u) => {
    if (cleanStaffId && u.staffId && u.staffId.trim().toLowerCase() === cleanStaffId) {
      return true;
    }
    if (cleanEmail && u.email.trim().toLowerCase() === cleanEmail) {
      return true;
    }
    const unprefixed = u.id.includes(':') ? u.id.split(':').slice(1).join(':') : u.id;
    const prefixed = `${schoolId}:${unprefixed}`;
    return (
      u.id === uid ||
      unprefixed === uid ||
      prefixed === uid ||
      `local:${u.id}` === uid ||
      `local:${prefixed}` === uid ||
      `local:${unprefixed}` === uid
    );
  });
}

interface SchoolContextValue {
  authProfile: AuthSessionProfile | null;
  authLoading: boolean;
  authError: string | null;
  schools: SchoolTenant[];
  auditLogs: AuditLogRecord[];
  activeSchoolId: string | null;
  activeSchool: SchoolTenant | null;
  academicYear: string;
  termName: string;
  db: SchoolDatabase | null;
  subscriptionLocked: boolean;
  subscriptionPortalData: {
    activeStudentsCount: number;
    invoices: SubscriptionInvoice[];
  } | null;
  loadingWorkspace: boolean;
  workspaceError: string | null;
  recentAccounts: RememberedAccountHint[];
  removeRecentAccount: (identifier: string, schoolId: string | null) => void;
  signInWithCredentials: (params: CredentialSignInParams) => Promise<void>;
  signOutWorkspace: () => Promise<void>;
  refreshPlatformData: () => Promise<void>;
  refreshTenantWorkspace: (schoolId?: string) => Promise<void>;
  refreshSubscriptionPortal: (schoolId?: string) => Promise<void>;
  updateLocalTenantDb: (updater: (prev: SchoolDatabase) => SchoolDatabase) => void;
  updateLocalActiveSchool: (updater: (prev: SchoolTenant) => SchoolTenant) => void;
  invalidateTenantCache: (schoolId?: string) => void;
  tenantApi: ReturnType<typeof createTenantApi> | null;
}

const SchoolContext = createContext<SchoolContextValue | null>(null);

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [authProfile, setAuthProfile] = useState<AuthSessionProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [schools, setSchools] = useState<SchoolTenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);
  const [db, setDb] = useState<SchoolDatabase | null>(null);
  const [subscriptionLocked, setSubscriptionLocked] = useState(false);
  const [subscriptionPortalData, setSubscriptionPortalData] = useState<{
    activeStudentsCount: number;
    invoices: SubscriptionInvoice[];
  } | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RememberedAccountHint[]>(() =>
    readRecentAccounts()
  );

  const localTokenRef = useRef<string | null>(readStoredToken());
  const tenantCacheRef = useRef<Map<string, SchoolDatabase>>(new Map());
  const authProfileRef = useRef<AuthSessionProfile | null>(null);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    return localTokenRef.current;
  }, []);

  useEffect(() => {
    configureApiClient(getValidToken, activeSchoolId);
  }, [getValidToken, activeSchoolId]);

  const invalidateTenantCache = useCallback((schoolId?: string) => {
    if (schoolId) {
      tenantCacheRef.current.delete(schoolId);
    } else {
      tenantCacheRef.current.clear();
    }
  }, []);

  const loadTenantWorkspace = useCallback(
    async (
      schoolId: string,
      forceRefresh = false,
      profileOverride?: AuthSessionProfile | null,
      schoolsOverride?: SchoolTenant[]
    ) => {
      setLoadingWorkspace(true);
      setWorkspaceError(null);
      configureApiClient(getValidToken, schoolId);

      const verifyTenantStaffMembership = (resolvedDb: SchoolDatabase): boolean => {
        const activeProfile = profileOverride ?? authProfileRef.current;
        if (!activeProfile || activeProfile.globalRole === 'super_admin') {
          return true;
        }
        const matchedStaff = findMatchingStaffInDb(resolvedDb.users, activeProfile, schoolId);
        if (!matchedStaff) {
          setWorkspaceError(
            'Account not assigned to an active school workspace. Contact your School Administrator.'
          );
          setDb(null);
          return false;
        }
        if (!matchedStaff.active) {
          setWorkspaceError('Account deactivated. Please contact your School Administrator.');
          setDb(null);
          return false;
        }
        return true;
      };

      const enterExpiredPortalMode = async () => {
        const api = createTenantApi(schoolId);
        const overview = await api.getSubscriptionOverview();
        setSubscriptionLocked(true);
        setSubscriptionPortalData({
          activeStudentsCount: overview.activeStudentsCount,
          invoices: overview.invoices,
        });
        setDb(null);
        tenantCacheRef.current.delete(schoolId);
        setSchools((prev) =>
          prev.some((s) => s.id === schoolId)
            ? prev.map((s) => (s.id === schoolId ? { ...s, ...overview.school } : s))
            : [overview.school]
        );
      };

      try {
        const matchedSchool = (schoolsOverride ?? []).find((s) => s.id === schoolId);
        if (matchedSchool && isSchoolSubscriptionExpired(matchedSchool)) {
          await enterExpiredPortalMode();
          return;
        }

        if (!forceRefresh) {
          const cached = tenantCacheRef.current.get(schoolId);
          if (cached) {
            if (verifyTenantStaffMembership(cached)) {
              setSubscriptionLocked(false);
              setSubscriptionPortalData(null);
              setDb(cached);
            }
            setLoadingWorkspace(false);
            return;
          }
        }

        const api = createTenantApi(schoolId);
        const result = await api.bootstrap();
        if (isSchoolSubscriptionExpired(result.school)) {
          await enterExpiredPortalMode();
          return;
        }
        if (!verifyTenantStaffMembership(result.db)) {
          return;
        }
        setSubscriptionLocked(false);
        setSubscriptionPortalData(null);
        tenantCacheRef.current.set(schoolId, result.db);
        setDb(result.db);
        setSchools((prev) =>
          prev.map((s) => (s.id === schoolId ? { ...s, ...result.school } : s))
        );
      } catch (err: unknown) {
        if (
          err instanceof ApiError &&
          err.status === 403 &&
          err.message.toLowerCase().includes('expired')
        ) {
          try {
            await enterExpiredPortalMode();
            return;
          } catch (portalErr: unknown) {
            setWorkspaceError(formatFriendlyAuthError(portalErr));
            setDb(null);
            return;
          }
        }
        setWorkspaceError(formatFriendlyAuthError(err));
        setDb(null);
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [getValidToken]
  );

  const loadPlatformData = useCallback(async () => {
    try {
      const [schoolsRes, logsRes] = await Promise.all([
        platformApi.listSchools(),
        platformApi.listAuditLogs(),
      ]);
      setSchools(schoolsRes.schools);
      setAuditLogs(logsRes.logs);
    } catch (err) {
      console.error('Failed to load super admin platform data:', err);
    }
  }, []);

  const rememberSignedInHint = useCallback(
    (user: AuthSessionProfile, accessibleSchools: SchoolTenant[], preferredIdentifier?: string) => {
      const schoolMatch = user.schoolId
        ? accessibleSchools.find((s) => s.id === user.schoolId)
        : undefined;
      const hintIdentifier = (
        user.staffId ||
        preferredIdentifier?.trim() ||
        user.email ||
        user.username ||
        ''
      ).trim();
      if (!hintIdentifier) return;
      const isSuperAdmin = user.globalRole === 'super_admin';
      const roleLabel = isSuperAdmin
        ? 'Platform Super Admin'
        : ROLE_DISPLAY_NAMES[user.schoolRole] ?? 'Staff';
      const entry: RememberedAccountHint = {
        identifier: hintIdentifier,
        staffId: user.staffId,
        name: user.name,
        schoolId: isSuperAdmin ? null : user.schoolId,
        schoolCode: isSuperAdmin ? null : schoolMatch?.schoolCode ?? user.schoolCode ?? null,
        schoolName: isSuperAdmin
          ? 'Platform Administration'
          : schoolMatch?.name ?? 'School Workspace',
        roleLabel,
        mode: isSuperAdmin ? 'super_admin' : 'school',
      };
      setRecentAccounts((prev) => {
        const filtered = prev.filter(
          (item) =>
            !(
              item.identifier.toLowerCase() === entry.identifier.toLowerCase() &&
              item.schoolId === entry.schoolId
            )
        );
        const next = [entry, ...filtered].slice(0, 5);
        writeRecentAccounts(next);
        return next;
      });
    },
    []
  );

  const removeRecentAccount = useCallback((identifier: string, schoolId: string | null) => {
    setRecentAccounts((prev) => {
      const next = prev.filter(
        (item) =>
          !(
            item.identifier.toLowerCase() === identifier.toLowerCase() &&
            item.schoolId === schoolId
          )
      );
      writeRecentAccounts(next);
      return next;
    });
  }, []);

  const applyAuthenticatedSession = useCallback(
    async (
      user: AuthSessionProfile,
      accessibleSchools: SchoolTenant[],
      preferredIdentifier?: string
    ) => {
      if (user.globalRole !== 'super_admin') {
        if (!user.active) {
          throw new Error('Account deactivated. Please contact your School Administrator.');
        }
        if (!user.schoolId) {
          throw new Error(
            'Account not assigned to an active school workspace. Contact your School Administrator.'
          );
        }
      }

      authProfileRef.current = user;
      setAuthProfile(user);
      setSchools(accessibleSchools);
      rememberSignedInHint(user, accessibleSchools, preferredIdentifier);

      if (user.globalRole === 'super_admin') {
        setActiveSchoolId(null);
        setDb(null);
        setSubscriptionLocked(false);
        setSubscriptionPortalData(null);
        setWorkspaceError(null);
        configureApiClient(getValidToken, null);
        await loadPlatformData();
        return;
      }

      const assignedSchoolId = user.schoolId!;
      setActiveSchoolId(assignedSchoolId);
      setAuditLogs([]);
      await loadTenantWorkspace(assignedSchoolId, true, user, accessibleSchools);
    },
    [getValidToken, loadPlatformData, loadTenantWorkspace, rememberSignedInHint]
  );

  // Restore stored PostgreSQL session on mount
  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const storedToken = readStoredToken();
      if (!storedToken) {
        if (active) setAuthLoading(false);
        return;
      }

      localTokenRef.current = storedToken;
      configureApiClient(getValidToken, null);
      try {
        const synced = await platformApi.syncSession();
        if (!active) return;
        await applyAuthenticatedSession(synced.user, synced.schools);
      } catch (err: unknown) {
        localTokenRef.current = null;
        clearStoredToken();
        if (active) {
          setAuthProfile(null);
          setAuthError(formatFriendlyAuthError(err));
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    };

    void restoreSession();

    return () => {
      active = false;
    };
  }, [applyAuthenticatedSession, getValidToken]);

  const signInWithCredentials = useCallback(
    async (params: CredentialSignInParams) => {
      const trimmedIdentifier = params.identifier.trim();
      const trimmedSchoolCode = params.schoolCode?.trim().toUpperCase() || undefined;
      const mode = params.mode ?? 'school';
      const rememberMe = params.rememberMe ?? true;

      setAuthError(null);
      setAuthLoading(true);
      try {
        localTokenRef.current = null;
        clearStoredToken();
        configureApiClient(async () => null, null);

        const res = await platformApi.loginWithCredentials({
          schoolCode: mode === 'school' ? trimmedSchoolCode : undefined,
          identifier: trimmedIdentifier,
          password: params.password,
          mode,
        });

        localTokenRef.current = res.token;
        saveStoredToken(res.token, rememberMe);
        configureApiClient(getValidToken, null);
        await applyAuthenticatedSession(res.user, res.schools, trimmedIdentifier);
      } catch (err: unknown) {
        localTokenRef.current = null;
        clearStoredToken();
        setAuthProfile(null);
        setDb(null);
        setAuthError(formatFriendlyAuthError(err));
      } finally {
        setAuthLoading(false);
      }
    },
    [applyAuthenticatedSession, getValidToken]
  );

  const signOutWorkspace = useCallback(async () => {
    tenantCacheRef.current.clear();
    localTokenRef.current = null;
    clearStoredToken();
    setAuthProfile(null);
    setSchools([]);
    setAuditLogs([]);
    setActiveSchoolId(null);
    setDb(null);
    setSubscriptionLocked(false);
    setSubscriptionPortalData(null);
    setWorkspaceError(null);
    setAuthError(null);
    await platformApi.logoutSession().catch(() => undefined);
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }, []);

  const refreshPlatformData = useCallback(async () => {
    if (!authProfile || authProfile.globalRole !== 'super_admin') return;
    await loadPlatformData();
  }, [authProfile, loadPlatformData]);

  const refreshTenantWorkspace = useCallback(
    async (targetSchoolId?: string) => {
      const sid = targetSchoolId ?? activeSchoolId;
      if (!sid) return;
      await loadTenantWorkspace(sid, true, authProfileRef.current, []);
    },
    [activeSchoolId, loadTenantWorkspace]
  );

  const refreshSubscriptionPortal = useCallback(
    async (targetSchoolId?: string) => {
      const sid = targetSchoolId ?? activeSchoolId;
      if (!sid) return;
      const api = createTenantApi(sid);
      const overview = await api.getSubscriptionOverview();
      setSchools((prev) =>
        prev.map((s) => (s.id === sid ? { ...s, ...overview.school } : s))
      );
      setSubscriptionPortalData({
        activeStudentsCount: overview.activeStudentsCount,
        invoices: overview.invoices,
      });
      if (!isSchoolSubscriptionExpired(overview.school)) {
        await loadTenantWorkspace(sid, true, authProfileRef.current, [overview.school]);
      }
    },
    [activeSchoolId, loadTenantWorkspace]
  );

  const updateLocalTenantDb = useCallback(
    (updater: (prev: SchoolDatabase) => SchoolDatabase) => {
      setDb((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (activeSchoolId) {
          tenantCacheRef.current.set(activeSchoolId, next);
        }
        return next;
      });
    },
    [activeSchoolId]
  );

  const updateLocalActiveSchool = useCallback(
    (updater: (prev: SchoolTenant) => SchoolTenant) => {
      if (!activeSchoolId) return;
      setSchools((prev) =>
        prev.map((s) => (s.id === activeSchoolId ? updater(s) : s))
      );
    },
    [activeSchoolId]
  );

  const activeSchool = useMemo(
    () => schools.find((s) => s.id === activeSchoolId) ?? null,
    [schools, activeSchoolId]
  );

  const tenantApi = useMemo(
    () => (activeSchoolId ? createTenantApi(activeSchoolId) : null),
    [activeSchoolId]
  );

  const value: SchoolContextValue = {
    authProfile,
    authLoading,
    authError,
    schools,
    auditLogs,
    activeSchoolId,
    activeSchool,
    academicYear: db?.settings.academicYear ?? activeSchool?.academicYear ?? '2026',
    termName: db?.settings.termName ?? activeSchool?.termName ?? 'Term III',
    db,
    subscriptionLocked,
    subscriptionPortalData,
    loadingWorkspace,
    workspaceError,
    recentAccounts,
    removeRecentAccount,
    signInWithCredentials,
    signOutWorkspace,
    refreshPlatformData,
    refreshTenantWorkspace,
    refreshSubscriptionPortal,
    updateLocalTenantDb,
    updateLocalActiveSchool,
    invalidateTenantCache,
    tenantApi,
  };

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchoolContext(): SchoolContextValue {
  const ctx = useContext(SchoolContext);
  if (!ctx) {
    throw new Error('useSchoolContext must be used inside a SchoolProvider.');
  }
  return ctx;
}

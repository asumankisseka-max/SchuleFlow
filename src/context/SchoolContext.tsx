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
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
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
  name: string;
  schoolId: string | null;
  schoolName: string;
  roleLabel: string;
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
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email, phone number, or password.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'Account deactivated. Please contact your School Administrator.';
      case 'auth/too-many-requests':
        return 'Too many failed sign-in attempts. Please wait a moment and try again.';
      case 'auth/operation-not-allowed':
        return 'Email & Password sign-in is not enabled in Firebase Authentication yet.';
      case 'auth/popup-closed-by-user':
        return 'Google Sign-In was cancelled before completing.';
      case 'auth/network-request-failed':
        return 'Network error while contacting the authentication server. Please try again.';
      default:
        break;
    }
  }

  const raw = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
  return raw.replace(/^(Forbidden|Unauthorized):\s*/i, '').trim() || 'Sign-in failed.';
}

function findMatchingStaffInDb(
  staffList: UserAccount[],
  profile: AuthSessionProfile,
  schoolId: string
): UserAccount | undefined {
  const cleanEmail = profile.email.trim().toLowerCase();
  const uid = profile.uid;
  return staffList.find((u) => {
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
  firebaseUser: FirebaseUser | null;
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
  signInWithCredentials: (
    identifier: string,
    password: string,
    options?: { schoolId?: string; rememberMe?: boolean }
  ) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
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
  const handlingManualFirebaseSignInRef = useRef(false);
  const preserveAuthErrorOnSignOutRef = useRef(false);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    if (localTokenRef.current) {
      return localTokenRef.current;
    }
    const current = auth.currentUser;
    if (!current) {
      return null;
    }
    return current.getIdToken();
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
        preferredIdentifier?.trim() ||
        user.email ||
        user.username ||
        ''
      ).trim();
      if (!hintIdentifier) return;
      const roleLabel =
        user.globalRole === 'super_admin'
          ? 'Platform Super Admin'
          : ROLE_DISPLAY_NAMES[user.schoolRole] ?? 'Staff';
      const entry: RememberedAccountHint = {
        identifier: hintIdentifier,
        name: user.name,
        schoolId: user.globalRole === 'super_admin' ? null : user.schoolId,
        schoolName:
          user.globalRole === 'super_admin'
            ? 'Platform Administration'
            : schoolMatch?.name ?? 'School Workspace',
        roleLabel,
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
        // Strict Super Admin Isolation: no school_id, no academic marks workspace
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

  // Restore local credential session (if present) or Firebase session on mount
  useEffect(() => {
    let active = true;

    const restoreLocal = async () => {
      const storedToken = readStoredToken();
      if (!storedToken) return false;

      localTokenRef.current = storedToken;
      configureApiClient(getValidToken, null);
      try {
        const synced = await platformApi.syncSession();
        if (!active) return true;
        await applyAuthenticatedSession(synced.user, synced.schools);
        if (active) setAuthLoading(false);
        return true;
      } catch (err: unknown) {
        localTokenRef.current = null;
        clearStoredToken();
        if (active) {
          setAuthProfile(null);
          setAuthError(formatFriendlyAuthError(err));
          setAuthLoading(false);
        }
        return false;
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);

      // Ignore transient listener updates while signInWithCredentials drives Firebase sign-in
      if (handlingManualFirebaseSignInRef.current) {
        return;
      }

      // Preserve active credential-based session when Firebase user is absent
      if (!user && localTokenRef.current) {
        return;
      }

      if (!user) {
        if (preserveAuthErrorOnSignOutRef.current) {
          preserveAuthErrorOnSignOutRef.current = false;
        } else {
          setAuthError(null);
        }
        tenantCacheRef.current.clear();
        setAuthProfile(null);
        setSchools([]);
        setAuditLogs([]);
        setActiveSchoolId(null);
        setDb(null);
        setAuthLoading(false);
        return;
      }

      // Firebase user signed in — clear any stale local token and sync with backend
      setAuthError(null);
      localTokenRef.current = null;
      clearStoredToken();
      setAuthLoading(true);
      try {
        await user.getIdToken();
        configureApiClient(getValidToken, null);
        const synced = await platformApi.syncSession();
        if (!active) return;
        await applyAuthenticatedSession(synced.user, synced.schools);
      } catch (err: unknown) {
        if (!active) return;
        setAuthError(formatFriendlyAuthError(err));
        setAuthProfile(null);
        setDb(null);
        preserveAuthErrorOnSignOutRef.current = true;
        await signOut(auth).catch(() => undefined);
      } finally {
        if (active) setAuthLoading(false);
      }
    });

    void restoreLocal();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyAuthenticatedSession, getValidToken]);

  const signInWithCredentials = useCallback(
    async (
      identifier: string,
      password: string,
      options?: { schoolId?: string; rememberMe?: boolean }
    ) => {
      const trimmedIdentifier = identifier.trim();
      const rememberMe = options?.rememberMe ?? true;
      const selectedSchoolId = options?.schoolId?.trim() || undefined;
      setAuthError(null);
      setAuthLoading(true);
      try {
        localTokenRef.current = null;
        clearStoredToken();
        configureApiClient(async () => null, null);

        try {
          const res = await platformApi.loginWithCredentials(
            trimmedIdentifier,
            password,
            selectedSchoolId
          );
          localTokenRef.current = res.token;
          saveStoredToken(res.token, rememberMe);
          if (auth.currentUser) {
            await signOut(auth).catch(() => undefined);
          }
          configureApiClient(getValidToken, null);
          await applyAuthenticatedSession(res.user, res.schools, trimmedIdentifier);
          return;
        } catch (backendErr: unknown) {
          const isEmailCredentialMismatch =
            backendErr instanceof ApiError &&
            backendErr.status === 401 &&
            trimmedIdentifier.includes('@');

          if (!isEmailCredentialMismatch) {
            throw backendErr;
          }
        }

        // Fallback to Firebase Auth Email & Password sign-in for Firebase-provisioned accounts
        handlingManualFirebaseSignInRef.current = true;
        try {
          const credential = await signInWithEmailAndPassword(auth, trimmedIdentifier, password);
          const idToken = await credential.user.getIdToken();
          configureApiClient(async () => idToken, null);
          const synced = await platformApi.syncSession();
          configureApiClient(getValidToken, null);
          await applyAuthenticatedSession(synced.user, synced.schools, trimmedIdentifier);
        } catch (firebaseErr: unknown) {
          preserveAuthErrorOnSignOutRef.current = true;
          if (auth.currentUser) {
            await signOut(auth).catch(() => undefined);
          }
          throw firebaseErr;
        } finally {
          handlingManualFirebaseSignInRef.current = false;
        }
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

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      localTokenRef.current = null;
      clearStoredToken();
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      setAuthError(formatFriendlyAuthError(err));
    }
  }, []);

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
    if (auth.currentUser) {
      await signOut(auth);
    }
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
    firebaseUser,
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
    signInWithGoogle,
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

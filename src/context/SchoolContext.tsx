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
  clearAllOfflineState,
  enqueueOfflineMutation,
  flushOutboxQueue,
  getPendingOutboxCount,
  isNetworkOfflineError,
  loadLastSessionMeta,
  loadTenantSnapshot,
  saveLastSessionMeta,
  saveTenantSnapshot,
  type OfflineMutationKind,
  type OfflineSyncConflict,
  type OutboxMutationItem,
} from '../lib/offlineSync';
import type {
  AuditLogRecord,
  AuthSessionProfile,
  ExaminationPeriod,
  MarksheetRecord,
  SchoolDatabase,
  SchoolSettings,
  SchoolTenant,
  StreamClass,
  StudentProfile,
  StudentTermRemarks,
  SubjectCombination,
  SubjectDefinition,
  SubscriptionInvoice,
  UserAccount,
} from '../types';
import { ApiError, configureApiClient, createTenantApi, platformApi } from '../utils/apiClient';
import { isSchoolSubscriptionExpired } from '../utils/plans';
import { ROLE_DISPLAY_NAMES } from '../utils/rbac';

const LEGACY_SESSION_STORAGE_KEY = 'schuleflow_auth_token';
const LEGACY_RECENT_ACCOUNTS_KEY = 'schuleflow_recent_accounts';
const RECENT_ACCOUNTS_KEY = 'schuleflow_recent_accounts_v2';

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
  rememberMe?: boolean;
}

function scrubLegacyTokenStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

function readRecentAccounts(): RememberedAccountHint[] {
  if (typeof window === 'undefined') return [];
  try {
    window.localStorage.removeItem(LEGACY_RECENT_ACCOUNTS_KEY);
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

async function executeQueuedTenantMutation(
  api: ReturnType<typeof createTenantApi>,
  item: OutboxMutationItem
): Promise<unknown> {
  switch (item.kind) {
    case 'saveMarksheet':
      return api.saveMarksheet(item.payload as MarksheetRecord);
    case 'saveRemark': {
      const p = item.payload as {
        examId: string;
        studentId: string;
        field: keyof StudentTermRemarks;
        value: string;
      };
      return api.saveRemark(p.examId, p.studentId, p.field, p.value);
    }
    case 'saveSettings':
      return api.saveSettings(item.payload as SchoolSettings);
    case 'saveClass': {
      const p = item.payload as { cls: StreamClass; attachToExamId?: string };
      return api.saveClass(p.cls, p.attachToExamId);
    }
    case 'saveSubject':
      return api.saveSubject(item.payload as SubjectDefinition);
    case 'saveCombination':
      return api.saveCombination(item.payload as SubjectCombination);
    case 'saveExam':
      return api.saveExam(item.payload as ExaminationPeriod);
    case 'updateStudent':
      return api.updateStudent(item.payload as StudentProfile);
    case 'addStudents':
      return api.addStudents(item.payload as StudentProfile[]);
    case 'promoteStudents': {
      const p = item.payload as {
        studentIds: string[];
        options: Parameters<typeof api.promoteStudents>[1];
      };
      return api.promoteStudents(p.studentIds, p.options);
    }
    case 'deleteStudent': {
      const p = item.payload as { studentId: string };
      return api.deleteStudent(p.studentId);
    }
    case 'publishExam': {
      const p = item.payload as { examId: string };
      return api.publishExam(p.examId);
    }
  }
}

interface SchoolContextValue {
  authProfile: AuthSessionProfile | null;
  authLoading: boolean;
  authError: string | null;
  authErrorCode: string | null;
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
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  syncConflicts: OfflineSyncConflict[];
  dismissSyncConflicts: () => void;
  syncPendingMutations: (targetSchoolId?: string) => Promise<void>;
  persistWithOfflineFallback: <P, R = unknown>(opts: {
    kind: OfflineMutationKind;
    label: string;
    payload: P;
    dedupeKey?: string;
    onlineCall: () => Promise<R>;
  }) => Promise<{ queued: boolean; result?: R }>;
  clearAuthError: () => void;
  removeRecentAccount: (identifier: string, schoolId: string | null) => void;
  signInWithCredentials: (params: CredentialSignInParams) => Promise<boolean>;
  signOutWorkspace: () => Promise<void>;
  completePasswordChange: (token: string, updatedUser: AuthSessionProfile) => void;
  refreshPlatformData: () => Promise<void>;
  refreshTenantWorkspace: (schoolId?: string, silent?: boolean) => Promise<void>;
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
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);

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

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncConflicts, setSyncConflicts] = useState<OfflineSyncConflict[]>([]);

  // In-memory only: browser reload relies securely on the HttpOnly sf_session cookie
  const localTokenRef = useRef<string | null>(null);
  const tenantCacheRef = useRef<Map<string, SchoolDatabase>>(new Map());
  const authProfileRef = useRef<AuthSessionProfile | null>(null);
  const schoolsRef = useRef<SchoolTenant[]>([]);
  const syncingRef = useRef(false);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  useEffect(() => {
    schoolsRef.current = schools;
  }, [schools]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const refreshOutboxCount = useCallback(async (sid?: string | null, uid?: string | null) => {
    const resolvedSid = sid ?? activeSchoolId;
    const resolvedUid = uid ?? authProfileRef.current?.uid;
    if (!resolvedSid || !resolvedUid) {
      setPendingSyncCount(0);
      return 0;
    }
    const count = await getPendingOutboxCount(resolvedSid, resolvedUid);
    setPendingSyncCount(count);
    return count;
  }, [activeSchoolId]);

  const loadTenantWorkspace = useCallback(
    async (
      schoolId: string,
      forceRefresh = false,
      profileOverride?: AuthSessionProfile | null,
      schoolsOverride?: SchoolTenant[],
      silent = false
    ) => {
      if (!silent) {
        setLoadingWorkspace(true);
        setWorkspaceError(null);
      }
      configureApiClient(getValidToken, schoolId);
      const activeProfile = profileOverride ?? authProfileRef.current;
      const activeUid = activeProfile?.uid ?? '';

      const verifyTenantStaffMembership = (resolvedDb: SchoolDatabase): boolean => {
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
        const matchedSchool = (schoolsOverride ?? schoolsRef.current).find((s) => s.id === schoolId);
        if (matchedSchool && isSchoolSubscriptionExpired(matchedSchool)) {
          await enterExpiredPortalMode();
          return;
        }

        const pendingForTenant = activeUid ? await getPendingOutboxCount(schoolId, activeUid) : 0;
        if (pendingForTenant > 0 && silent) {
          // Do not overwrite un-synced local offline changes during background refresh
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
            if (!silent) setLoadingWorkspace(false);
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
          prev.some((s) => s.id === schoolId)
            ? prev.map((s) => (s.id === schoolId ? { ...s, ...result.school } : s))
            : [...prev, result.school]
        );
        if (activeUid) {
          void saveTenantSnapshot(schoolId, activeUid, result.school, result.db);
        }
      } catch (err: unknown) {
        if (isNetworkOfflineError(err) && activeUid) {
          const offlineSnap = await loadTenantSnapshot(schoolId, activeUid);
          if (offlineSnap && verifyTenantStaffMembership(offlineSnap.db)) {
            setSubscriptionLocked(false);
            setSubscriptionPortalData(null);
            tenantCacheRef.current.set(schoolId, offlineSnap.db);
            setDb(offlineSnap.db);
            setWorkspaceError(null);
            setSchools((prev) =>
              prev.some((s) => s.id === schoolId)
                ? prev.map((s) => (s.id === schoolId ? offlineSnap.school : s))
                : [offlineSnap.school]
            );
            return;
          }
        }
        if (
          err instanceof ApiError &&
          err.status === 403 &&
          err.message.toLowerCase().includes('expired')
        ) {
          try {
            await enterExpiredPortalMode();
            return;
          } catch (portalErr: unknown) {
            if (!silent) {
              setWorkspaceError(formatFriendlyAuthError(portalErr));
              setDb(null);
            }
            return;
          }
        }
        if (!silent) {
          setWorkspaceError(formatFriendlyAuthError(err));
          setDb(null);
        }
      } finally {
        if (!silent) {
          setLoadingWorkspace(false);
        }
      }
    },
    [getValidToken]
  );

  const syncPendingMutations = useCallback(
    async (targetSchoolId?: string) => {
      const sid = targetSchoolId ?? activeSchoolId;
      const uid = authProfileRef.current?.uid;
      if (!sid || !uid || syncingRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const countBefore = await getPendingOutboxCount(sid, uid);
      setPendingSyncCount(countBefore);
      if (countBefore === 0) return;

      syncingRef.current = true;
      setIsSyncing(true);
      try {
        const api = createTenantApi(sid);
        const result = await flushOutboxQueue({
          schoolId: sid,
          uid,
          executor: (item) => executeQueuedTenantMutation(api, item),
        });
        setPendingSyncCount(result.remainingCount);
        if (result.conflicts.length > 0) {
          setSyncConflicts((prev) => [...result.conflicts, ...prev].slice(0, 10));
        }
        if (result.syncedCount > 0 || result.conflicts.length > 0) {
          if (result.remainingCount === 0) {
            await loadTenantWorkspace(sid, true, authProfileRef.current, undefined, true);
          }
        }
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [activeSchoolId, loadTenantWorkspace]
  );

  const persistWithOfflineFallback = useCallback(
    async <P, R = unknown>(opts: {
      kind: OfflineMutationKind;
      label: string;
      payload: P;
      dedupeKey?: string;
      onlineCall: () => Promise<R>;
    }): Promise<{ queued: boolean; result?: R }> => {
      const sid = activeSchoolId;
      const uid = authProfileRef.current?.uid;
      if (!sid || !uid) {
        const result = await opts.onlineCall();
        return { queued: false, result };
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { pendingCount } = await enqueueOfflineMutation({
          schoolId: sid,
          uid,
          kind: opts.kind,
          label: opts.label,
          payload: opts.payload,
          dedupeKey: opts.dedupeKey,
        });
        setPendingSyncCount(pendingCount);
        return { queued: true };
      }

      try {
        const result = await opts.onlineCall();
        return { queued: false, result };
      } catch (err: unknown) {
        if (isNetworkOfflineError(err)) {
          setIsOnline(false);
          const { pendingCount } = await enqueueOfflineMutation({
            schoolId: sid,
            uid,
            kind: opts.kind,
            label: opts.label,
            payload: opts.payload,
            dedupeKey: opts.dedupeKey,
          });
          setPendingSyncCount(pendingCount);
          return { queued: true };
        }
        throw err;
      }
    },
    [activeSchoolId]
  );

  useEffect(() => {
    if (isOnline && activeSchoolId && authProfile?.uid && pendingSyncCount > 0) {
      void syncPendingMutations(activeSchoolId);
    }
  }, [isOnline, activeSchoolId, authProfile?.uid, pendingSyncCount, syncPendingMutations]);

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
      schoolsRef.current = accessibleSchools;
      rememberSignedInHint(user, accessibleSchools, preferredIdentifier);
      void saveLastSessionMeta(user, accessibleSchools);

      if (user.globalRole === 'super_admin') {
        setActiveSchoolId(null);
        setDb(null);
        setSubscriptionLocked(false);
        setSubscriptionPortalData(null);
        setWorkspaceError(null);
        setPendingSyncCount(0);
        configureApiClient(getValidToken, null);
        await loadPlatformData();
        return;
      }

      const assignedSchoolId = user.schoolId!;
      setActiveSchoolId(assignedSchoolId);
      setAuditLogs([]);
      const queuedCount = await refreshOutboxCount(assignedSchoolId, user.uid);
      if (queuedCount > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
        await syncPendingMutations(assignedSchoolId);
      }
      await loadTenantWorkspace(assignedSchoolId, true, user, accessibleSchools);
    },
    [
      getValidToken,
      loadPlatformData,
      loadTenantWorkspace,
      refreshOutboxCount,
      rememberSignedInHint,
      syncPendingMutations,
    ]
  );

  // Restore session securely on mount via HttpOnly cookie, falling back cleanly to IndexedDB snapshot if offline
  useEffect(() => {
    let active = true;
    scrubLegacyTokenStorage();

    const restoreSession = async () => {
      configureApiClient(getValidToken, null);
      try {
        const synced = await platformApi.syncSession();
        if (!active) return;
        await applyAuthenticatedSession(synced.user, synced.schools);
      } catch (err: unknown) {
        localTokenRef.current = null;
        if (!active) return;

        if (isNetworkOfflineError(err)) {
          const offlineMeta = await loadLastSessionMeta();
          if (offlineMeta && offlineMeta.authProfile.globalRole !== 'super_admin' && offlineMeta.authProfile.schoolId) {
            const snap = await loadTenantSnapshot(
              offlineMeta.authProfile.schoolId,
              offlineMeta.authProfile.uid
            );
            if (snap && active) {
              authProfileRef.current = offlineMeta.authProfile;
              setAuthProfile(offlineMeta.authProfile);
              setSchools(
                offlineMeta.schools.length > 0 ? offlineMeta.schools : [snap.school]
              );
              setActiveSchoolId(snap.schoolId);
              tenantCacheRef.current.set(snap.schoolId, snap.db);
              setDb(snap.db);
              setWorkspaceError(null);
              await refreshOutboxCount(snap.schoolId, offlineMeta.authProfile.uid);
              setAuthLoading(false);
              return;
            }
          }
        }

        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          await clearAllOfflineState();
        }
        setAuthProfile(null);
        if (err instanceof ApiError && err.status !== 401) {
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
  }, [applyAuthenticatedSession, getValidToken, refreshOutboxCount]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
    setAuthErrorCode(null);
  }, []);

  const signInWithCredentials = useCallback(
    async (params: CredentialSignInParams): Promise<boolean> => {
      const trimmedIdentifier = params.identifier.trim();
      const trimmedSchoolCode = params.schoolCode?.trim().toUpperCase() || undefined;

      setAuthError(null);
      setAuthErrorCode(null);
      setAuthLoading(true);
      scrubLegacyTokenStorage();
      try {
        localTokenRef.current = null;
        configureApiClient(async () => null, null);

        const res = await platformApi.loginWithCredentials({
          ...(trimmedSchoolCode ? { schoolCode: trimmedSchoolCode } : {}),
          identifier: trimmedIdentifier,
          password: params.password,
        });

        localTokenRef.current = res.token;
        configureApiClient(getValidToken, null);
        await applyAuthenticatedSession(res.user, res.schools, trimmedIdentifier);
        return true;
      } catch (err: unknown) {
        localTokenRef.current = null;
        setAuthProfile(null);
        setDb(null);
        setAuthError(formatFriendlyAuthError(err));
        setAuthErrorCode(err instanceof ApiError ? err.code ?? null : null);
        return false;
      } finally {
        setAuthLoading(false);
      }
    },
    [applyAuthenticatedSession, getValidToken]
  );

  const signOutWorkspace = useCallback(async () => {
    tenantCacheRef.current.clear();
    localTokenRef.current = null;
    scrubLegacyTokenStorage();
    setAuthProfile(null);
    setSchools([]);
    setAuditLogs([]);
    setActiveSchoolId(null);
    setDb(null);
    setSubscriptionLocked(false);
    setSubscriptionPortalData(null);
    setWorkspaceError(null);
    setAuthError(null);
    setAuthErrorCode(null);
    setPendingSyncCount(0);
    setSyncConflicts([]);
    await clearAllOfflineState();
    await platformApi.logoutSession().catch(() => undefined);
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }, []);

  const completePasswordChange = useCallback(
    (token: string, updatedUser: AuthSessionProfile) => {
      localTokenRef.current = token;
      authProfileRef.current = updatedUser;
      setAuthProfile(updatedUser);
      void saveLastSessionMeta(updatedUser, schoolsRef.current);
      setDb((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((u) =>
                u.email.toLowerCase() === updatedUser.email.toLowerCase()
                  ? { ...u, mustChangePassword: false }
                  : u
              ),
            }
          : prev
      );
    },
    []
  );

  const refreshPlatformData = useCallback(async () => {
    if (!authProfile || authProfile.globalRole !== 'super_admin') return;
    await loadPlatformData();
  }, [authProfile, loadPlatformData]);

  const refreshTenantWorkspace = useCallback(
    async (targetSchoolId?: string, silent = false) => {
      const sid = targetSchoolId ?? activeSchoolId;
      if (!sid) return;
      await loadTenantWorkspace(sid, true, authProfileRef.current, [], silent);
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
          const activeUid = authProfileRef.current?.uid;
          const activeTenant = schoolsRef.current.find((s) => s.id === activeSchoolId);
          if (activeUid && activeTenant) {
            void saveTenantSnapshot(activeSchoolId, activeUid, activeTenant, next);
          }
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

  const dismissSyncConflicts = useCallback(() => {
    setSyncConflicts([]);
  }, []);

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
    authErrorCode,
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
    isOnline,
    isSyncing,
    pendingSyncCount,
    syncConflicts,
    dismissSyncConflicts,
    syncPendingMutations,
    persistWithOfflineFallback,
    clearAuthError,
    removeRecentAccount,
    signInWithCredentials,
    signOutWorkspace,
    completePasswordChange,
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

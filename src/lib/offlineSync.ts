import type { AuthSessionProfile, SchoolDatabase, SchoolTenant } from '../types';
import { ApiError } from '../utils/apiClient';

const OFFLINE_DB_NAME = 'schuleflow_offline_v1';
const OFFLINE_DB_VERSION = 1;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESSION = 'session_meta';
const STORE_OUTBOX = 'outbox';

export type OfflineMutationKind =
  | 'saveMarksheet'
  | 'saveRemark'
  | 'saveSettings'
  | 'saveClass'
  | 'saveSubject'
  | 'saveCombination'
  | 'saveExam'
  | 'updateStudent'
  | 'addStudents'
  | 'promoteStudents'
  | 'deleteStudent'
  | 'publishExam';

export interface OutboxMutationItem<P = unknown> {
  id: string;
  schoolId: string;
  uid: string;
  kind: OfflineMutationKind;
  dedupeKey?: string;
  label: string;
  payload: P;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface OfflineSnapshotRecord {
  schoolId: string;
  uid: string;
  school: SchoolTenant;
  db: SchoolDatabase;
  updatedAt: string;
}

export interface OfflineSessionMeta {
  key: 'current';
  uid: string;
  authProfile: AuthSessionProfile;
  schools: SchoolTenant[];
  updatedAt: string;
}

export interface OfflineSyncConflict {
  id: string;
  label: string;
  status: number;
  message: string;
  timestamp: string;
}

export interface FlushOutboxResult {
  syncedCount: number;
  remainingCount: number;
  stoppedOffline: boolean;
  conflicts: OfflineSyncConflict[];
  syncedItems: Array<{ kind: OfflineMutationKind; response: unknown; item: OutboxMutationItem }>;
}

export interface OfflineStoreAdapter {
  getSnapshot: (schoolId: string) => Promise<OfflineSnapshotRecord | null>;
  putSnapshot: (record: OfflineSnapshotRecord) => Promise<void>;
  getSessionMeta: () => Promise<OfflineSessionMeta | null>;
  putSessionMeta: (meta: OfflineSessionMeta) => Promise<void>;
  listOutbox: (schoolId?: string, uid?: string) => Promise<OutboxMutationItem[]>;
  putOutboxItem: (item: OutboxMutationItem) => Promise<void>;
  deleteOutboxItem: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export function isNetworkOfflineError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return false;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (err instanceof Error) {
    return /failed to fetch|networkerror|network request failed|load failed|internet disconnected|econnrefused|offline/i.test(
      err.message
    );
  }
  return false;
}

export function coalesceMutationItems(
  existingItems: OutboxMutationItem[],
  incoming: OutboxMutationItem
): {
  nextItems: OutboxMutationItem[];
  storedItem: OutboxMutationItem;
  replacedId?: string;
} {
  if (!incoming.dedupeKey) {
    return {
      nextItems: [...existingItems, incoming],
      storedItem: incoming,
    };
  }

  const existingIdx = existingItems.findIndex(
    (item) =>
      item.schoolId === incoming.schoolId &&
      item.uid === incoming.uid &&
      item.dedupeKey === incoming.dedupeKey
  );

  if (existingIdx < 0) {
    return {
      nextItems: [...existingItems, incoming],
      storedItem: incoming,
    };
  }

  const prev = existingItems[existingIdx];
  let mergedPayload = incoming.payload;
  // Preserve the earliest server-known marksheet version across multiple offline edits
  if (
    incoming.kind === 'saveMarksheet' &&
    prev.payload &&
    typeof prev.payload === 'object' &&
    incoming.payload &&
    typeof incoming.payload === 'object' &&
    'version' in prev.payload
  ) {
    const prevVersion = (prev.payload as { version?: number }).version;
    if (typeof prevVersion === 'number') {
      mergedPayload = {
        ...(incoming.payload as Record<string, unknown>),
        version: prevVersion,
      };
    }
  }

  const coalesced: OutboxMutationItem = {
    ...incoming,
    id: prev.id,
    createdAt: prev.createdAt,
    payload: mergedPayload,
  };

  const nextItems = existingItems.map((item, idx) => (idx === existingIdx ? coalesced : item));
  return {
    nextItems,
    storedItem: coalesced,
    replacedId: prev.id,
  };
}

export function createMemoryOfflineStore(): OfflineStoreAdapter {
  const snapshots = new Map<string, OfflineSnapshotRecord>();
  let sessionMeta: OfflineSessionMeta | null = null;
  const outbox = new Map<string, OutboxMutationItem>();

  return {
    async getSnapshot(schoolId) {
      return snapshots.get(schoolId) ?? null;
    },
    async putSnapshot(record) {
      snapshots.set(record.schoolId, structuredClone(record));
    },
    async getSessionMeta() {
      return sessionMeta ? structuredClone(sessionMeta) : null;
    },
    async putSessionMeta(meta) {
      sessionMeta = structuredClone(meta);
    },
    async listOutbox(schoolId, uid) {
      return Array.from(outbox.values())
        .filter((item) => (!schoolId || item.schoolId === schoolId) && (!uid || item.uid === uid))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async putOutboxItem(item) {
      outbox.set(item.id, structuredClone(item));
    },
    async deleteOutboxItem(id) {
      outbox.delete(id);
    },
    async clearAll() {
      snapshots.clear();
      sessionMeta = null;
      outbox.clear();
    },
  };
}

let cachedIdbPromise: Promise<IDBDatabase> | null = null;
const memoryFallbackStore = createMemoryOfflineStore();

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (cachedIdbPromise) {
    return cachedIdbPromise;
  }
  cachedIdbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'schoolId' });
        }
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
          db.createObjectStore(STORE_SESSION, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          cachedIdbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        cachedIdbPromise = null;
        reject(request.error ?? new Error('Failed to open offline database'));
      };
    } catch (err) {
      cachedIdbPromise = null;
      reject(err);
    }
  });
  return cachedIdbPromise;
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function createBrowserIdbStore(): OfflineStoreAdapter {
  return {
    async getSnapshot(schoolId) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const res = await idbReq<OfflineSnapshotRecord | undefined>(
          tx.objectStore(STORE_SNAPSHOTS).get(schoolId)
        );
        return res ?? null;
      } catch {
        return memoryFallbackStore.getSnapshot(schoolId);
      }
    },
    async putSnapshot(record) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
        await idbReq(tx.objectStore(STORE_SNAPSHOTS).put(record));
      } catch {
        await memoryFallbackStore.putSnapshot(record);
      }
    },
    async getSessionMeta() {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_SESSION, 'readonly');
        const res = await idbReq<OfflineSessionMeta | undefined>(
          tx.objectStore(STORE_SESSION).get('current')
        );
        return res ?? null;
      } catch {
        return memoryFallbackStore.getSessionMeta();
      }
    },
    async putSessionMeta(meta) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_SESSION, 'readwrite');
        await idbReq(tx.objectStore(STORE_SESSION).put(meta));
      } catch {
        await memoryFallbackStore.putSessionMeta(meta);
      }
    },
    async listOutbox(schoolId, uid) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_OUTBOX, 'readonly');
        const all = await idbReq<OutboxMutationItem[]>(tx.objectStore(STORE_OUTBOX).getAll());
        return all
          .filter((item) => (!schoolId || item.schoolId === schoolId) && (!uid || item.uid === uid))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      } catch {
        return memoryFallbackStore.listOutbox(schoolId, uid);
      }
    },
    async putOutboxItem(item) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_OUTBOX, 'readwrite');
        await idbReq(tx.objectStore(STORE_OUTBOX).put(item));
      } catch {
        await memoryFallbackStore.putOutboxItem(item);
      }
    },
    async deleteOutboxItem(id) {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction(STORE_OUTBOX, 'readwrite');
        await idbReq(tx.objectStore(STORE_OUTBOX).delete(id));
      } catch {
        await memoryFallbackStore.deleteOutboxItem(id);
      }
    },
    async clearAll() {
      try {
        const db = await openOfflineDb();
        const tx = db.transaction([STORE_SNAPSHOTS, STORE_SESSION, STORE_OUTBOX], 'readwrite');
        await Promise.all([
          idbReq(tx.objectStore(STORE_SNAPSHOTS).clear()),
          idbReq(tx.objectStore(STORE_SESSION).clear()),
          idbReq(tx.objectStore(STORE_OUTBOX).clear()),
        ]);
      } catch {
        await memoryFallbackStore.clearAll();
      }
    },
  };
}

export const defaultOfflineStore: OfflineStoreAdapter = createBrowserIdbStore();

export async function saveTenantSnapshot(
  schoolId: string,
  uid: string,
  school: SchoolTenant,
  db: SchoolDatabase,
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<void> {
  await store.putSnapshot({
    schoolId,
    uid,
    school,
    db,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadTenantSnapshot(
  schoolId: string,
  uid: string,
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<OfflineSnapshotRecord | null> {
  const snap = await store.getSnapshot(schoolId);
  if (!snap || snap.uid !== uid) return null;
  return snap;
}

export async function saveLastSessionMeta(
  authProfile: AuthSessionProfile,
  schools: SchoolTenant[],
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<void> {
  await store.putSessionMeta({
    key: 'current',
    uid: authProfile.uid,
    authProfile,
    schools,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadLastSessionMeta(
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<OfflineSessionMeta | null> {
  return store.getSessionMeta();
}

export async function clearAllOfflineState(
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<void> {
  await store.clearAll();
}

export async function enqueueOfflineMutation<P>(
  params: {
    schoolId: string;
    uid: string;
    kind: OfflineMutationKind;
    label: string;
    payload: P;
    dedupeKey?: string;
  },
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<{ item: OutboxMutationItem<P>; pendingCount: number }> {
  const existing = await store.listOutbox(params.schoolId, params.uid);
  const incoming: OutboxMutationItem<P> = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schoolId: params.schoolId,
    uid: params.uid,
    kind: params.kind,
    dedupeKey: params.dedupeKey,
    label: params.label,
    payload: params.payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const { storedItem, nextItems } = coalesceMutationItems(existing, incoming);
  await store.putOutboxItem(storedItem);
  return {
    item: storedItem as OutboxMutationItem<P>,
    pendingCount: nextItems.length,
  };
}

export async function getPendingOutboxCount(
  schoolId?: string,
  uid?: string,
  store: OfflineStoreAdapter = defaultOfflineStore
): Promise<number> {
  const items = await store.listOutbox(schoolId, uid);
  return items.length;
}

export async function flushOutboxQueue(params: {
  schoolId: string;
  uid: string;
  executor: (item: OutboxMutationItem) => Promise<unknown>;
  store?: OfflineStoreAdapter;
}): Promise<FlushOutboxResult> {
  const store = params.store ?? defaultOfflineStore;
  const items = await store.listOutbox(params.schoolId, params.uid);
  let syncedCount = 0;
  let stoppedOffline = false;
  const conflicts: OfflineSyncConflict[] = [];
  const syncedItems: Array<{ kind: OfflineMutationKind; response: unknown; item: OutboxMutationItem }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const response = await params.executor(item);
      await store.deleteOutboxItem(item.id);
      syncedCount++;
      syncedItems.push({ kind: item.kind, response, item });
    } catch (err: unknown) {
      if (isNetworkOfflineError(err)) {
        stoppedOffline = true;
        await store.putOutboxItem({
          ...item,
          attempts: item.attempts + 1,
          lastError: 'Waiting for internet connection.',
        });
        break;
      }

      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Deterministic validation/permission/version conflict: quarantine/remove so subsequent items still sync
        await store.deleteOutboxItem(item.id);
        conflicts.push({
          id: item.id,
          label: item.label,
          status: err.status,
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // 5xx or transient server failure: keep queued and stop
      stoppedOffline = true;
      await store.putOutboxItem({
        ...item,
        attempts: item.attempts + 1,
        lastError: err instanceof Error ? err.message : 'Server temporarily unavailable.',
      });
      break;
    }
  }

  const remaining = await store.listOutbox(params.schoolId, params.uid);
  return {
    syncedCount,
    remainingCount: remaining.length,
    stoppedOffline,
    conflicts,
    syncedItems,
  };
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAllOfflineState,
  createMemoryOfflineStore,
  enqueueOfflineMutation,
  flushOutboxQueue,
  loadLastSessionMeta,
  loadTenantSnapshot,
  saveLastSessionMeta,
  saveTenantSnapshot,
} from '../src/lib/offlineSync.ts';
import { ApiError } from '../src/utils/apiClient.ts';
import { DEFAULT_SCHOOL_SETTINGS } from '../src/data/sampleData.ts';
import type { AuthSessionProfile, SchoolDatabase, SchoolTenant } from '../src/types.ts';

function makeSchoolTenant(id: string, code: string): SchoolTenant {
  return {
    id,
    schoolCode: code,
    name: `School ${code}`,
    subdomain: code.toLowerCase(),
    ministryRegNo: `MOES/${code}`,
    motto: 'Excellence',
    district: 'Kampala',
    region: 'Central',
    address: 'Kampala',
    phone: '+256 700 000001',
    email: `info@${code.toLowerCase()}.ac.ug`,
    principalName: 'Headteacher',
    dosName: 'DOS',
    plan: 'standard',
    curriculumScope: 'olevel_alevel',
    status: 'active',
    subscriptionStatus: 'active',
    studentQuota: 500,
    termFeePerStudentUgx: 5000,
    billingStatus: 'paid',
    nextBillingDate: '2027-01-01',
    licenseExpiresAt: '2027-12-31',
    academicYear: '2026',
    termName: 'Term III',
    primaryColor: '#1e3a8a',
    secondaryColor: '#b45309',
    reportsGeneratedCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeEmptyDb(schoolId: string): SchoolDatabase {
  return {
    settings: { ...DEFAULT_SCHOOL_SETTINGS, schoolName: `School ${schoolId}` },
    users: [],
    classes: [],
    subjects: [],
    combinations: [],
    students: [],
    exams: [],
    marksheets: [],
    correctionRequests: [],
    studentRemarks: {},
    loginActivity: [],
    invoices: [],
    reportsGeneratedCount: 0,
  };
}

describe('Offline-First Snapshot Cache, Coalescing Outbox & Reconnect Sync', () => {
  it('stores and isolates tenant workspace snapshots by schoolId and uid', async () => {
    const store = createMemoryOfflineStore();
    const schoolA = makeSchoolTenant('sch-a', 'SCH-101');
    const dbA = makeEmptyDb('sch-a');
    await saveTenantSnapshot('sch-a', 'uid-teacher-1', schoolA, dbA, store);

    const sameUser = await loadTenantSnapshot('sch-a', 'uid-teacher-1', store);
    assert.ok(sameUser);
    assert.equal(sameUser.school.schoolCode, 'SCH-101');

    // Different user on shared device cannot read another user's cached snapshot
    const otherUser = await loadTenantSnapshot('sch-a', 'uid-teacher-2', store);
    assert.equal(otherUser, null);
  });

  it('coalesces repeated offline marksheet edits while preserving initial server version and FIFO order', async () => {
    const store = createMemoryOfflineStore();

    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveMarksheet',
        dedupeKey: 'marksheet:ex1:cls1:sub1',
        label: 'Math U1',
        payload: { id: 'ms-1', version: 4, entries: { s1: { u1: '60' } } },
      },
      store
    );

    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveRemark',
        dedupeKey: 'remark:ex1:s1:dosRemark',
        label: 'Remark',
        payload: { examId: 'ex1', studentId: 's1', field: 'dosRemark', value: 'Good work' },
      },
      store
    );

    // Edit the same marksheet again offline (should keep version: 4 and position 0)
    const secondMarksheetEnqueue = await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveMarksheet',
        dedupeKey: 'marksheet:ex1:cls1:sub1',
        label: 'Math U1 + EoT',
        payload: { id: 'ms-1', version: 99, entries: { s1: { u1: '65', eot: '80' } } },
      },
      store
    );

    assert.equal(secondMarksheetEnqueue.pendingCount, 2);
    const items = await store.listOutbox('sch-a', 'uid-1');
    assert.equal(items.length, 2);
    assert.equal(items[0].kind, 'saveMarksheet');
    assert.equal((items[0].payload as { version: number }).version, 4);
    assert.equal(items[1].kind, 'saveRemark');
  });

  it('flushes FIFO on reconnect, pauses cleanly on network drop, and quarantines 409/403 conflicts', async () => {
    const store = createMemoryOfflineStore();
    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveClass',
        label: 'Class S.1',
        payload: { cls: { id: 'cls-1' } },
      },
      store
    );
    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveMarksheet',
        label: 'Conflicting Marksheet',
        payload: { id: 'ms-conflict', version: 1 },
      },
      store
    );
    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveRemark',
        label: 'Remark S.1',
        payload: { examId: 'ex1', studentId: 's1', field: 'dosRemark', value: 'Promoted' },
      },
      store
    );

    // Simulate mid-sync network loss on first item
    const offlineAttempt = await flushOutboxQueue({
      schoolId: 'sch-a',
      uid: 'uid-1',
      store,
      executor: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    assert.equal(offlineAttempt.stoppedOffline, true);
    assert.equal(offlineAttempt.syncedCount, 0);
    assert.equal(offlineAttempt.remainingCount, 3);

    // Reconnected: item 1 succeeds, item 2 hits 409 conflict, item 3 still syncs cleanly
    const executedKinds: string[] = [];
    const reconnectFlush = await flushOutboxQueue({
      schoolId: 'sch-a',
      uid: 'uid-1',
      store,
      executor: async (item) => {
        executedKinds.push(item.kind);
        if (item.kind === 'saveMarksheet') {
          throw new ApiError('Marksheet modified by another user', 409);
        }
        return { ok: true };
      },
    });

    assert.deepEqual(executedKinds, ['saveClass', 'saveMarksheet', 'saveRemark']);
    assert.equal(reconnectFlush.stoppedOffline, false);
    assert.equal(reconnectFlush.syncedCount, 2);
    assert.equal(reconnectFlush.remainingCount, 0);
    assert.equal(reconnectFlush.conflicts.length, 1);
    assert.equal(reconnectFlush.conflicts[0].status, 409);
  });

  it('wipes cached snapshots, session metadata, and pending outbox completely on sign-out', async () => {
    const store = createMemoryOfflineStore();
    const profile: AuthSessionProfile = {
      uid: 'uid-1',
      staffId: '002',
      email: 'dos@jis.ac.ug',
      username: 'dos',
      name: 'DOS',
      globalRole: 'school_user',
      schoolId: 'sch-a',
      schoolCode: 'JIS-101',
      schoolRole: 'dos',
      active: true,
      mustChangePassword: false,
    };
    const schoolA = makeSchoolTenant('sch-a', 'JIS-101');
    await saveLastSessionMeta(profile, [schoolA], store);
    await saveTenantSnapshot('sch-a', 'uid-1', schoolA, makeEmptyDb('sch-a'), store);
    await enqueueOfflineMutation(
      {
        schoolId: 'sch-a',
        uid: 'uid-1',
        kind: 'saveSettings',
        label: 'Settings',
        payload: {},
      },
      store
    );

    await clearAllOfflineState(store);
    assert.equal(await loadLastSessionMeta(store), null);
    assert.equal(await loadTenantSnapshot('sch-a', 'uid-1', store), null);
    assert.equal((await store.listOutbox()).length, 0);
  });
});

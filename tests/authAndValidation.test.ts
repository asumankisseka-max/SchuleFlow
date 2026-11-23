import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
  hashPassword,
  setRuntimeSessionSecret,
  signSessionToken,
  validatePasswordStrength,
  verifyPassword,
  verifySessionToken,
} from '../src/lib/passwordAuth.ts';
import {
  loginSchema,
  marksheetSchema,
  onboardSchoolSchema,
  parseWithSchema,
  streamClassPayloadSchema,
} from '../src/lib/validationSchemas.ts';
import { createRateLimiter, resetRateLimitBuckets } from '../src/middleware/rateLimit.ts';
import {
  extractSchoolInitials,
  generateNextSchoolCode,
  generateNextStaffId,
  generateNextStudentId,
  normalizeShortStaffIdCandidate,
} from '../src/utils/idGenerator.ts';

process.env.TEST_MODE = 'true';

describe('Password Hashing, Session Tokens & ID Generation', () => {
  it('hashes and verifies passwords with scrypt timing-safe check', () => {
    const hashed = hashPassword('Kampala@2026');
    assert.ok(hashed.startsWith('scrypt$'));
    assert.equal(verifyPassword('Kampala@2026', hashed), true);
    assert.equal(verifyPassword('WrongPassword1', hashed), false);
    assert.equal(verifyPassword('Kampala@2026', 'malformed-hash'), false);
  });

  it('enforces minimum password strength (8+ chars, letter + number)', () => {
    assert.ok(validatePasswordStrength('short1'));
    assert.ok(validatePasswordStrength('onlyletters'));
    assert.ok(validatePasswordStrength('12345678'));
    assert.equal(validatePasswordStrength('Schule2026'), null);
  });

  it('signs and verifies HMAC session tokens and rejects tampered or expired tokens', () => {
    const token = signSessionToken({
      userId: 42,
      uid: 'usr-42',
      staffId: 'KHS-TCH-001',
      email: 'teacher@khs.ac.ug',
      name: 'Teacher One',
      globalRole: 'school_user',
      schoolId: 'school-1',
      role: 'teacher',
      schoolRole: 'teacher',
    });

    const verified = verifySessionToken(token);
    assert.ok(verified);
    assert.equal(verified.schoolId, 'school-1');
    assert.equal(verified.staffId, 'KHS-TCH-001');

    // Tamper signature
    const tampered = `${token.slice(0, -3)}XYZ`;
    assert.equal(verifySessionToken(tampered), null);

    // Expired token
    const expired = signSessionToken(
      {
        uid: 'usr-42',
        email: 'teacher@khs.ac.ug',
        name: 'Teacher One',
        globalRole: 'school_user',
        schoolId: 'school-1',
        role: 'teacher',
        schoolRole: 'teacher',
      },
      -1000
    );
    assert.equal(verifySessionToken(expired), null);
  });

  it('signs and verifies tokens in production even when SESSION_SECRET env var is omitted', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevTestMode = process.env.TEST_MODE;
    const prevSessionSecret = process.env.SESSION_SECRET;

    process.env.NODE_ENV = 'production';
    delete process.env.TEST_MODE;
    delete process.env.SESSION_SECRET;

    try {
      setRuntimeSessionSecret('c9e17a4d8f2049b3926b8c4a17d5f0e3a8124b9c0d6e7f12');
      const token = signSessionToken({
        userId: 1,
        uid: 'env:super_admin:superadmin@schuleflow.ac.ug',
        email: 'superadmin@schuleflow.ac.ug',
        name: 'Platform Super Admin',
        globalRole: 'super_admin',
        schoolId: null,
        role: 'school_admin',
        schoolRole: 'school_admin',
      });
      const verified = verifySessionToken(token);
      assert.ok(verified);
      assert.equal(verified.globalRole, 'super_admin');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevTestMode === undefined) delete process.env.TEST_MODE;
      else process.env.TEST_MODE = prevTestMode;
      if (prevSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSessionSecret;
    }
  });

  it('generates globally unique school codes, short (<4 char) Staff IDs, and Student IDs', () => {
    assert.equal(extractSchoolInitials('Kampala Horizon High School'), 'KHHS');
    assert.equal(extractSchoolInitials('Kampala High School'), 'KHS');

    const code = generateNextSchoolCode('Kampala High School', ['KHS-101', 'SMCM-102']);
    assert.equal(code, 'KHS-103');

    const staffId = generateNextStaffId('Kampala High School', ['001', '002']);
    assert.equal(staffId, '003');
    assert.ok(staffId.length < 4);

    // Also increments cleanly past any remaining legacy prefixes
    assert.equal(generateNextStaffId('Kampala High School', ['KHS-TCH-001', '002']), '003');

    assert.equal(normalizeShortStaffIdCandidate('1'), '001');
    assert.equal(normalizeShortStaffIdCandidate('07'), '007');
    assert.equal(normalizeShortStaffIdCandidate('007'), '007');
    assert.equal(normalizeShortStaffIdCandidate('1000'), null);

    const studentId = generateNextStudentId('KHS', ['KHS-STD-001'], true);
    assert.equal(studentId, 'KHS-STD-002');
  });
});

describe('Zod Schema Validation (Optional Streams & Concurrency Versioning)', () => {
  it('accepts classes both with and without optional streams', () => {
    const noStream = parseWithSchema(streamClassPayloadSchema, {
      cls: {
        id: 'cls-s1',
        gradeLevel: 'S.1',
        level: 'olevel',
      },
    });
    assert.equal(noStream.ok, true);
    if (noStream.ok) {
      assert.equal(noStream.data.cls.stream, undefined);
    }

    const withStream = parseWithSchema(streamClassPayloadSchema, {
      cls: {
        id: 'cls-s1-e',
        gradeLevel: 'S.1',
        stream: 'East',
        level: 'olevel',
      },
    });
    assert.equal(withStream.ok, true);
    if (withStream.ok) {
      assert.equal(withStream.data.cls.stream, 'East');
    }
  });

  it('validates login, marksheet version, and school onboarding inputs', () => {
    const badLogin = parseWithSchema(loginSchema, { identifier: '', password: '' });
    assert.equal(badLogin.ok, false);

    const unifiedLogin = parseWithSchema(loginSchema, {
      identifier: 'KHHS-TCH-001',
      password: 'Password123',
    });
    assert.equal(unifiedLogin.ok, true);

    const goodSheet = parseWithSchema(marksheetSchema, {
      id: 'ms-1',
      examId: 'ex-1',
      classId: 'cls-1',
      subjectId: 'sub-1',
      status: 'draft',
      version: 2,
      entries: { 'stu-1': { u1: '3', eot: '70' } },
      lastModified: new Date().toISOString(),
    });
    assert.equal(goodSheet.ok, true);

    const badOnboard = parseWithSchema(onboardSchoolSchema, {
      name: 'A',
      subdomain: 'khs',
      email: 'not-an-email',
      adminName: 'Admin',
      adminEmail: 'admin@school.ac.ug',
    });
    assert.equal(badOnboard.ok, false);
  });
});

describe('Sliding-Window Rate Limiter', () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    delete process.env.DISABLE_RATE_LIMIT;
  });

  it('blocks requests with HTTP 429 once maxAttempts is exceeded', async () => {
    const testApp = express();
    testApp.post(
      '/test-limit',
      createRateLimiter({
        name: 'unit_test_limit',
        windowMs: 60_000,
        maxAttempts: 2,
        message: 'Too many test requests.',
      }),
      (_req, res) => {
        res.json({ ok: true });
      }
    );

    const server = http.createServer(testApp);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const r1 = await fetch(`http://127.0.0.1:${port}/test-limit`, { method: 'POST' });
      const r2 = await fetch(`http://127.0.0.1:${port}/test-limit`, { method: 'POST' });
      const r3 = await fetch(`http://127.0.0.1:${port}/test-limit`, { method: 'POST' });

      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(r3.status, 429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
  hashPassword,
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

  it('generates globally unique school codes and school-scoped Staff & Student IDs', () => {
    assert.equal(extractSchoolInitials('Kampala Horizon High School'), 'KHHS');
    assert.equal(extractSchoolInitials('Kampala High School'), 'KHS');

    const code = generateNextSchoolCode('Kampala High School', ['KHS-101', 'SMCM-102']);
    assert.equal(code, 'KHS-103');

    const staffId = generateNextStaffId('Kampala High School', ['KHS-TCH-001', 'KHS-TCH-002']);
    assert.equal(staffId, 'KHS-TCH-003');

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

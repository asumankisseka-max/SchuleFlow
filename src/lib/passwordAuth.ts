import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { GlobalRole, UserRole } from '../types.ts';

const TOKEN_PREFIX = 'sf_sess.';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LocalSessionPayload {
  uid: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
  schoolId: string | null;
  schoolRole: UserRole;
  exp: number;
}

function getSessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.DATABASE_URL ||
    'schuleflow-uganda-tenant-session-secret'
  );
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !password) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash) return false;

  try {
    const derived = scryptSync(password, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function isLocalSessionToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

export function signSessionToken(
  payload: Omit<LocalSessionPayload, 'exp'>,
  ttlMs = SESSION_TTL_MS
): string {
  const fullPayload: LocalSessionPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${TOKEN_PREFIX}${encoded}.${sig}`;
}

export function verifySessionToken(token: string): LocalSessionPayload | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const body = token.slice(TOKEN_PREFIX.length);
  const dotIdx = body.lastIndexOf('.');
  if (dotIdx <= 0) return null;

  const encoded = body.slice(0, dotIdx);
  const sig = body.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as LocalSessionPayload;
    if (!parsed || typeof parsed.uid !== 'string' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const RECOVERY_PREFIX = 'sf_rec.';
const RECOVERY_TTL_MS = 10 * 60 * 1000;

export type RecoveryTokenPurpose = 'lookup_verify' | 'password_reset';
export type RecoveryLookupMethod = 'identifier' | 'name_school';

export interface RecoveryTokenPayload {
  userId?: number;
  staffId?: string;
  email: string;
  schoolId: string | null;
  purpose: RecoveryTokenPurpose;
  lookupMethod: RecoveryLookupMethod;
  exp: number;
}

export function signRecoveryToken(
  payload: Omit<RecoveryTokenPayload, 'exp'>,
  ttlMs = RECOVERY_TTL_MS
): string {
  const fullPayload: RecoveryTokenPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${RECOVERY_PREFIX}${encoded}.${sig}`;
}

export function verifyRecoveryToken(
  token: string,
  expectedPurpose: RecoveryTokenPurpose
): RecoveryTokenPayload | null {
  if (!token || !token.startsWith(RECOVERY_PREFIX)) return null;
  const body = token.slice(RECOVERY_PREFIX.length);
  const dotIdx = body.lastIndexOf('.');
  if (dotIdx <= 0) return null;

  const encoded = body.slice(0, dotIdx);
  const sig = body.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as RecoveryTokenPayload;
    if (
      !parsed ||
      typeof parsed.email !== 'string' ||
      parsed.purpose !== expectedPurpose ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

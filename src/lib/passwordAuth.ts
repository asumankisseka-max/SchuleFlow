import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { GlobalRole, UserRole } from '../types.ts';

const TOKEN_PREFIX = 'sf_sess.';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LocalSessionPayload {
  userId?: number;
  uid: string;
  staffId?: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
  schoolId: string | null;
  role: UserRole;
  schoolRole: UserRole;
  iat?: number;
  exp: number;
}

let runtimeDbSecret: string | null = null;
let ephemeralFallbackSecret: string | null = null;
let cachedDbDerivedSecret: { url: string; secret: string } | null = null;
let warnedFallbackSecret = false;

export function setRuntimeSessionSecret(secret: string): void {
  const trimmed = secret.trim();
  if (trimmed.length >= 16) {
    runtimeDbSecret = trimmed;
  }
}

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }

  if (runtimeDbSecret && runtimeDbSecret.length >= 16) {
    return runtimeDbSecret;
  }

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    if (!cachedDbDerivedSecret || cachedDbDerivedSecret.url !== dbUrl) {
      cachedDbDerivedSecret = {
        url: dbUrl,
        secret: createHmac('sha256', 'schuleflow-session-fallback-v1').update(dbUrl).digest('hex'),
      };
    }
    return cachedDbDerivedSecret.secret;
  }

  if (!warnedFallbackSecret) {
    warnedFallbackSecret = true;
    console.warn(
      'Warning: SESSION_SECRET is not set and database runtime secret has not been loaded yet; using process-local CSPRNG session secret.'
    );
  }

  if (!ephemeralFallbackSecret) {
    ephemeralFallbackSecret = randomBytes(48).toString('hex');
  }
  return ephemeralFallbackSecret;
}

export function validatePasswordStrength(password: string): string | null {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(trimmed) || !/[0-9]/.test(trimmed)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
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
  payload: Omit<LocalSessionPayload, 'exp' | 'iat'> & { iat?: number },
  ttlMs = SESSION_TTL_MS
): string {
  const issuedAt = payload.iat ?? Date.now();
  const fullPayload: LocalSessionPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + ttlMs,
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
  jti: string;
  iat: number;
  exp: number;
}

const consumedRecoveryJtis = new Map<string, number>();

function pruneConsumedRecoveryJtis(now: number): void {
  if (consumedRecoveryJtis.size < 200) return;
  for (const [jti, exp] of consumedRecoveryJtis.entries()) {
    if (now > exp) {
      consumedRecoveryJtis.delete(jti);
    }
  }
}

export function consumeRecoveryTokenJti(jti: string, exp: number): boolean {
  const now = Date.now();
  pruneConsumedRecoveryJtis(now);
  if (consumedRecoveryJtis.has(jti)) {
    return false;
  }
  consumedRecoveryJtis.set(jti, exp);
  return true;
}

export function signRecoveryToken(
  payload: Omit<RecoveryTokenPayload, 'exp' | 'jti' | 'iat'>,
  ttlMs = RECOVERY_TTL_MS
): string {
  const now = Date.now();
  const fullPayload: RecoveryTokenPayload = {
    ...payload,
    jti: randomBytes(12).toString('hex'),
    iat: now,
    exp: now + ttlMs,
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
      typeof parsed.exp !== 'number' ||
      typeof parsed.jti !== 'string'
    ) {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    if (consumedRecoveryJtis.has(parsed.jti)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

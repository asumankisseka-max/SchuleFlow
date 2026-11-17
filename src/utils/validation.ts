const UGANDA_MOBILE_REGEX = /^(?:\+256|256|0)7[0-9]{8}$/;

export interface PhoneValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Validates Ugandan mobile phone numbers (+2567XXXXXXXX, 2567XXXXXXXX, or 07XXXXXXXX)
 * and normalizes valid inputs into E.164 format (+2567XXXXXXXX) for SMS/WhatsApp routing.
 */
export function validateUgandanPhone(
  raw: string | undefined | null,
  required = false
): PhoneValidationResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return required
      ? {
          valid: false,
          normalized: '',
          error: 'Ugandan phone number is required (+2567... or 07...).',
        }
      : { valid: true, normalized: '' };
  }

  const compact = trimmed.replace(/[\s()-]/g, '');
  if (!UGANDA_MOBILE_REGEX.test(compact)) {
    return {
      valid: false,
      normalized: trimmed,
      error:
        'Invalid Ugandan mobile number. Use +2567XXXXXXXX or 07XXXXXXXX (10 digits starting with 07, or +2567...).',
    };
  }

  let e164 = compact;
  if (compact.startsWith('07')) {
    e164 = `+256${compact.slice(1)}`;
  } else if (compact.startsWith('2567')) {
    e164 = `+${compact}`;
  }

  return {
    valid: true,
    normalized: e164,
  };
}

/**
 * Normalizes a phone number for storage: Ugandan mobile numbers are normalized
 * to E.164 (+2567XXXXXXXX); other non-empty phone strings have spaces/dashes stripped.
 */
export function normalizeStoredPhone(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const check = validateUgandanPhone(trimmed, false);
  if (check.valid && check.normalized) {
    return check.normalized;
  }
  const compact = trimmed.replace(/[\s()-]/g, '');
  return compact || null;
}

/**
 * Produces normalized candidate phone representations (+2567..., 2567..., 07...)
 * when a login identifier looks like a phone number.
 */
export function buildPhoneLoginCandidates(raw: string | undefined | null): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.includes('@')) return [];

  const compact = trimmed.replace(/[\s()-]/g, '');
  if (!/^\+?\d{7,15}$/.test(compact)) {
    return [];
  }

  const candidates = new Set<string>([compact]);
  const ugCheck = validateUgandanPhone(compact, false);
  if (ugCheck.valid && ugCheck.normalized) {
    const e164 = ugCheck.normalized; // +2567XXXXXXXX
    candidates.add(e164);
    candidates.add(e164.slice(1)); // 2567XXXXXXXX
    candidates.add(`0${e164.slice(4)}`); // 07XXXXXXXX
  } else if (compact.startsWith('+')) {
    candidates.add(compact.slice(1));
  } else {
    candidates.add(`+${compact}`);
  }

  return Array.from(candidates);
}

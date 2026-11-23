const STOP_WORDS = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'on', 'to']);

/**
 * Extracts clean uppercase school initials from an institution's full name.
 * Examples:
 * - "Kampala Horizon High School" -> "KHHS"
 * - "St. Mary's College Mbale" -> "SMCM"
 * - "Kampala High School" -> "KHS"
 */
export function extractSchoolInitials(schoolName: string): string {
  const words = schoolName
    .replace(/['’]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const significant = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const sourceWords = significant.length >= 2 ? significant : words;

  let initials = sourceWords
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .replace(/[^A-Z0-9]/g, '');

  if (initials.length < 2) {
    initials = schoolName
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 3);
  }

  if (!initials) {
    initials = 'SCH';
  }

  return initials.slice(0, 5);
}

/**
 * Generates the next globally unique School Code in `{INITIALS}-{101+}` format.
 */
export function generateNextSchoolCode(schoolName: string, existingCodes: string[]): string {
  const initials = extractSchoolInitials(schoolName);
  const existingUpper = new Set(existingCodes.map((c) => c.trim().toUpperCase()).filter(Boolean));

  let maxSeq = 100;
  for (const code of existingCodes) {
    const match = code.trim().match(/-(\d+)$/);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }

  let candidateSeq = maxSeq + 1;
  let candidate = `${initials}-${candidateSeq}`;
  while (existingUpper.has(candidate.toUpperCase())) {
    candidateSeq += 1;
    candidate = `${initials}-${candidateSeq}`;
  }
  return candidate;
}

/**
 * Computes the next sequential numeric suffix for a school-scoped entity ID prefix.
 * Supports both short Staff IDs (`001`, `12`) and legacy prefixed IDs (`KHS-TCH-001`).
 */
export function getNextSequenceNumber(existingIds: Array<string | null | undefined>, marker: 'TCH' | 'STD'): number {
  const markerRegex = new RegExp(`-${marker}-(\\d+)$`, 'i');
  let maxSeq = 0;
  for (const id of existingIds) {
    if (!id) continue;
    const trimmed = id.trim();
    const markerMatch = trimmed.match(markerRegex);
    if (markerMatch) {
      const n = Number(markerMatch[1]);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
      continue;
    }
    if (marker === 'TCH' && /^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }
  return maxSeq + 1;
}

/**
 * Formats an easy-to-remember school-scoped Staff ID (< 4 characters, e.g. 001, 002).
 * Scoped uniquely per school after entering the School ID.
 */
export function formatStaffId(_schoolInitials: string, seqNumber: number): string {
  return String(seqNumber).padStart(3, '0');
}

/**
 * Normalizes a short numeric Staff ID typed at sign-in (e.g. "1", "01", "001" -> "001").
 * Returns null for non-numeric or >= 4 digit identifiers.
 */
export function normalizeShortStaffIdCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return String(num).padStart(3, '0');
}

export function formatStudentId(schoolInitials: string, seqNumber: number): string {
  const prefix = schoolInitials.replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'SCH';
  return `${prefix}-STD-${String(seqNumber).padStart(3, '0')}`;
}

export function generateNextStaffId(
  schoolNameOrInitials: string,
  existingStaffIds: Array<string | null | undefined>,
  isAlreadyInitials = false
): string {
  const initials = isAlreadyInitials
    ? schoolNameOrInitials.toUpperCase()
    : extractSchoolInitials(schoolNameOrInitials);
  const used = new Set(
    existingStaffIds.map((id) => id?.trim().toUpperCase()).filter((v): v is string => Boolean(v))
  );
  let seq = getNextSequenceNumber(existingStaffIds, 'TCH');
  let candidate = formatStaffId(initials, seq);
  while (used.has(candidate)) {
    seq += 1;
    candidate = formatStaffId(initials, seq);
  }
  return candidate;
}

export function generateNextStudentId(
  schoolNameOrInitials: string,
  existingStudentIds: Array<string | null | undefined>,
  isAlreadyInitials = false
): string {
  const initials = isAlreadyInitials
    ? schoolNameOrInitials.toUpperCase()
    : extractSchoolInitials(schoolNameOrInitials);
  const used = new Set(
    existingStudentIds.map((id) => id?.trim().toUpperCase()).filter((v): v is string => Boolean(v))
  );
  let seq = getNextSequenceNumber(existingStudentIds, 'STD');
  let candidate = formatStudentId(initials, seq);
  while (used.has(candidate)) {
    seq += 1;
    candidate = formatStudentId(initials, seq);
  }
  return candidate;
}

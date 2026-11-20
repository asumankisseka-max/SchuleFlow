import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  hashPassword,
  signRecoveryToken,
  verifyPassword,
  verifyRecoveryToken,
  type RecoveryLookupMethod,
} from '../lib/passwordAuth.ts';
import type { AuthSessionProfile, PublicSchoolBranding, UserRole } from '../types.ts';
import { normalizeUserRole, ROLE_DISPLAY_NAMES } from '../utils/rbac.ts';
import { DEFAULT_UNIFORM_PRIMARY, DEFAULT_UNIFORM_SECONDARY } from '../utils/schoolTheme.ts';
import { buildPhoneLoginCandidates, normalizeStoredPhone } from '../utils/validation.ts';
import { db } from './index.ts';
import { schools, staffTeachers, users } from './schema.ts';

function toProfile(
  row: typeof users.$inferSelect,
  schoolCode?: string | null
): AuthSessionProfile {
  const globalRole = row.globalRole as AuthSessionProfile['globalRole'];
  return {
    userId: row.id,
    uid: row.uid,
    staffId: row.staffId ?? undefined,
    schoolCode: globalRole === 'super_admin' ? null : schoolCode ?? null,
    email: row.email,
    username: row.username ?? row.email.split('@')[0],
    phone: row.phone ?? undefined,
    name: row.name,
    globalRole,
    schoolId: globalRole === 'super_admin' ? null : row.schoolId,
    schoolRole: normalizeUserRole(row.schoolRole),
    active: row.active,
  };
}

export async function getUserProfileByUid(uid: string): Promise<AuthSessionProfile | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    const row = rows[0];
    if (!row) return null;

    let schoolCode: string | null = null;
    if (row.globalRole !== 'super_admin' && row.schoolId) {
      const schRows = await db
        .select({ schoolCode: schools.schoolCode })
        .from(schools)
        .where(eq(schools.id, row.schoolId))
        .limit(1);
      schoolCode = schRows[0]?.schoolCode ?? null;
    }

    return toProfile(row, schoolCode);
  } catch (error) {
    console.error('Database error loading user by uid:', error);
    return null;
  }
}

export async function lookupSchoolByCode(
  schoolCode: string
): Promise<PublicSchoolBranding | null> {
  const cleanCode = schoolCode.trim().toUpperCase();
  if (!cleanCode) return null;

  const rows = await db
    .select({
      id: schools.id,
      schoolCode: schools.schoolCode,
      name: schools.name,
      subdomain: schools.subdomain,
      district: schools.district,
      logoUrl: schools.logoUrl,
      primaryColor: schools.primaryColor,
      secondaryColor: schools.secondaryColor,
    })
    .from(schools)
    .where(sql`upper(trim(${schools.schoolCode})) = ${cleanCode}`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    schoolCode: row.schoolCode,
    name: row.name,
    subdomain: row.subdomain,
    district: row.district,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor || DEFAULT_UNIFORM_PRIMARY,
    secondaryColor: row.secondaryColor || DEFAULT_UNIFORM_SECONDARY,
  };
}

export class AuthValidationError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function authenticateWithCredentials(params: {
  schoolCode?: string;
  identifier: string;
  password: string;
  mode?: 'school' | 'super_admin';
}): Promise<AuthSessionProfile | null> {
  const cleanIdentifier = params.identifier.trim().toLowerCase();
  const cleanSchoolCode = params.schoolCode?.trim().toUpperCase() || '';
  const password = params.password;
  const mode = params.mode ?? (cleanSchoolCode ? 'school' : 'super_admin');

  if (!cleanIdentifier || !password) {
    return null;
  }

  // 1. Platform Super Admin Login (database-backed PostgreSQL users table, no schoolCode required)
  if (mode === 'super_admin') {
    const superAdminRows = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.globalRole, 'super_admin'),
          or(
            sql`lower(trim(${users.email})) = ${cleanIdentifier}`,
            sql`lower(trim(COALESCE(${users.username}, ''))) = ${cleanIdentifier}`
          )
        )
      )
      .limit(5);

    for (const row of superAdminRows) {
      if (verifyPassword(password, row.passwordHash)) {
        if (!row.active) {
          throw new AuthValidationError(
            'Account deactivated. Please contact Platform Support.',
            403
          );
        }
        const updated = await db
          .update(users)
          .set({
            globalRole: 'super_admin',
            schoolId: null,
            lastLogin: new Date(),
          })
          .where(eq(users.id, row.id))
          .returning();
        return toProfile(updated[0], null);
      }
    }
    return null;
  }

  // 2. School Workspace Login: School Code is mandatory and isolates the user query strictly to school_id
  if (!cleanSchoolCode) {
    throw new AuthValidationError('School Code is required for school staff sign-in.', 400);
  }

  const schoolRows = await db
    .select()
    .from(schools)
    .where(sql`upper(trim(${schools.schoolCode})) = ${cleanSchoolCode}`)
    .limit(1);

  const school = schoolRows[0];
  if (!school) {
    throw new AuthValidationError(
      'Invalid School Code. Verify the code with your School Administrator.',
      401
    );
  }

  const phoneCandidates = buildPhoneLoginCandidates(params.identifier);
  const userPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${users.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;

  const userRows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.schoolId, school.id),
        or(
          sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${cleanIdentifier}`,
          sql`lower(trim(${users.email})) = ${cleanIdentifier}`,
          sql`lower(trim(COALESCE(${users.username}, ''))) = ${cleanIdentifier}`,
          ...(userPhonePredicate ? [userPhonePredicate] : [])
        )
      )
    )
    .limit(10);

  for (const row of userRows) {
    if (verifyPassword(password, row.passwordHash)) {
      if (!row.active) {
        throw new AuthValidationError(
          'Account deactivated. Please contact your School Administrator.',
          403
        );
      }

      const cleanEmail = row.email.trim().toLowerCase();
      const staffMatchRows = await db
        .select()
        .from(staffTeachers)
        .where(
          and(
            eq(staffTeachers.schoolId, school.id),
            or(
              row.staffId
                ? sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${row.staffId.toLowerCase()}`
                : sql`false`,
              sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
            )
          )
        )
        .limit(1);

      const matchedStaff = staffMatchRows[0];
      if (matchedStaff && !matchedStaff.active) {
        throw new AuthValidationError(
          'Account deactivated. Please contact your School Administrator.',
          403
        );
      }

      const effectiveRole = matchedStaff
        ? normalizeUserRole(matchedStaff.role)
        : normalizeUserRole(row.schoolRole);
      const effectiveStaffId = matchedStaff?.staffId ?? row.staffId ?? null;

      if (matchedStaff) {
        await db
          .update(staffTeachers)
          .set({ lastLogin: new Date().toISOString() })
          .where(eq(staffTeachers.id, matchedStaff.id));
      }

      const updated = await db
        .update(users)
        .set({
          staffId: effectiveStaffId,
          schoolId: school.id,
          schoolRole: effectiveRole,
          lastLogin: new Date(),
        })
        .where(eq(users.id, row.id))
        .returning();

      return toProfile(updated[0], school.schoolCode);
    }
  }

  // Fallback check strictly scoped to staff_teachers WHERE school_id = $school.id
  const staffPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${staffTeachers.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;

  const staffList = await db
    .select()
    .from(staffTeachers)
    .where(
      and(
        eq(staffTeachers.schoolId, school.id),
        or(
          sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${cleanIdentifier}`,
          sql`lower(trim(${staffTeachers.email})) = ${cleanIdentifier}`,
          sql`lower(trim(${staffTeachers.username})) = ${cleanIdentifier}`,
          ...(staffPhonePredicate ? [staffPhonePredicate] : [])
        )
      )
    )
    .limit(10);

  for (const staff of staffList) {
    if (verifyPassword(password, staff.passwordHash)) {
      if (!staff.active) {
        throw new AuthValidationError(
          'Account deactivated. Please contact your School Administrator.',
          403
        );
      }

      const staffEmail = staff.email.trim().toLowerCase();
      const normalizedPhone = normalizeStoredPhone(staff.phone);
      const effectiveRole = normalizeUserRole(staff.role);
      const localUid = staff.id.includes(':')
        ? `local:${staff.id}`
        : `local:${school.id}:${staff.id}`;

      await db
        .update(staffTeachers)
        .set({ lastLogin: new Date().toISOString() })
        .where(eq(staffTeachers.id, staff.id));

      const inserted = await db
        .insert(users)
        .values({
          uid: localUid,
          staffId: staff.staffId,
          email: staffEmail,
          username: staff.username.toLowerCase(),
          phone: normalizedPhone,
          passwordHash: staff.passwordHash,
          name: staff.name,
          globalRole: 'school_user',
          schoolId: school.id,
          schoolRole: effectiveRole,
          active: staff.active,
          lastLogin: new Date(),
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            staffId: staff.staffId,
            phone: normalizedPhone,
            schoolId: school.id,
            schoolRole: effectiveRole,
            active: staff.active,
            lastLogin: new Date(),
          },
        })
        .returning();

      return toProfile(inserted[0], school.schoolCode);
    }
  }

  return null;
}

export async function updateUserTenantRole(
  uid: string,
  schoolId: string | null,
  schoolRole: UserRole
): Promise<AuthSessionProfile | null> {
  try {
    const updated = await db
      .update(users)
      .set({
        schoolId,
        schoolRole: normalizeUserRole(schoolRole),
      })
      .where(eq(users.uid, uid))
      .returning();

    if (!updated[0]) return null;
    return toProfile(updated[0], null);
  } catch (error) {
    console.error('Database error updating user tenant role:', error);
    throw new Error('Failed to update active workspace role.', { cause: error });
  }
}

/* -------------------------------------------------------------------------- */
/* Forgotten Login Information & Password Recovery                            */
/* -------------------------------------------------------------------------- */

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.length <= 2 ? local[0] : `${local[0]}***${local[local.length - 1]}`;
  return `${visible}@${domain}`;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const compact = phone.replace(/[\s()-]/g, '');
  if (compact.length < 6) return '***';
  return `${compact.slice(0, 5)}***${compact.slice(-3)}`;
}

function maskUsername(username: string | null | undefined): string | null {
  if (!username) return null;
  if (username.length <= 2) return `${username[0]}*`;
  return `${username.slice(0, 2)}***${username.slice(-1)}`;
}

function formatRoleLabel(globalRole: string, schoolRole: string): string {
  if (globalRole === 'super_admin') return 'Platform Super Admin';
  return ROLE_DISPLAY_NAMES[normalizeUserRole(schoolRole)] ?? schoolRole;
}

function normalizePersonName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(mr|mrs|ms|miss|dr|sr|rev|prof)\.?\s+/i, '')
    .replace(/\s+/g, ' ');
}

export interface AccountLookupResult {
  recoveryToken: string;
  lookupMethod: RecoveryLookupMethod;
  maskedEmail: string;
  maskedPhone: string | null;
  maskedUsername: string | null;
  maskedStaffId: string | null;
  schoolName: string;
  schoolContactPhone: string | null;
  schoolContactEmail: string | null;
  roleLabel: string;
  hasPhone: boolean;
}

export async function lookupRecoverableAccount(params: {
  identifier?: string;
  schoolCode?: string;
  fullName?: string;
}): Promise<AccountLookupResult | null> {
  const identifier = params.identifier?.trim() ?? '';
  const schoolCode = params.schoolCode?.trim().toUpperCase() ?? '';
  const fullName = params.fullName?.trim() ?? '';

  let targetUser: typeof users.$inferSelect | null = null;
  let targetStaff: typeof staffTeachers.$inferSelect | null = null;
  let lookupMethod: RecoveryLookupMethod = 'identifier';

  let scopedSchoolId: string | null = null;
  if (schoolCode) {
    const schRows = await db
      .select({ id: schools.id })
      .from(schools)
      .where(sql`upper(trim(${schools.schoolCode})) = ${schoolCode}`)
      .limit(1);
    if (!schRows[0]) return null;
    scopedSchoolId = schRows[0].id;
  }

  if (identifier) {
    const clean = identifier.toLowerCase();
    const phoneCandidates = buildPhoneLoginCandidates(identifier);
    const userPhonePred =
      phoneCandidates.length > 0
        ? inArray(
            sql`regexp_replace(COALESCE(${users.phone}, ''), '[\\s()-]+', '', 'g')`,
            phoneCandidates
          )
        : undefined;

    const idPred = or(
      sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${clean}`,
      sql`lower(${users.email}) = ${clean}`,
      sql`lower(COALESCE(${users.username}, '')) = ${clean}`,
      ...(userPhonePred ? [userPhonePred] : [])
    );

    const userRows = await db
      .select()
      .from(users)
      .where(scopedSchoolId ? and(eq(users.schoolId, scopedSchoolId), idPred) : idPred)
      .limit(5);

    if (userRows.length > 0) {
      targetUser = userRows.find((u) => u.active) ?? userRows[0];
    } else {
      const staffPhonePred =
        phoneCandidates.length > 0
          ? inArray(
              sql`regexp_replace(COALESCE(${staffTeachers.phone}, ''), '[\\s()-]+', '', 'g')`,
              phoneCandidates
            )
          : undefined;
      const staffPred = or(
        sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${clean}`,
        sql`lower(${staffTeachers.email}) = ${clean}`,
        sql`lower(${staffTeachers.username}) = ${clean}`,
        ...(staffPhonePred ? [staffPhonePred] : [])
      );
      const staffRows = await db
        .select()
        .from(staffTeachers)
        .where(
          scopedSchoolId
            ? and(eq(staffTeachers.schoolId, scopedSchoolId), staffPred)
            : staffPred
        )
        .limit(5);
      if (staffRows.length > 0) {
        targetStaff = staffRows.find((s) => s.active) ?? staffRows[0];
      }
    }
  } else if (scopedSchoolId && fullName) {
    lookupMethod = 'name_school';
    const targetNormName = normalizePersonName(fullName);
    const schoolUsers = await db
      .select()
      .from(users)
      .where(eq(users.schoolId, scopedSchoolId));
    const matchedUsersByName = schoolUsers.filter(
      (u) => normalizePersonName(u.name) === targetNormName
    );

    if (matchedUsersByName.length > 0) {
      targetUser = matchedUsersByName.find((u) => u.active) ?? matchedUsersByName[0];
    } else {
      const schoolStaff = await db
        .select()
        .from(staffTeachers)
        .where(eq(staffTeachers.schoolId, scopedSchoolId));
      const matchedStaffByName = schoolStaff.filter(
        (s) => normalizePersonName(s.name) === targetNormName
      );
      if (matchedStaffByName.length > 0) {
        targetStaff = matchedStaffByName.find((s) => s.active) ?? matchedStaffByName[0];
      }
    }
  }

  if (!targetUser && !targetStaff) {
    return null;
  }

  const email = (targetUser?.email ?? targetStaff!.email).trim().toLowerCase();
  const username = targetUser?.username ?? targetStaff?.username ?? email.split('@')[0];
  const staffCode = targetUser?.staffId ?? targetStaff?.staffId ?? null;
  const phone = normalizeStoredPhone(targetUser?.phone ?? targetStaff?.phone);
  const resolvedSchoolId = targetUser
    ? targetUser.globalRole === 'super_admin'
      ? null
      : targetUser.schoolId
    : targetStaff!.schoolId;
  const globalRole = targetUser?.globalRole ?? 'school_user';
  const schoolRole = targetUser?.schoolRole ?? targetStaff!.role;

  let schoolName = 'SchuleFlow Platform (Global)';
  let schoolContactPhone: string | null = null;
  let schoolContactEmail: string | null = null;

  if (resolvedSchoolId) {
    const schoolRows = await db
      .select({
        name: schools.name,
        phone: schools.phone,
        email: schools.email,
      })
      .from(schools)
      .where(eq(schools.id, resolvedSchoolId))
      .limit(1);
    if (schoolRows[0]) {
      schoolName = schoolRows[0].name;
      schoolContactPhone = schoolRows[0].phone;
      schoolContactEmail = schoolRows[0].email;
    }
  }

  const recoveryToken = signRecoveryToken({
    userId: targetUser?.id,
    staffId: targetStaff?.id,
    email,
    schoolId: resolvedSchoolId,
    purpose: 'lookup_verify',
    lookupMethod,
  });

  return {
    recoveryToken,
    lookupMethod,
    maskedEmail: maskEmail(email),
    maskedPhone: maskPhone(phone),
    maskedUsername: maskUsername(username),
    maskedStaffId: staffCode,
    schoolName,
    schoolContactPhone,
    schoolContactEmail,
    roleLabel: formatRoleLabel(globalRole, schoolRole),
    hasPhone: Boolean(phone),
  };
}

export async function verifyRecoveryIdentity(
  recoveryToken: string,
  verificationInput: string
): Promise<{
  resetToken: string;
  account: {
    name: string;
    staffId: string | null;
    schoolCode: string | null;
    email: string;
    username: string;
    phone: string | null;
    schoolId: string | null;
    schoolName: string;
    roleLabel: string;
  };
} | null> {
  const payload = verifyRecoveryToken(recoveryToken, 'lookup_verify');
  if (!payload) return null;

  const answer = verificationInput.trim();
  if (!answer) return null;

  let userRow: typeof users.$inferSelect | null = null;
  let staffRow: typeof staffTeachers.$inferSelect | null = null;

  if (payload.userId) {
    const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    userRow = rows[0] ?? null;
  }
  if (!userRow && payload.staffId) {
    const rows = await db
      .select()
      .from(staffTeachers)
      .where(eq(staffTeachers.id, payload.staffId))
      .limit(1);
    staffRow = rows[0] ?? null;
  }
  if (!userRow && !staffRow) return null;

  const name = (userRow?.name ?? staffRow!.name).trim();
  const staffCode = userRow?.staffId ?? staffRow?.staffId ?? null;
  const email = (userRow?.email ?? staffRow!.email).trim().toLowerCase();
  const username = (userRow?.username ?? staffRow?.username ?? email.split('@')[0])
    .trim()
    .toLowerCase();
  const phone = normalizeStoredPhone(userRow?.phone ?? staffRow?.phone);
  const schoolId = userRow
    ? userRow.globalRole === 'super_admin'
      ? null
      : userRow.schoolId
    : staffRow!.schoolId;
  const globalRole = userRow?.globalRole ?? 'school_user';
  const schoolRole = userRow?.schoolRole ?? staffRow!.role;

  const answerLower = answer.toLowerCase();
  const answerPhoneCandidates = buildPhoneLoginCandidates(answer);
  const answerDigits = answer.replace(/\D/g, '');
  const phoneDigits = (phone ?? '').replace(/\D/g, '');

  const matchesName =
    payload.lookupMethod === 'identifier' &&
    normalizePersonName(name) === normalizePersonName(answer);
  const matchesEmail = email === answerLower;
  const matchesUsername = username === answerLower;
  const matchesStaffId = Boolean(staffCode && staffCode.toLowerCase() === answerLower);
  const matchesPhone = Boolean(
    phone &&
      (answerPhoneCandidates.includes(phone) ||
        (answerDigits.length === 4 && phoneDigits.endsWith(answerDigits)))
  );

  if (!matchesName && !matchesEmail && !matchesUsername && !matchesStaffId && !matchesPhone) {
    return null;
  }

  let schoolName = 'SchuleFlow Platform (Global)';
  let schoolCode: string | null = null;
  if (schoolId) {
    const schoolRows = await db
      .select({ name: schools.name, schoolCode: schools.schoolCode })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    if (schoolRows[0]) {
      schoolName = schoolRows[0].name;
      schoolCode = schoolRows[0].schoolCode;
    }
  }

  const resetToken = signRecoveryToken({
    userId: userRow?.id,
    staffId: staffRow?.id,
    email,
    schoolId,
    purpose: 'password_reset',
    lookupMethod: payload.lookupMethod,
  });

  return {
    resetToken,
    account: {
      name,
      staffId: staffCode,
      schoolCode,
      email,
      username,
      phone,
      schoolId,
      schoolName,
      roleLabel: formatRoleLabel(globalRole, schoolRole),
    },
  };
}

export async function resetPasswordWithRecoveryToken(
  resetToken: string,
  newPassword: string
): Promise<{
  uid: string;
  email: string;
  username: string;
  phone: string | null;
  schoolId: string | null;
  role: string;
} | null> {
  const payload = verifyRecoveryToken(resetToken, 'password_reset');
  if (!payload) return null;

  const trimmedPwd = newPassword.trim();
  if (trimmedPwd.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  const nextHash = hashPassword(trimmedPwd);
  const cleanEmail = payload.email.trim().toLowerCase();

  let updatedUser: typeof users.$inferSelect | null = null;
  if (payload.userId) {
    const updated = await db
      .update(users)
      .set({ passwordHash: nextHash })
      .where(eq(users.id, payload.userId))
      .returning();
    updatedUser = updated[0] ?? null;
  }

  if (payload.staffId) {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash })
      .where(eq(staffTeachers.id, payload.staffId));
  }

  if (payload.schoolId) {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash })
      .where(
        and(
          eq(staffTeachers.schoolId, payload.schoolId),
          sql`lower(${staffTeachers.email}) = ${cleanEmail}`
        )
      );
  } else {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash })
      .where(sql`lower(${staffTeachers.email}) = ${cleanEmail}`);
  }

  if (!updatedUser && payload.staffId) {
    const staffRows = await db
      .select()
      .from(staffTeachers)
      .where(eq(staffTeachers.id, payload.staffId))
      .limit(1);
    const st = staffRows[0];
    if (st) {
      const inserted = await db
        .insert(users)
        .values({
          uid: `local:${st.id}`,
          staffId: st.staffId,
          email: cleanEmail,
          username: st.username.toLowerCase(),
          phone: normalizeStoredPhone(st.phone),
          passwordHash: nextHash,
          name: st.name,
          globalRole: 'school_user',
          schoolId: st.schoolId,
          schoolRole: normalizeUserRole(st.role),
          active: st.active,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { passwordHash: nextHash },
        })
        .returning();
      updatedUser = inserted[0] ?? null;
    }
  }

  return {
    uid: updatedUser?.uid ?? `local:${payload.staffId ?? cleanEmail}`,
    email: updatedUser?.email ?? cleanEmail,
    username: updatedUser?.username ?? cleanEmail.split('@')[0],
    phone: updatedUser?.phone ?? null,
    schoolId: payload.schoolId,
    role: updatedUser?.schoolRole ?? 'school_user',
  };
}

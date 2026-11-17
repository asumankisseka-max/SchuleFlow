import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  hashPassword,
  signRecoveryToken,
  verifyPassword,
  verifyRecoveryToken,
  type RecoveryLookupMethod,
} from '../lib/passwordAuth.ts';
import type { AuthSessionProfile, UserRole } from '../types.ts';
import { normalizeUserRole, ROLE_DISPLAY_NAMES } from '../utils/rbac.ts';
import { buildPhoneLoginCandidates, normalizeStoredPhone } from '../utils/validation.ts';
import { db } from './index.ts';
import { schools, staffTeachers, users } from './schema.ts';

function safeStringEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function getEnvSuperAdminConfig(): { email: string; password: string } | null {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD?.trim();
  if (!email) return null;
  return { email, password: password ?? '' };
}

function isEnvSuperAdminEmail(email: string): boolean {
  const cfg = getEnvSuperAdminConfig();
  return Boolean(cfg && email.trim().toLowerCase() === cfg.email);
}

async function findMatchingStaffByEmail(
  cleanEmail: string,
  preferredSchoolId?: string | null
) {
  const rows = await db
    .select()
    .from(staffTeachers)
    .where(sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`);
  if (rows.length === 0) return null;
  if (preferredSchoolId) {
    const exact = rows.find((r) => r.schoolId === preferredSchoolId);
    if (exact) return exact;
  }
  return rows.find((r) => r.active) ?? rows[0];
}

function toProfile(row: typeof users.$inferSelect): AuthSessionProfile {
  const globalRole = row.globalRole as AuthSessionProfile['globalRole'];
  return {
    uid: row.uid,
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
    if (!rows[0]) return null;
    return toProfile(rows[0]);
  } catch (error) {
    console.error('Database error loading user by uid:', error);
    return null;
  }
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string
): Promise<AuthSessionProfile> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const fallbackName = displayName?.trim() || cleanEmail.split('@')[0] || 'Staff User';

    const [existingByUidRows, existingByEmailRows, matchedStaff, superAdmins] = await Promise.all([
      db.select().from(users).where(eq(users.uid, uid)).limit(1),
      db
        .select()
        .from(users)
        .where(sql`lower(trim(${users.email})) = ${cleanEmail}`)
        .limit(5),
      findMatchingStaffByEmail(cleanEmail),
      db.select({ id: users.id }).from(users).where(eq(users.globalRole, 'super_admin')).limit(1),
    ]);

    const existing = existingByUidRows[0];
    const byEmail =
      existingByEmailRows.find((u) => u.globalRole === 'super_admin') ??
      existingByEmailRows.find((u) => u.active && Boolean(u.schoolId)) ??
      existingByEmailRows[0];

    const isSuperAdmin =
      isEnvSuperAdminEmail(cleanEmail) ||
      existing?.globalRole === 'super_admin' ||
      byEmail?.globalRole === 'super_admin' ||
      (superAdmins.length === 0 && !matchedStaff);

    if (isSuperAdmin) {
      const targetRow = existing ?? byEmail;
      if (targetRow) {
        if (!targetRow.active) {
          throw new Error('Account deactivated. Please contact Platform Support.');
        }
        const updated = await db
          .update(users)
          .set({
            uid,
            email: cleanEmail,
            name: displayName?.trim() || targetRow.name || fallbackName,
            globalRole: 'super_admin',
            schoolId: null,
            lastLogin: new Date(),
          })
          .where(eq(users.id, targetRow.id))
          .returning();
        return toProfile(updated[0]);
      }

      const inserted = await db
        .insert(users)
        .values({
          uid,
          email: cleanEmail,
          username: cleanEmail.split('@')[0],
          name: fallbackName,
          globalRole: 'super_admin',
          schoolId: null,
          schoolRole: 'school_admin',
          active: true,
          lastLogin: new Date(),
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: cleanEmail,
            globalRole: 'super_admin',
            schoolId: null,
            lastLogin: new Date(),
          },
        })
        .returning();
      return toProfile(inserted[0]);
    }

    // Standard non-super-admin user: verify active status & tenant assignment against staff_teachers (db.users)
    if (matchedStaff && !matchedStaff.active) {
      throw new Error('Account deactivated. Please contact your School Administrator.');
    }

    const targetRow = existing ?? byEmail;
    if (targetRow && !targetRow.active && !matchedStaff) {
      throw new Error('Account deactivated. Please contact your School Administrator.');
    }

    const resolvedSchoolId = matchedStaff?.schoolId ?? targetRow?.schoolId ?? null;
    if (!resolvedSchoolId) {
      throw new Error(
        'Account not assigned to an active school workspace. Contact your School Administrator.'
      );
    }

    const schoolCheck = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.id, resolvedSchoolId))
      .limit(1);
    if (!schoolCheck[0]) {
      throw new Error(
        'Account not assigned to an active school workspace. Contact your School Administrator.'
      );
    }

    const resolvedSchoolRole: UserRole = normalizeUserRole(
      matchedStaff?.role ?? targetRow?.schoolRole
    );
    const resolvedPhone = normalizeStoredPhone(matchedStaff?.phone ?? targetRow?.phone);
    const resolvedName =
      matchedStaff?.name || displayName?.trim() || targetRow?.name || fallbackName;
    const resolvedUsername =
      matchedStaff?.username?.toLowerCase() ??
      targetRow?.username ??
      cleanEmail.split('@')[0];

    if (!matchedStaff) {
      await db
        .insert(staffTeachers)
        .values({
          id: `${resolvedSchoolId}:usr-${uid}`,
          schoolId: resolvedSchoolId,
          name: resolvedName,
          email: cleanEmail,
          username: resolvedUsername,
          passwordHash: targetRow?.passwordHash ?? null,
          role: resolvedSchoolRole,
          active: targetRow ? targetRow.active : true,
          phone: resolvedPhone,
          assignedClassIds: [],
          assignedSubjectIds: [],
        })
        .onConflictDoNothing();
    }

    if (targetRow) {
      const updated = await db
        .update(users)
        .set({
          uid,
          email: cleanEmail,
          username: resolvedUsername,
          phone: resolvedPhone,
          name: resolvedName,
          globalRole: 'school_user',
          schoolId: resolvedSchoolId,
          schoolRole: resolvedSchoolRole,
          active: matchedStaff ? matchedStaff.active : targetRow.active,
          lastLogin: new Date(),
        })
        .where(eq(users.id, targetRow.id))
        .returning();
      return toProfile(updated[0]);
    }

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        username: resolvedUsername,
        phone: resolvedPhone,
        passwordHash: matchedStaff?.passwordHash ?? null,
        name: resolvedName,
        globalRole: 'school_user',
        schoolId: resolvedSchoolId,
        schoolRole: resolvedSchoolRole,
        active: true,
        lastLogin: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail,
          phone: resolvedPhone,
          schoolId: resolvedSchoolId,
          schoolRole: resolvedSchoolRole,
          lastLogin: new Date(),
        },
      })
      .returning();

    return toProfile(inserted[0]);
  } catch (error) {
    console.error('Database error syncing user:', error);
    if (
      error instanceof Error &&
      (error.message.includes('Account deactivated') ||
        error.message.includes('Account not assigned to an active school workspace') ||
        error.message.includes('No active school staff account'))
    ) {
      throw error;
    }
    throw new Error('Failed to synchronize authenticated user profile.', { cause: error });
  }
}

export async function authenticateWithCredentials(
  identifier: string,
  password: string,
  schoolId?: string
): Promise<AuthSessionProfile | null> {
  const clean = identifier.trim().toLowerCase();
  const cleanSchoolId = schoolId?.trim() || null;
  if (!clean || !password) return null;

  // Optional environment-based Super Admin credential verification
  const envAdmin = getEnvSuperAdminConfig();
  if (envAdmin && envAdmin.password && clean === envAdmin.email && safeStringEqual(password, envAdmin.password)) {
    const existingEnvAdmin = await db
      .select()
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${envAdmin.email}`)
      .limit(1);

    if (existingEnvAdmin[0]) {
      const updated = await db
        .update(users)
        .set({
          globalRole: 'super_admin',
          schoolId: null,
          active: true,
          lastLogin: new Date(),
        })
        .where(eq(users.id, existingEnvAdmin[0].id))
        .returning();
      return toProfile(updated[0]);
    }

    const inserted = await db
      .insert(users)
      .values({
        uid: `env:super_admin:${envAdmin.email}`,
        email: envAdmin.email,
        username: envAdmin.email.split('@')[0],
        passwordHash: hashPassword(password),
        name: 'Platform Super Admin',
        globalRole: 'super_admin',
        schoolId: null,
        schoolRole: 'school_admin',
        active: true,
        lastLogin: new Date(),
      })
      .returning();
    return toProfile(inserted[0]);
  }

  const phoneCandidates = buildPhoneLoginCandidates(identifier);
  const userPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${users.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;

  const userIdentifierMatch = or(
    sql`lower(trim(${users.email})) = ${clean}`,
    sql`lower(trim(${users.username})) = ${clean}`,
    ...(userPhonePredicate ? [userPhonePredicate] : [])
  );

  const matchedUsers = await db
    .select()
    .from(users)
    .where(
      cleanSchoolId
        ? and(
            userIdentifierMatch,
            or(eq(users.schoolId, cleanSchoolId), eq(users.globalRole, 'super_admin'))
          )
        : userIdentifierMatch
    )
    .limit(15);

  // If a school was explicitly selected, prefer that school's user record first
  const orderedUsers = cleanSchoolId
    ? [...matchedUsers].sort((a, b) => {
        const aExact = a.schoolId === cleanSchoolId ? 0 : 1;
        const bExact = b.schoolId === cleanSchoolId ? 0 : 1;
        return aExact - bExact;
      })
    : matchedUsers;

  for (const row of orderedUsers) {
    if (verifyPassword(password, row.passwordHash)) {
      if (!row.active) {
        throw new Error('Account deactivated. Please contact your School Administrator.');
      }
      const isSuperAdmin = row.globalRole === 'super_admin' || isEnvSuperAdminEmail(row.email);
      if (isSuperAdmin) {
        const updated = await db
          .update(users)
          .set({
            globalRole: 'super_admin',
            schoolId: null,
            lastLogin: new Date(),
          })
          .where(eq(users.id, row.id))
          .returning();
        return toProfile(updated[0]);
      }

      const matchedStaff = await findMatchingStaffByEmail(
        row.email.trim().toLowerCase(),
        cleanSchoolId ?? row.schoolId
      );
      if (matchedStaff && !matchedStaff.active) {
        throw new Error('Account deactivated. Please contact your School Administrator.');
      }

      const effectiveSchoolId = matchedStaff?.schoolId ?? row.schoolId;
      if (!effectiveSchoolId) {
        throw new Error(
          'Account not assigned to an active school workspace. Contact your School Administrator.'
        );
      }

      const effectiveRole = matchedStaff
        ? normalizeUserRole(matchedStaff.role)
        : normalizeUserRole(row.schoolRole);

      const updated = await db
        .update(users)
        .set({
          schoolId: effectiveSchoolId,
          schoolRole: effectiveRole,
          lastLogin: new Date(),
        })
        .where(eq(users.id, row.id))
        .returning();
      return toProfile(updated[0]);
    }
  }

  // Fallback: check staff_teachers directly if a staff row was seeded or lacks synced users.phone
  const staffPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${staffTeachers.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;

  const staffIdentifierMatch = or(
    sql`lower(trim(${staffTeachers.email})) = ${clean}`,
    sql`lower(trim(${staffTeachers.username})) = ${clean}`,
    ...(staffPhonePredicate ? [staffPhonePredicate] : [])
  );

  const matchedStaffList = await db
    .select()
    .from(staffTeachers)
    .where(
      cleanSchoolId
        ? and(eq(staffTeachers.schoolId, cleanSchoolId), staffIdentifierMatch)
        : staffIdentifierMatch
    )
    .limit(15);

  for (const staff of matchedStaffList) {
    if (verifyPassword(password, staff.passwordHash)) {
      if (!staff.active) {
        throw new Error('Account deactivated. Please contact your School Administrator.');
      }
      if (!staff.schoolId) {
        throw new Error(
          'Account not assigned to an active school workspace. Contact your School Administrator.'
        );
      }

      const staffEmail = staff.email.trim().toLowerCase();
      const normalizedPhone = normalizeStoredPhone(staff.phone);
      const existingByEmail = await db
        .select()
        .from(users)
        .where(sql`lower(trim(${users.email})) = ${staffEmail}`)
        .limit(1);

      if (existingByEmail[0]) {
        const updated = await db
          .update(users)
          .set({
            phone: normalizedPhone ?? existingByEmail[0].phone,
            schoolId: staff.schoolId,
            schoolRole: normalizeUserRole(staff.role),
            active: staff.active,
            lastLogin: new Date(),
          })
          .where(eq(users.id, existingByEmail[0].id))
          .returning();
        return toProfile(updated[0]);
      }

      const localUid = staff.id.includes(':')
        ? `local:${staff.id}`
        : `local:${staff.schoolId}:${staff.id}`;
      const inserted = await db
        .insert(users)
        .values({
          uid: localUid,
          email: staffEmail,
          username: staff.username.toLowerCase(),
          phone: normalizedPhone,
          passwordHash: staff.passwordHash,
          name: staff.name,
          globalRole: 'school_user',
          schoolId: staff.schoolId,
          schoolRole: normalizeUserRole(staff.role),
          active: staff.active,
          lastLogin: new Date(),
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            phone: normalizedPhone,
            schoolId: staff.schoolId,
            lastLogin: new Date(),
            schoolRole: normalizeUserRole(staff.role),
            active: staff.active,
          },
        })
        .returning();
      return toProfile(inserted[0]);
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
    return toProfile(updated[0]);
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

export async function listRecoverySchools(): Promise<
  Array<{ id: string; name: string; district: string }>
> {
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      district: schools.district,
    })
    .from(schools);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface AccountLookupResult {
  recoveryToken: string;
  lookupMethod: RecoveryLookupMethod;
  maskedEmail: string;
  maskedPhone: string | null;
  maskedUsername: string | null;
  schoolName: string;
  schoolContactPhone: string | null;
  schoolContactEmail: string | null;
  roleLabel: string;
  hasPhone: boolean;
}

export async function lookupRecoverableAccount(params: {
  identifier?: string;
  schoolId?: string;
  fullName?: string;
}): Promise<AccountLookupResult | null> {
  const identifier = params.identifier?.trim() ?? '';
  const schoolId = params.schoolId?.trim() ?? '';
  const fullName = params.fullName?.trim() ?? '';

  let targetUser: typeof users.$inferSelect | null = null;
  let targetStaff: typeof staffTeachers.$inferSelect | null = null;
  let lookupMethod: RecoveryLookupMethod = 'identifier';

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

    const userRows = await db
      .select()
      .from(users)
      .where(
        or(
          sql`lower(${users.email}) = ${clean}`,
          sql`lower(${users.username}) = ${clean}`,
          ...(userPhonePred ? [userPhonePred] : [])
        )
      )
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
      const staffRows = await db
        .select()
        .from(staffTeachers)
        .where(
          or(
            sql`lower(${staffTeachers.email}) = ${clean}`,
            sql`lower(${staffTeachers.username}) = ${clean}`,
            ...(staffPhonePred ? [staffPhonePred] : [])
          )
        )
        .limit(5);
      if (staffRows.length > 0) {
        targetStaff = staffRows.find((s) => s.active) ?? staffRows[0];
      }
    }
  } else if (schoolId && fullName) {
    lookupMethod = 'name_school';
    const targetNormName = normalizePersonName(fullName);
    const schoolUsers = await db
      .select()
      .from(users)
      .where(eq(users.schoolId, schoolId));
    const matchedUsersByName = schoolUsers.filter(
      (u) => normalizePersonName(u.name) === targetNormName
    );

    if (matchedUsersByName.length > 0) {
      targetUser = matchedUsersByName.find((u) => u.active) ?? matchedUsersByName[0];
    } else {
      const schoolStaff = await db
        .select()
        .from(staffTeachers)
        .where(eq(staffTeachers.schoolId, schoolId));
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
  const matchesPhone = Boolean(
    phone &&
      (answerPhoneCandidates.includes(phone) ||
        (answerDigits.length === 4 && phoneDigits.endsWith(answerDigits)))
  );

  if (!matchesName && !matchesEmail && !matchesUsername && !matchesPhone) {
    return null;
  }

  let schoolName = 'SchuleFlow Platform (Global)';
  if (schoolId) {
    const schoolRows = await db
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    if (schoolRows[0]) schoolName = schoolRows[0].name;
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

  // Keep matching staff_teachers & users records synchronized for the account
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

  // Ensure a users row exists if the account originally existed only in staff_teachers
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

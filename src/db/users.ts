import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  consumeRecoveryTokenJti,
  hashPassword,
  signRecoveryToken,
  validatePasswordStrength,
  verifyPassword,
  verifyRecoveryToken,
  type RecoveryLookupMethod,
} from '../lib/passwordAuth.ts';
import type {
  AuthSessionProfile,
  BillingStatus,
  CurriculumScope,
  PublicSchoolBranding,
  SchoolStatus,
  SchoolTenant,
  SubscriptionPlan,
  UserRole,
} from '../types.ts';
import { normalizeShortStaffIdCandidate } from '../utils/idGenerator.ts';
import { normalizeUserRole, ROLE_DISPLAY_NAMES } from '../utils/rbac.ts';
import { DEFAULT_UNIFORM_PRIMARY, DEFAULT_UNIFORM_SECONDARY } from '../utils/schoolTheme.ts';
import { buildPhoneLoginCandidates, normalizeStoredPhone } from '../utils/validation.ts';
import { db } from './index.ts';
import { platformRuntimeConfig, schools, staffTeachers, users } from './schema.ts';

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
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

function toSchoolTenant(row: typeof schools.$inferSelect): SchoolTenant {
  return {
    id: row.id,
    schoolCode: row.schoolCode,
    name: row.name,
    subdomain: row.subdomain,
    ministryRegNo: row.ministryRegNo,
    subCounty: row.subCounty,
    motto: row.motto,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    address: row.address,
    phone: row.phone,
    email: row.email,
    district: row.district,
    region: row.region,
    status: row.status as SchoolStatus,
    subscriptionStatus: (row.subscriptionStatus || row.status) as SchoolStatus,
    licenseExpiresAt: row.licenseExpiresAt.toISOString(),
    plan: row.plan as SubscriptionPlan,
    curriculumScope: row.curriculumScope as CurriculumScope,
    studentQuota: row.studentQuota,
    termFeePerStudentUgx: row.termFeePerStudentUgx,
    billingStatus: row.billingStatus as BillingStatus,
    nextBillingDate: row.nextBillingDate,
    academicYear: row.academicYear,
    termName: row.termName,
    principalName: row.principalName,
    dosName: row.dosName,
    reportsGeneratedCount: row.reportsGeneratedCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AuthContextLookupResult {
  profile: AuthSessionProfile;
  sessionValidAfterMs: number | null;
  school: SchoolTenant | null;
}

export async function getAuthContextByUid(
  uid: string
): Promise<AuthContextLookupResult | null> {
  try {
    const rows = await db
      .select({
        user: users,
        school: schools,
        sva: platformRuntimeConfig,
      })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .leftJoin(
        platformRuntimeConfig,
        eq(platformRuntimeConfig.key, sql`'sva:' || ${users.uid}`)
      )
      .where(eq(users.uid, uid))
      .limit(1);

    const joined = rows[0];
    if (!joined) return null;

    const schoolTenant =
      joined.user.globalRole !== 'super_admin' && joined.school
        ? toSchoolTenant(joined.school)
        : null;

    const parsedSva = joined.sva?.value ? Number(joined.sva.value) : NaN;
    const sessionValidAfterMs = Number.isFinite(parsedSva) ? parsedSva : null;

    return {
      profile: toProfile(joined.user, schoolTenant?.schoolCode ?? null),
      sessionValidAfterMs,
      school: schoolTenant,
    };
  } catch (error) {
    console.error('Database error loading auth context by uid:', error);
    return null;
  }
}

export async function getUserProfileByUid(uid: string): Promise<AuthSessionProfile | null> {
  const ctx = await getAuthContextByUid(uid);
  return ctx?.profile ?? null;
}

export async function revokeUserSessionsByUid(uid: string, timestampMs = Date.now()): Promise<void> {
  try {
    const key = `sva:${uid}`;
    const value = String(timestampMs);
    await db
      .insert(platformRuntimeConfig)
      .values({ key, value, updatedAt: new Date(timestampMs) })
      .onConflictDoUpdate({
        target: platformRuntimeConfig.key,
        set: { value, updatedAt: new Date(timestampMs) },
      });
  } catch (error) {
    console.warn('Could not persist session revocation watermark:', error);
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
  code?: string;
  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Constant-time timing-attack guard used when an identifier matches zero database rows
const DUMMY_TIMING_HASH = hashPassword('schuleflow-dummy-timing-guard-9912');

async function findMatchingStaffForUserRow(
  schoolId: string,
  row: typeof users.$inferSelect
): Promise<typeof staffTeachers.$inferSelect | undefined> {
  const cleanEmail = row.email.trim().toLowerCase();
  const staffMatchRows = await db
    .select()
    .from(staffTeachers)
    .where(
      and(
        eq(staffTeachers.schoolId, schoolId),
        or(
          row.staffId
            ? sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${row.staffId.toLowerCase()}`
            : sql`false`,
          sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
        )
      )
    )
    .limit(1);
  return staffMatchRows[0];
}

async function finalizeSchoolUserLogin(
  school: typeof schools.$inferSelect,
  userRow?: typeof users.$inferSelect,
  matchedStaff?: typeof staffTeachers.$inferSelect
): Promise<AuthSessionProfile> {
  if (userRow) {
    if (!userRow.active || (matchedStaff && !matchedStaff.active)) {
      throw new AuthValidationError(
        'Account deactivated. Please contact your School Administrator.',
        403
      );
    }

    const effectiveRole = matchedStaff
      ? normalizeUserRole(matchedStaff.role)
      : normalizeUserRole(userRow.schoolRole);
    const effectiveStaffId = matchedStaff?.staffId ?? userRow.staffId ?? null;

    if (matchedStaff) {
      await db
        .update(staffTeachers)
        .set({ lastLogin: new Date().toISOString() })
        .where(eq(staffTeachers.id, matchedStaff.id));
    }

    const effectiveMustChange = Boolean(
      userRow.mustChangePassword || matchedStaff?.mustChangePassword
    );
    const updated = await db
      .update(users)
      .set({
        globalRole: 'school_user',
        staffId: effectiveStaffId,
        schoolId: school.id,
        schoolRole: effectiveRole,
        mustChangePassword: effectiveMustChange,
        lastLogin: new Date(),
      })
      .where(eq(users.id, userRow.id))
      .returning();

    return toProfile(updated[0], school.schoolCode);
  }

  const staff = matchedStaff!;
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
      mustChangePassword: Boolean(staff.mustChangePassword),
      lastLogin: new Date(),
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        staffId: staff.staffId,
        email: staffEmail,
        username: staff.username.toLowerCase(),
        phone: normalizedPhone,
        ...(staff.passwordHash ? { passwordHash: staff.passwordHash } : {}),
        globalRole: 'school_user',
        schoolId: school.id,
        schoolRole: effectiveRole,
        active: staff.active,
        mustChangePassword: Boolean(staff.mustChangePassword),
        lastLogin: new Date(),
      },
    })
    .returning();

  return toProfile(inserted[0], school.schoolCode);
}

export async function authenticateWithCredentials(params: {
  schoolCode?: string;
  identifier: string;
  password: string;
}): Promise<AuthSessionProfile | null> {
  const cleanIdentifier = params.identifier.trim().toLowerCase();
  const cleanSchoolCode = params.schoolCode?.trim().toUpperCase() || '';
  const password = params.password;

  if (!cleanIdentifier || !password) {
    return null;
  }

  const phoneCandidates = buildPhoneLoginCandidates(params.identifier);
  const userPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${users.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;
  const staffPhonePredicate =
    phoneCandidates.length > 0
      ? inArray(
          sql`regexp_replace(COALESCE(${staffTeachers.phone}, ''), '[\\s()-]+', '', 'g')`,
          phoneCandidates
        )
      : undefined;

  const shortStaffCandidate = normalizeShortStaffIdCandidate(params.identifier);

  // 1. School Code scoping (required for school login flow with short Staff IDs, e.g. 001 / 1)
  if (cleanSchoolCode) {
    const schoolRows = await db
      .select()
      .from(schools)
      .where(sql`upper(trim(${schools.schoolCode})) = ${cleanSchoolCode}`)
      .limit(1);

    const school = schoolRows[0];
    if (!school) {
      verifyPassword(password, DUMMY_TIMING_HASH);
      return null;
    }

    const userRows = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.schoolId, school.id),
          sql`${users.globalRole} <> 'super_admin'`,
          or(
            sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${cleanIdentifier}`,
            ...(shortStaffCandidate
              ? [sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${shortStaffCandidate.toLowerCase()}`]
              : []),
            sql`lower(trim(${users.email})) = ${cleanIdentifier}`,
            sql`lower(trim(COALESCE(${users.username}, ''))) = ${cleanIdentifier}`,
            ...(userPhonePredicate ? [userPhonePredicate] : [])
          )
        )
      )
      .limit(10);

    const staffList = await db
      .select()
      .from(staffTeachers)
      .where(
        and(
          eq(staffTeachers.schoolId, school.id),
          or(
            sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${cleanIdentifier}`,
            ...(shortStaffCandidate
              ? [
                  sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${shortStaffCandidate.toLowerCase()}`,
                ]
              : []),
            sql`lower(trim(${staffTeachers.email})) = ${cleanIdentifier}`,
            sql`lower(trim(${staffTeachers.username})) = ${cleanIdentifier}`,
            ...(staffPhonePredicate ? [staffPhonePredicate] : [])
          )
        )
      )
      .limit(10);

    if (userRows.length === 0 && staffList.length === 0) {
      verifyPassword(password, DUMMY_TIMING_HASH);
      return null;
    }

    let matchedInactive = false;
    for (const row of userRows) {
      if (verifyPassword(password, row.passwordHash)) {
        const matchedStaff = await findMatchingStaffForUserRow(school.id, row);
        if (!row.active || (matchedStaff && !matchedStaff.active)) {
          matchedInactive = true;
          continue;
        }
        return finalizeSchoolUserLogin(school, row, matchedStaff);
      }
    }

    for (const staff of staffList) {
      if (verifyPassword(password, staff.passwordHash)) {
        if (!staff.active) {
          matchedInactive = true;
          continue;
        }
        return finalizeSchoolUserLogin(school, undefined, staff);
      }
    }

    if (matchedInactive) {
      throw new AuthValidationError(
        'Account deactivated. Please contact your School Administrator.',
        403
      );
    }
    return null;
  }

  // Never allow bare short numeric Staff IDs (< 4 chars, e.g. 001 / 1) without School ID
  if (shortStaffCandidate) {
    verifyPassword(password, DUMMY_TIMING_HASH);
    throw new AuthValidationError(
      'Enter your School ID first when signing in with your short Staff ID.',
      409,
      'SCHOOL_CODE_REQUIRED'
    );
  }

  // 2. Credential-driven automatic separation (Platform Super Admin vs School Tenants)
  const [superAdminRows, schoolUserRows, staffRows] = await Promise.all([
    db
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
      .limit(5),
    db
      .select()
      .from(users)
      .where(
        and(
          sql`${users.globalRole} <> 'super_admin'`,
          sql`${users.schoolId} IS NOT NULL`,
          or(
            sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${cleanIdentifier}`,
            sql`lower(trim(${users.email})) = ${cleanIdentifier}`,
            sql`lower(trim(COALESCE(${users.username}, ''))) = ${cleanIdentifier}`,
            ...(userPhonePredicate ? [userPhonePredicate] : [])
          )
        )
      )
      .limit(20),
    db
      .select()
      .from(staffTeachers)
      .where(
        or(
          sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${cleanIdentifier}`,
          sql`lower(trim(${staffTeachers.email})) = ${cleanIdentifier}`,
          sql`lower(trim(${staffTeachers.username})) = ${cleanIdentifier}`,
          ...(staffPhonePredicate ? [staffPhonePredicate] : [])
        )
      )
      .limit(20),
  ]);

  if (superAdminRows.length === 0 && schoolUserRows.length === 0 && staffRows.length === 0) {
    verifyPassword(password, DUMMY_TIMING_HASH);
    return null;
  }

  const verifiedSuperAdmins: Array<typeof users.$inferSelect> = [];
  const verifiedSchoolTargets = new Map<
    string,
    {
      schoolId: string;
      userRow?: typeof users.$inferSelect;
      staffRow?: typeof staffTeachers.$inferSelect;
    }
  >();
  let deactivatedType: 'super_admin' | 'school' | null = null;

  for (const row of superAdminRows) {
    if (verifyPassword(password, row.passwordHash)) {
      if (!row.active) {
        deactivatedType = deactivatedType ?? 'super_admin';
      } else {
        verifiedSuperAdmins.push(row);
      }
    }
  }

  for (const row of schoolUserRows) {
    if (!row.schoolId) continue;
    if (verifyPassword(password, row.passwordHash)) {
      const matchedStaff = await findMatchingStaffForUserRow(row.schoolId, row);
      if (!row.active || (matchedStaff && !matchedStaff.active)) {
        deactivatedType = 'school';
      } else if (!verifiedSchoolTargets.has(row.schoolId)) {
        verifiedSchoolTargets.set(row.schoolId, {
          schoolId: row.schoolId,
          userRow: row,
          staffRow: matchedStaff,
        });
      }
    }
  }

  for (const staff of staffRows) {
    if (!staff.schoolId) continue;
    if (verifiedSchoolTargets.has(staff.schoolId)) continue;
    if (verifyPassword(password, staff.passwordHash)) {
      if (!staff.active) {
        deactivatedType = 'school';
      } else {
        verifiedSchoolTargets.set(staff.schoolId, {
          schoolId: staff.schoolId,
          staffRow: staff,
        });
      }
    }
  }

  if (verifiedSuperAdmins.length === 0 && verifiedSchoolTargets.size === 0) {
    if (deactivatedType === 'super_admin') {
      throw new AuthValidationError(
        'Account deactivated. Please contact Platform Support.',
        403
      );
    }
    if (deactivatedType === 'school') {
      throw new AuthValidationError(
        'Account deactivated. Please contact your School Administrator.',
        403
      );
    }
    return null;
  }

  // Platform Super Admin has no School ID — always sign in directly when a super_admin credential verifies
  if (verifiedSuperAdmins.length > 0) {
    const adminRow = verifiedSuperAdmins[0];
    const updated = await db
      .update(users)
      .set({
        globalRole: 'super_admin',
        schoolId: null,
        lastLogin: new Date(),
      })
      .where(eq(users.id, adminRow.id))
      .returning();
    return toProfile(updated[0], null);
  }

  if (verifiedSchoolTargets.size > 1) {
    throw new AuthValidationError(
      'Your credentials match multiple workspaces. Enter your School Code to continue.',
      409,
      'SCHOOL_CODE_REQUIRED'
    );
  }

  const [target] = Array.from(verifiedSchoolTargets.values());
  const schoolRows = await db
    .select()
    .from(schools)
    .where(eq(schools.id, target.schoolId))
    .limit(1);
  const school = schoolRows[0];
  if (!school) {
    return null;
  }

  return finalizeSchoolUserLogin(school, target.userRow, target.staffRow);
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
    const shortStaffCandidate = normalizeShortStaffIdCandidate(identifier);
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
      ...(scopedSchoolId && shortStaffCandidate
        ? [sql`lower(trim(COALESCE(${users.staffId}, ''))) = ${shortStaffCandidate.toLowerCase()}`]
        : []),
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
        ...(scopedSchoolId && shortStaffCandidate
          ? [
              sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${shortStaffCandidate.toLowerCase()}`,
            ]
          : []),
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

  const shortStaffAnswer = normalizeShortStaffIdCandidate(answer);

  // Hardened identity verification: disallow public-name-only or 4-digit suffix bypasses.
  // Require matching full registered phone number, Staff ID, or full email address.
  const matchesEmail = email === answerLower;
  const matchesStaffId = Boolean(
    staffCode &&
      (staffCode.toLowerCase() === answerLower ||
        (shortStaffAnswer && staffCode.toLowerCase() === shortStaffAnswer.toLowerCase()))
  );
  const matchesPhone = Boolean(phone && answerPhoneCandidates.includes(phone));
  const matchesUsername = payload.lookupMethod === 'name_school' && username === answerLower;

  if (!matchesEmail && !matchesStaffId && !matchesPhone && !matchesUsername) {
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
  const strengthErr = validatePasswordStrength(trimmedPwd);
  if (strengthErr) {
    throw new Error(strengthErr);
  }

  let targetUid: string | null = null;
  if (payload.userId) {
    const existingRows = await db
      .select({ uid: users.uid })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);
    targetUid = existingRows[0]?.uid ?? null;
    if (targetUid) {
      const svaRows = await db
        .select({ value: platformRuntimeConfig.value })
        .from(platformRuntimeConfig)
        .where(eq(platformRuntimeConfig.key, `sva:${targetUid}`))
        .limit(1);
      const revokedMs = svaRows[0]?.value ? Number(svaRows[0].value) : NaN;
      if (Number.isFinite(revokedMs) && payload.iat < revokedMs) {
        return null;
      }
    }
  }

  if (!consumeRecoveryTokenJti(payload.jti, payload.exp)) {
    return null;
  }

  const nextHash = hashPassword(trimmedPwd);
  const cleanEmail = payload.email.trim().toLowerCase();
  const revokedAtMs = Date.now();

  let updatedUser: typeof users.$inferSelect | null = null;
  if (payload.userId) {
    const updated = await db
      .update(users)
      .set({
        passwordHash: nextHash,
        mustChangePassword: false,
      })
      .where(eq(users.id, payload.userId))
      .returning();
    updatedUser = updated[0] ?? null;
    if (updatedUser) {
      await revokeUserSessionsByUid(updatedUser.uid, revokedAtMs);
    }
  }

  if (payload.staffId) {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash, mustChangePassword: false })
      .where(eq(staffTeachers.id, payload.staffId));
  }

  if (payload.schoolId) {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash, mustChangePassword: false })
      .where(
        and(
          eq(staffTeachers.schoolId, payload.schoolId),
          sql`lower(${staffTeachers.email}) = ${cleanEmail}`
        )
      );
  } else {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash, mustChangePassword: false })
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
          mustChangePassword: false,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            passwordHash: nextHash,
            mustChangePassword: false,
          },
        })
        .returning();
      updatedUser = inserted[0] ?? null;
      if (updatedUser) {
        await revokeUserSessionsByUid(updatedUser.uid, revokedAtMs);
      }
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

export async function changeAuthenticatedUserPassword(params: {
  uid: string;
  email: string;
  schoolId: string | null;
  currentPassword: string;
  newPassword: string;
}): Promise<AuthSessionProfile & { sessionValidAfterMs: number }> {
  const { uid, email, schoolId, currentPassword, newPassword } = params;
  const strengthErr = validatePasswordStrength(newPassword);
  if (strengthErr) {
    throw new AuthValidationError(strengthErr, 400);
  }

  const userRows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
  const userRow = userRows[0];
  if (!userRow) {
    throw new AuthValidationError('User account not found.', 404);
  }

  if (!verifyPassword(currentPassword, userRow.passwordHash)) {
    throw new AuthValidationError('Current password is incorrect.', 401);
  }

  if (currentPassword.trim() === newPassword.trim()) {
    throw new AuthValidationError('New password must be different from your current password.', 400);
  }

  const nextHash = hashPassword(newPassword.trim());
  const cleanEmail = email.trim().toLowerCase();
  const revokedAtMs = Date.now();

  const updated = await db
    .update(users)
    .set({
      passwordHash: nextHash,
      mustChangePassword: false,
    })
    .where(eq(users.id, userRow.id))
    .returning();

  await revokeUserSessionsByUid(userRow.uid, revokedAtMs);

  if (schoolId) {
    await db
      .update(staffTeachers)
      .set({ passwordHash: nextHash, mustChangePassword: false })
      .where(
        and(
          eq(staffTeachers.schoolId, schoolId),
          or(
            userRow.staffId
              ? sql`lower(trim(COALESCE(${staffTeachers.staffId}, ''))) = ${userRow.staffId.toLowerCase()}`
              : sql`false`,
            sql`lower(trim(${staffTeachers.email})) = ${cleanEmail}`
          )
        )
      );
  }

  let schoolCode: string | null = null;
  if (schoolId) {
    const sch = await db
      .select({ schoolCode: schools.schoolCode })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    schoolCode = sch[0]?.schoolCode ?? null;
  }

  return {
    ...toProfile(updated[0], schoolCode),
    sessionValidAfterMs: revokedAtMs,
  };
}

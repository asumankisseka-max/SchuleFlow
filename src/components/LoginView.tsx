import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import type { CredentialSignInParams, RememberedAccountHint } from '../context/SchoolContext';
import type { PublicSchoolBranding } from '../types';
import { platformApi } from '../utils/apiClient';
import { buildSchoolThemeVars } from '../utils/schoolTheme';
import { AccountRecoveryModal } from './AccountRecoveryModal';

interface LoginViewProps {
  loading: boolean;
  error: string | null;
  recentAccounts: RememberedAccountHint[];
  onRemoveRecentAccount: (identifier: string, schoolId: string | null) => void;
  onCredentialSignIn: (params: CredentialSignInParams) => Promise<void>;
}

export function LoginView({
  loading,
  error,
  recentAccounts,
  onRemoveRecentAccount,
  onCredentialSignIn,
}: LoginViewProps) {
  const [loginMode, setLoginMode] = useState<'school' | 'super_admin'>('school');
  const [schoolCode, setSchoolCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('code') || '').trim().toUpperCase();
  });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const [matchedSchool, setMatchedSchool] = useState<PublicSchoolBranding | null>(null);
  const [schoolLookupState, setSchoolLookupState] = useState<
    'idle' | 'searching' | 'found' | 'not_found'
  >('idle');

  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const identifierInputRef = useRef<HTMLInputElement | null>(null);

  // Debounced single-school lookup by School Code (no all-schools listing exposed)
  useEffect(() => {
    if (loginMode !== 'school') {
      setMatchedSchool(null);
      setSchoolLookupState('idle');
      return;
    }

    const trimmed = schoolCode.trim().toUpperCase();
    if (trimmed.length < 4 || !trimmed.includes('-')) {
      setMatchedSchool(null);
      setSchoolLookupState('idle');
      return;
    }

    let active = true;
    setSchoolLookupState('searching');
    const timer = setTimeout(() => {
      platformApi
        .lookupSchoolByCode(trimmed)
        .then((res) => {
          if (!active) return;
          setMatchedSchool(res.school);
          setSchoolLookupState('found');
        })
        .catch(() => {
          if (!active) return;
          setMatchedSchool(null);
          setSchoolLookupState('not_found');
        });
    }, 280);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [schoolCode, loginMode]);

  const brandingStyle = useMemo(
    () =>
      loginMode === 'school' && matchedSchool
        ? buildSchoolThemeVars(matchedSchool.primaryColor, matchedSchool.secondaryColor)
        : undefined,
    [loginMode, matchedSchool]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    if (loginMode === 'school' && !schoolCode.trim()) return;

    await onCredentialSignIn({
      schoolCode: loginMode === 'school' ? schoolCode.trim().toUpperCase() : undefined,
      identifier: identifier.trim(),
      password,
      mode: loginMode,
      rememberMe,
    });
  };

  const handlePickRecentAccount = (account: RememberedAccountHint) => {
    const targetMode = account.mode === 'super_admin' ? 'super_admin' : 'school';
    setLoginMode(targetMode);
    setSchoolCode(targetMode === 'school' ? account.schoolCode ?? '' : '');
    setIdentifier(account.identifier);
    setPassword('');
    requestAnimationFrame(() => {
      passwordInputRef.current?.focus();
    });
  };

  const canSubmit =
    Boolean(identifier.trim()) &&
    Boolean(password) &&
    (loginMode === 'super_admin' || Boolean(schoolCode.trim()));

  return (
    <div
      style={brandingStyle}
      className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10 ${
        loginMode === 'school' && matchedSchool ? 'school-themed' : ''
      }`}
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center space-y-3">
          {loginMode === 'school' && matchedSchool?.logoUrl ? (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-white p-1.5 overflow-hidden"
              style={{ borderColor: 'var(--school-secondary, #b45309)' }}
            >
              <img
                src={matchedSchool.logoUrl}
                alt={`${matchedSchool.name} badge`}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-900 text-white">
              {loginMode === 'super_admin' ? (
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              ) : (
                <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
              )}
            </div>
          )}

          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {loginMode === 'super_admin'
                ? 'Platform Super Admin'
                : matchedSchool
                  ? matchedSchool.name
                  : 'SchuleFlow School Portal'}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              {loginMode === 'super_admin'
                ? 'Sign in to onboard schools and manage platform licensing'
                : matchedSchool
                  ? `${matchedSchool.district} · Verified School Code ${matchedSchool.schoolCode}`
                  : 'Enter your School Code, Staff ID or email, and personal password'}
            </p>
          </div>
        </div>

        <div
          className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5"
          style={
            loginMode === 'school' && matchedSchool
              ? { borderTopWidth: '3px', borderTopColor: 'var(--school-primary, #1e3a8a)' }
              : undefined
          }
        >
          {/* School Staff vs Platform Super Admin Switcher */}
          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              disabled={loading}
              onClick={() => setLoginMode('school')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md py-2 transition-colors ${
                loginMode === 'school'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>School Staff</span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setLoginMode('super_admin')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md py-2 transition-colors ${
                loginMode === 'super_admin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Super Admin</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {recentAccounts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Quick Sign In</span>
                </span>
                <span className="text-[11px] text-slate-400">Saved on this browser</span>
              </div>
              <div className="space-y-1.5">
                {recentAccounts.map((acc) => {
                  const isCurrent =
                    identifier.trim().toLowerCase() === acc.identifier.toLowerCase() &&
                    (acc.mode === 'super_admin'
                      ? loginMode === 'super_admin'
                      : loginMode === 'school' &&
                        schoolCode.trim().toUpperCase() === (acc.schoolCode ?? '').toUpperCase());
                  return (
                    <div
                      key={`${acc.schoolId ?? 'platform'}:${acc.identifier}`}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                        isCurrent
                          ? 'border-blue-800 bg-blue-50/70'
                          : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/80'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handlePickRecentAccount(acc)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="font-semibold text-slate-900 truncate">
                          {acc.name}{' '}
                          <span className="font-normal text-slate-500">· {acc.roleLabel}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate font-mono">
                          {acc.schoolCode ? `${acc.schoolCode} · ` : ''}
                          {acc.identifier} · {acc.schoolName}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => onRemoveRecentAccount(acc.identifier, acc.schoolId)}
                        title="Remove saved account from this browser"
                        aria-label={`Remove ${acc.name} from saved accounts`}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {loginMode === 'school' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-school-code"
                    className="block text-xs font-medium text-slate-700"
                  >
                    School Code *
                  </label>
                  {schoolLookupState === 'searching' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </span>
                  )}
                  {schoolLookupState === 'found' && matchedSchool && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      {matchedSchool.name}
                    </span>
                  )}
                  {schoolLookupState === 'not_found' && (
                    <span className="text-[11px] text-amber-700">Code not recognized</span>
                  )}
                </div>
                <div className="relative">
                  <KeyRound
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-school-code"
                    type="text"
                    required
                    disabled={loading}
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                    placeholder="e.g. KHHS-101"
                    autoComplete="organization"
                    className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 font-mono text-sm uppercase tracking-wider text-slate-900 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="login-identifier"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                {loginMode === 'super_admin'
                  ? 'Super Admin Email or Username *'
                  : 'Teacher / Staff ID or Email *'}
              </label>
              <input
                ref={identifierInputRef}
                id="login-identifier"
                type="text"
                autoComplete="username"
                required
                disabled={loading}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  loginMode === 'super_admin'
                    ? 'superadmin@schuleflow.ug'
                    : matchedSchool
                      ? `e.g. ${matchedSchool.schoolCode.split('-')[0]}-TCH-001 or staff email`
                      : 'e.g. KHHS-TCH-001 or staff@school.ac.ug'
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-slate-700"
                >
                  Personal Password *
                </label>
                {loginMode === 'school' && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setRecoveryOpen(true)}
                    className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                  >
                    Forgot login info?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  ref={passwordInputRef}
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your personal password"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                disabled={loading}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              <span>Keep me signed in on this device</span>
            </label>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60 transition-colors"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {loading
                  ? 'Signing in...'
                  : loginMode === 'super_admin'
                    ? 'Sign In to Platform Console'
                    : 'Sign In to School Workspace'}
              </span>
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500">
          SchuleFlow Uganda · Isolated multi-school workspace access
        </p>
      </div>

      <AccountRecoveryModal
        open={recoveryOpen}
        initialIdentifier={identifier}
        initialSchoolCode={schoolCode}
        onClose={() => setRecoveryOpen(false)}
        onRecoveredSignInHint={(recoveredIdentifier, recoveredSchoolCode) => {
          setLoginMode('school');
          if (recoveredSchoolCode) {
            setSchoolCode(recoveredSchoolCode);
          }
          setIdentifier(recoveredIdentifier);
          setPassword('');
          requestAnimationFrame(() => passwordInputRef.current?.focus());
        }}
      />
    </div>
  );
}

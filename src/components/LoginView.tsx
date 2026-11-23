import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
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
  errorCode?: string | null;
  recentAccounts: RememberedAccountHint[];
  onClearError: () => void;
  onRemoveRecentAccount: (identifier: string, schoolId: string | null) => void;
  onCredentialSignIn: (params: CredentialSignInParams) => Promise<boolean>;
}

type LoginStep = 'school' | 'identifier' | 'password';

export function LoginView({
  loading,
  error,
  errorCode,
  recentAccounts,
  onClearError,
  onRemoveRecentAccount,
  onCredentialSignIn,
}: LoginViewProps) {
  const [initialUrlCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('code') || '').trim().toUpperCase();
  });

  const [step, setStep] = useState<LoginStep>(initialUrlCode ? 'identifier' : 'school');
  const [schoolInput, setSchoolInput] = useState(initialUrlCode);
  const [schoolCode, setSchoolCode] = useState(initialUrlCode);
  const [disambiguateSchoolCode, setDisambiguateSchoolCode] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [lookingUpSchool, setLookingUpSchool] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [urlSchoolBranding, setUrlSchoolBranding] = useState<PublicSchoolBranding | null>(null);

  const schoolInputRef = useRef<HTMLInputElement | null>(null);
  const identifierInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate branding automatically when opened via ?code=SCHOOL-101 or picking a saved school account
  useEffect(() => {
    const trimmed = schoolCode.trim().toUpperCase();
    if (!trimmed || disambiguateSchoolCode) return;
    let active = true;
    platformApi
      .lookupSchoolByCode(trimmed)
      .then((res) => {
        if (active) setUrlSchoolBranding(res.school);
      })
      .catch(() => {
        if (active) {
          setUrlSchoolBranding(null);
          if (initialUrlCode && trimmed === initialUrlCode) {
            setSchoolCode('');
            setStep('school');
          }
        }
      });
    return () => {
      active = false;
    };
  }, [schoolCode, disambiguateSchoolCode, initialUrlCode]);

  // If the backend requires School ID (e.g. shared email across schools), prompt cleanly at password step
  useEffect(() => {
    if (errorCode === 'SCHOOL_CODE_REQUIRED') {
      setDisambiguateSchoolCode(true);
      setStep('password');
    }
  }, [errorCode]);

  const brandingStyle = useMemo(
    () =>
      urlSchoolBranding
        ? buildSchoolThemeVars(urlSchoolBranding.primaryColor, urlSchoolBranding.secondaryColor)
        : undefined,
    [urlSchoolBranding]
  );

  const displayError = localError || error;
  const isBusy = loading || lookingUpSchool;

  const handleSchoolStepContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = schoolInput.trim();
    if (!raw) return;

    onClearError();
    setLocalError(null);
    setDisambiguateSchoolCode(false);

    // Email input or superadmin username advances straight to password without enumerating
    if (raw.includes('@') || raw.toLowerCase() === 'superadmin') {
      setSchoolCode('');
      setUrlSchoolBranding(null);
      setIdentifier(raw.toLowerCase());
      setPassword('');
      setStep('password');
      requestAnimationFrame(() => passwordInputRef.current?.focus());
      return;
    }

    const candidateCode = raw.toUpperCase();
    setLookingUpSchool(true);
    try {
      const res = await platformApi.lookupSchoolByCode(candidateCode);
      setSchoolCode(res.school.schoolCode);
      setSchoolInput(res.school.schoolCode);
      setUrlSchoolBranding(res.school);
      setIdentifier('');
      setPassword('');
      setStep('identifier');
      requestAnimationFrame(() => identifierInputRef.current?.focus());
    } catch (err: unknown) {
      setUrlSchoolBranding(null);
      setSchoolCode('');
      setLocalError(
        err instanceof Error ? err.message : 'No registered school matches that School ID.'
      );
    } finally {
      setLookingUpSchool(false);
    }
  };

  const handleIdentifierContinue = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim();
    if (!cleanId) return;
    onClearError();
    setLocalError(null);
    if (
      cleanId.toLowerCase() === 'superadmin@schuleflow.ac.ug' ||
      cleanId.toLowerCase() === 'superadmin'
    ) {
      setSchoolCode('');
      setUrlSchoolBranding(null);
      setDisambiguateSchoolCode(false);
      setIdentifier(cleanId.toLowerCase());
    }
    setPassword('');
    setStep('password');
    requestAnimationFrame(() => passwordInputRef.current?.focus());
  };

  const handleChangeSchool = () => {
    onClearError();
    setLocalError(null);
    setPassword('');
    setIdentifier('');
    setSchoolCode('');
    setUrlSchoolBranding(null);
    setDisambiguateSchoolCode(false);
    setStep('school');
    requestAnimationFrame(() => schoolInputRef.current?.focus());
  };

  const handleChangeIdentifier = () => {
    onClearError();
    setLocalError(null);
    setPassword('');
    setDisambiguateSchoolCode(false);
    if (schoolCode.trim()) {
      setStep('identifier');
      requestAnimationFrame(() => identifierInputRef.current?.focus());
    } else {
      setSchoolCode('');
      setUrlSchoolBranding(null);
      setStep('school');
      requestAnimationFrame(() => schoolInputRef.current?.focus());
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim();
    if (!cleanId || !password) return;
    if (disambiguateSchoolCode && !schoolCode.trim()) return;

    setLocalError(null);
    const isSuperAdminId =
      cleanId.toLowerCase() === 'superadmin@schuleflow.ac.ug' ||
      cleanId.toLowerCase() === 'superadmin';
    const activeCode = isSuperAdminId ? '' : schoolCode.trim().toUpperCase();

    await onCredentialSignIn({
      ...(activeCode ? { schoolCode: activeCode } : {}),
      identifier: cleanId,
      password,
      rememberMe,
    });
  };

  const handlePickRecentAccount = (account: RememberedAccountHint) => {
    onClearError();
    setLocalError(null);
    setDisambiguateSchoolCode(false);
    const preferredCode = account.mode === 'school' ? (account.schoolCode ?? '') : '';
    const preferredId =
      account.mode === 'school'
        ? account.staffId || account.identifier
        : account.identifier;

    setSchoolCode(preferredCode);
    setSchoolInput(preferredCode || preferredId);
    setIdentifier(preferredId);
    setPassword('');
    if (!preferredCode) {
      setUrlSchoolBranding(null);
    }
    setStep('password');
    requestAnimationFrame(() => passwordInputRef.current?.focus());
  };

  const subtitleText =
    step === 'school'
      ? 'Enter your School ID first (or Super Admin email)'
      : step === 'identifier'
        ? 'Enter your short Staff ID (e.g. 001) to continue'
        : 'Enter your personal password to open your workspace';

  return (
    <div
      style={brandingStyle}
      className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10 ${
        urlSchoolBranding ? 'school-themed' : ''
      }`}
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center space-y-3">
          {urlSchoolBranding?.logoUrl ? (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-white p-1.5 overflow-hidden"
              style={{ borderColor: 'var(--school-secondary, #b45309)' }}
            >
              <img
                src={urlSchoolBranding.logoUrl}
                alt={`${urlSchoolBranding.name} badge`}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-900 text-white">
              <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
            </div>
          )}

          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {urlSchoolBranding ? urlSchoolBranding.name : 'Sign in to SchuleFlow'}
            </h1>
            <p className="text-sm text-slate-600 mt-1">{subtitleText}</p>
          </div>
        </div>

        <div
          className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5"
          style={
            urlSchoolBranding
              ? { borderTopWidth: '3px', borderTopColor: 'var(--school-primary, #1e3a8a)' }
              : undefined
          }
        >
          {displayError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{displayError}</span>
            </div>
          )}

          {step === 'school' && recentAccounts.length > 0 && (
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
                  const displayId = acc.staffId || acc.identifier;
                  return (
                    <div
                      key={`${acc.schoolId ?? 'platform'}:${acc.identifier}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-slate-100/80 px-3 py-2 text-xs transition-colors"
                    >
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handlePickRecentAccount(acc)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="font-semibold text-slate-900 truncate">
                          {acc.name}{' '}
                          <span className="font-normal text-slate-500">· {acc.roleLabel}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate font-mono">
                          {acc.schoolCode ? `${acc.schoolCode} · ID ${displayId}` : displayId} ·{' '}
                          {acc.schoolName}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
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

          {step === 'school' && (
            <form onSubmit={handleSchoolStepContinue} className="space-y-4">
              <div>
                <label
                  htmlFor="login-school-input"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  School ID
                </label>
                <div className="relative">
                  <Building2
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    ref={schoolInputRef}
                    id="login-school-input"
                    type="text"
                    autoComplete="organization"
                    autoFocus
                    required
                    disabled={isBusy}
                    value={schoolInput}
                    onChange={(e) => {
                      setLocalError(null);
                      setSchoolInput(e.target.value);
                    }}
                    placeholder="e.g. JIS-101"
                    className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Enter your registered School ID to unlock your school. Platform Super Admin may enter their email.
                </p>
              </div>

              <button
                type="submit"
                disabled={isBusy || !schoolInput.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60 transition-colors"
              >
                {lookingUpSchool ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{lookingUpSchool ? 'Checking School ID...' : 'Continue'}</span>
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setRecoveryOpen(true)}
                  className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                >
                  Forgot login info?
                </button>
              </div>
            </form>
          )}

          {step === 'identifier' && (
            <form onSubmit={handleIdentifierContinue} className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound className="h-3.5 w-3.5 text-blue-800 shrink-0" aria-hidden="true" />
                  <span className="font-mono font-semibold text-slate-900 shrink-0">
                    {schoolCode}
                  </span>
                  {urlSchoolBranding && (
                    <span className="text-slate-500 truncate">· {urlSchoolBranding.name}</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleChangeSchool}
                  className="inline-flex items-center gap-1 font-semibold text-blue-800 hover:text-blue-950 shrink-0"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Change</span>
                </button>
              </div>

              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Your Staff ID
                </label>
                <input
                  ref={identifierInputRef}
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  disabled={isBusy}
                  value={identifier}
                  onChange={(e) => {
                    setLocalError(null);
                    setIdentifier(e.target.value);
                  }}
                  placeholder="e.g. 001"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm tracking-wider text-slate-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Enter your short 3-digit Staff ID (e.g. 001, 002) — or your school email.
                </p>
              </div>

              <button
                type="submit"
                disabled={isBusy || !identifier.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60 transition-colors"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setRecoveryOpen(true)}
                  className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                >
                  Forgot login info?
                </button>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-mono text-slate-800 truncate">
                  {schoolCode ? `${schoolCode} · ID ${identifier.trim()}` : identifier.trim()}
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleChangeIdentifier}
                  className="inline-flex items-center gap-1 font-semibold text-blue-800 hover:text-blue-950 shrink-0"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Change</span>
                </button>
              </div>

              {disambiguateSchoolCode && (
                <div>
                  <label
                    htmlFor="login-school-code"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    School ID *
                  </label>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="login-school-code"
                      type="text"
                      required
                      disabled={isBusy}
                      value={schoolCode}
                      onChange={(e) => {
                        setLocalError(null);
                        onClearError();
                        setSchoolCode(e.target.value.toUpperCase());
                      }}
                      placeholder="e.g. JIS-101"
                      autoComplete="organization"
                      className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 font-mono text-sm uppercase tracking-wider text-slate-900 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Personal Password
                  </label>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setRecoveryOpen(true)}
                    className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={passwordInputRef}
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoFocus
                    required
                    disabled={isBusy}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
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
                  disabled={isBusy}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                <span>Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                disabled={
                  isBusy || !password || (disambiguateSchoolCode && !schoolCode.trim())
                }
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60 transition-colors"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-500">
          SchuleFlow Uganda · Automatic role-isolated workspace access
        </p>
      </div>

      <AccountRecoveryModal
        open={recoveryOpen}
        initialIdentifier={identifier}
        initialSchoolCode={schoolCode}
        onClose={() => setRecoveryOpen(false)}
        onRecoveredSignInHint={(recoveredIdentifier, recoveredSchoolCode) => {
          onClearError();
          setLocalError(null);
          setSchoolCode(recoveredSchoolCode ?? '');
          setSchoolInput(recoveredSchoolCode ?? recoveredIdentifier);
          setDisambiguateSchoolCode(false);
          setIdentifier(recoveredIdentifier);
          setPassword('');
          setStep('password');
          requestAnimationFrame(() => passwordInputRef.current?.focus());
        }}
      />
    </div>
  );
}

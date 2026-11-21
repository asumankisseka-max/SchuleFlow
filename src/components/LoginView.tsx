import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
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

export function LoginView({
  loading,
  error,
  errorCode,
  recentAccounts,
  onClearError,
  onRemoveRecentAccount,
  onCredentialSignIn,
}: LoginViewProps) {
  const [step, setStep] = useState<'identifier' | 'password'>('identifier');
  const [schoolCode, setSchoolCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('code') || '').trim().toUpperCase();
  });
  const [disambiguateSchoolCode, setDisambiguateSchoolCode] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const [urlSchoolBranding, setUrlSchoolBranding] = useState<PublicSchoolBranding | null>(null);

  const identifierInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Optional branding only when opened via an explicit ?code=SCHOOL-101 link
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
        if (active) setUrlSchoolBranding(null);
      });
    return () => {
      active = false;
    };
  }, [schoolCode, disambiguateSchoolCode]);

  // If the backend detects the same credentials exist in multiple workspaces after password check,
  // switch to School Code disambiguation without ever enumerating before password verification.
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

  const handleIdentifierContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    onClearError();
    setStep('password');
    requestAnimationFrame(() => {
      passwordInputRef.current?.focus();
    });
  };

  const handleChangeIdentifier = () => {
    onClearError();
    setPassword('');
    setSchoolCode('');
    setUrlSchoolBranding(null);
    setDisambiguateSchoolCode(false);
    setStep('identifier');
    requestAnimationFrame(() => {
      identifierInputRef.current?.focus();
    });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    if (disambiguateSchoolCode && !schoolCode.trim()) return;

    await onCredentialSignIn({
      ...(disambiguateSchoolCode && schoolCode.trim()
        ? { schoolCode: schoolCode.trim().toUpperCase() }
        : {}),
      identifier: identifier.trim(),
      password,
      rememberMe,
    });
  };

  const handlePickRecentAccount = (account: RememberedAccountHint) => {
    onClearError();
    setIdentifier(account.identifier);
    setSchoolCode('');
    setDisambiguateSchoolCode(false);
    setPassword('');
    setStep('password');
    requestAnimationFrame(() => {
      passwordInputRef.current?.focus();
    });
  };

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
            <p className="text-sm text-slate-600 mt-1">
              {step === 'identifier'
                ? 'Enter your Staff ID, email, username, or phone to continue'
                : 'Enter your personal password to open your workspace'}
            </p>
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
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {step === 'identifier' && recentAccounts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Quick Sign In</span>
                </span>
                <span className="text-[11px] text-slate-400">Saved on this browser</span>
              </div>
              <div className="space-y-1.5">
                {recentAccounts.map((acc) => (
                  <div
                    key={`${acc.schoolId ?? 'platform'}:${acc.identifier}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-slate-100/80 px-3 py-2 text-xs transition-colors"
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
                ))}
              </div>
            </div>
          )}

          {step === 'identifier' ? (
            <form onSubmit={handleIdentifierContinue} className="space-y-4">
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Staff ID, Email, Username, or Phone
                </label>
                <input
                  ref={identifierInputRef}
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  disabled={loading}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. KHHS-TCH-001 or user@school.ac.ug"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !identifier.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60 transition-colors"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setRecoveryOpen(true)}
                  className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                >
                  Forgot login info?
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-mono text-slate-800 truncate">{identifier.trim()}</span>
                <button
                  type="button"
                  disabled={loading}
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
                    School Code *
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
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Personal Password
                  </label>
                  <button
                    type="button"
                    disabled={loading}
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
                    disabled={loading}
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
                  disabled={loading}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                <span>Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                disabled={
                  loading || !password || (disambiguateSchoolCode && !schoolCode.trim())
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
          setSchoolCode(recoveredSchoolCode ?? '');
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

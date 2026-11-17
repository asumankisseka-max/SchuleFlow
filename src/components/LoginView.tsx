import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  UserCheck,
  X,
} from 'lucide-react';
import type { RememberedAccountHint } from '../context/SchoolContext';
import type { PublicSchoolBranding } from '../types';
import { platformApi } from '../utils/apiClient';
import { buildSchoolThemeVars } from '../utils/schoolTheme';
import { AccountRecoveryModal } from './AccountRecoveryModal';

interface LoginViewProps {
  loading: boolean;
  error: string | null;
  recentAccounts: RememberedAccountHint[];
  onRemoveRecentAccount: (identifier: string, schoolId: string | null) => void;
  onCredentialSignIn: (
    identifier: string,
    password: string,
    options?: { schoolId?: string; rememberMe?: boolean }
  ) => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
}

export function LoginView({
  loading,
  error,
  recentAccounts,
  onRemoveRecentAccount,
  onCredentialSignIn,
  onGoogleSignIn,
}: LoginViewProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [schoolCatalog, setSchoolCatalog] = useState<PublicSchoolBranding[]>([]);

  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const identifierInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    platformApi
      .listPublicSchoolBranding()
      .then((res) => {
        if (!active) return;
        setSchoolCatalog(res.schools);
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const querySchool = params.get('school')?.trim().toLowerCase();
          if (querySchool) {
            const matched = res.schools.find(
              (s) =>
                s.subdomain.toLowerCase() === querySchool ||
                s.id.toLowerCase() === querySchool
            );
            if (matched) {
              setSelectedSchoolId(matched.id);
            }
          }
        }
      })
      .catch(() => {
        // Login still works smoothly with auto-detection even if school list fails to load
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedSchool = useMemo(
    () => schoolCatalog.find((s) => s.id === selectedSchoolId) ?? null,
    [schoolCatalog, selectedSchoolId]
  );

  const brandingStyle = useMemo(
    () =>
      selectedSchool
        ? buildSchoolThemeVars(selectedSchool.primaryColor, selectedSchool.secondaryColor)
        : undefined,
    [selectedSchool]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    await onCredentialSignIn(identifier.trim(), password, {
      schoolId: selectedSchoolId || undefined,
      rememberMe,
    });
  };

  const handlePickRecentAccount = (account: RememberedAccountHint) => {
    setIdentifier(account.identifier);
    setSelectedSchoolId(account.schoolId ?? '');
    setPassword('');
    requestAnimationFrame(() => {
      passwordInputRef.current?.focus();
    });
  };

  return (
    <div
      style={brandingStyle}
      className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10 ${
        selectedSchool ? 'school-themed' : ''
      }`}
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center space-y-3">
          {selectedSchool?.logoUrl ? (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 bg-white p-1.5 overflow-hidden"
              style={{ borderColor: 'var(--school-secondary, #b45309)' }}
            >
              <img
                src={selectedSchool.logoUrl}
                alt={`${selectedSchool.name} badge`}
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
              {selectedSchool ? selectedSchool.name : 'Welcome to SchuleFlow Portal'}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              {selectedSchool
                ? `${selectedSchool.district} · Sign in to your school workspace`
                : 'Sign in with your email, phone number, username, or Google account'}
            </p>
          </div>
        </div>

        <div
          className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5"
          style={
            selectedSchool
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
                    (selectedSchoolId || null) === acc.schoolId;
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
                        <div className="text-[11px] text-slate-500 truncate">
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
            {schoolCatalog.length > 0 && (
              <div>
                <label
                  htmlFor="login-school"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  School <span className="text-slate-400 font-normal">(optional · preview &amp; quick username sign-in)</span>
                </label>
                <div className="relative">
                  <Building2
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <select
                    id="login-school"
                    disabled={loading}
                    value={selectedSchoolId}
                    onChange={(e) => {
                      setSelectedSchoolId(e.target.value);
                      identifierInputRef.current?.focus();
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
                  >
                    <option value="">Auto-detect school from email or phone</option>
                    {schoolCatalog.map((sch) => (
                      <option key={sch.id} value={sch.id}>
                        {sch.name} · {sch.district}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="login-identifier"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                {selectedSchool
                  ? 'Username, Phone Number, or Email'
                  : 'Email Address, Phone Number, or Username'}
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
                  selectedSchool
                    ? `e.g. admin, dos, 0772110401, or name@${selectedSchool.subdomain}.ac.ug`
                    : 'name@school.ac.ug, 0772110401, or username'
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
                  Password
                </label>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setRecoveryOpen(true)}
                  className="text-xs font-medium text-blue-800 hover:text-blue-950 hover:underline"
                >
                  Forgot login info?
                </button>
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
              disabled={loading || !identifier.trim() || !password}
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

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="mx-3 shrink text-[11px] font-medium uppercase tracking-wider text-slate-400">
              or
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={onGoogleSignIn}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-60 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Continue with Institutional Google Account</span>
          </button>
        </div>

        <p className="text-center text-xs text-slate-500">
          SchuleFlow Uganda · Authorized institutional access only
        </p>
      </div>

      <AccountRecoveryModal
        open={recoveryOpen}
        initialIdentifier={identifier}
        onClose={() => setRecoveryOpen(false)}
        onRecoveredSignInHint={(recoveredIdentifier) => {
          setIdentifier(recoveredIdentifier);
          setPassword('');
          requestAnimationFrame(() => passwordInputRef.current?.focus());
        }}
      />
    </div>
  );
}

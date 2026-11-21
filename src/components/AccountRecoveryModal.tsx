import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { platformApi } from '../utils/apiClient';

interface AccountRecoveryModalProps {
  open: boolean;
  initialIdentifier?: string;
  initialSchoolCode?: string;
  onClose: () => void;
  onRecoveredSignInHint: (identifier: string, schoolCode?: string | null) => void;
}

type RecoveryStep = 'locate' | 'verify' | 'result';
type LocateMode = 'identifier' | 'name_school';

export function AccountRecoveryModal({
  open,
  initialIdentifier = '',
  initialSchoolCode = '',
  onClose,
  onRecoveredSignInHint,
}: AccountRecoveryModalProps) {
  const [step, setStep] = useState<RecoveryStep>('locate');
  const [locateMode, setLocateMode] = useState<LocateMode>('identifier');
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [schoolCodeInput, setSchoolCodeInput] = useState(initialSchoolCode);
  const [fullName, setFullName] = useState('');

  const [lookupData, setLookupData] = useState<{
    recoveryToken: string;
    lookupMethod: 'identifier' | 'name_school';
    maskedEmail: string;
    maskedPhone: string | null;
    maskedUsername: string | null;
    maskedStaffId: string | null;
    schoolName: string;
    schoolContactPhone: string | null;
    schoolContactEmail: string | null;
    roleLabel: string;
    hasPhone: boolean;
  } | null>(null);

  const [verification, setVerification] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [recoveredAccount, setRecoveredAccount] = useState<{
    name: string;
    staffId: string | null;
    schoolCode: string | null;
    email: string;
    username: string;
    phone: string | null;
    schoolId: string | null;
    schoolName: string;
    roleLabel: string;
  } | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [adminHelpSent, setAdminHelpSent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('locate');
    setLocateMode('identifier');
    setIdentifier(initialIdentifier);
    setSchoolCodeInput(initialSchoolCode);
    setFullName('');
    setLookupData(null);
    setVerification('');
    setResetToken('');
    setRecoveredAccount(null);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordUpdated(false);
    setAdminHelpSent(false);
    setError(null);
  }, [open, initialIdentifier, initialSchoolCode]);

  if (!open) return null;

  const handleLocateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const cleanCode = schoolCodeInput.trim().toUpperCase();
      const res = await platformApi.recoveryLookup(
        locateMode === 'identifier'
          ? {
              identifier: identifier.trim(),
              ...(cleanCode ? { schoolCode: cleanCode } : {}),
            }
          : { schoolCode: cleanCode, fullName: fullName.trim() }
      );
      setLookupData(res);
      setVerification('');
      setAdminHelpSent(false);
      setStep('verify');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to find matching account.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupData) return;
    setError(null);
    setLoading(true);
    try {
      const res = await platformApi.recoveryVerify(lookupData.recoveryToken, verification.trim());
      setResetToken(res.resetToken);
      setRecoveredAccount(res.account);
      setStep('result');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAdminHelp = async () => {
    if (!lookupData) return;
    setError(null);
    setLoading(true);
    try {
      await platformApi.recoveryRequestAdmin(
        lookupData.recoveryToken,
        'User unable to self-verify login details'
      );
      setAdminHelpSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not log recovery request.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedPwd = newPassword.trim();
    if (trimmedPwd.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Za-z]/.test(trimmedPwd) || !/[0-9]/.test(trimmedPwd)) {
      setError('New password must include at least one letter and one number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Password confirmation does not match.');
      return;
    }
    setLoading(true);
    try {
      await platformApi.recoveryResetPassword(resetToken, newPassword.trim());
      setPasswordUpdated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white overflow-hidden shadow-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-blue-900" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Recover Login Information
              </h3>
              <p className="text-[11px] text-slate-500">
                {step === 'locate'
                  ? 'Step 1 of 3 · Find your institutional account'
                  : step === 'verify'
                    ? 'Step 2 of 3 · Verify your identity'
                    : 'Step 3 of 3 · Recovered login details & password reset'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200"
            aria-label="Close recovery modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === 'locate' && (
            <form onSubmit={handleLocateSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setLocateMode('identifier');
                  }}
                  className={`rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors ${
                    locateMode === 'identifier'
                      ? 'bg-white text-blue-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By Staff ID / Email / Phone
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setLocateMode('name_school');
                  }}
                  className={`rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors ${
                    locateMode === 'name_school'
                      ? 'bg-white text-blue-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By Name &amp; School Code
                </button>
              </div>

              {locateMode === 'identifier' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      School Code <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      disabled={loading}
                      value={schoolCodeInput}
                      onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase())}
                      placeholder="e.g. KHHS-101"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Staff ID, Email, Phone, or Username *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={loading}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. KHHS-TCH-001, name@school.ac.ug, or 0772110401"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Forgot your Staff ID and email? Switch to{' '}
                      <strong>By Name &amp; School Code</strong> above.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      School Code *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={loading}
                      value={schoolCodeInput}
                      onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase())}
                      placeholder="e.g. KHHS-101"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Your Registered Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={loading}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Bernard Ssebunya"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  <span>Find Account</span>
                </button>
              </div>
            </form>
          )}

          {step === 'verify' && lookupData && (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-blue-800" />
                  <span>Account Located</span>
                </div>
                <div className="text-slate-700">
                  {lookupData.schoolName} · <strong>{lookupData.roleLabel}</strong>
                </div>
                <div className="grid grid-cols-1 gap-1 pt-1 font-mono text-[11px] text-slate-600">
                  {lookupData.maskedStaffId && <div>Staff ID: {lookupData.maskedStaffId}</div>}
                  <div>Email: {lookupData.maskedEmail}</div>
                  {lookupData.maskedPhone && <div>Phone: {lookupData.maskedPhone}</div>}
                  {lookupData.maskedUsername && <div>Username: {lookupData.maskedUsername}</div>}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">
                  Confirm your Registered Phone Number, Staff ID, or Email
                </label>
                <input
                  type="text"
                  required
                  disabled={loading}
                  value={verification}
                  onChange={(e) => setVerification(e.target.value)}
                  placeholder="e.g. 0772110401, KHHS-TCH-001, or your registered email"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
                />
              </div>

              {(lookupData.schoolContactPhone || lookupData.schoolContactEmail) && (
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="flex items-start gap-2 text-slate-600">
                    <HelpCircle className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-slate-800">Cannot remember?</span> Contact{' '}
                      {lookupData.schoolName}:{' '}
                      <span className="font-mono">
                        {[lookupData.schoolContactPhone, lookupData.schoolContactEmail]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                  {adminHelpSent ? (
                    <div className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Recovery request logged for administrator assistance.</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleRequestAdminHelp}
                      className="text-[11px] font-semibold text-blue-800 hover:underline"
                    >
                      Log an administrator recovery request
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setError(null);
                    setStep('locate');
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !verification.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  <span>Verify &amp; Unlock Details</span>
                </button>
              </div>
            </form>
          )}

          {step === 'result' && recoveredAccount && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>Recovered Login Information</span>
                </div>
                <div className="text-slate-800 font-medium">
                  {recoveredAccount.name} · {recoveredAccount.roleLabel}
                </div>
                <div className="text-[11px] text-slate-600">
                  {recoveredAccount.schoolName}
                  {recoveredAccount.schoolCode ? (
                    <span className="ml-1.5 font-mono font-semibold text-slate-800">
                      ({recoveredAccount.schoolCode})
                    </span>
                  ) : null}
                </div>
                <div className="pt-1 space-y-1 font-mono text-[11px] text-slate-900">
                  {recoveredAccount.staffId && (
                    <div className="flex items-center gap-1.5 font-semibold text-blue-950">
                      <BadgeCheck className="h-3.5 w-3.5 text-blue-700" />
                      <span>Staff ID: {recoveredAccount.staffId}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-slate-500" />
                    <span>Email: {recoveredAccount.email}</span>
                  </div>
                  {recoveredAccount.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-500" />
                      <span>Phone: {recoveredAccount.phone}</span>
                    </div>
                  )}
                  <div className="text-slate-700">Username: {recoveredAccount.username}</div>
                </div>
              </div>

              {passwordUpdated ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <span>Password Updated Successfully</span>
                  </div>
                  <p className="text-[11px]">
                    You can now sign in with your Staff ID or email and your new password.
                  </p>
                </div>
              ) : (
                <form onSubmit={handlePasswordReset} className="space-y-3 border-t border-slate-200 pt-3">
                  <div className="font-semibold text-slate-900">
                    Reset Forgotten Password (Optional)
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      New Password (min 8 chars, letter &amp; number)
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        minLength={8}
                        required
                        disabled={loading}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="w-full rounded-md border border-slate-300 pl-3 pr-9 py-2 text-slate-900 focus:border-blue-800 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Confirm New Password
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      minLength={8}
                      required
                      disabled={loading}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !newPassword || !confirmPassword}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-900 bg-blue-50 px-4 py-2 font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Save New Password</span>
                  </button>
                </form>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    onRecoveredSignInHint(
                      recoveredAccount.staffId || recoveredAccount.email,
                      recoveredAccount.schoolCode
                    );
                    onClose();
                  }}
                  className="rounded-md bg-blue-900 px-4 py-2 font-semibold text-white hover:bg-blue-950"
                >
                  Use Details to Sign In
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

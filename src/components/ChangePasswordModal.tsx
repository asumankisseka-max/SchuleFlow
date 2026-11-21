import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { AuthSessionProfile } from '../types';
import { platformApi } from '../utils/apiClient';

interface ChangePasswordModalProps {
  open: boolean;
  required?: boolean;
  userEmail: string;
  userName: string;
  onClose?: () => void;
  onLogout?: () => void;
  onPasswordChanged: (token: string, updatedUser: AuthSessionProfile) => void;
}

export function ChangePasswordModal({
  open,
  required = false,
  userEmail,
  userName,
  onClose,
  onLogout,
  onPasswordChanged,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setError(null);
    setSuccess(false);
  }, [open]);

  if (!open) return null;

  const validateClientStrength = (pwd: string): string | null => {
    const trimmed = pwd.trim();
    if (trimmed.length < 8) {
      return 'New password must be at least 8 characters long.';
    }
    if (!/[A-Za-z]/.test(trimmed) || !/[0-9]/.test(trimmed)) {
      return 'New password must include at least one letter and one number.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const strengthErr = validateClientStrength(newPassword);
    if (strengthErr) {
      setError(strengthErr);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (currentPassword.trim() === newPassword.trim()) {
      setError('New password must differ from your current temporary password.');
      return;
    }

    setLoading(true);
    try {
      const res = await platformApi.changePassword(currentPassword, newPassword.trim());
      setSuccess(true);
      onPasswordChanged(res.token, res.user);
      if (!required && onClose) {
        setTimeout(() => onClose(), 900);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5 min-w-0">
            {required ? (
              <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0" />
            ) : (
              <KeyRound className="h-5 w-5 text-blue-900 shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-display text-sm font-bold text-slate-900 truncate">
                {required ? 'Set Your Personal Password' : 'Change Account Password'}
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                {userName} · {userEmail}
              </p>
            </div>
          </div>

          {!required && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {required && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-900 leading-relaxed">
              Your account is using a temporary or newly issued password. Set a personal password
              before entering the school workspace.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
              <span>Personal password updated successfully.</span>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Current / Temporary Password *
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              required
              disabled={loading || success}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              New Personal Password (min 8 chars, letter &amp; number) *
            </label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                minLength={8}
                required
                disabled={loading || success}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="e.g. Kampala2026!"
                className="w-full rounded-md border border-slate-300 pl-3 pr-9 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
              >
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Confirm New Password *
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              minLength={8}
              required
              disabled={loading || success}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
            {required && onLogout ? (
              <button
                type="button"
                disabled={loading}
                onClick={onLogout}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={onClose}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}

            <button
              type="submit"
              disabled={loading || success || !currentPassword || !newPassword || !confirmPassword}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-2 font-semibold text-white hover:bg-blue-950 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{required ? 'Save & Continue' : 'Update Password'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

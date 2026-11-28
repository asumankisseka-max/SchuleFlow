import { AlertTriangle, CloudOff, Loader2, RefreshCw, WifiOff, X } from 'lucide-react';
import type { OfflineSyncConflict } from '../lib/offlineSync';

interface OfflineSyncBannerProps {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflicts: OfflineSyncConflict[];
  onSyncNow: () => void;
  onDismissConflicts: () => void;
}

export function OfflineSyncBanner({
  isOnline,
  isSyncing,
  pendingCount,
  conflicts,
  onSyncNow,
  onDismissConflicts,
}: OfflineSyncBannerProps) {
  if (isOnline && !isSyncing && pendingCount === 0 && conflicts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 no-print">
      {(!isOnline || isSyncing || pendingCount > 0) && (
        <div
          className={`rounded-md border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 ${
            !isOnline
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 min-w-0">
            {!isOnline ? (
              <WifiOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            ) : isSyncing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-800" aria-hidden="true" />
            ) : (
              <CloudOff className="h-4 w-4 shrink-0 text-blue-800" aria-hidden="true" />
            )}
            <span className="font-medium">
              {!isOnline
                ? pendingCount > 0
                  ? `Offline mode active — ${pendingCount} pending change${pendingCount === 1 ? '' : 's'} saved safely on this device and will sync automatically when reconnected.`
                  : 'Offline mode active — you can view cached school records and save marksheets locally; changes sync automatically on reconnection.'
                : isSyncing
                  ? `Reconnected — syncing ${pendingCount} offline change${pendingCount === 1 ? '' : 's'} to school database...`
                  : `${pendingCount} offline change${pendingCount === 1 ? '' : 's'} waiting to synchronize.`}
            </span>
          </div>

          {isOnline && pendingCount > 0 && !isSyncing && (
            <button
              type="button"
              onClick={onSyncNow}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 transition-colors shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Sync Now
            </button>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-700 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">
                {conflicts.length} offline change{conflicts.length === 1 ? ' could not' : 's could not'} be applied during sync (server kept newer/locked record):
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-red-800">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.label}:</span> {c.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissConflicts}
            className="p-1 text-red-600 hover:text-red-900 shrink-0"
            aria-label="Dismiss sync notices"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (isInstalled) {
    return null;
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={() => void handleInstall()}
        title={compact ? 'Install App for Offline Use' : undefined}
        aria-label="Install App"
        className={`flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-900 hover:bg-blue-100 transition-colors whitespace-nowrap min-h-[36px] ${
          compact ? 'w-10 h-9 p-0' : 'w-full px-3 py-1.5'
        }`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {!compact && <span>Install App</span>}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title={compact ? 'Install App on iOS' : undefined}
          aria-label="Install on iOS"
          className={`flex items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-900 hover:bg-blue-100 transition-colors whitespace-nowrap min-h-[36px] ${
            compact ? 'w-10 h-9 p-0' : 'w-full px-3 py-1.5'
          }`}
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {!compact && <span>Install App</span>}
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-lg">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-900">Install SchuleFlow Offline</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                  aria-label="Close instructions"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="space-y-2 text-xs text-slate-700 list-decimal pl-4">
                <li>
                  Tap the <Share className="inline h-3.5 w-3.5 text-blue-800 mx-0.5" /> Share icon in Safari.
                </li>
                <li>
                  Scroll down and select <span className="font-semibold">Add to Home Screen</span>.
                </li>
                <li>Tap Add to run SchuleFlow offline anytime.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-md bg-blue-900 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

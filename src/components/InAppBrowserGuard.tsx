import React, { useState, useEffect } from 'react';
import { ExternalLink, Copy, Check, Compass } from 'lucide-react';
import { MemorizLogo } from './MemorizLogo';

const SESSION_DISMISS_KEY = 'silenon_inapp_guard_dismissed_v1';

export interface InAppBrowserDetection {
  isInApp: boolean;
  isAndroid: boolean;
  isIOS: boolean;
}

export function detectInAppBrowser(customUA?: string): InAppBrowserDetection {
  if (typeof navigator === 'undefined' && !customUA) {
    return { isInApp: false, isAndroid: false, isIOS: false };
  }

  const ua = customUA ?? navigator.userAgent ?? '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  const inAppRegex =
    /Instagram|FBAN|FBAV|FB_IAB|BytedanceWebview|musical_ly|TikTok|Line\/|Snapchat|LinkedInApp|; wv\)|\bwv\b/i;

  const isInApp = inAppRegex.test(ua);

  return {
    isInApp,
    isAndroid,
    isIOS,
  };
}

export const InAppBrowserGuard: React.FC = () => {
  const [detection] = useState<InAppBrowserDetection>(() => detectInAppBrowser());
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!detection.isInApp) return;
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      // Ignore storage access errors in restricted webviews
    }
  }, [detection.isInApp]);

  if (!detection.isInApp || dismissed) {
    return null;
  }

  const currentUrl =
    typeof window !== 'undefined' ? window.location.href : 'https://silenon.app';

  const androidBrowserIntentUrl =
    typeof window !== 'undefined'
      ? `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`
      : currentUrl;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setCopiedLink(false);
    }
  };

  const handleContinueAnyway = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch {
      // Ignore sessionStorage errors
    }
    setDismissed(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inapp-browser-guard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/95 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border p-6 sm:p-7 shadow-2xl text-center space-y-5 my-auto">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-accent-subtle border border-accent-subtle-border flex items-center justify-center text-accent shadow-xs">
            <MemorizLogo className="w-10 h-10" />
          </div>

          <div className="space-y-1.5">
            <h2
              id="inapp-browser-guard-title"
              className="text-lg sm:text-xl font-bold text-primary"
            >
              Abra o Silenon no seu navegador
            </h2>
            <p className="text-xs sm:text-sm text-secondary leading-relaxed">
              Você abriu este link dentro de outro aplicativo. O login com a Conta Google e o uso do microfone não funcionam dentro de outros aplicativos.
            </p>
          </div>
        </div>

        {detection.isAndroid ? (
          <div className="space-y-3 pt-1">
            <a
              href={androidBrowserIntentUrl}
              className="w-full py-3 px-4 rounded-xl theme-btn-accent text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span>Abrir no navegador</span>
            </a>

            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="w-full py-2.5 px-4 rounded-xl theme-btn-secondary border border-border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success shrink-0" />
                  <span className="text-success font-semibold">Link copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Copiar link</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-3.5 pt-1">
            <div className="p-3.5 rounded-xl bg-surface-subtle border border-border text-left flex items-start gap-2.5">
              <Compass className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p className="text-xs text-primary leading-relaxed font-medium">
                Toque nos três pontinhos (⋯) ou no ícone de compartilhar e escolha{' '}
                <strong className="font-bold text-accent">
                  &ldquo;Abrir no navegador / Safari&rdquo;
                </strong>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="w-full py-3 px-4 rounded-xl theme-btn-accent text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Link copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>Copiar link</span>
                </>
              )}
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleContinueAnyway}
            className="text-xs text-muted hover:text-secondary transition-colors underline underline-offset-4 cursor-pointer py-1"
          >
            Continuar mesmo assim (sem login Google)
          </button>
        </div>
      </div>
    </div>
  );
};

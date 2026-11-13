import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const SHOW_TIPS_STORAGE_KEY = 'memoriz_show_tips_v1';
const TIPS_CHANGED_EVENT = 'memoriz:tips-preference-changed';

export function getShowTipsPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SHOW_TIPS_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function setShowTipsPreference(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHOW_TIPS_STORAGE_KEY, show ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent<boolean>(TIPS_CHANGED_EVENT, { detail: show }));
  } catch {
    // Ignore storage quota / privacy errors
  }
}

export function useTipsPreference() {
  const [showTips, setShowTipsState] = useState<boolean>(() => getShowTipsPreference());

  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === 'boolean') {
        setShowTipsState(customEvent.detail);
      } else {
        setShowTipsState(getShowTipsPreference());
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SHOW_TIPS_STORAGE_KEY) {
        setShowTipsState(getShowTipsPreference());
      }
    };

    window.addEventListener(TIPS_CHANGED_EVENT, handleCustomChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(TIPS_CHANGED_EVENT, handleCustomChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setShowTips = (next: boolean) => {
    setShowTipsState(next);
    setShowTipsPreference(next);
  };

  return { showTips, setShowTips };
}

interface DisableTipsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DisableTipsModal: React.FC<DisableTipsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen || typeof document === 'undefined') return null;

  const handleDisable = () => {
    setShowTipsPreference(false);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1250] flex items-center justify-center p-4 bg-overlay/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface theme-bg-surface border border-border theme-border shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disable-tips-modal-title"
      >
        <h3
          id="disable-tips-modal-title"
          className="text-base sm:text-lg font-bold text-primary theme-text-primary text-center leading-snug"
        >
          As dicas do Silenon ficaram chatas? Você pode desativar isso!
        </h3>

        <div className="grid grid-cols-2 gap-3 w-full pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-secondary theme-text-secondary bg-surface-subtle hover:bg-surface-hover border border-border theme-border transition-colors cursor-pointer"
          >
            Manter por enquanto
          </button>
          <button
            type="button"
            onClick={handleDisable}
            className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold theme-btn-accent transition-all shadow-sm cursor-pointer"
          >
            Desativar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

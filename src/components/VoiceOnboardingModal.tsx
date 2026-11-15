import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Mic, X, AlertCircle } from 'lucide-react';
import { setVoiceOnboardingDone } from '../lib/aiOrchestrator';

interface VoiceOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthorized: () => void;
}

export const VoiceOnboardingModal: React.FC<VoiceOnboardingModalProps> = ({
  isOpen,
  onClose,
  onAuthorized,
}) => {
  const [isRequesting, setIsRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRequestPermissions = async () => {
    setIsRequesting(true);
    setErrorMessage(null);

    try {
      // Request real microphone permission via getUserMedia
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
      ) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release the hardware stream tracks immediately so SpeechRecognition can bind cleanly
        stream.getTracks().forEach(track => track.stop());
      }

      // 3. Mark onboarding as completed and start listening immediately
      setVoiceOnboardingDone(true);
      onAuthorized();
    } catch (err: any) {
      console.warn('[VoiceOnboarding] Microphone permission error:', err);
      setErrorMessage(
        'Não foi possível acessar o microfone. Verifique as permissões do navegador ou continue usando o modo de voz/texto.'
      );
      // Even if getUserMedia was blocked in an iframe, allow user to proceed if SpeechRecognition is available
      setVoiceOnboardingDone(true);
      onAuthorized();
    } finally {
      setIsRequesting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 330, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg theme-card bg-surface border border-border rounded-2xl p-6 sm:p-7 shadow-2xl space-y-5 my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 pr-6">
          <div className="w-12 h-12 rounded-2xl bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
            <Mic className="w-6 h-6" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-lg sm:text-xl font-bold text-primary theme-text-primary leading-snug">
              <span className="block">Está com dificuldades?</span>
              <span className="block">Sem pressa! Aqui você tem voz!</span>
            </h3>
          </div>
        </div>

        {/* Explanation Body */}
        <div className="p-4 rounded-xl bg-surface-subtle border border-border">
          <p className="text-sm text-primary theme-text-primary leading-relaxed font-medium">
            É simples: você lê e comenta sobre qualquer questão em voz alta, transcrevemos sua fala e analisamos seus principais pontos fracos em evidência para te guiar no caminho certo!
          </p>
        </div>

        {/* Call to Action below the container */}
        <div className="space-y-1">
          <p className="text-xs sm:text-sm font-semibold text-accent leading-snug">
            <span className="block">Use o Quat e permita que analisemos suas dificuldades!</span>
            <span className="block">Como você faria essa questão?</span>
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary border border-border text-xs font-medium transition-colors cursor-pointer"
          >
            Agora não
          </button>

          <button
            type="button"
            onClick={handleRequestPermissions}
            disabled={isRequesting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl theme-btn-accent font-semibold text-xs sm:text-sm transition-all cursor-pointer shadow-sm disabled:opacity-50"
          >
            <Mic className="w-4 h-4" />
            <span>
              {isRequesting ? 'Solicitando acesso...' : 'Permitir Microfone e Voz'}
            </span>
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, Eye, EyeOff, X, Check, KeyRound } from 'lucide-react';
import { GeminiIcon, GroqIcon } from './icons/BrandIcons';
import { getAIKeys, saveAIKeys, getAccumulatedTokens } from '../lib/aiOrchestrator';

export const GEMINI_TUTORIAL_URL = 'https://youtu.be/7bgWVbZUxfI?si=gel7UMme_8bElyV8';
export const GROQ_TUTORIAL_URL = 'https://youtu.be/LTIpLOe57iU?si=0cGMLfFZK_oGfFuu';

interface BYOKModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  tutorialUrl?: string;
}

export const BYOKModal: React.FC<BYOKModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  tutorialUrl = GEMINI_TUTORIAL_URL,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [accumulatedTokens, setAccumulatedTokens] = useState(0);
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const current = getAIKeys();
      setGeminiApiKey(current.geminiApiKey);
      setGroqApiKey(current.groqApiKey);
      setAccumulatedTokens(getAccumulatedTokens());
      setSavedFeedback(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasGemini = geminiApiKey.trim().length > 0;
  const hasGroq = groqApiKey.trim().length > 0;
  const canSaveBothKeys = hasGemini && hasGroq;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSaveBothKeys) return;
    saveAIKeys({
      geminiApiKey: geminiApiKey.trim(),
      groqApiKey: groqApiKey.trim(),
    });
    setSavedFeedback(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 180);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl theme-card bg-surface border border-border rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 my-auto"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header section */}
            <div className="text-center space-y-2 max-w-xl mx-auto pt-1">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-primary theme-text-primary">
                Traga a sua chave!
              </h2>

              <p className="text-sm sm:text-base font-medium text-secondary theme-text-secondary leading-relaxed">
                Use a Inteligência Artificial para lhe ajudar na reta final para a prova do Enem 2026.
              </p>

              <p className="text-xs text-muted theme-text-muted leading-relaxed">
                É rápido, fácil e vantajoso, você só precisa ter mais de 18 anos e assistir a esse tutorial
              </p>
            </div>

            {/* Interactive Side-by-Side Cards for Gemini & Groq */}
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Google Gemini Card */}
                <motion.div
                  initial={{ opacity: 0, x: -28, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.06 }}
                  className="relative rounded-xl border border-border bg-surface-subtle p-4 flex flex-col justify-between gap-4 hover:border-border-hover transition-colors"
                >
                  {/* Top Row: Floating Icon + Brand Name + ExternalLink to API Key Console */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                        className="w-11 h-11 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 shadow-xs"
                      >
                        <GeminiIcon className="w-6 h-6" />
                      </motion.div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-primary theme-text-primary">
                            Google Gemini
                          </h3>
                          {geminiApiKey.trim().length > 10 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-bg text-success font-semibold">
                              Ativa
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted">
                          Chat Global &amp; Triagem (gemini-3.5-flash-lite)
                        </p>
                      </div>
                    </div>

                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-surface hover:bg-surface-hover text-secondary hover:text-accent border border-border transition-colors shrink-0 cursor-pointer"
                      title="Gerar chave gratuita no Google AI Studio"
                      aria-label="Gerar chave gratuita no Google AI Studio"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  {/* Key Input */}
                  <div className="space-y-1.5">
                    <label htmlFor="gemini-api-key-input" className="block text-[11px] font-medium text-secondary">
                      Chave Gemini API
                    </label>
                    <div className="relative">
                      <input
                        id="gemini-api-key-input"
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="Cole sua chave AIzaSy..."
                        autoComplete="off"
                        className="w-full pr-9 pl-3 py-2 text-xs font-mono rounded-lg theme-input bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(prev => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors cursor-pointer"
                        title={showGeminiKey ? 'Ocultar chave' : 'Mostrar chave'}
                      >
                        {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* Groq Card */}
                <motion.div
                  initial={{ opacity: 0, x: 28, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.12 }}
                  className="relative rounded-xl border border-border bg-surface-subtle p-4 flex flex-col justify-between gap-4 hover:border-border-hover transition-colors"
                >
                  {/* Top Row: Floating Icon + Brand Name + ExternalLink to Groq Console */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }}
                        className="w-11 h-11 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 text-primary shadow-xs"
                      >
                        <GroqIcon className="w-6 h-6" />
                      </motion.div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-primary theme-text-primary">
                            Groq Cloud
                          </h3>
                          {groqApiKey.trim().length > 10 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-bg text-success font-semibold">
                              Ativa
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted">
                          Raciocínio Socrático Ultra-Rápido
                        </p>
                      </div>
                    </div>

                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-surface hover:bg-surface-hover text-secondary hover:text-accent border border-border transition-colors shrink-0 cursor-pointer"
                      title="Gerar chave gratuita no Groq Console"
                      aria-label="Gerar chave gratuita no Groq Console"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  {/* Key Input */}
                  <div className="space-y-1.5">
                    <label htmlFor="groq-api-key-input" className="block text-[11px] font-medium text-secondary">
                      Chave Groq API
                    </label>
                    <div className="relative">
                      <input
                        id="groq-api-key-input"
                        type={showGroqKey ? 'text' : 'password'}
                        value={groqApiKey}
                        onChange={(e) => setGroqApiKey(e.target.value)}
                        placeholder="Cole sua chave gsk_..."
                        autoComplete="off"
                        className="w-full pr-9 pl-3 py-2 text-xs font-mono rounded-lg theme-input bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey(prev => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors cursor-pointer"
                        title={showGroqKey ? 'Ocultar chave' : 'Mostrar chave'}
                      >
                        {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Token usage info bar & Dual-Key Requirement Notice */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-surface-subtle border border-border text-xs text-muted">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>
                    {!canSaveBothKeys
                      ? !hasGemini && !hasGroq
                        ? 'Preencha as duas chaves (Gemini e Groq) para habilitar o salvamento.'
                        : !hasGemini
                          ? 'Falta preencher a chave do Google Gemini para trabalhar junto com a Groq.'
                          : 'Falta preencher a chave da Groq para trabalhar junto com o Google Gemini.'
                      : 'As duas chaves estão prontas e ficam salvas apenas no seu navegador.'}
                  </span>
                </div>
                {accumulatedTokens > 0 && (
                  <span className="font-mono text-[11px] text-secondary font-semibold">
                    {accumulatedTokens.toLocaleString('pt-BR')} tokens processados
                  </span>
                )}
              </div>

              {/* Bottom Actions: Tutorial Buttons + Save */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-border">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={tutorialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
                    title="Assistir tutorial da chave Gemini no YouTube"
                  >
                    <GeminiIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>Tutorial Gemini</span>
                    <ExternalLink className="w-3.5 h-3.5 text-muted shrink-0" />
                  </a>
                  <a
                    href={GROQ_TUTORIAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
                    title="Assistir tutorial da chave Groq no YouTube"
                  >
                    <GroqIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>Tutorial Groq</span>
                    <ExternalLink className="w-3.5 h-3.5 text-muted shrink-0" />
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={!canSaveBothKeys}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl theme-btn-accent font-semibold text-xs sm:text-sm transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  <span>{savedFeedback ? 'Salvo!' : 'Salvar'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

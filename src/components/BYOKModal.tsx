import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ExternalLink,
  Eye,
  EyeOff,
  X,
  Check,
  KeyRound,
  Lock,
  Unlock,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { GeminiIcon, GroqIcon } from './icons/BrandIcons';
import { getAIKeys, saveAIKeys, getAccumulatedTokens } from '../lib/aiOrchestrator';
import {
  auth,
  FirebaseUser,
  saveEncryptedKeysToFirestore,
  loadEncryptedKeysFromFirestore,
  EncryptedKeysCloudPayload,
} from '../lib/firebase';
import {
  encryptKeysWithPin,
  decryptKeysWithPin,
  isValidFourDigitPin,
} from '../lib/cryptoVault';

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

  // Cloud Encrypted Vault State (4-digit numeric PIN)
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [cloudVault, setCloudVault] = useState<EncryptedKeysCloudPayload | null>(null);
  const [isCheckingVault, setIsCheckingVault] = useState(false);
  const [isUnlockPanelOpen, setIsUnlockPanelOpen] = useState(false);
  const [unlockPin, setUnlockPin] = useState('');
  const [savePin, setSavePin] = useState('');
  const [isVaultBusy, setIsVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultSuccess, setVaultSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const current = getAIKeys();
    setGeminiApiKey(current.geminiApiKey);
    setGroqApiKey(current.groqApiKey);
    setAccumulatedTokens(getAccumulatedTokens());
    setSavedFeedback(false);
    setUnlockPin('');
    setSavePin('');
    setVaultError(null);
    setVaultSuccess(null);

    const activeUser = auth.currentUser;
    setGoogleUser(activeUser);

    if (activeUser) {
      let mounted = true;
      setIsCheckingVault(true);
      loadEncryptedKeysFromFirestore(activeUser.uid)
        .then((vault) => {
          if (!mounted) return;
          setCloudVault(vault);
          const hasBothLocal =
            current.geminiApiKey.trim().length > 0 && current.groqApiKey.trim().length > 0;
          if (vault && !hasBothLocal) {
            setIsUnlockPanelOpen(true);
          } else {
            setIsUnlockPanelOpen(false);
          }
        })
        .catch(() => {
          if (mounted) setCloudVault(null);
        })
        .finally(() => {
          if (mounted) setIsCheckingVault(false);
        });
      return () => {
        mounted = false;
      };
    } else {
      setCloudVault(null);
      setIsUnlockPanelOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasGemini = geminiApiKey.trim().length > 0;
  const hasGroq = groqApiKey.trim().length > 0;
  const canSaveBothKeys = hasGemini && hasGroq;

  const handleUnlockVault = async () => {
    if (!cloudVault) return;
    if (!isValidFourDigitPin(unlockPin)) {
      setVaultError('Digite os 4 dígitos numéricos do seu PIN.');
      return;
    }

    setIsVaultBusy(true);
    setVaultError(null);
    setVaultSuccess(null);

    try {
      const decrypted = await decryptKeysWithPin(cloudVault, unlockPin);
      setGeminiApiKey(decrypted.geminiApiKey);
      setGroqApiKey(decrypted.groqApiKey);
      saveAIKeys(decrypted);
      setVaultSuccess('Chaves restauradas com sucesso do cofre da sua Conta Google!');
      setIsUnlockPanelOpen(false);
      setUnlockPin('');
      if (onSaved) onSaved();
      setTimeout(() => {
        onClose();
      }, 650);
    } catch (err: unknown) {
      setVaultError(
        err instanceof Error ? err.message : 'PIN incorreto ou falha ao descriptografar o cofre.'
      );
    } finally {
      setIsVaultBusy(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSaveBothKeys || isVaultBusy) return;

    const cleanPin = savePin.trim();
    if (cleanPin.length > 0 && !isValidFourDigitPin(cleanPin)) {
      setVaultError(
        'O PIN do cofre precisa ter exatamente 4 dígitos numéricos (ou deixe em branco para salvar apenas neste navegador).'
      );
      return;
    }

    setVaultError(null);
    setVaultSuccess(null);

    const cleanKeys = {
      geminiApiKey: geminiApiKey.trim(),
      groqApiKey: groqApiKey.trim(),
    };

    saveAIKeys(cleanKeys);

    if (googleUser && isValidFourDigitPin(cleanPin)) {
      setIsVaultBusy(true);
      try {
        const encryptedBlob = await encryptKeysWithPin(cleanKeys, cleanPin);
        await saveEncryptedKeysToFirestore(googleUser.uid, encryptedBlob);
        setVaultSuccess('Chaves salvas localmente e protegidas com PIN na sua Conta Google!');
      } catch (err: unknown) {
        setVaultError(
          err instanceof Error
            ? err.message
            : 'Chaves salvas localmente, mas falhou ao sincronizar o cofre na nuvem.'
        );
        setIsVaultBusy(false);
        return;
      }
      setIsVaultBusy(false);
    }

    setSavedFeedback(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      onClose();
    }, 220);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-canvas/80 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl theme-card bg-surface border border-border rounded-2xl p-6 sm:p-8 shadow-2xl space-y-5 my-auto"
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

            {/* Cloud Vault Feedback Alerts */}
            {vaultError && (
              <div className="p-3 rounded-xl bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{vaultError}</span>
              </div>
            )}

            {vaultSuccess && (
              <div className="p-3 rounded-xl bg-success-bg border border-success-border text-success text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{vaultSuccess}</span>
              </div>
            )}

            {/* Cloud Encrypted Vault Restore Banner (when user has encrypted_keys in Google Account) */}
            {googleUser && cloudVault && (
              <div className="rounded-xl border border-accent/40 bg-accent-subtle p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-accent text-accent-contrast shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xs sm:text-sm font-bold text-primary">
                        Cofre Protegido na sua Conta Google
                      </h3>
                      <p className="text-[11px] text-secondary leading-snug">
                        {isUnlockPanelOpen
                          ? 'Digite seu PIN numérico de 4 dígitos para restaurar suas chaves de acesso neste aparelho.'
                          : 'Suas chaves de acesso gratuitas (Google e Groq) estão salvas com PIN na nuvem.'}
                      </p>
                    </div>
                  </div>

                  {!isUnlockPanelOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setVaultError(null);
                        setIsUnlockPanelOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs font-semibold text-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                    >
                      <Unlock className="w-3.5 h-3.5 text-accent" />
                      <span>Restaurar com PIN</span>
                    </button>
                  )}
                </div>

                {isUnlockPanelOpen && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    <input
                      id="unlock-vault-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={unlockPin}
                      onChange={(e) => {
                        setVaultError(null);
                        setUnlockPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleUnlockVault();
                        }
                      }}
                      placeholder="PIN de 4 dígitos (••••)"
                      autoFocus={!canSaveBothKeys}
                      className="flex-1 px-3 py-2 rounded-lg theme-input bg-surface border border-border text-xs font-mono tracking-widest text-center sm:text-left text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      disabled={unlockPin.length !== 4 || isVaultBusy}
                      onClick={() => void handleUnlockVault()}
                      className="px-4 py-2 rounded-lg theme-btn-accent text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {isVaultBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                      <span>Restaurar Chaves</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Interactive Side-by-Side Cards for Gemini & Groq */}
            <form onSubmit={handleSave} className="space-y-5">
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
                      Chave de acesso gratuita (Google)
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
                      Chave de acesso gratuita (Groq)
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

              {/* 4-Digit PIN Cloud Vault Save Section (when logged in with Google) */}
              {googleUser && canSaveBothKeys && (
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-primary">
                          Salvar no Cofre da Conta Google (PIN de 4 dígitos)
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface border border-border text-muted">
                          Protegido com PIN
                        </span>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5 leading-snug">
                        {cloudVault
                          ? 'Digite um PIN de 4 dígitos para atualizar seu cofre na nuvem (ou deixe vazio para salvar só neste aparelho).'
                          : 'Defina um PIN numérico de 4 dígitos para recuperar suas chaves em qualquer outro aparelho.'}
                      </p>
                    </div>
                  </div>

                  <div className="w-full sm:w-44 shrink-0">
                    <input
                      id="save-vault-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={savePin}
                      onChange={(e) => {
                        setVaultError(null);
                        setSavePin(e.target.value.replace(/\D/g, '').slice(0, 4));
                      }}
                      placeholder="PIN 4 dígitos"
                      aria-label="PIN de 4 dígitos para criptografar chaves na nuvem"
                      className="w-full px-3 py-2 text-xs font-mono tracking-widest text-center rounded-lg theme-input bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}

              {/* Token usage info bar & Dual-Key Requirement Notice */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-surface-subtle border border-border text-xs text-muted">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>
                    {isCheckingVault
                      ? 'Verificando cofre criptografado na Conta Google...'
                      : !canSaveBothKeys
                        ? !hasGemini && !hasGroq
                          ? 'Preencha as duas chaves (Gemini e Groq) para habilitar o salvamento.'
                          : !hasGemini
                            ? 'Falta preencher a chave do Google Gemini para trabalhar junto com a Groq.'
                            : 'Falta preencher a chave da Groq para trabalhar junto com o Google Gemini.'
                        : savePin.length === 4 && googleUser
                          ? 'As duas chaves serão salvas no navegador e criptografadas com seu PIN na nuvem.'
                          : 'As duas chaves estão prontas e ficam salvas no seu navegador.'}
                  </span>
                </div>
                {accumulatedTokens > 0 && (
                  <span className="text-[11px] text-secondary font-semibold">
                    Chaves de acesso gratuitas (Google e Groq) • Progresso salvo no aparelho
                  </span>
                )}
              </div>

              {/* Bottom Actions: Tutorial Buttons + Save */}
              <div className="flex flex-col gap-3 pt-2 border-t border-border">
                <div className="grid grid-cols-2 gap-3 w-full">
                  <a
                    href={tutorialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium text-center transition-colors cursor-pointer"
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
                    className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium text-center transition-colors cursor-pointer"
                    title="Assistir tutorial da chave Groq no YouTube"
                  >
                    <GroqIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>Tutorial Groq</span>
                    <ExternalLink className="w-3.5 h-3.5 text-muted shrink-0" />
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={!canSaveBothKeys || isVaultBusy}
                  className="w-full flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl theme-btn-accent font-semibold text-xs sm:text-sm transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isVaultBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>
                    {savedFeedback
                      ? 'Salvo!'
                      : savePin.length === 4 && googleUser
                        ? 'Salvar + Cofre PIN'
                        : 'Salvar'}
                  </span>
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

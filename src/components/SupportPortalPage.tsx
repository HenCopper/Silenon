import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Star,
  Bug,
  MessageSquare,
  Send,
  CheckCircle2,
  ArrowLeft,
  ExternalLink,
  Sun,
  Moon,
  BookOpen,
  Flame,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ThemeMode } from '../types/question';
import { MemorizLogo } from './MemorizLogo';

export const OFFICIAL_INSTAGRAM_URL =
  (import.meta as any).env?.VITE_OFFICIAL_INSTAGRAM_URL || 'https://www.instagram.com/silenon.app/';

type ReportActionType = 'rating' | 'bug' | 'contact' | null;

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; icon: React.ReactNode }> = [
  { id: 'light', label: 'Claro', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dark', label: 'Escuro', icon: <Moon className="w-3.5 h-3.5" /> },
  { id: 'reading', label: 'Leitura', icon: <BookOpen className="w-3.5 h-3.5" /> },
  { id: 'night', label: 'Noturno', icon: <Flame className="w-3.5 h-3.5" /> },
];

function readSavedTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'night';
  try {
    const raw =
      localStorage.getItem('memoriz_prefs_v1') ||
      localStorage.getItem('memoriz_prefs') ||
      localStorage.getItem('memoriz_theme');
    if (raw) {
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed?.theme) {
          const t = parsed.theme;
          if (t === 'amber') return 'night';
          if (t === 'sepia') return 'reading';
          if (t === 'light' || t === 'dark' || t === 'reading' || t === 'night') return t;
        }
      } else {
        if (raw === 'amber') return 'night';
        if (raw === 'sepia') return 'reading';
        if (raw === 'light' || raw === 'dark' || raw === 'reading' || raw === 'night') return raw;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return 'night';
}

function applyAndSaveTheme(nextTheme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const htmlEl = document.documentElement;
  htmlEl.setAttribute('data-theme', nextTheme);
  if (nextTheme === 'dark') {
    htmlEl.classList.add('dark');
  } else {
    htmlEl.classList.remove('dark');
  }

  try {
    const raw = localStorage.getItem('memoriz_prefs_v1');
    let prefsObj: Record<string, any> = {};
    if (raw && raw.startsWith('{')) {
      prefsObj = JSON.parse(raw) || {};
    }
    prefsObj.theme = nextTheme;
    localStorage.setItem('memoriz_prefs_v1', JSON.stringify(prefsObj));
  } catch {
    // Ignore storage write errors
  }
}

export const SupportPortalPage: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => readSavedTheme());
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState<boolean>(false);
  const [activeAction, setActiveAction] = useState<ReportActionType>(null);

  // Form states
  const [rating, setRating] = useState<number>(5);
  const [subject, setSubject] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [contactInfo, setContactInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    applyAndSaveTheme(theme);
    const preloader = document.getElementById('app-preloader');
    if (preloader) {
      preloader.remove();
    }
  }, [theme]);

  useEffect(() => {
    if (!isThemeMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isThemeMenuOpen]);

  const handleSelectAction = (action: ReportActionType) => {
    setActiveAction(action);
    setSubmitSuccess(false);
    setSubmitError(null);
    setSubject('');
    setMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAction || isSubmitting) return;

    if (activeAction !== 'rating' && !message.trim()) {
      setSubmitError('Por favor, descreva sua mensagem antes de enviar.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: activeAction,
          rating: activeAction === 'rating' ? rating : undefined,
          subject: subject.trim(),
          message: message.trim(),
          contactInfo: contactInfo.trim(),
          theme,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Falha no envio (HTTP ${response.status}).`);
      }

      setSubmitSuccess(true);
      setSubject('');
      setMessage('');
    } catch (err: any) {
      setSubmitError(err?.message || 'Não foi possível enviar no momento. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100vh] min-h-[100dvh] w-full bg-canvas theme-bg-canvas text-primary theme-text-primary flex flex-col justify-between p-4 sm:p-6 relative select-none">
      {/* Top Bar with Brand & Top-Right Gear Theme Switcher */}
      <header className="w-full max-w-2xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <MemorizLogo size={32} />
          <div>
            <h1 className="text-base sm:text-lg font-bold leading-none text-primary">
              Silenon
            </h1>
            <p className="text-[11px] text-muted mt-0.5">Simples no silício</p>
          </div>
        </div>

        {/* Gear Theme Switcher in Top-Right Corner */}
        <div className="relative" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setIsThemeMenuOpen((prev) => !prev)}
            className="p-2.5 rounded-xl bg-surface hover:bg-surface-hover border border-border text-secondary hover:text-primary transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 text-xs font-medium"
            title="Alternar tema visual"
            aria-label="Configurações de tema"
          >
            <Settings className="w-4 h-4 text-accent" />
            <span className="hidden sm:inline">Tema</span>
          </button>

          {isThemeMenuOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-surface border border-border shadow-xl p-1.5 z-50 space-y-1">
              {THEME_OPTIONS.map((opt) => {
                const isActive = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setTheme(opt.id);
                      setIsThemeMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-accent text-accent-contrast font-semibold'
                        : 'text-secondary hover:text-primary hover:bg-surface-hover'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {opt.icon}
                      <span>{opt.label}</span>
                    </span>
                    {isActive && <span className="text-[10px]">●</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* Central Content Area */}
      <main className="w-full max-w-lg mx-auto my-auto py-8">
        <div className="theme-card rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-lg space-y-6">
          {!activeAction ? (
            <>
              <div className="text-center space-y-1.5">
                <h2 className="text-lg sm:text-xl font-bold text-primary">
                  Central de Feedback &amp; Contato
                </h2>
                <p className="text-xs sm:text-sm text-secondary">
                  Escolha uma opção abaixo para enviar sua avaliação, relatar um problema técnico ou falar diretamente com o desenvolvedor.
                </p>
              </div>

              {/* 3 Main Action Buttons */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => handleSelectAction('rating')}
                  className="w-full p-4 rounded-xl border border-border bg-surface-subtle hover:bg-surface-hover hover:border-accent transition-all flex items-center gap-3.5 text-left cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
                    <Star className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                      Avaliar
                    </div>
                    <div className="text-xs text-muted">
                      Deixe sua nota e conte como o Silenon está ajudando nos estudos
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAction('bug')}
                  className="w-full p-4 rounded-xl border border-border bg-surface-subtle hover:bg-surface-hover hover:border-accent transition-all flex items-center gap-3.5 text-left cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
                    <Bug className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                      Reportar erro
                    </div>
                    <div className="text-xs text-muted">
                      Relate falhas visuais, questões com problema ou comportamento inesperado
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectAction('contact')}
                  className="w-full p-4 rounded-xl border border-border bg-surface-subtle hover:bg-surface-hover hover:border-accent transition-all flex items-center gap-3.5 text-left cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-primary group-hover:text-accent transition-colors">
                      Contatar o desenvolvedor
                    </div>
                    <div className="text-xs text-muted">
                      Envie sugestões, parcerias ou dúvidas diretamente ao criador
                    </div>
                  </div>
                </button>
              </div>

              {/* Official Social Network Button */}
              <div className="pt-3 border-t border-border">
                <a
                  href={OFFICIAL_INSTAGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl border border-border bg-surface hover:bg-surface-hover text-secondary hover:text-primary text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>Rede Social Oficial (@silenon.app)</span>
                  <ExternalLink className="w-3.5 h-3.5 text-accent" />
                </a>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                <button
                  type="button"
                  onClick={() => handleSelectAction(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-primary cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar</span>
                </button>
                <span className="text-xs font-bold text-accent uppercase tracking-wider">
                  {activeAction === 'rating'
                    ? 'Avaliar o Silenon'
                    : activeAction === 'bug'
                    ? 'Reportar Erro'
                    : 'Contatar o Desenvolvedor'}
                </span>
              </div>

              {submitSuccess ? (
                <div className="py-6 text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
                  <h3 className="text-base font-bold text-primary">
                    Mensagem enviada com sucesso!
                  </h3>
                  <p className="text-xs text-secondary max-w-xs mx-auto leading-relaxed">
                    Obrigado por contribuir com o Silenon. Seu registro foi recebido.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectAction(null)}
                    className="mt-2 px-4 py-2 rounded-xl theme-btn-accent text-xs font-semibold cursor-pointer"
                  >
                    Voltar ao início
                  </button>
                </div>
              ) : (
                <>
                  {activeAction === 'rating' && (
                    <div className="space-y-2 text-center">
                      <label className="block text-xs font-semibold text-secondary">
                        Qual a sua nota para o Silenon?
                      </label>
                      <div className="flex items-center justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            className={`p-2 rounded-xl border transition-all cursor-pointer ${
                              star <= rating
                                ? 'bg-accent-subtle border-accent text-accent scale-105'
                                : 'bg-surface-subtle border-border text-muted hover:text-secondary'
                            }`}
                            aria-label={`${star} estrelas`}
                          >
                            <Star
                              className={`w-5 h-5 ${star <= rating ? 'fill-current' : ''}`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeAction !== 'rating' && (
                    <div>
                      <label className="block text-xs font-semibold text-secondary mb-1">
                        {activeAction === 'bug' ? 'Onde ocorreu o erro?' : 'Assunto'}
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={
                          activeAction === 'bug'
                            ? 'Ex: Imagem na questão 42, importação de ZIP, etc.'
                            : 'Ex: Sugestão de funcionalidade, dúvida, parceria...'
                        }
                        className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl theme-input bg-surface-subtle border border-border text-primary focus:outline-hidden focus:border-accent"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-secondary mb-1">
                      {activeAction === 'rating'
                        ? 'Comentário (opcional)'
                        : activeAction === 'bug'
                        ? 'Descrição detalhada do erro *'
                        : 'Sua mensagem *'}
                    </label>
                    <textarea
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={
                        activeAction === 'rating'
                          ? 'Conte o que você mais gosta ou o que podemos melhorar...'
                          : activeAction === 'bug'
                          ? 'Descreva o que aconteceu e como reproduzir o problema...'
                          : 'Escreva sua mensagem para o desenvolvedor...'
                      }
                      className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl theme-input bg-surface-subtle border border-border text-primary focus:outline-hidden focus:border-accent resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-secondary mb-1">
                      Seu contato (e-mail ou rede social — opcional)
                    </label>
                    <input
                      type="text"
                      value={contactInfo}
                      onChange={(e) => setContactInfo(e.target.value)}
                      placeholder="Ex: seu@email.com ou @seuusuario"
                      className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl theme-input bg-surface-subtle border border-border text-primary focus:outline-hidden focus:border-accent"
                    />
                  </div>

                  {submitError && (
                    <div className="p-3 rounded-xl bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 rounded-xl theme-btn-accent text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Enviar</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-2xl mx-auto text-center text-[11px] text-muted py-2">
        Silenon — Simples no silício
      </footer>
    </div>
  );
};

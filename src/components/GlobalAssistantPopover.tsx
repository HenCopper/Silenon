import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  X,
  KeyRound,
  Sparkles,
  Send,
  Mic,
  MicOff,
  Loader2,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Square,
  Target,
  ShieldCheck,
  ChevronsUp,
  Paperclip,
  Trash2,
  Pencil,
} from 'lucide-react';
import { Question, UserAnswerRecord, UserStatistics } from '../types/question';
import { GeminiIcon } from './icons/BrandIcons';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DraggableModeSwitcher, SwitcherTabItem } from './DraggableModeSwitcher';
import { LiveSwitch } from './ui/LiveSwitch';
import {
  getAccumulatedTokens,
  syncQuatTokensFromThreads,
  LEARNING_IMPROVEMENT_TOKEN_GOAL,
  formatRelativeTime,
  formatMessageTimestampPrefix,
  generateLearningImprovementDiagnosis,
  getSavedLearningDiagnosis,
  LearningDiagnosisResult,
  runGlobalChat,
  extractFlatAnswers,
  getHighModelsQuotaState,
  setHighModelsEnabled,
  HighModelsQuotaState,
  HIGH_MODELS_DAILY_TOTAL_QUOTA,
  HIGH_GEMINI_MODEL_4_HYDROGEN,
  HIGH_GEMINI_MODEL_38,
  HIGH_GEMINI_MODEL_36,
  DEFAULT_GEMINI_MODEL,
  getOrchestratorDebugSnapshot,
  clearOrchestratorDebugLogs,
  recordOrchestratorRuntimeError,
  generateDynamicStriveSuggestions,
  getCachedStriveSuggestions,
  StriveGeneratedGraph,
  extractGraphMarkersFromText,
  generateAndValidateStriveGraphSVG,
  sanitizeTextForSpeech,
  notifyQuatNativeAudioDialog,
  AIAttachmentPayload,
  mapToStudentFriendlyError,
} from '../lib/aiOrchestrator';
import {
  getUnanalyzedQuestionThreads,
  getAllQuestionThreads,
  markQuestionThreadsAnalyzed,
  QuestionChatThreadRecord,
} from '../lib/questionChatStorage';

interface GlobalAssistantPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBYOKModal: () => void;
  stats: UserStatistics;
  answers: Record<number, UserAnswerRecord[]> | UserAnswerRecord[];
  questions: Question[];
  currentQuestion?: Question | null;
  pendingQuote?: { text: string; timestamp: number } | null;
  onConsumePendingQuote?: () => void;
}

interface PendingAttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  previewUrl?: string;
}

interface GlobalChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  modelUsed?: string;
  generatedGraphs?: Record<string, StriveGeneratedGraph>;
}

const GLOBAL_CHAT_STORAGE_KEY = 'memoriz_global_chat_history_v1';
const ENEM_SECOND_DAY_START_MS = new Date('2026-11-15T13:00:00-03:00').getTime();

export const GlobalAssistantPopover: React.FC<GlobalAssistantPopoverProps> = ({
  isOpen,
  onClose,
  onOpenBYOKModal,
  stats,
  answers,
  questions,
  currentQuestion,
  pendingQuote,
  onConsumePendingQuote,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'diagnosis' | 'improve'>('chat');
  const [accumulatedTokens, setAccumulatedTokens] = useState<number>(0);
  const [unanalyzedThreads, setUnanalyzedThreads] = useState<QuestionChatThreadRecord[]>([]);
  const [allThreads, setAllThreads] = useState<QuestionChatThreadRecord[]>([]);
  const [diagnosis, setDiagnosis] = useState<LearningDiagnosisResult | null>(() =>
    getSavedLearningDiagnosis()
  );
  const [isGeneratingDiagnosis, setIsGeneratingDiagnosis] = useState<boolean>(false);

  // High-capacity models quota state (40 RPD: 20 x 3.8 Flash + 20 x 3.6 Flash, enabled by default until 0/40)
  const [highQuota, setHighQuota] = useState<HighModelsQuotaState>(() =>
    getHighModelsQuotaState()
  );
  const [isLiquidPopoverOpen, setIsLiquidPopoverOpen] = useState<boolean>(false);

  // Hidden Session Debug Panel state (toggled exclusively via keyboard shortcut)
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState<boolean>(false);
  const [debugRefreshTick, setDebugRefreshTick] = useState<number>(0);
  const [copiedDebugReport, setCopiedDebugReport] = useState<boolean>(false);

  // Chat states
  const [chatMessages, setChatMessages] = useState<GlobalChatMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(GLOBAL_CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore
    }
    return [];
  });
  const [inputText, setInputText] = useState<string>('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentItem[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState<string>('');
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const [visibleChatCount, setVisibleChatCount] = useState<number>(30);
  const [isSendingChat, setIsSendingChat] = useState<boolean>(false);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [rpmStatusNotice, setRpmStatusNotice] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [striveSuggestions, setStriveSuggestions] = useState<string[]>(() =>
    getCachedStriveSuggestions(answers)
  );

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScrollRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const confirmedTextRef = useRef<string>('');
  const sessionBaseConfirmedRef = useRef<string>('');
  const sessionLatestTranscriptRef = useRef<string>('');
  const lastFinalIndexRef = useRef<number>(-1);
  const voiceRestartTimerRef = useRef<number | null>(null);
  const liquidPopoverRef = useRef<HTMLDivElement | null>(null);
  const liquidPopoverMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef<number>(0);
  const spokenAudioCacheRef = useRef<Map<string, { audioBase64: string; mimeType: string }>>(
    new Map()
  );
  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const speakingAbortIdRef = useRef<string | null>(null);
  const dragControls = useDragControls();

  const stopVoiceListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    if (voiceRestartTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setIsListeningVoice(false);
  }, []);

  useEffect(() => {
    return () => {
      stopVoiceListening();
    };
  }, [stopVoiceListening]);

  // Pre-fill input when user clicks "Perguntar ao Strive" on a text selection
  useEffect(() => {
    if (!pendingQuote || !pendingQuote.text) return;
    setActiveTab('chat');
    const cleanQuote = pendingQuote.text.replace(/\s+/g, ' ').trim();
    const formattedQuote = `“${cleanQuote}” — `;
    confirmedTextRef.current = formattedQuote;
    sessionBaseConfirmedRef.current = formattedQuote;
    sessionLatestTranscriptRef.current = '';
    setInputText(formattedQuote);
    onConsumePendingQuote?.();
    const timer = window.setTimeout(() => {
      const el = chatInputRef.current;
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(formattedQuote.length, formattedQuote.length);
        } catch {
          // Ignore
        }
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pendingQuote, onConsumePendingQuote]);

  // Dynamic header title accompanying the active tab + "• Enem" before 15/11/2026 13:00 BRT
  const baseTabTitle =
    activeTab === 'chat'
      ? 'Strive'
      : activeTab === 'diagnosis'
      ? 'Diagnóstico'
      : 'Melhore meu Aprendizado';
  const isPostEnemSecondDay = Date.now() >= ENEM_SECOND_DAY_START_MS;
  const headerTitle = isPostEnemSecondDay ? baseTabTitle : `${baseTabTitle} • Enem`;

  // Global keyboard shortcut for the Session Debug Panel (capture phase so it works over any error, menu lock, or blur)
  useEffect(() => {
    const handleGlobalDebugShortcut = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
      const isF9 = e.key === 'F9';
      const isCtrlShiftL = (e.ctrlKey || e.metaKey) && e.shiftKey && keyLower === 'l';
      const isCtrlAltD = (e.ctrlKey || e.metaKey) && e.altKey && keyLower === 'd';
      const isAltShiftD = e.altKey && e.shiftKey && keyLower === 'd';
      const isCtrlShiftDWhileOpen =
        (isOpen || isDebugPanelOpen) && (e.ctrlKey || e.metaKey) && e.shiftKey && keyLower === 'd';

      if (isF9 || isCtrlShiftL || isCtrlAltD || isAltShiftD || isCtrlShiftDWhileOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsDebugPanelOpen((prev) => !prev);
        setDebugRefreshTick((t) => t + 1);
        return;
      }

      if (e.key === 'Escape' && isDebugPanelOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsDebugPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalDebugShortcut, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleGlobalDebugShortcut, { capture: true });
  }, [isOpen, isDebugPanelOpen]);

  // Live refresh of debug panel while open
  useEffect(() => {
    if (!isDebugPanelOpen) return;
    const interval = setInterval(() => {
      setDebugRefreshTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isDebugPanelOpen]);

  // Refresh token count, quota & unanalyzed question threads whenever popover opens
  useEffect(() => {
    if (!isOpen) {
      stopVoiceListening();
      setIsLiquidPopoverOpen(false);
      setEditingMessageId(null);
      setEditingMessageText('');
      setIsDraggingFiles(false);
      dragDepthRef.current = 0;
      setVisibleChatCount(30);
      return;
    }

    setDiagnosis(getSavedLearningDiagnosis());
    setHighQuota(getHighModelsQuotaState());

    getUnanalyzedQuestionThreads().then((unanalyzed) => {
      setUnanalyzedThreads(unanalyzed);
      setAccumulatedTokens(syncQuatTokensFromThreads(unanalyzed));
    });
    getAllQuestionThreads().then(setAllThreads);
  }, [isOpen]);

  // Carrega sugestões do cache local imediatamente e atualiza em segundo plano via Groq quando houver novas respostas
  useEffect(() => {
    setStriveSuggestions(getCachedStriveSuggestions(answers));
    if (!isOpen || chatMessages.length > 0) return;

    let cancelled = false;
    generateDynamicStriveSuggestions(answers, questions, stats)
      .then((fresh) => {
        if (!cancelled && Array.isArray(fresh) && fresh.length === 3) {
          setStriveSuggestions(fresh);
        }
      })
      .catch(() => {
        // Mantém sugestões do cache/fallback silenciosamente
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, chatMessages.length, answers, questions, stats.total_answered]);

  // Close liquid popover on click outside
  useEffect(() => {
    if (!isLiquidPopoverOpen) return;
    const handlePointerDownOutside = (e: MouseEvent) => {
      if (
        liquidPopoverRef.current &&
        !liquidPopoverRef.current.contains(e.target as Node) &&
        (!liquidPopoverMenuRef.current || !liquidPopoverMenuRef.current.contains(e.target as Node))
      ) {
        setIsLiquidPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDownOutside);
    return () => document.removeEventListener('mousedown', handlePointerDownOutside);
  }, [isLiquidPopoverOpen]);

  // Close full-screen panel with Escape key in capture phase (priority: Graph Modal -> Debug Panel -> Liquid Popover -> Editing Message -> Strive)
  useEffect(() => {
    if (!isOpen && !isDebugPanelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (
          typeof document !== 'undefined' &&
          document.querySelector('[data-strive-graph-modal="true"]')
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (isDebugPanelOpen) {
          setIsDebugPanelOpen(false);
        } else if (isLiquidPopoverOpen) {
          setIsLiquidPopoverOpen(false);
        } else if (editingMessageId) {
          setEditingMessageId(null);
          setEditingMessageText('');
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, isLiquidPopoverOpen, isDebugPanelOpen, editingMessageId, onClose]);

  const inFlightGraphKeysRef = useRef<Set<string>>(new Set());

  // Processa em segundo plano marcadores [[GRAFICO: ...]] nas respostas do Strive sem travar o chat
  useEffect(() => {
    for (const msg of chatMessages) {
      if (msg.role !== 'assistant' || !msg.content) continue;
      const markers = extractGraphMarkersFromText(msg.content);
      if (markers.length === 0) continue;

      for (const marker of markers) {
        const existing = msg.generatedGraphs?.[marker.key];
        if (existing && existing.status === 'ready' && existing.svg) continue;

        const flightId = `${msg.id}::${marker.key}`;
        if (inFlightGraphKeysRef.current.has(flightId)) continue;
        inFlightGraphKeysRef.current.add(flightId);

        generateAndValidateStriveGraphSVG({
          title: marker.title,
          description: marker.description,
          contextSummary: msg.content.slice(0, 600),
        })
          .then((svg) => {
            setChatMessages((prev) =>
              prev.map((item) =>
                item.id === msg.id
                  ? {
                      ...item,
                      generatedGraphs: {
                        ...(item.generatedGraphs || {}),
                        [marker.key]: {
                          key: marker.key,
                          title: marker.title,
                          description: marker.description,
                          svg,
                          status: 'ready',
                        },
                      },
                    }
                  : item
              )
            );
          })
          .catch(() => {
            inFlightGraphKeysRef.current.delete(flightId);
          });
      }
    }
  }, [chatMessages]);

  // Persist global chat history (up to 120 messages so "Carregar anteriores" can page beyond the initial 30)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(GLOBAL_CHAT_STORAGE_KEY, JSON.stringify(chatMessages.slice(-120)));
    } catch {
      // Ignore
    }
  }, [chatMessages]);

  const displayedChatMessages = useMemo(
    () => chatMessages.slice(-visibleChatCount),
    [chatMessages, visibleChatCount]
  );
  const hiddenEarlierMessagesCount = Math.max(0, chatMessages.length - displayedChatMessages.length);

  // Scroll leve em 2 estágios: posiciona instantaneamente ('auto') até ~10 mensagens antes da última
  // e realiza a rolagem suave ('smooth') apenas nas últimas ~10 mensagens até o final
  useEffect(() => {
    if (!isOpen || activeTab !== 'chat') return;
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }

    const container = chatScrollContainerRef.current;
    if (!container) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const msgNodes = container.querySelectorAll<HTMLElement>('[data-chat-msg-item="true"]');
    if (msgNodes.length > 10) {
      const anchorNode = msgNodes[msgNodes.length - 10];
      if (anchorNode) {
        const targetAnchorTop = Math.max(0, anchorNode.offsetTop - 24);
        if (container.scrollTop < targetAnchorTop) {
          container.scrollTo({ top: targetAnchorTop, behavior: 'auto' });
        }
      }
    }

    const rafId = window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [chatMessages.length, isSendingChat, isOpen, activeTab]);

  const formatChatBubbleTimestamp = (timestampMs: number): string => {
    const safeTs =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0
        ? timestampMs
        : Date.now();
    const d = new Date(safeTs);
    const now = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const isSameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isSameDay) {
      return `${formatRelativeTime(safeTs)} • ${hh}:${min}`;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm} • ${hh}:${min}`;
  };

  const questionMap = useMemo(() => {
    const map = new Map<number, Question>();
    for (const q of questions) {
      map.set(q.sequence_id, q);
    }
    return map;
  }, [questions]);

  // Build recent activity summary with relative timestamps (formatRelativeTime)
  const recentActivitySummary = useMemo(() => {
    if (!isOpen && !isDebugPanelOpen) return '';
    try {
      const lines: string[] = [];

      const flatAnswers: UserAnswerRecord[] = extractFlatAnswers<UserAnswerRecord>(answers);

      const sortedAnswers = [...flatAnswers]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 8);

      if (sortedAnswers.length > 0) {
        lines.push('Questões respondidas recentemente:');
        for (const ans of sortedAnswers) {
          const q = questionMap.get(ans.question_id);
          const subj = q?.metadata?.subject || 'Geral';
          const topics = q?.metadata?.topics?.slice(0, 2).join(', ') || '';
          const statusLabel = ans.is_correct ? 'ACERTOU' : `ERROU (marcou ${ans.selected_letter})`;
          const relTime = formatRelativeTime(ans.timestamp || Date.now());
          const selectedOpt = q?.options?.find((o) => o.letter === ans.selected_letter);
          const optBackstageParts: string[] = [];
          if (selectedOpt?.distractor_type?.trim()) {
            optBackstageParts.push(`Distrator: ${selectedOpt.distractor_type.trim()}`);
          }
          if (selectedOpt?.why_wrong_or_right?.trim()) {
            optBackstageParts.push(`Bastidor da opção ${ans.selected_letter}: ${selectedOpt.why_wrong_or_right.trim()}`);
          }
          const optBackstageNote =
            optBackstageParts.length > 0 ? ` — [${optBackstageParts.join(' | ')}]` : '';
          lines.push(
            `- Questão #${ans.question_id} [${subj}${topics ? ` • ${topics}` : ''}]: ${statusLabel} (${relTime})${optBackstageNote}`
          );
        }
      }

      if (allThreads.length > 0) {
        lines.push('\nDúvidas socráticas recentes nas questões:');
        for (const t of allThreads.slice(0, 5)) {
          const lastInt = t.interactions[t.interactions.length - 1];
          if (lastInt) {
            const relTime = formatRelativeTime(t.updatedAt || Date.now());
            lines.push(
              `- Questão #${t.question_id} (${t.subject}, ${relTime}): Aluno disse "${lastInt.studentTranscript.slice(0, 120)}" | Lacunas: ${(t.blockingTags || []).join(', ') || 'N/A'}`
            );
          }
        }
      }

      return lines.join('\n');
    } catch (err) {
      console.warn('[GlobalAssistantPopover] Erro ao extrair histórico recente:', err);
      return '';
    }
  }, [answers, allThreads, questionMap, isOpen, isDebugPanelOpen]);

  const statsSummary = useMemo(() => {
    const accuracy =
      stats.total_answered > 0
        ? Math.round((stats.total_correct / stats.total_answered) * 100)
        : 0;
    return `Total de questões resolvidas: ${stats.total_answered} | Acertos: ${stats.total_correct} (${accuracy}% de aproveitamento) | Ofensiva atual: ${stats.streak_days} dias | XP acumulado: ${stats.xp_points} XP.`;
  }, [stats]);

  const processedDataMB = useMemo(() => {
    try {
      let totalBytes = 0;
      const measure = (val: unknown) => {
        if (!val) return 0;
        const str = typeof val === 'string' ? val : JSON.stringify(val);
        return typeof Blob !== 'undefined' ? new Blob([str]).size : str.length * 2;
      };
      totalBytes += measure(answers);
      totalBytes += measure(allThreads);
      totalBytes += measure(chatMessages);
      totalBytes += measure(diagnosis);
      if (typeof window !== 'undefined') {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('memoriz_')) {
              const v = localStorage.getItem(k);
              if (v) totalBytes += k.length + v.length;
            }
          }
        } catch {
          // Ignore storage access errors
        }
      }
      return (totalBytes / (1024 * 1024)).toFixed(2);
    } catch {
      return '0.00';
    }
  }, [answers, allThreads, chatMessages, diagnosis]);

  const tokenProgressPercent = Math.min(
    100,
    Math.round((accumulatedTokens / LEARNING_IMPROVEMENT_TOKEN_GOAL) * 100)
  );
  const hasReachedTokenGoal = accumulatedTokens >= LEARNING_IMPROVEMENT_TOKEN_GOAL;
  const hasUnanalyzedInteractions = unanalyzedThreads.length > 0;
  const canHighlightLearningImprovement = hasReachedTokenGoal && hasUnanalyzedInteractions;

  const liquidPercent = Math.min(
    100,
    Math.max(0, Math.round((highQuota.remainingTotal / HIGH_MODELS_DAILY_TOTAL_QUOTA) * 100))
  );
  const isQuotaExhausted = highQuota.remainingTotal <= 0;
  const isHighModelEffective = highQuota.enabled && !isQuotaExhausted;

  // Determine the expected primary model name for live status guarantee
  const expectedActiveModelName = isHighModelEffective
    ? HIGH_GEMINI_MODEL_4_HYDROGEN
    : DEFAULT_GEMINI_MODEL;

  // Guaranteed live status text that ALWAYS includes the active model name
  const liveStatusWithModel = useMemo(() => {
    if (!isSendingChat && !isGeneratingDiagnosis) return null;
    if (rpmStatusNotice && rpmStatusNotice.trim().length > 0) {
      return rpmStatusNotice;
    }
    return `Conectando ao ${expectedActiveModelName}...`;
  }, [isSendingChat, isGeneratingDiagnosis, rpmStatusNotice, expectedActiveModelName]);

  const handleToggleHighModels = (nextChecked: boolean) => {
    if (highQuota.remainingTotal <= 0) return;
    const updated = setHighModelsEnabled(nextChecked);
    setHighQuota(updated);
  };

  // Handle "Melhore meu Aprendizado" click
  const handleImproveMyLearning = async () => {
    setErrorBanner(null);
    setIsGeneratingDiagnosis(true);
    setActiveTab('diagnosis');
    setRpmStatusNotice(`Conectando ao ${expectedActiveModelName}...`);

    try {
      const threadsToAnalyze =
        unanalyzedThreads.length > 0 ? unanalyzedThreads : allThreads.slice(0, 6);

      const unanalyzedSummaries = threadsToAnalyze.map((t) => ({
        questionId: t.question_id,
        subject: t.subject,
        tags: t.tags || [],
        blockingTags: t.blockingTags || [],
        studentTranscripts: (t.interactions || []).map((i) => i.studentTranscript),
        aiReasonings: (t.interactions || []).map((i) => i.aiInternalReasoning),
        updatedAt: t.updatedAt || Date.now(),
      }));

      const result = await generateLearningImprovementDiagnosis({
        unanalyzedSummaries,
        recentAnswersSummary: `${statsSummary}\n${recentActivitySummary}`,
        onStatusChange: (status) => {
          setRpmStatusNotice(status);
          setHighQuota(getHighModelsQuotaState());
        },
      });

      if (threadsToAnalyze.length > 0) {
        await markQuestionThreadsAnalyzed(threadsToAnalyze.map((t) => t.question_id));
      }

      setDiagnosis(result);
      setHighQuota(getHighModelsQuotaState());
      const remainingUnanalyzed = await getUnanalyzedQuestionThreads();
      setUnanalyzedThreads(remainingUnanalyzed);
      setAccumulatedTokens(syncQuatTokensFromThreads(remainingUnanalyzed));
    } catch (err: any) {
      const friendly = mapToStudentFriendlyError(
        err?.message || 'Não foi possível gerar o diagnóstico agora.'
      );
      setErrorBanner(friendly.displayText);
      setHighQuota(getHighModelsQuotaState());
    } finally {
      setIsGeneratingDiagnosis(false);
      setRpmStatusNotice(null);
    }
  };

  const processAttachedFiles = async (filesInput: FileList | File[]) => {
    const files: File[] = Array.from(filesInput || []);
    if (files.length === 0) return;

    const loadedItems: PendingAttachmentItem[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
          reader.readAsDataURL(file);
        });
        const base64Data = dataUrl.replace(/^data:[^;]+;base64,/i, '').trim();
        if (!base64Data) continue;
        loadedItems.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || (file.type.startsWith('image/') ? 'imagem.jpg' : 'audio.mp3'),
          mimeType: file.type || 'application/octet-stream',
          data: base64Data,
          previewUrl: file.type.startsWith('image/') ? dataUrl : undefined,
        });
      } catch {
        // Ignore unreadable file
      }
    }

    if (loadedItems.length > 0) {
      setPendingAttachments((prev) => [...prev, ...loadedItems].slice(0, 6));
    }
  };

  const handleSelectAttachments = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = Array.from(fileList);
    e.target.value = '';
    await processAttachedFiles(files);
  };

  const handleRemoveAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const hasFilesInDataTransfer = (dt: React.DragEvent['dataTransfer'] | null): boolean => {
    if (!dt) return false;
    if (dt.types && Array.from(dt.types).includes('Files')) return true;
    return Boolean(dt.files && dt.files.length > 0);
  };

  const handleChatDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (!isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  };

  const handleChatDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  };

  const handleChatDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer) && !isDraggingFiles) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleChatDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      await processAttachedFiles(e.dataTransfer.files);
    }
  };

  const handlePasteAttachment = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const pastedFiles: File[] = [];
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file && (file.type.startsWith('image/') || file.type.startsWith('audio/'))) {
          pastedFiles.push(file);
        }
      }
    }
    if (pastedFiles.length === 0 && clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (
          item &&
          item.kind === 'file' &&
          (item.type.startsWith('image/') || item.type.startsWith('audio/'))
        ) {
          const f = item.getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
    }

    if (pastedFiles.length > 0) {
      await processAttachedFiles(pastedFiles);
    }
  };

  const handleDeleteMessage = (msgId: string) => {
    if (speakingMessageId === msgId) {
      stopActiveSpeechPlayback();
      setSpeakingMessageId(null);
    }
    spokenAudioCacheRef.current.delete(msgId);
    if (editingMessageId === msgId) {
      setEditingMessageId(null);
      setEditingMessageText('');
    }
    setChatMessages((prev) => {
      const next = prev.filter((m) => m.id !== msgId);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(GLOBAL_CHAT_STORAGE_KEY, JSON.stringify(next.slice(-120)));
        } catch {
          // Ignore
        }
      }
      return next;
    });
  };

  const handleStartEditMessage = (msg: GlobalChatMessage) => {
    if (msg.role !== 'user') return;
    setEditingMessageId(msg.id);
    setEditingMessageText(msg.content);
  };

  const handleCancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

  const handleSaveEditedMessage = async (msgId: string) => {
    if (isSendingChat) return;
    const trimmedText = editingMessageText.trim();
    if (!trimmedText) return;

    const targetIdx = chatMessages.findIndex((m) => m.id === msgId && m.role === 'user');
    if (targetIdx === -1) return;

    if (isListeningVoice || shouldKeepListeningRef.current) {
      stopVoiceListening();
    }

    if (speakingMessageId) {
      stopActiveSpeechPlayback();
      setSpeakingMessageId(null);
    }

    for (let i = targetIdx; i < chatMessages.length; i++) {
      spokenAudioCacheRef.current.delete(chatMessages[i].id);
    }

    const previousMessages = chatMessages;
    const nowMs = Date.now();
    const editedUserMsg: GlobalChatMessage = {
      ...chatMessages[targetIdx],
      content: trimmedText,
      timestamp: nowMs,
    };

    const updatedHistory = [...chatMessages.slice(0, targetIdx), editedUserMsg];
    setChatMessages(updatedHistory);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(GLOBAL_CHAT_STORAGE_KEY, JSON.stringify(updatedHistory.slice(-120)));
      } catch {
        // Ignore
      }
    }
    setEditingMessageId(null);
    setEditingMessageText('');
    setIsSendingChat(true);
    setErrorBanner(null);
    setIsLiquidPopoverOpen(false);

    const currentQuota = getHighModelsQuotaState();
    const boostForThisMessage = currentQuota.enabled && currentQuota.remainingTotal > 0;
    const initialModelForThisMessage = boostForThisMessage
      ? HIGH_GEMINI_MODEL_4_HYDROGEN
      : DEFAULT_GEMINI_MODEL;

    setRpmStatusNotice(`Conectando ao ${initialModelForThisMessage}...`);

    const conversationHistory = updatedHistory.map((msg) => ({
      role: msg.role,
      timestamp: msg.timestamp,
      content: `${formatMessageTimestampPrefix(msg.timestamp, nowMs)} \n${msg.content}`,
    }));

    try {
      const { reply, modelUsed } = await runGlobalChat({
        chatHistory: conversationHistory,
        userMessage: trimmedText,
        recentActivitySummary,
        statsSummary,
        currentQuestion,
        latestDiagnosis: diagnosis,
        isBoostActive: boostForThisMessage,
        onStatusChange: (status) => {
          setRpmStatusNotice(status);
          setHighQuota(getHighModelsQuotaState());
        },
      });

      const detectedMarkers = extractGraphMarkersFromText(reply);
      const initialGraphs: Record<string, StriveGeneratedGraph> | undefined =
        detectedMarkers.length > 0
          ? Object.fromEntries(
              detectedMarkers.map((m) => [
                m.key,
                {
                  key: m.key,
                  title: m.title,
                  description: m.description,
                  svg: '',
                  status: 'loading' as const,
                },
              ])
            )
          : undefined;

      const assistantMsg: GlobalChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        modelUsed,
        ...(initialGraphs ? { generatedGraphs: initialGraphs } : {}),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
      setAccumulatedTokens(getAccumulatedTokens());
      setHighQuota(getHighModelsQuotaState());
    } catch (err: any) {
      setChatMessages(previousMessages);
      const friendly = mapToStudentFriendlyError(
        err?.message || 'Erro ao conversar com o assistente global.'
      );
      setErrorBanner(friendly.displayText);
      setHighQuota(getHighModelsQuotaState());
    } finally {
      setIsSendingChat(false);
      setRpmStatusNotice(null);
    }
  };

  // Handle sending a message in Global Chat
  const handleSendChatMessage = async (e?: React.FormEvent, customMessage?: string) => {
    if (e) e.preventDefault();
    const rawMessage = (customMessage ?? inputText).trim();
    const attachmentsSnapshot = customMessage ? [] : [...pendingAttachments];
    if ((!rawMessage && attachmentsSnapshot.length === 0) || isSendingChat) return;

    if (isListeningVoice || shouldKeepListeningRef.current) {
      stopVoiceListening();
    }

    const attachmentMetaSuffix =
      attachmentsSnapshot.length > 0
        ? attachmentsSnapshot.map((a) => `[Anexo: ${a.name}]`).join(' ')
        : '';
    const displayUserContent = [rawMessage, attachmentMetaSuffix].filter(Boolean).join('\n');
    const promptForModel =
      rawMessage || 'Analise o arquivo enviado em relação aos meus estudos.';

    const nowMs = Date.now();
    const userMsg: GlobalChatMessage = {
      id: `msg_${nowMs}_u`,
      role: 'user',
      content: displayUserContent,
      timestamp: nowMs,
    };

    const updatedHistory = [...chatMessages, userMsg];
    setChatMessages(updatedHistory);
    confirmedTextRef.current = '';
    sessionBaseConfirmedRef.current = '';
    sessionLatestTranscriptRef.current = '';
    setInputText('');
    if (!customMessage) {
      setPendingAttachments([]);
    }
    setIsSendingChat(true);
    setErrorBanner(null);
    setIsLiquidPopoverOpen(false);

    const currentQuota = getHighModelsQuotaState();
    const boostForThisMessage = currentQuota.enabled && currentQuota.remainingTotal > 0;
    const initialModelForThisMessage = boostForThisMessage
      ? HIGH_GEMINI_MODEL_4_HYDROGEN
      : DEFAULT_GEMINI_MODEL;

    setRpmStatusNotice(`Conectando ao ${initialModelForThisMessage}...`);

    const conversationHistory = updatedHistory.map((msg) => ({
      role: msg.role,
      timestamp: msg.timestamp,
      content: `${formatMessageTimestampPrefix(msg.timestamp, nowMs)} \n${msg.content}`,
    }));

    const apiAttachments: AIAttachmentPayload[] | undefined =
      attachmentsSnapshot.length > 0
        ? attachmentsSnapshot.map((a) => ({
            mimeType: a.mimeType,
            data: a.data,
            name: a.name,
          }))
        : undefined;

    try {
      const { reply, modelUsed } = await runGlobalChat({
        chatHistory: conversationHistory,
        userMessage: promptForModel,
        attachments: apiAttachments,
        recentActivitySummary,
        statsSummary,
        currentQuestion,
        latestDiagnosis: diagnosis,
        isBoostActive: boostForThisMessage,
        onStatusChange: (status) => {
          setRpmStatusNotice(status);
          setHighQuota(getHighModelsQuotaState());
        },
      });

      const detectedMarkers = extractGraphMarkersFromText(reply);
      const initialGraphs: Record<string, StriveGeneratedGraph> | undefined =
        detectedMarkers.length > 0
          ? Object.fromEntries(
              detectedMarkers.map((m) => [
                m.key,
                {
                  key: m.key,
                  title: m.title,
                  description: m.description,
                  svg: '',
                  status: 'loading' as const,
                },
              ])
            )
          : undefined;

      const assistantMsg: GlobalChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        modelUsed,
        ...(initialGraphs ? { generatedGraphs: initialGraphs } : {}),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
      setAccumulatedTokens(getAccumulatedTokens());
      setHighQuota(getHighModelsQuotaState());
    } catch (err: any) {
      setChatMessages(chatMessages);
      setInputText(rawMessage);
      if (!customMessage && attachmentsSnapshot.length > 0) {
        setPendingAttachments(attachmentsSnapshot);
      }
      const friendly = mapToStudentFriendlyError(
        err?.message || 'Erro ao conversar com o assistente global.'
      );
      setErrorBanner(friendly.displayText);
      setHighQuota(getHighModelsQuotaState());
    } finally {
      setIsSendingChat(false);
      setRpmStatusNotice(null);
    }
  };

  const normalizeForSpeechDedup = (text: string): string =>
    text.replace(/\s+/g, ' ').trim().toLowerCase();

  const joinCleanSpeech = (baseText: string, newSegment: string): string => {
    const cleanBase = baseText.replace(/\s+/g, ' ').trim();
    const cleanNew = newSegment.replace(/\s+/g, ' ').trim();

    if (!cleanNew) return cleanBase;
    if (!cleanBase) return cleanNew;

    const normBase = normalizeForSpeechDedup(cleanBase);
    const normNew = normalizeForSpeechDedup(cleanNew);

    if (!normNew) return cleanBase;
    if (normBase === normNew) return cleanBase;

    // Se o novo trecho já começar com o texto anterior acumulado, substitui em vez de concatenar
    if (normNew.startsWith(normBase)) {
      return cleanNew;
    }

    // Se o texto confirmado já terminar exatamente com o novo trecho, ignora a repetição
    if (normBase.endsWith(normNew)) {
      return cleanBase;
    }

    // Verifica sobreposição de sufixo/prefixo entre palavras
    const baseWords = cleanBase.split(' ');
    const newWords = cleanNew.split(' ');
    const maxOverlap = Math.min(baseWords.length, newWords.length);
    for (let k = maxOverlap; k >= 1; k--) {
      const baseSuffix = baseWords.slice(baseWords.length - k).join(' ').toLowerCase();
      const newPrefix = newWords.slice(0, k).join(' ').toLowerCase();
      if (baseSuffix === newPrefix && (k > 1 || baseSuffix.length >= 4)) {
        const remainingNew = newWords.slice(k).join(' ');
        return remainingNew ? `${cleanBase} ${remainingNew}` : cleanBase;
      }
    }

    return `${cleanBase} ${cleanNew}`;
  };

  const extractCleanTranscript = (
    event: any,
    isContinuous: boolean
  ): { finalTranscript: string; interimTranscript: string; fullSessionTranscript: string } => {
    const results = event?.results;
    if (!results || typeof results.length !== 'number') {
      return { finalTranscript: '', interimTranscript: '', fullSessionTranscript: '' };
    }

    if (!isContinuous) {
      let finalAccum = '';
      let interimAccum = '';

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const piece = String(res?.[0]?.transcript || '').replace(/\s+/g, ' ').trim();
        if (!piece) continue;

        if (i + 1 < results.length) {
          const nextPiece = String(results[i + 1]?.[0]?.transcript || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (
            nextPiece &&
            normalizeForSpeechDedup(nextPiece).startsWith(normalizeForSpeechDedup(piece))
          ) {
            continue;
          }
        }

        if (res.isFinal) {
          finalAccum = joinCleanSpeech(finalAccum, piece);
        } else {
          interimAccum = joinCleanSpeech(interimAccum, piece);
        }
      }

      const fullSessionTranscript = joinCleanSpeech(finalAccum, interimAccum);
      let cleanInterim = interimAccum;
      if (finalAccum && cleanInterim) {
        const normFinal = normalizeForSpeechDedup(finalAccum);
        const normInterim = normalizeForSpeechDedup(cleanInterim);
        if (normInterim === normFinal || normFinal.endsWith(normInterim)) {
          cleanInterim = '';
        } else if (normInterim.startsWith(normFinal)) {
          cleanInterim = cleanInterim.slice(finalAccum.length).trim();
        }
      }

      return {
        finalTranscript: finalAccum,
        interimTranscript: cleanInterim,
        fullSessionTranscript,
      };
    }

    let newFinalChunk = '';
    let currentInterim = '';
    const startIdx = typeof event.resultIndex === 'number' ? event.resultIndex : 0;

    for (let i = startIdx; i < results.length; i++) {
      const res = results[i];
      const piece = String(res?.[0]?.transcript || '').replace(/\s+/g, ' ').trim();
      if (!piece) continue;

      if (res.isFinal) {
        if (i <= lastFinalIndexRef.current) {
          continue;
        }
        lastFinalIndexRef.current = i;
        newFinalChunk = joinCleanSpeech(newFinalChunk, piece);
      } else {
        currentInterim = joinCleanSpeech(currentInterim, piece);
      }
    }

    return {
      finalTranscript: newFinalChunk,
      interimTranscript: currentInterim,
      fullSessionTranscript: joinCleanSpeech(newFinalChunk, currentInterim),
    };
  };

  // Voice Dictation in Global Chat with persistent listening & Android deduplication
  const handleToggleVoiceInput = async () => {
    if (isListeningVoice || shouldKeepListeningRef.current) {
      stopVoiceListening();
      return;
    }

    setErrorBanner(null);

    const SpeechRecognitionAPI =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionAPI) {
      const unsupportedMsg =
        'Reconhecimento de voz não suportado neste navegador — abra no Chrome/Edge ou digite sua mensagem.';
      setErrorBanner(unsupportedMsg);
      recordOrchestratorRuntimeError(`[Mic] ${unsupportedMsg}`);
      return;
    }

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    // Request explicit microphone permission first on non-Android so browser blocks are caught immediately
    if (!isAndroid && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStream.getTracks().forEach((track) => track.stop());
      } catch (permErr: any) {
        const rawErr = String(permErr?.name || permErr?.message || 'not-allowed').toLowerCase();
        const blockedByBrowserOrUser =
          rawErr.includes('notallowed') ||
          rawErr.includes('not-allowed') ||
          rawErr.includes('permission') ||
          rawErr.includes('denied') ||
          rawErr.includes('security');
        const friendlyMsg = blockedByBrowserOrUser
          ? 'Permissão do microfone negada ou bloqueada pelo navegador. Libere o acesso ou digite sua mensagem.'
          : `Falha ao acessar o microfone (${permErr?.name || permErr?.message || 'erro de dispositivo'}). Digite sua mensagem abaixo.`;
        setErrorBanner(friendlyMsg);
        recordOrchestratorRuntimeError(
          `[Mic getUserMedia Error] ${permErr?.name || 'Error'}: ${permErr?.message || String(permErr)}`,
          permErr?.stack
        );
        stopVoiceListening();
        return;
      }
    }

    confirmedTextRef.current = inputText.trim();
    shouldKeepListeningRef.current = true;
    setIsListeningVoice(true);

    const startRecognitionInstance = () => {
      if (!shouldKeepListeningRef.current) return;

      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = 'pt-BR';
        recognition.continuous = !isAndroid;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        lastFinalIndexRef.current = -1;
        sessionBaseConfirmedRef.current = confirmedTextRef.current;
        sessionLatestTranscriptRef.current = '';

        recognition.onresult = (event: any) => {
          if (!shouldKeepListeningRef.current) return;

          const { finalTranscript, interimTranscript, fullSessionTranscript } =
            extractCleanTranscript(event, !isAndroid);

          if (isAndroid) {
            sessionLatestTranscriptRef.current = fullSessionTranscript;
            if (finalTranscript) {
              confirmedTextRef.current = joinCleanSpeech(
                sessionBaseConfirmedRef.current,
                finalTranscript
              );
            }
            setInputText(joinCleanSpeech(confirmedTextRef.current, interimTranscript));
          } else {
            if (finalTranscript) {
              confirmedTextRef.current = joinCleanSpeech(
                confirmedTextRef.current,
                finalTranscript
              );
            }
            setInputText(joinCleanSpeech(confirmedTextRef.current, interimTranscript));
          }
        };

        recognition.onerror = (event: any) => {
          const errCode = String(event?.error || 'unknown').toLowerCase();

          if (
            shouldKeepListeningRef.current &&
            (errCode === 'no-speech' || errCode === 'aborted')
          ) {
            return;
          }

          if (
            errCode === 'not-allowed' ||
            errCode === 'service-not-allowed' ||
            errCode === 'audio-capture'
          ) {
            stopVoiceListening();
            const errMessage =
              errCode === 'audio-capture'
                ? 'Dispositivo de microfone indisponível ou ocupado por outro programa'
                : 'Permissão do microfone negada ou bloqueada pelo navegador. Libere o acesso ou digite sua mensagem.';
            setErrorBanner(errMessage);
            recordOrchestratorRuntimeError(
              `[SpeechRecognition.onerror] error=${errCode} message=${event?.message || errMessage}`
            );
            return;
          }

          if (!shouldKeepListeningRef.current) {
            stopVoiceListening();
          }
        };

        recognition.onend = () => {
          if (isAndroid && sessionLatestTranscriptRef.current) {
            confirmedTextRef.current = joinCleanSpeech(
              sessionBaseConfirmedRef.current,
              sessionLatestTranscriptRef.current
            );
            sessionLatestTranscriptRef.current = '';
            setInputText(confirmedTextRef.current);
          }

          if (shouldKeepListeningRef.current) {
            if (voiceRestartTimerRef.current !== null && typeof window !== 'undefined') {
              window.clearTimeout(voiceRestartTimerRef.current);
            }
            voiceRestartTimerRef.current = window.setTimeout(() => {
              voiceRestartTimerRef.current = null;
              if (shouldKeepListeningRef.current) {
                startRecognitionInstance();
              }
            }, 120);
          } else {
            setIsListeningVoice(false);
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (startErr: any) {
        stopVoiceListening();
        const startMsg = `Não foi possível iniciar o reconhecimento de voz (${startErr?.message || 'Permissão do microfone negada ou bloqueada pelo navegador. Libere o acesso ou digite sua mensagem.'})`;
        setErrorBanner(startMsg);
        recordOrchestratorRuntimeError(
          `[SpeechRecognition.start Exception] ${startErr?.message || String(startErr)}`,
          startErr?.stack
        );
      }
    };

    startRecognitionInstance();
  };

  const stopActiveSpeechPlayback = () => {
    speakingAbortIdRef.current = null;
    if (activeAudioElementRef.current) {
      try {
        activeAudioElementRef.current.pause();
        activeAudioElementRef.current.currentTime = 0;
      } catch {
        // Ignore
      }
      activeAudioElementRef.current = null;
    }
  };

  const handleSpeakMessage = async (msg: GlobalChatMessage) => {
    if (typeof window === 'undefined') return;
    if (speakingMessageId === msg.id) {
      stopActiveSpeechPlayback();
      setSpeakingMessageId(null);
      return;
    }

    stopActiveSpeechPlayback();
    speakingAbortIdRef.current = msg.id;
    setSpeakingMessageId(msg.id);

    const cleanSpeechText = sanitizeTextForSpeech(msg.content);
    if (!cleanSpeechText) {
      speakingAbortIdRef.current = null;
      setSpeakingMessageId(null);
      return;
    }

    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    let cachedAudio = spokenAudioCacheRef.current.get(msg.id);

    if (!cachedAudio) {
      if (!isOnline) {
        speakingAbortIdRef.current = null;
        setSpeakingMessageId(null);
        const offlineErr = 'Sem conexão com a internet para sintetizar a voz via Gemini Live API.';
        const friendly = mapToStudentFriendlyError(offlineErr);
        setErrorBanner(friendly.displayText);
        return;
      }

      const res = await notifyQuatNativeAudioDialog({
        action: 'speak',
        textToSpeak: cleanSpeechText,
      });

      if (speakingAbortIdRef.current !== msg.id) return;

      if (res.error || !res.audioBase64) {
        speakingAbortIdRef.current = null;
        setSpeakingMessageId(null);
        const realErr =
          res.error || 'Falha ao gerar áudio na Gemini Live API (nenhum dado de áudio retornado).';
        const friendly = mapToStudentFriendlyError(
          `${realErr}${res.attempts ? ` | attempts=${JSON.stringify(res.attempts)}` : ''}`
        );
        setErrorBanner(friendly.displayText);
        return;
      }

      cachedAudio = {
        audioBase64: res.audioBase64,
        mimeType: res.mimeType || 'audio/wav',
      };
      spokenAudioCacheRef.current.set(msg.id, cachedAudio);
    }

    if (speakingAbortIdRef.current !== msg.id) return;

    try {
      const audio = new Audio(
        `data:${cachedAudio.mimeType || 'audio/wav'};base64,${cachedAudio.audioBase64}`
      );
      activeAudioElementRef.current = audio;
      audio.onended = () => {
        if (speakingAbortIdRef.current === msg.id) {
          speakingAbortIdRef.current = null;
          activeAudioElementRef.current = null;
          setSpeakingMessageId(null);
        }
      };
      audio.onerror = () => {
        if (speakingAbortIdRef.current === msg.id) {
          speakingAbortIdRef.current = null;
          activeAudioElementRef.current = null;
          setSpeakingMessageId(null);
          const mediaErr = 'Erro ao reproduzir o fluxo de áudio retornado pela Gemini Live API.';
          const friendly = mapToStudentFriendlyError(mediaErr);
          setErrorBanner(friendly.displayText);
        }
      };
      await audio.play();
    } catch (playErr: any) {
      speakingAbortIdRef.current = null;
      activeAudioElementRef.current = null;
      setSpeakingMessageId(null);
      const errMsg = `Não foi possível reproduzir o áudio da Live API: ${
        playErr?.message || String(playErr)
      }`;
      const friendly = mapToStudentFriendlyError(errMsg);
      setErrorBanner(friendly.displayText);
    }
  };

  // Reused DraggableModeSwitcher tabs (Zero duplicate tab-switcher code)
  const switcherTabs: SwitcherTabItem[] = useMemo(
    () => [
      { id: 'chat', label: 'Modo Strive', icon: Sparkles },
      { id: 'diagnosis', label: 'Diagnóstico', icon: Target, badgeDot: Boolean(diagnosis) },
      {
        id: 'improve',
        label: 'Melhore meu Aprendizado',
        icon: TrendingUp,
        badgeDot: canHighlightLearningImprovement,
      },
    ],
    [diagnosis, canHighlightLearningImprovement]
  );

  // Full diagnostic snapshot for the keyboard-shortcut Session Debug Panel
  const debugSnapshot = useMemo(() => {
    if (!isDebugPanelOpen) return null;
    const orch = getOrchestratorDebugSnapshot();
    const flatAns = extractFlatAnswers(answers);
    let storageSummary: Array<{ key: string; bytes: number }> = [];
    if (typeof window !== 'undefined') {
      try {
        storageSummary = Object.keys(localStorage).map((k) => ({
          key: k,
          bytes: (localStorage.getItem(k) || '').length,
        }));
      } catch {
        // Ignore
      }
    }

    return {
      capturedAtIso: new Date().toISOString(),
      capturedAtLocal: new Date().toLocaleString('pt-BR'),
      enemSecondDayThreshold: '2026-11-15T13:00:00-03:00',
      isPostEnemSecondDay,
      uiState: {
        isGlobalAssistantOpen: isOpen,
        activeTab,
        headerTitle,
        isSendingChat,
        isGeneratingDiagnosis,
        liveStatusWithModel,
        errorBanner,
        chatMessagesCount: chatMessages.length,
        questionsLoadedCount: questions.length,
        flatAnswersCount: flatAns.length,
        allQuestionThreadsInIDB: allThreads.length,
        unanalyzedThreadsInIDB: unanalyzedThreads.length,
      },
      environment:
        typeof window !== 'undefined'
          ? {
              url: window.location.href,
              userAgent: navigator.userAgent,
              language: navigator.language,
              onLine: navigator.onLine,
              deviceMemoryGB: (navigator as any).deviceMemory ?? 'N/A',
              hardwareConcurrency: navigator.hardwareConcurrency ?? 'N/A',
              viewport: `${window.innerWidth}x${window.innerHeight}`,
              webSpeechRecognitionSupported: Boolean(
                (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
              ),
            }
          : {},
      orchestrator: orch,
      localStorageKeys: storageSummary,
    };
  }, [
    isDebugPanelOpen,
    debugRefreshTick,
    isOpen,
    activeTab,
    headerTitle,
    isSendingChat,
    isGeneratingDiagnosis,
    liveStatusWithModel,
    errorBanner,
    chatMessages.length,
    questions.length,
    answers,
    allThreads.length,
    unanalyzedThreads.length,
    isPostEnemSecondDay,
  ]);

  const handleCopyDebugJson = () => {
    if (!debugSnapshot || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(JSON.stringify(debugSnapshot, null, 2)).then(() => {
      setCopiedDebugReport(true);
      setTimeout(() => setCopiedDebugReport(false), 2000);
    });
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="global-assistant-curtain"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 110 || info.velocity.y > 450) {
                onClose();
              }
            }}
            className="fixed inset-0 z-50 w-screen h-[100dvh] flex flex-col bg-canvas overflow-hidden"
          >
            {/* Smart Header with Mobile Drag-to-Close & Reused DraggableModeSwitcher */}
            <header
              onPointerDown={(e) => {
                if (!(e.target as HTMLElement).closest('button, [data-no-curtain-drag="true"]')) {
                  dragControls.start(e);
                }
              }}
              className="w-full bg-surface border-b border-border shrink-0 shadow-2xs touch-none select-none cursor-grab active:cursor-grabbing overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="max-w-4xl mx-auto w-full px-4 pt-2 pb-2.5 space-y-2">
                {/* Subtle drag handle indicator on mobile */}
                <div className="w-10 h-1 rounded-full bg-border mx-auto sm:hidden" />

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 shadow-2xs">
                      <GeminiIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-bold text-primary theme-text-primary truncate">
                        {headerTitle}
                      </h2>
                      <p className="text-[11px] text-muted truncate">
                        {activeTab === 'improve'
                          ? `${processedDataMB} MB de dados processados`
                          : `${stats.total_answered} questões resolvidas`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenBYOKModal();
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
                      aria-label="Chaves de acesso gratuitas (Google e Groq)"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-accent" />
                      <span className="hidden sm:inline">Chaves de Acesso</span>
                    </button>

                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                      aria-label="Fechar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Reused DraggableModeSwitcher with identical pointer drag physics & sliding pill */}
                <div data-no-curtain-drag="true" className="w-full">
                  <DraggableModeSwitcher
                    currentMode={activeTab}
                    onSelectMode={(mode) => setActiveTab(mode as 'chat' | 'diagnosis' | 'improve')}
                    tabs={switcherTabs}
                  />
                </div>
              </div>
            </header>

            {/* Error Banner */}
            {errorBanner && (
              <div className="w-full bg-danger-bg border-b border-border text-danger text-xs px-4 py-2 shrink-0">
                <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorBanner}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorBanner(null)}
                    className="p-1 hover:opacity-75 cursor-pointer"
                    aria-label="Fechar aviso"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 1: MODO STRIVE (ÁREA MÁXIMA DEDICADA AO CHAT GERAL COM ALINHAMENTO EXATO) */}
            {activeTab === 'chat' && (
              <div
                onDragEnter={handleChatDragEnter}
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
                className="relative flex-1 flex flex-col min-h-0 overflow-hidden"
              >
                {isDraggingFiles && (
                  <div className="absolute inset-3 z-40 rounded-2xl bg-surface/90 border-2 border-dashed border-accent text-primary flex flex-col items-center justify-center gap-2 pointer-events-none select-none shadow-sm">
                    <Paperclip className="w-6 h-6 text-accent" />
                    <span className="text-xs sm:text-sm font-semibold text-primary">
                      Solte a imagem ou arquivo aqui para anexar
                    </span>
                  </div>
                )}

                <div
                  ref={chatScrollContainerRef}
                  className="flex-1 overflow-y-auto"
                  style={{ scrollbarGutter: 'stable' }}
                >
                  <div className="max-w-4xl mx-auto w-full px-4 py-4 sm:py-6 space-y-4">
                    {hiddenEarlierMessagesCount > 0 && (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            skipNextAutoScrollRef.current = true;
                            setVisibleChatCount((prev) => prev + 30);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer shadow-2xs"
                        >
                          Carregar anteriores ({hiddenEarlierMessagesCount})
                        </button>
                      </div>
                    )}
                    {chatMessages.length === 0 ? (
                      <div className="w-[calc(100%-6rem)] sm:w-[calc(100%-7rem)] p-5 sm:p-6 rounded-2xl bg-surface border border-border space-y-3.5 shadow-xs">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-primary">
                          <span>Bem-vindo ao Modo Strive!</span>
                        </div>
                        <p className="text-xs sm:text-sm text-secondary leading-relaxed">
                          Estou acompanhando seu histórico em tempo real ({stats.total_answered} questões resolvidas). Pergunte sobre estratégias de tempo para Matemática e Ciências da Natureza, revisão rápida de fórmulas ou converse comigo para organizar seus estudos.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {striveSuggestions.map((suggestion, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSendChatMessage(undefined, suggestion)}
                              className="text-left text-xs px-3 py-2 rounded-xl bg-surface-subtle hover:bg-surface-hover text-primary border border-border transition-colors cursor-pointer"
                            >
                              “{suggestion}”
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      displayedChatMessages.map((msg) => {
                        const isEditingThisMessage =
                          msg.role === 'user' && editingMessageId === msg.id;

                        return (
                          <div
                            key={msg.id}
                            data-chat-msg-item="true"
                            className={`flex flex-col w-full ${
                              msg.role === 'user' ? 'items-end' : 'items-start'
                            }`}
                          >
                            <div
                              className={`group rounded-2xl p-4 sm:p-5 text-xs sm:text-sm leading-relaxed space-y-2 shadow-xs ${
                                msg.role === 'user'
                                  ? `${
                                      isEditingThisMessage ? 'w-full' : 'w-fit'
                                    } max-w-[calc(100%-6rem)] sm:max-w-[calc(100%-7rem)] bg-accent text-accent-contrast rounded-br-xs`
                                  : 'w-[calc(100%-6rem)] sm:w-[calc(100%-7rem)] bg-surface text-primary border border-border rounded-bl-xs'
                              }`}
                            >
                              {msg.role === 'user' ? (
                                isEditingThisMessage ? (
                                  <div className="space-y-2.5">
                                    <textarea
                                      value={editingMessageText}
                                      onChange={(e) => setEditingMessageText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleCancelEditMessage();
                                        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleSaveEditedMessage(msg.id);
                                        }
                                      }}
                                      rows={3}
                                      autoFocus
                                      aria-label="Editar mensagem"
                                      className="w-full p-2.5 rounded-xl bg-surface text-primary border border-border text-xs sm:text-sm leading-relaxed focus:outline-none focus:border-accent resize-y"
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={handleCancelEditMessage}
                                        className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveEditedMessage(msg.id)}
                                        disabled={isSendingChat || !editingMessageText.trim()}
                                        className="px-3 py-1 rounded-lg bg-surface-elevated hover:bg-surface-hover text-primary border border-border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
                                      >
                                        Salvar e reenviar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap select-text">
                                    {msg.content}
                                  </div>
                                )
                              ) : (
                                <MarkdownRenderer
                                  content={msg.content}
                                  graphsByKey={msg.generatedGraphs}
                                />
                              )}
                              <div
                                className={`flex items-center justify-between gap-3 pt-1.5 text-[10px] ${
                                  msg.role === 'user' ? 'opacity-80' : 'text-muted'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span>{formatChatBubbleTimestamp(msg.timestamp)}</span>
                                  {msg.modelUsed && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted font-mono">
                                      {msg.modelUsed}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {msg.role === 'user' && !isEditingThisMessage && (
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditMessage(msg)}
                                      disabled={isSendingChat}
                                      aria-label="Editar mensagem"
                                      className="inline-flex items-center justify-center p-1 rounded hover:bg-surface/20 text-accent-contrast group-hover:opacity-100 opacity-70 sm:opacity-0 focus:opacity-100 transition-opacity cursor-pointer disabled:opacity-40"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMessage(msg.id)}
                                    aria-label="Excluir mensagem"
                                    className={`inline-flex items-center justify-center p-1 rounded group-hover:opacity-100 opacity-70 sm:opacity-0 focus:opacity-100 transition-opacity cursor-pointer ${
                                      msg.role === 'user'
                                        ? 'hover:bg-surface/20 text-accent-contrast'
                                        : 'hover:bg-surface-hover text-muted hover:text-danger'
                                    }`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                  {msg.role === 'assistant' && (
                                    <button
                                      type="button"
                                      onClick={() => handleSpeakMessage(msg)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface hover:bg-surface-hover text-secondary border border-border cursor-pointer shrink-0"
                                    >
                                      {speakingMessageId === msg.id ? (
                                        <>
                                          <Square className="w-2.5 h-2.5 fill-current text-danger" />
                                          <span>Parar</span>
                                        </>
                                      ) : (
                                        <>
                                          <Volume2 className="w-2.5 h-2.5 text-accent" />
                                          <span>Ouvir</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Live Loading Bubble with Mandatory Active Model Name */}
                    {isSendingChat && liveStatusWithModel && (
                      <div className="flex flex-col items-start w-full">
                        <div className="w-[calc(100%-6rem)] sm:w-[calc(100%-7rem)] rounded-2xl rounded-bl-xs p-4 bg-surface border border-border shadow-xs flex items-center gap-2.5 text-xs text-secondary">
                          <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />
                          <span className="font-mono font-medium text-primary">
                            {liveStatusWithModel}
                          </span>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                </div>

                {/* Barra de Envio Fixa no Rodapé Alinhada sob max-w-4xl mx-auto w-full px-4 */}
                <div className="relative w-full shrink-0">
                  <AnimatePresence>
                    {isLiquidPopoverOpen && (
                      <div
                        className="absolute bottom-full inset-x-0 mb-2.5 z-30 pointer-events-none overflow-y-auto"
                        style={{ scrollbarGutter: 'stable' }}
                      >
                        <div className="max-w-4xl mx-auto w-full px-4">
                          <motion.div
                            ref={liquidPopoverMenuRef}
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.96 }}
                            transition={{ duration: 0.16 }}
                            className="ml-12 w-76 sm:w-84 p-4 rounded-2xl bg-surface border border-border shadow-md pointer-events-auto flex items-stretch gap-3.5"
                          >
                            {/* Left: Vertical Flask with Animated SVG Wave Liquid divided in 2 bands */}
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="relative w-8 h-36 rounded-2xl bg-surface-subtle border border-border overflow-hidden flex flex-col justify-end">
                                {/* Animated Fluid Liquid Body */}
                                <div
                                  className={`relative w-full bg-accent transition-all duration-500 ease-out ${
                                    isHighModelEffective ? 'opacity-90' : 'opacity-30'
                                  }`}
                                  style={{ height: `${liquidPercent}%` }}
                                >
                                  {/* Smooth Animated SVG Wave at Liquid Surface */}
                                  {liquidPercent > 0 && liquidPercent < 100 && (
                                    <motion.svg
                                      viewBox="0 0 120 12"
                                      preserveAspectRatio="none"
                                      animate={{ x: ['0%', '-50%'] }}
                                      transition={{
                                        repeat: Infinity,
                                        duration: 2.8,
                                        ease: 'linear',
                                      }}
                                      className="absolute -top-2 left-0 w-[200%] h-2.5 pointer-events-none"
                                      style={{ fill: 'var(--theme-accent)' }}
                                    >
                                      <path d="M0,6 Q15,0 30,6 T60,6 T90,6 T120,6 L120,12 L0,12 Z" />
                                    </motion.svg>
                                  )}
                                </div>

                                {/* Horizontal Divider Marks for 3.8 Flash (Top 20) and 3.6 Flash (Bottom 20) */}
                                <div className="absolute inset-x-0 top-1/2 -translate-y-px border-t-2 border-dashed border-border z-10" />
                                <div className="absolute left-0 top-1/4 w-2 border-t border-border/80 z-10" />
                                <div className="absolute right-0 top-1/4 w-2 border-t border-border/80 z-10" />
                                <div className="absolute left-0 top-3/4 w-2 border-t border-border/80 z-10" />
                                <div className="absolute right-0 top-3/4 w-2 border-t border-border/80 z-10" />
                              </div>

                              {/* Band Labels (3.8 Flash & 3.6 Flash) */}
                              <div className="h-36 flex flex-col justify-between py-1.5 text-[10px] font-mono text-secondary select-none">
                                <div className="space-y-0.5">
                                  <div className="font-bold text-primary">3.8 Flash</div>
                                  <div className="text-muted">{highQuota.remaining38}/20</div>
                                </div>
                                <div className="w-full border-t border-border" />
                                <div className="space-y-0.5">
                                  <div className="font-bold text-primary">3.6 Flash</div>
                                  <div className="text-muted">{highQuota.remaining36}/20</div>
                                </div>
                              </div>
                            </div>

                            {/* Right: Message, Balance (XX / 40) & Reused <LiveSwitch /> */}
                            <div className="flex-1 flex flex-col justify-between min-w-0">
                              <div className="space-y-1.5">
                                <p className="text-xs font-bold text-primary leading-snug">
                                  {isQuotaExhausted
                                    ? 'Limite diário dos modelos avançados esgotado'
                                    : 'Limite diário dos modelos avançados'}
                                </p>
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[11px] text-secondary">Saldo diário:</span>
                                  <span className="text-xs font-mono font-bold text-accent px-1.5 py-0.5 rounded-md bg-accent-subtle border border-accent-subtle-border">
                                    {highQuota.remainingTotal} / {HIGH_MODELS_DAILY_TOTAL_QUOTA}
                                  </span>
                                </div>
                                <p className="text-[10px] font-mono text-muted truncate">
                                  Ativo: {expectedActiveModelName}
                                </p>
                              </div>

                              <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-primary truncate">
                                    Modo Boost
                                  </div>
                                  <div className="text-[10px] text-muted truncate">
                                    {isQuotaExhausted ? 'Bloqueado hoje (0/40)' : 'Modelos avançados'}
                                  </div>
                                </div>
                                <LiveSwitch
                                  checked={isHighModelEffective}
                                  onChange={handleToggleHighModels}
                                  disabled={isQuotaExhausted}
                                  ariaLabel="Alternar Modo Boost"
                                />
                              </div>
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    )}
                  </AnimatePresence>

                  <footer
                    className="w-full bg-surface border-t border-border shrink-0 shadow-xs overflow-y-auto"
                    style={{ scrollbarGutter: 'stable' }}
                  >
                    <div className="max-w-4xl mx-auto w-full px-4">
                      {/* Live Status Bar Above Input (Always showing active model name) */}
                      {liveStatusWithModel && (
                        <div className="pt-2 pb-1 flex items-center gap-2 text-[11px] font-mono text-accent">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                          <span>{liveStatusWithModel}</span>
                        </div>
                      )}

                      {/* Compact Preview Chips for Pending Image/Audio Attachments */}
                      {pendingAttachments.length > 0 && (
                        <div className="pt-2.5 pb-0.5 flex flex-wrap items-center gap-2">
                          {pendingAttachments.map((att) => (
                            <div
                              key={att.id}
                              className="inline-flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-xl bg-surface-subtle border border-border text-xs text-primary max-w-[220px]"
                            >
                              {att.previewUrl ? (
                                <img
                                  src={att.previewUrl}
                                  alt={att.name}
                                  className="w-6 h-6 rounded object-cover border border-border shrink-0"
                                />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5 text-accent shrink-0" />
                              )}
                              <span className="truncate text-[11px] font-medium text-secondary">
                                {att.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveAttachment(att.id)}
                                className="p-0.5 rounded hover:bg-surface-hover text-muted hover:text-primary transition-colors cursor-pointer shrink-0"
                                aria-label={`Remover ${att.name}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Chat Input Bar Aligned with Message Bubbles:
                          - Left edge of Mic button === Left edge of AI bubble
                          - Right edge of Input === Right edge of AI bubble (calc(100% - 6rem) / sm:calc(100% - 7rem))
                          - Right edge of Enviar button === Right edge of User bubble
                      */}
                      <form
                        onSubmit={(e) => handleSendChatMessage(e)}
                        className="py-3 flex items-center gap-2 w-full"
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,audio/*"
                          multiple
                          className="hidden"
                          onChange={handleSelectAttachments}
                        />

                        <button
                          type="button"
                          onClick={handleToggleVoiceInput}
                          className={`w-10 h-10 rounded-xl border transition-colors cursor-pointer shrink-0 flex items-center justify-center ${
                            isListeningVoice
                              ? 'bg-danger text-danger-contrast border-transparent animate-pulse'
                              : 'bg-surface hover:bg-surface-hover text-secondary border-border'
                          }`}
                          aria-label={
                            isListeningVoice ? 'Parar ditado por voz' : 'Falar no Chat Geral'
                          }
                        >
                          {isListeningVoice ? (
                            <MicOff className="w-4 h-4" />
                          ) : (
                            <Mic className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-10 h-10 rounded-xl border border-border bg-surface hover:bg-surface-hover text-secondary hover:text-primary transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                          aria-label="Anexar imagem ou arquivo de áudio"
                        >
                          <Paperclip className="w-4 h-4" />
                        </button>

                        {/* Compact Square <ChevronsUp /> Button with Fluid Fill & Popover */}
                        <div className="relative shrink-0" ref={liquidPopoverRef}>
                          {/* Square <ChevronsUp /> Button with Proportional Fluid Background Fill */}
                          <button
                            type="button"
                            onClick={() => setIsLiquidPopoverOpen((prev) => !prev)}
                            className={`w-10 h-10 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-center ${
                              isHighModelEffective
                                ? 'border-accent text-accent shadow-2xs bg-surface'
                                : 'bg-surface hover:bg-surface-hover text-secondary border-border'
                            }`}
                            aria-label="Limite diário dos modelos avançados"
                          >
                            <div
                              className={`absolute bottom-0 inset-x-0 transition-all duration-500 ease-out pointer-events-none ${
                                isHighModelEffective ? 'bg-accent/25' : 'bg-accent/10'
                              }`}
                              style={{ height: `${liquidPercent}%` }}
                            >
                              {liquidPercent > 0 && liquidPercent < 100 && (
                                <motion.svg
                                  viewBox="0 0 120 12"
                                  preserveAspectRatio="none"
                                  animate={{ x: ['0%', '-50%'] }}
                                  transition={{
                                    repeat: Infinity,
                                    duration: 2.8,
                                    ease: 'linear',
                                  }}
                                  className="absolute -top-1 left-0 w-[200%] h-1.5 pointer-events-none opacity-25"
                                  style={{ fill: 'var(--theme-accent)' }}
                                >
                                  <path d="M0,6 Q15,0 30,6 T60,6 T90,6 T120,6 L120,12 L0,12 Z" />
                                </motion.svg>
                              )}
                            </div>
                            <ChevronsUp className="w-4 h-4 relative z-10" />
                          </button>
                        </div>

                        <textarea
                          ref={chatInputRef}
                          rows={1}
                          value={inputText}
                          onChange={(e) => {
                            const val = e.target.value;
                            setInputText(val);
                            confirmedTextRef.current = val;
                            sessionBaseConfirmedRef.current = val;
                            sessionLatestTranscriptRef.current = '';
                          }}
                          onPaste={handlePasteAttachment}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendChatMessage();
                            }
                          }}
                          placeholder="Tire dúvidas sobre suas questões ou peça um plano de estudo..."
                          className="flex-1 min-w-0 h-10 px-3.5 py-2.5 text-xs sm:text-sm rounded-xl theme-input bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent resize-none leading-tight overflow-y-auto"
                        />

                        <button
                          type="submit"
                          disabled={
                            isSendingChat ||
                            (!inputText.trim() && pendingAttachments.length === 0)
                          }
                          className="w-[5.5rem] sm:w-[6.5rem] h-10 inline-flex items-center justify-center gap-1.5 rounded-xl theme-btn-accent text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 shrink-0"
                        >
                          {isSendingChat ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Enviar</span>
                        </button>
                      </form>
                    </div>
                  </footer>
                </div>
              </div>
            )}

            {/* TAB 2: DIAGNÓSTICO (LISTA DE PRIORIDADES & LISTA DE REFORÇO) */}
            {activeTab === 'diagnosis' && (
              <div
                className="flex-1 overflow-y-auto"
                style={{ scrollbarGutter: 'stable' }}
              >
                <div className="max-w-4xl mx-auto w-full px-4 py-4 sm:py-6 space-y-4">
                  {isGeneratingDiagnosis ? (
                    <div className="py-12 text-center space-y-3">
                      <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
                      <p className="text-sm font-semibold text-primary">
                        Cruzando suas interações com a matriz do 2º Dia do ENEM...
                      </p>
                      {liveStatusWithModel && (
                        <p className="text-xs font-mono text-accent">{liveStatusWithModel}</p>
                      )}
                      <p className="text-xs text-muted max-w-md mx-auto">
                        Identificando prioridades de alto impacto nas questões fundamentais de Matemática e Ciências da Natureza.
                      </p>
                    </div>
                  ) : diagnosis ? (
                    <div className="space-y-4">
                      <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-border space-y-2 shadow-xs">
                        <div className="flex items-center justify-between text-[11px] text-muted">
                          <span className="font-semibold text-accent uppercase tracking-wider">
                            Síntese do Desempenho
                          </span>
                          <span>Atualizado {formatRelativeTime(diagnosis.generatedAt)}</span>
                        </div>
                        <p className="text-xs sm:text-sm text-primary leading-relaxed font-medium">
                          {diagnosis.summary}
                        </p>
                      </div>

                      {/* Lista 1: Lista de Prioridades (Dia 2 ENEM) */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-primary">
                          <Target className="w-4 h-4 text-accent" />
                          <h3>Lista de Prioridades (Dia 2 ENEM)</h3>
                        </div>

                        <div className="space-y-2.5">
                          {diagnosis.priorityList.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-4 rounded-xl bg-surface border border-border space-y-2 shadow-2xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs sm:text-sm font-bold text-primary">
                                  {idx + 1}. {item.topic}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-accent-subtle text-accent border border-border text-[10px] font-semibold">
                                  {item.subject}
                                </span>
                              </div>
                              <p className="text-xs text-secondary leading-relaxed">
                                {item.reason}
                              </p>
                              <div className="pt-1 text-[11px] font-medium text-accent flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Ação recomendada: {item.action}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Lista 2: Lista de Reforço */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-primary">
                          <ShieldCheck className="w-4 h-4 text-success" />
                          <h3>Lista de Reforço</h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {diagnosis.reinforcementList.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-surface border border-border space-y-1.5 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-primary">
                                  {item.topic}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-subtle border border-border text-muted">
                                  {item.subject}
                                </span>
                              </div>
                              <p className="text-[11px] text-secondary leading-relaxed">
                                {item.tip}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-12 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-accent-subtle border border-border text-accent flex items-center justify-center mx-auto">
                        <TrendingUp className="w-6 h-6" />
                      </div>
                      <div className="space-y-2 max-w-md mx-auto">
                        <h3 className="text-sm font-bold text-primary">
                          Nenhum diagnóstico gerado ainda
                        </h3>
                        <p className="text-xs text-muted leading-relaxed">
                          Acesse a aba <strong>“Melhore meu Aprendizado”</strong> para cruzar suas interações no Quat com os assuntos mais recorrentes de Matemática e Ciências da Natureza.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('improve')}
                          className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl theme-btn-accent text-xs font-semibold cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Ir para Melhore meu Aprendizado</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: MELHORE MEU APRENDIZADO (ABA DEDICADA COM PROGRESSO DE TOKENS DO QUAT) */}
            {activeTab === 'improve' && (
              <div
                className="flex-1 overflow-y-auto"
                style={{ scrollbarGutter: 'stable' }}
              >
                <div className="max-w-4xl mx-auto w-full px-4 py-4 sm:py-6 space-y-4">
                  <div className="p-5 sm:p-6 rounded-2xl bg-surface border border-border space-y-4 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-primary">
                          <TrendingUp className="w-4 h-4 text-accent" />
                          <span>Melhore meu Aprendizado</span>
                          <span className="text-xs font-mono text-muted">
                            ({tokenProgressPercent}% concluído)
                          </span>
                        </div>
                        {canHighlightLearningImprovement ? (
                          <p className="text-xs font-semibold text-accent">
                            Você pode ajudar a melhorar o aplicativo por aqui. As respostas ficam melhores e você analisa o seu desempenho
                          </p>
                        ) : (
                          <p className="text-xs text-secondary leading-relaxed">
                            {unanalyzedThreads.length > 0
                              ? `${unanalyzedThreads.length} ${
                                  unanalyzedThreads.length === 1
                                    ? 'questão com raciocínio pronto'
                                    : 'questões com raciocínios prontos'
                                } no Quat para cruzamento com o 2º Dia do ENEM.`
                              : 'Pratique questões com o Quat para alimentar e desbloquear seu diagnóstico de prioridades.'}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleImproveMyLearning}
                        disabled={isGeneratingDiagnosis}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer shrink-0 ${
                          canHighlightLearningImprovement
                            ? 'theme-btn-accent shadow-xs'
                            : 'bg-accent-subtle text-accent border border-accent-subtle-border hover:opacity-90'
                        } disabled:opacity-50`}
                      >
                        {isGeneratingDiagnosis ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Analisando...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Analisar Interações do Quat</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Progress Bar based on getAccumulatedTokens() (goal: 800 tokens) */}
                    <div className="space-y-1.5">
                      <div className="w-full h-2.5 rounded-full bg-surface-subtle border border-border overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-300"
                          style={{ width: `${tokenProgressPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted">
                        <span>Progresso de raciocínios coletados pelo Quat</span>
                        <span className="font-mono font-semibold text-primary">
                          {tokenProgressPercent}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* GLOBAL KEYBOARD-SHORTCUT SESSION DEBUG PANEL (Pure HTML / Monospace, Overlays Any Error/Blur) */}
      {isDebugPanelOpen && debugSnapshot && (
        <div
          role="dialog"
          aria-label="Painel Técnico de Debug de Sessão"
          className="fixed inset-0 z-[9999] w-screen h-[100dvh] bg-canvas text-primary font-mono text-xs overflow-y-auto p-4 sm:p-6 select-text"
        >
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-surface border border-border">
              <div>
                <h1 className="text-sm font-bold text-accent">
                  [SILENON SESSION DEBUG PANEL — TELEMETRIA COMPLETA DE ORQUESTRAÇÃO E ESTADO]
                </h1>
                <p className="text-[11px] text-muted">
                  Atalhos: F9 | Ctrl+Shift+L | Ctrl+Alt+D | Alt+Shift+D | Esc para fechar
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDebugRefreshTick((t) => t + 1)}
                  className="px-2.5 py-1 rounded bg-surface-subtle hover:bg-surface-hover border border-border text-primary cursor-pointer"
                >
                  Atualizar Agora
                </button>
                <button
                  type="button"
                  onClick={handleCopyDebugJson}
                  className="px-2.5 py-1 rounded bg-accent-subtle border border-accent-subtle-border text-accent font-bold cursor-pointer"
                >
                  {copiedDebugReport ? 'JSON Copiado!' : 'Copiar Dump JSON'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearOrchestratorDebugLogs();
                    setDebugRefreshTick((t) => t + 1);
                  }}
                  className="px-2.5 py-1 rounded bg-danger-bg border border-danger-border text-danger cursor-pointer"
                >
                  Limpar Logs
                </button>
                <button
                  type="button"
                  onClick={() => setIsDebugPanelOpen(false)}
                  className="px-2.5 py-1 rounded bg-surface-subtle hover:bg-surface-hover border border-border text-primary cursor-pointer"
                >
                  Fechar [Esc]
                </button>
              </div>
            </div>

            {/* 1. Estado Atual de Orquestração, Cotas e Chaves */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5">
                <div className="font-bold text-accent border-b border-border pb-1">
                  1. ORQUESTRADOR &amp; COTA 40 RPD (3.8 / 3.6 FLASH)
                </div>
                <div>Status ao Vivo: {debugSnapshot.orchestrator.currentLiveStatus || 'IDLE'}</div>
                <div>Modelo em Voo: {debugSnapshot.orchestrator.activeModelInFlight || 'NENHUM'}</div>
                <div>
                  Modo Boost Habilitado: {String(debugSnapshot.orchestrator.quotaState.enabled)} | Esgotado:{' '}
                  {String(debugSnapshot.orchestrator.quotaState.isExhausted)}
                </div>
                <div>
                  Saldo Total: {debugSnapshot.orchestrator.quotaState.remainingTotal} /{' '}
                  {debugSnapshot.orchestrator.quotaState.maxTotal} (Data:{' '}
                  {debugSnapshot.orchestrator.quotaState.dateKey})
                </div>
                <div>
                  gemini-3.8-flash: usados={debugSnapshot.orchestrator.quotaState.used38}, restantes=
                  {debugSnapshot.orchestrator.quotaState.remaining38}/20
                </div>
                <div>
                  gemini-3.6-flash: usados={debugSnapshot.orchestrator.quotaState.used36}, restantes=
                  {debugSnapshot.orchestrator.quotaState.remaining36}/20
                </div>
                <div>
                  Tokens Quat Acumulados: {debugSnapshot.orchestrator.accumulatedQuatTokens} /{' '}
                  {debugSnapshot.orchestrator.tokenGoal}
                </div>
                <div>
                  Chave Gemini: {debugSnapshot.orchestrator.keysStatus.geminiKey} | Chave Groq:{' '}
                  {debugSnapshot.orchestrator.keysStatus.groqKey}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5">
                <div className="font-bold text-accent border-b border-border pb-1">
                  2. DIVISÃO DE PAPÉIS &amp; AMBIENTE
                </div>
                <div>Strive (Boost): {debugSnapshot.orchestrator.architectureRoles.strivePrimaryBoost}</div>
                <div>
                  Strive (Padrão/0-40): {debugSnapshot.orchestrator.architectureRoles.striveStandardFallback}
                </div>
                <div>
                  Quat (Áudio/Voz): {debugSnapshot.orchestrator.architectureRoles.quatVoiceCaptureAndTTS}
                </div>
                <div>
                  Quat (Cérebro Socrático): {debugSnapshot.orchestrator.architectureRoles.quatSocraticBrain}
                </div>
                <div>
                  Aba Ativa: {debugSnapshot.uiState.activeTab} | Título: {debugSnapshot.uiState.headerTitle}
                </div>
                <div>
                  Questões: {debugSnapshot.uiState.questionsLoadedCount} | Respostas:{' '}
                  {debugSnapshot.uiState.flatAnswersCount} | Threads IDB:{' '}
                  {debugSnapshot.uiState.allQuestionThreadsInIDB} (Não analisadas:{' '}
                  {debugSnapshot.uiState.unanalyzedThreadsInIDB})
                </div>
                <div>
                  Hardware: RAM={(debugSnapshot.environment as any).deviceMemoryGB}GB | Cores=
                  {(debugSnapshot.environment as any).hardwareConcurrency} | Online=
                  {String((debugSnapshot.environment as any).onLine)}
                </div>
              </div>
            </div>

            {/* 2. Última Falha Registrada */}
            {debugSnapshot.orchestrator.lastError && (
              <div className="p-3 rounded-lg bg-danger-bg border border-danger-border text-danger space-y-1.5">
                <div className="font-bold">
                  ÚLTIMO ERRO DE IA ({debugSnapshot.orchestrator.lastError.isoTime}) — Fluxo:{' '}
                  {debugSnapshot.orchestrator.lastError.flow} | Modelo:{' '}
                  {debugSnapshot.orchestrator.lastError.model}
                </div>
                <pre className="whitespace-pre-wrap break-words text-[11px]">
                  {debugSnapshot.orchestrator.lastError.message}
                </pre>
                {debugSnapshot.orchestrator.lastError.serverAttempts && (
                  <pre className="whitespace-pre-wrap break-words text-[10px] bg-surface p-2 rounded border border-border text-primary">
                    {JSON.stringify(debugSnapshot.orchestrator.lastError.serverAttempts, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* 3. Linha do Tempo Universal Automática da Sessão (sessionUniversalLogs) */}
            <div className="p-3 rounded-lg bg-surface border border-border space-y-2">
              <div className="font-bold text-accent border-b border-border pb-1">
                3. LOG UNIVERSAL AUTOMÁTICO DA SESSÃO — REDE, IA, CONSOLE &amp; EXCEÇÕES (
                {debugSnapshot.orchestrator.sessionUniversalLogs.length})
              </div>
              {debugSnapshot.orchestrator.sessionUniversalLogs.length === 0 ? (
                <div className="text-muted">Nenhum evento registrado nesta sessão ainda.</div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {debugSnapshot.orchestrator.sessionUniversalLogs.map((uLog) => (
                    <div
                      key={uLog.id}
                      className="p-2.5 rounded bg-surface-subtle border border-border space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                        <span>
                          [{uLog.isoTime}] [{uLog.category.toUpperCase()}] {uLog.source}
                          {uLog.model ? ` | model=${uLog.model}` : ''}
                          {uLog.url ? ` | url=${uLog.url}` : ''}
                        </span>
                        <span
                          className={
                            uLog.level === 'error'
                              ? 'text-danger'
                              : uLog.level === 'warn'
                              ? 'text-accent'
                              : 'text-success'
                          }
                        >
                          {uLog.level.toUpperCase()}
                          {typeof uLog.durationMs === 'number' ? ` (${uLog.durationMs}ms` : ''}
                          {typeof uLog.status === 'number'
                            ? `${typeof uLog.durationMs === 'number' ? ', ' : ' ('}HTTP ${uLog.status})`
                            : typeof uLog.durationMs === 'number'
                            ? ')'
                            : ''}
                        </span>
                      </div>
                      <div className="text-[11px] text-primary break-words">{uLog.message}</div>
                      {uLog.attempts && uLog.attempts.length > 0 && (
                        <pre className="text-[10px] text-secondary whitespace-pre-wrap break-words bg-surface p-1.5 rounded border border-border">
                          Attempts: {JSON.stringify(uLog.attempts, null, 2)}
                        </pre>
                      )}
                      {uLog.error && (
                        <pre className="text-[11px] text-danger whitespace-pre-wrap break-words">
                          Erro Completo: {uLog.error}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Histórico Detalhado de Requisições de IA da Sessão */}
            <div className="p-3 rounded-lg bg-surface border border-border space-y-2">
              <div className="font-bold text-accent border-b border-border pb-1">
                4. LOGS DE FLUXOS DE IA NA SESSÃO ({debugSnapshot.orchestrator.requestLogs.length})
              </div>
              {debugSnapshot.orchestrator.requestLogs.length === 0 ? (
                <div className="text-muted">Nenhuma requisição disparada nesta sessão ainda.</div>
              ) : (
                <div className="space-y-2.5">
                  {debugSnapshot.orchestrator.requestLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 rounded bg-surface-subtle border border-border space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                        <span>
                          [{log.isoTime}] Fluxo={log.flow} | Solicitado={log.requestedModel} | Resolvido=
                          {log.resolvedModel}
                          {log.upstreamModelUsed ? ` (Upstream=${log.upstreamModelUsed})` : ''}
                          {log.thinkingLevel ? ` | thinking=${log.thinkingLevel}` : ''}
                        </span>
                        <span
                          className={
                            log.outcome === 'error'
                              ? 'text-danger'
                              : log.outcome === 'fallback'
                              ? 'text-accent'
                              : 'text-success'
                          }
                        >
                          {log.outcome.toUpperCase()} ({log.durationMs}ms, HTTP {log.httpStatus ?? 'N/A'})
                        </span>
                      </div>
                      {log.statusTransitions.length > 0 && (
                        <div className="text-[10px] text-secondary">
                          Status: {log.statusTransitions.join(' -> ')}
                        </div>
                      )}
                      {log.serverAttempts && log.serverAttempts.length > 0 && (
                        <pre className="text-[10px] text-secondary whitespace-pre-wrap break-words bg-surface p-1.5 rounded border border-border">
                          Tentativas no Servidor: {JSON.stringify(log.serverAttempts)}
                        </pre>
                      )}
                      {log.errorMessage && (
                        <pre className="text-[11px] text-danger whitespace-pre-wrap break-words">
                          Erro Exato: {log.errorMessage}
                        </pre>
                      )}
                      {log.responsePreview && (
                        <div className="text-[10px] text-muted truncate">
                          Resposta: {log.responsePreview}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Dump Completo de Estado em JSON */}
            <div className="p-3 rounded-lg bg-surface border border-border space-y-2">
              <div className="font-bold text-accent border-b border-border pb-1">
                5. DUMP COMPLETO DO ESTADO DA SESSÃO (JSON)
              </div>
              <pre className="text-[10px] text-secondary whitespace-pre-wrap break-words max-h-96 overflow-y-auto p-2 rounded bg-surface-subtle border border-border">
                {JSON.stringify(debugSnapshot, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
};



import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  Mic,
  Pause,
  Play,
  Square,
  Send,
  ChevronDown,
  ChevronUp,
  Brain,
  MessageSquare,
  Volume2,
  X,
  Loader2,
  AlertCircle,
  FileText,
  GripHorizontal,
} from 'lucide-react';
import { Question } from '../types/question';
import {
  hasAnyAIKey,
  isVoiceOnboardingDone,
  runSocraticQuestionAnalysis,
  formatRelativeTime,
} from '../lib/aiOrchestrator';
import {
  getQuestionThread,
  saveQuestionInteraction,
  truncateInteractionSpokenResponse,
  QuestionChatInteraction,
} from '../lib/questionChatStorage';
import { VoiceOnboardingModal } from './VoiceOnboardingModal';

interface QuestionVoiceBarProps {
  question: Question;
  onRequireAPIKey: () => void;
}

export const QuestionVoiceBar: React.FC<QuestionVoiceBarProps> = ({
  question,
  onRequireAPIKey,
}) => {
  const [interactions, setInteractions] = useState<QuestionChatInteraction[]>([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({});
  const [expandedContextIds, setExpandedContextIds] = useState<Record<string, boolean>>({});

  // Recording states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [draftTranscript, setDraftTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // SpeechSynthesis playback states
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState<boolean>(false);
  const [activeSpeakingInteractionId, setActiveSpeakingInteractionId] = useState<string | null>(null);

  // Onboarding modal state
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);

  // Drag controls & viewport bounds for floating popup
  const dragControls = useDragControls();
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Refs for continuous SpeechRecognition & Barge-in speech tracking
  const isRecordingRef = useRef<boolean>(false);
  const shouldRestartSpeechRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const finalizedTranscriptRef = useRef<string>('');

  const fullSpokenTextRef = useRef<string>('');
  const spokenCharIndexRef = useRef<number>(0);
  const boundaryFiredRef = useRef<boolean>(false);
  const speechStartTimeRef = useRef<number>(0);
  const speechAccumulatedMsRef = useRef<number>(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeInteractionIdRef = useRef<string | null>(null);
  const currentQuestionIdRef = useRef<number>(question.sequence_id);

  const clearFallbackTimer = () => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  };

  const stopSpeechCleanup = useCallback(() => {
    clearFallbackTimer();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    setIsSpeaking(false);
    setIsSpeechPaused(false);
    setActiveSpeakingInteractionId(null);
    activeInteractionIdRef.current = null;
  }, []);

  const stopRecordingInternal = useCallback(() => {
    isRecordingRef.current = false;
    shouldRestartSpeechRef.current = false;
    setIsRecording(false);
    setInterimTranscript('');
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
  }, []);

  const handleCancelRecording = useCallback(() => {
    stopRecordingInternal();
    setDraftTranscript('');
    setInterimTranscript('');
    finalizedTranscriptRef.current = '';
    setErrorBanner(null);
  }, [stopRecordingInternal]);

  // Load isolated question thread from IndexedDB whenever question.sequence_id changes
  useEffect(() => {
    currentQuestionIdRef.current = question.sequence_id;
    stopRecordingInternal();
    stopSpeechCleanup();
    setDraftTranscript('');
    setInterimTranscript('');
    finalizedTranscriptRef.current = '';
    setErrorBanner(null);
    setIsHistoryExpanded(false);

    let cancelled = false;
    getQuestionThread(question.sequence_id).then((thread) => {
      if (cancelled) return;
      if (thread && Array.isArray(thread.interactions)) {
        setInteractions(thread.interactions);
      } else {
        setInteractions([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [question.sequence_id, stopRecordingInternal, stopSpeechCleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecordingInternal();
      stopSpeechCleanup();
    };
  }, [stopRecordingInternal, stopSpeechCleanup]);

  // Start SpeechSynthesis playback with real-time onboundary + proportional timer tracking
  const speakResponseAloud = useCallback(
    (fullText: string, interactionId: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !fullText) {
        return;
      }

      stopSpeechCleanup();

      try {
        const utterance = new SpeechSynthesisUtterance(fullText);
        utterance.lang = 'pt-BR';
        utterance.rate = 1.04;

        const voices = window.speechSynthesis.getVoices();
        const ptVoice =
          voices.find(v => v.lang.toLowerCase().includes('pt-br') && v.name.toLowerCase().includes('natural')) ||
          voices.find(v => v.lang.toLowerCase().includes('pt-br')) ||
          voices.find(v => v.lang.toLowerCase().startsWith('pt'));
        if (ptVoice) {
          utterance.voice = ptVoice;
        }

        fullSpokenTextRef.current = fullText;
        spokenCharIndexRef.current = 0;
        boundaryFiredRef.current = false;
        speechStartTimeRef.current = Date.now();
        speechAccumulatedMsRef.current = 0;
        activeInteractionIdRef.current = interactionId;

        const estimatedTotalMs = Math.max(1500, (fullText.length / 14.5) * 1000);

        utterance.onboundary = (event: SpeechSynthesisEvent) => {
          if (typeof event.charIndex === 'number') {
            boundaryFiredRef.current = true;
            const len = typeof event.charLength === 'number' && event.charLength > 0 ? event.charLength : 6;
            spokenCharIndexRef.current = Math.min(fullText.length, event.charIndex + len);
          }
        };

        utterance.onstart = () => {
          speechStartTimeRef.current = Date.now();
          setIsSpeaking(true);
          setIsSpeechPaused(false);
          setActiveSpeakingInteractionId(interactionId);

          clearFallbackTimer();
          fallbackTimerRef.current = setInterval(() => {
            if (boundaryFiredRef.current) return;
            const now = Date.now();
            const elapsed = speechAccumulatedMsRef.current + (now - speechStartTimeRef.current);
            const ratio = Math.min(1, elapsed / estimatedTotalMs);
            spokenCharIndexRef.current = Math.max(
              spokenCharIndexRef.current,
              Math.floor(ratio * fullText.length)
            );
          }, 120);
        };

        utterance.onend = () => {
          spokenCharIndexRef.current = fullText.length;
          clearFallbackTimer();
          setIsSpeaking(false);
          setIsSpeechPaused(false);
          setActiveSpeakingInteractionId(null);
          activeInteractionIdRef.current = null;
        };

        utterance.onerror = () => {
          clearFallbackTimer();
          setIsSpeaking(false);
          setIsSpeechPaused(false);
          setActiveSpeakingInteractionId(null);
          activeInteractionIdRef.current = null;
        };

        setIsSpeaking(true);
        setIsSpeechPaused(false);
        setActiveSpeakingInteractionId(interactionId);
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[QuestionVoiceBar] SpeechSynthesis error:', err);
        setIsSpeaking(false);
      }
    },
    [stopSpeechCleanup]
  );

  // Snap partial text cleanly to a word boundary
  const computePartialSpokenText = (): string => {
    const fullText = fullSpokenTextRef.current;
    if (!fullText) return '';

    let charLimit = spokenCharIndexRef.current;
    if (charLimit <= 0) {
      charLimit = Math.min(fullText.length, 28);
    }

    if (charLimit >= fullText.length) {
      return fullText;
    }

    while (charLimit < fullText.length && !/\s/.test(fullText[charLimit])) {
      charLimit++;
    }

    return fullText.slice(0, charLimit).trim();
  };

  // Start continuous microphone recording with separate shouldRestartSpeechRef to prevent permission error loops
  const startMicrophoneSession = useCallback(() => {
    setErrorBanner(null);
    setIsHistoryExpanded(true);

    const SpeechRecognitionAPI =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionAPI) {
      isRecordingRef.current = false;
      shouldRestartSpeechRef.current = false;
      setIsRecording(false);
      setInterimTranscript('');
      setErrorBanner(
        'Reconhecimento de voz não disponível neste navegador. Digite seu raciocínio no campo abaixo.'
      );
      return;
    }

    isRecordingRef.current = true;
    shouldRestartSpeechRef.current = true;
    setIsRecording(true);

    const createAndStartInstance = () => {
      if (!isRecordingRef.current || !shouldRestartSpeechRef.current) return;
      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = 'pt-BR';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
          let newFinalChunk = '';
          let currentInterim = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPiece = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) {
              newFinalChunk += transcriptPiece + ' ';
            } else {
              currentInterim += transcriptPiece;
            }
          }

          if (newFinalChunk) {
            const combined = (finalizedTranscriptRef.current + ' ' + newFinalChunk).replace(/\s+/g, ' ').trim();
            finalizedTranscriptRef.current = combined;
            setDraftTranscript(combined);
          }
          setInterimTranscript(currentInterim);
        };

        recognition.onerror = (event: any) => {
          const errCode = String(event?.error || '').toLowerCase();
          if (errCode === 'no-speech') {
            return;
          }
          if (
            errCode === 'not-allowed' ||
            errCode === 'service-not-allowed' ||
            errCode === 'audio-capture'
          ) {
            isRecordingRef.current = false;
            shouldRestartSpeechRef.current = false;
            setIsRecording(false);
            setInterimTranscript('');
            try {
              recognition.onend = null;
              recognition.abort?.();
              recognition.stop?.();
            } catch {
              // Ignore
            }
            recognitionRef.current = null;
            setErrorBanner(
              'Permissão de microfone negada no navegador. Você também pode digitar seu raciocínio abaixo.'
            );
          }
        };

        recognition.onend = () => {
          if (isRecordingRef.current && shouldRestartSpeechRef.current) {
            setTimeout(() => {
              if (isRecordingRef.current && shouldRestartSpeechRef.current) {
                createAndStartInstance();
              }
            }, 150);
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch {
        isRecordingRef.current = false;
        shouldRestartSpeechRef.current = false;
        setIsRecording(false);
        setInterimTranscript('');
        setErrorBanner(
          'Não foi possível iniciar o microfone neste ambiente. Digite seu raciocínio no campo abaixo.'
        );
      }
    };

    createAndStartInstance();
  }, []);

  // Handle Microphone button click (including Barge-in interruption or immediate cancel when already recording)
  const handleMicButtonClick = async () => {
    // 1. Check BYOK keys first
    if (!hasAnyAIKey()) {
      onRequireAPIKey();
      return;
    }

    // 2. BARGE-IN: If Assistant is currently speaking, interrupt immediately, slice spoken text, save only what was spoken, and start recording!
    if (isSpeaking && activeInteractionIdRef.current) {
      const interruptedInteractionId = activeInteractionIdRef.current;
      const partialSpoken = computePartialSpokenText();

      stopSpeechCleanup();

      if (partialSpoken) {
        setInteractions(prev =>
          prev.map(item =>
            item.id === interruptedInteractionId
              ? { ...item, aiSpokenResponse: partialSpoken, wasInterrupted: true, updatedAt: Date.now() }
              : item
          )
        );

        await truncateInteractionSpokenResponse(
          currentQuestionIdRef.current,
          interruptedInteractionId,
          partialSpoken
        );
      }

      finalizedTranscriptRef.current = '';
      setDraftTranscript('');
      setInterimTranscript('');
      startMicrophoneSession();
      return;
    }

    // 3. If currently recording ("Ouvindo..."), cancel recording immediately and return to idle state
    if (isRecording) {
      handleCancelRecording();
      return;
    }

    // 4. Check first-time Voice Onboarding
    if (!isVoiceOnboardingDone()) {
      setIsOnboardingOpen(true);
      return;
    }

    // 5. Start recording session
    finalizedTranscriptRef.current = draftTranscript;
    startMicrophoneSession();
  };

  // Pause / Resume Assistant Speech
  const handleTogglePauseSpeech = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (isSpeechPaused) {
      speechStartTimeRef.current = Date.now();
      window.speechSynthesis.resume();
      setIsSpeechPaused(false);
    } else {
      speechAccumulatedMsRef.current += Date.now() - speechStartTimeRef.current;
      window.speechSynthesis.pause();
      setIsSpeechPaused(true);
    }
  };

  // Stop Assistant Speech (also truncating to what was spoken up to the stop click)
  const handleStopSpeech = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const interruptedInteractionId = activeInteractionIdRef.current;
    const partialSpoken = computePartialSpokenText();
    stopSpeechCleanup();

    if (interruptedInteractionId && partialSpoken) {
      setInteractions(prev =>
        prev.map(item =>
          item.id === interruptedInteractionId
            ? { ...item, aiSpokenResponse: partialSpoken, wasInterrupted: true, updatedAt: Date.now() }
            : item
        )
      );
      await truncateInteractionSpokenResponse(
        currentQuestionIdRef.current,
        interruptedInteractionId,
        partialSpoken
      );
    }
  };

  // Submit student's reasoning to Quat
  const handleSubmitReasoning = async () => {
    const fullStudentText = [draftTranscript, interimTranscript].filter(Boolean).join(' ').trim();
    if (!fullStudentText) {
      setErrorBanner('Fale ou digite seu raciocínio antes de enviar para o Quat.');
      return;
    }

    if (!hasAnyAIKey()) {
      onRequireAPIKey();
      return;
    }

    stopRecordingInternal();
    setIsLoadingAI(true);
    setErrorBanner(null);
    setIsHistoryExpanded(true);

    try {
      const result = await runSocraticQuestionAnalysis({
        question,
        studentTranscript: fullStudentText,
        previousInteractions: interactions.map(i => ({
          studentTranscript: i.studentTranscript,
          aiSpokenResponse: i.aiSpokenResponse,
        })),
      });

      const stemSummary =
        question.stem.full_text.length > 260
          ? `${question.stem.full_text.slice(0, 260)}...`
          : question.stem.full_text;
      const questionStemAndAnswer = `Enunciado (#${question.sequence_id}): ${stemSummary} | Gabarito Oficial: Alternativa ${question.resolution.deduced_answer}`;
      const questionTags = Array.from(
        new Set([question.metadata.subject, ...(question.metadata.topics || [])])
      );

      const { thread, interaction } = await saveQuestionInteraction({
        questionId: question.sequence_id,
        subject: question.metadata.subject,
        questionTags,
        questionStemAndAnswer,
        studentTranscript: fullStudentText,
        aiInternalReasoning: result.internal_reasoning,
        aiSpokenResponse: result.spoken_response,
        responseType: result.response_type,
        blockingTags: result.blocking_tags,
        wasInterrupted: false,
      });

      setInteractions(thread.interactions);
      setIsHistoryExpanded(true);
      setDraftTranscript('');
      setInterimTranscript('');
      finalizedTranscriptRef.current = '';

      speakResponseAloud(result.spoken_response, interaction.id);
    } catch (err: any) {
      console.error('[QuestionVoiceBar] Error calling AI:', err);
      setErrorBanner(err?.message || 'Erro ao consultar o Quat. Verifique suas chaves de API.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const combinedLiveTranscript = [draftTranscript, interimTranscript].filter(Boolean).join(' ');

  const isFloatingPopupOpen =
    isRecording ||
    isLoadingAI ||
    isSpeaking ||
    isHistoryExpanded ||
    draftTranscript.length > 0 ||
    interimTranscript.length > 0 ||
    Boolean(errorBanner);

  const handleCloseFloatingPopup = () => {
    if (isRecording && !combinedLiveTranscript.trim()) {
      handleCancelRecording();
    } else if (isRecording) {
      stopRecordingInternal();
    }
    setErrorBanner(null);
    setIsHistoryExpanded(false);
  };

  const renderMicControls = (compact: boolean = false) => (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      className={`inline-flex items-center gap-1.5 p-1 rounded-xl border transition-all duration-300 ${
        isSpeaking
          ? 'bg-accent-subtle border-accent-subtle-border shadow-xs'
          : isRecording
          ? 'bg-danger-bg border-danger-border shadow-xs'
          : 'bg-surface border-border hover:border-border-hover'
      }`}
    >
      <button
        type="button"
        onClick={handleMicButtonClick}
        disabled={isLoadingAI}
        className={`inline-flex items-center gap-1.5 ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5'
        } rounded-lg text-xs font-semibold transition-all cursor-pointer ${
          isRecording
            ? 'bg-danger text-danger-contrast'
            : isSpeaking
            ? 'bg-accent text-accent-contrast'
            : 'theme-btn-accent'
        } disabled:opacity-50`}
        title={
          isSpeaking
            ? 'Interromper a fala do Quat no ponto atual e iniciar gravação'
            : isRecording
            ? 'Clique para cancelar a gravação'
            : 'Falar raciocínio com o Quat'
        }
      >
        {isLoadingAI ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Analisando...</span>
          </>
        ) : (
          <>
            <Mic className={`w-3.5 h-3.5 ${isRecording ? 'animate-pulse' : ''}`} />
            <span>
              {isSpeaking
                ? 'Interromper e Falar'
                : isRecording
                ? 'Ouvindo...'
                : 'Falar Raciocínio'}
            </span>
          </>
        )}
      </button>

      <AnimatePresence>
        {isSpeaking && (
          <>
            <motion.button
              key="voice-pause-resume-btn"
              type="button"
              initial={{ width: 1, height: 1, scale: 0.05, opacity: 0 }}
              animate={{ width: 30, height: 30, scale: 1, opacity: 1 }}
              exit={{ width: 1, height: 1, scale: 0.05, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
              onClick={handleTogglePauseSpeech}
              className="flex items-center justify-center rounded-lg bg-surface hover:bg-surface-hover text-primary border border-border cursor-pointer overflow-hidden shrink-0"
              title={isSpeechPaused ? 'Retomar fala do Quat' : 'Pausar fala do Quat'}
              aria-label={isSpeechPaused ? 'Retomar fala' : 'Pausar fala'}
            >
              {isSpeechPaused ? (
                <Play className="w-3.5 h-3.5 fill-current text-accent" />
              ) : (
                <Pause className="w-3.5 h-3.5 text-primary" />
              )}
            </motion.button>

            <motion.button
              key="voice-stop-btn"
              type="button"
              initial={{ width: 1, height: 1, scale: 0.05, opacity: 0 }}
              animate={{ width: 30, height: 30, scale: 1, opacity: 1 }}
              exit={{ width: 1, height: 1, scale: 0.05, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 24, delay: 0.03 }}
              onClick={handleStopSpeech}
              className="flex items-center justify-center rounded-lg bg-danger-bg hover:opacity-90 text-danger border border-danger-border cursor-pointer overflow-hidden shrink-0"
              title="Parar fala do Quat (salva apenas até o trecho falado)"
              aria-label="Parar fala"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </motion.button>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return (
    <div className="pt-3 border-t border-border select-none">
      {/* Compact Footer Bar inside QuestionCard */}
      <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-2.5 transition-all">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Clean Quat Identity & Status */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-primary theme-text-primary truncate">
                  Quat
                </span>
                {interactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsHistoryExpanded(prev => !prev)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface hover:bg-surface-hover border border-border text-secondary font-semibold transition-colors cursor-pointer"
                  >
                    {interactions.length} {interactions.length === 1 ? 'interação' : 'interações'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted truncate">
                {isSpeaking
                  ? isSpeechPaused
                    ? 'Fala pausada. Clique no microfone para interromper e falar'
                    : 'Quat falando na janela flutuante'
                  : isRecording
                  ? 'Microfone aberto na janela flutuante'
                  : 'Explique seu raciocínio em voz alta para analisar suas dificuldades'}
              </p>
            </div>
          </div>

          {/* Right: Microphone Controls + Toggle Floating Window Button */}
          <div className="flex items-center gap-2 shrink-0">
            {renderMicControls(false)}

            {interactions.length > 0 && (
              <button
                type="button"
                onClick={() => setIsHistoryExpanded(prev => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-surface hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
                title={isFloatingPopupOpen ? 'Minimizar janela do Quat' : 'Abrir janela do Quat'}
              >
                <MessageSquare className="w-3.5 h-3.5 text-accent" />
                {isFloatingPopupOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Draggable Compact Floating Popup via Portal (Visible anywhere on screen) */}
      {isFloatingPopupOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragElastic={0.08}
            dragConstraints={{
              left: -Math.max(0, viewportSize.w - 380),
              right: 0,
              top: -Math.max(0, viewportSize.h - 140),
              bottom: 0,
            }}
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="fixed bottom-5 right-5 z-30 w-[340px] sm:w-[370px] max-w-[calc(100vw-24px)] max-h-[420px] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden select-none"
          >
            {/* Draggable Header Bar */}
            <div
              onPointerDown={(e) => {
                if (!(e.target as HTMLElement).closest('button')) {
                  dragControls.start(e);
                }
              }}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-surface-subtle border-b border-border cursor-grab active:cursor-grabbing select-none touch-none shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-accent-subtle border border-accent-subtle-border text-accent flex items-center justify-center shrink-0">
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-bold text-primary theme-text-primary truncate">
                  Quat
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-secondary font-semibold shrink-0">
                  #{question.sequence_id}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <GripHorizontal className="w-3.5 h-3.5 text-muted pointer-events-none" />
                <button
                  type="button"
                  onClick={handleCloseFloatingPopup}
                  className="p-1 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                  title="Minimizar janela do Quat"
                  aria-label="Fechar janela do Quat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Body of the Floating Popup */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {/* Top Action Row inside Popup: Mic / Pause / Stop Controls */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-secondary font-medium truncate">
                  {isSpeaking
                    ? isSpeechPaused
                      ? 'Fala pausada'
                      : 'Respondendo em voz alta...'
                    : isRecording
                    ? 'Microfone ativo'
                    : 'Explique ou digite seu raciocínio'}
                </span>
                {renderMicControls(true)}
              </div>

              {/* Error / Permission Notice (Automatically cleared when closing popup or starting a valid recording) */}
              {errorBanner && (
                <div className="p-2.5 rounded-xl bg-danger-bg border border-danger-border text-danger text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-snug">{errorBanner}</span>
                </div>
              )}

              {/* Live Streaming Transcript / Clean Reasoning Input Box */}
              {(isRecording ||
                draftTranscript.length > 0 ||
                interimTranscript.length > 0 ||
                Boolean(errorBanner) ||
                interactions.length === 0) && (
                <div className="p-3 rounded-xl bg-surface-subtle border border-border space-y-2.5">
                  {isRecording ? (
                    <div className="flex items-center justify-between gap-2 text-[11px] text-secondary">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <span className="ml-1 relative flex h-2.5 w-2.5 items-center justify-center shrink-0">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                        </span>
                        <span>Ouvindo — sua fala aparecerá aqui em tempo real</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelRecording}
                        className="inline-flex items-center gap-1 text-muted hover:text-danger transition-colors cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  ) : (
                    combinedLiveTranscript.length > 0 && (
                      <div className="flex items-center justify-end text-[11px]">
                        <button
                          type="button"
                          onClick={handleCancelRecording}
                          className="inline-flex items-center gap-1 text-muted hover:text-danger transition-colors cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>Limpar</span>
                        </button>
                      </div>
                    )
                  )}

                  <textarea
                    rows={2}
                    value={combinedLiveTranscript}
                    onChange={(e) => {
                      finalizedTranscriptRef.current = e.target.value;
                      setDraftTranscript(e.target.value);
                      setInterimTranscript('');
                    }}
                    placeholder="Fale em voz alta ou digite como você pensou nesta questão..."
                    className="w-full rounded-lg p-2 text-xs bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent resize-none leading-relaxed"
                  />

                  <button
                    type="button"
                    onClick={handleSubmitReasoning}
                    disabled={isLoadingAI || !combinedLiveTranscript.trim()}
                    className="w-full py-2 px-3 rounded-lg theme-btn-accent font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isLoadingAI ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Analisando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Enviar raciocínio para o Quat</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Compact List of Socratic Interactions for Current Question */}
              {interactions.length > 0 && (
                <div className="space-y-2">
                  {interactions.map((item, idx) => {
                    const isReasoningOpen = Boolean(expandedReasoningIds[item.id]);
                    const isContextOpen = Boolean(expandedContextIds[item.id]);
                    const isThisItemSpeaking = isSpeaking && activeSpeakingInteractionId === item.id;

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-border bg-surface-subtle p-3 space-y-2 text-xs"
                      >
                        {/* Interaction Header */}
                        <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-border">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-subtle text-accent border border-accent-subtle-border font-semibold text-[10px]">
                              <MessageSquare className="w-2.5 h-2.5" />
                              <span>Quat #{idx + 1}</span>
                            </span>
                            {item.wasInterrupted && (
                              <span className="px-1.5 py-0.5 rounded bg-surface text-muted border border-border text-[9px] font-medium">
                                Interrompido
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted">
                            {formatRelativeTime(item.updatedAt || item.createdAt)}
                          </span>
                        </div>

                        {/* Student Transcript */}
                        <div className="p-2 rounded-lg bg-surface border border-border space-y-0.5">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
                            Sua Fala
                          </div>
                          <p className="text-primary theme-text-primary leading-relaxed select-text text-[11px]">
                            “{item.studentTranscript}”
                          </p>
                        </div>

                        {/* Quat Response */}
                        <div className="p-2.5 rounded-lg bg-surface border border-border space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              <span>Resposta</span>
                            </span>

                            <button
                              type="button"
                              onClick={() => speakResponseAloud(item.aiSpokenResponse, item.id)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border text-[10px] font-medium transition-colors cursor-pointer"
                              title="Ouvir esta resposta novamente"
                            >
                              <Volume2 className={`w-3 h-3 ${isThisItemSpeaking ? 'text-accent animate-pulse' : ''}`} />
                              <span>{isThisItemSpeaking ? 'Falando...' : 'Ouvir'}</span>
                            </button>
                          </div>
                          <p className="text-primary theme-text-primary text-xs leading-relaxed font-medium select-text">
                            {item.aiSpokenResponse}
                          </p>
                        </div>

                        {/* Expandable Details (Reasoning & Context) */}
                        <div className="flex flex-wrap items-center gap-3 pt-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedReasoningIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline cursor-pointer"
                          >
                            <Brain className="w-3 h-3" />
                            <span>{isReasoningOpen ? 'Ocultar Análise' : 'Ver Análise'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedContextIds(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted hover:text-primary transition-colors cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>{isContextOpen ? 'Ocultar Questão' : 'Referência'}</span>
                          </button>
                        </div>

                        {isReasoningOpen && (
                          <div className="p-2 rounded-lg bg-accent-subtle border border-accent-subtle-border text-secondary text-[11px] leading-relaxed select-text">
                            {item.aiInternalReasoning}
                          </div>
                        )}

                        {isContextOpen && (
                          <div className="p-2 rounded-lg bg-surface border border-border text-[10px] text-secondary font-mono leading-relaxed">
                            {item.questionStemAndAnswer}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>,
          document.body
        )}

      {/* First-Time Voice Onboarding Modal */}
      <VoiceOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onAuthorized={() => {
          setIsOnboardingOpen(false);
          finalizedTranscriptRef.current = draftTranscript;
          startMicrophoneSession();
        }}
      />
    </div>
  );
};

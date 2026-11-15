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
  VolumeX,
  RotateCcw,
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
  notifyQuatNativeAudioDialog,
  sanitizeTextForSpeech,
  mapToStudentFriendlyError,
  formatRelativeTime,
} from '../lib/aiOrchestrator';
import {
  getQuestionThread,
  saveQuestionInteraction,
  truncateInteractionSpokenResponse,
  QuestionChatInteraction,
} from '../lib/questionChatStorage';
import { VoiceOnboardingModal } from './VoiceOnboardingModal';

function base64AudioToBlobUrl(base64: string, mimeType: string): string {
  const clean = base64.replace(/^data:[^;]+;base64,/i, '').trim();
  const binaryStr = window.atob(clean);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
  return URL.createObjectURL(blob);
}

function normalizeForSpeechDedup(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function joinCleanSpeech(baseText: string, newSegment: string): string {
  const cleanBase = baseText.replace(/\s+/g, ' ').trim();
  const cleanNew = newSegment.replace(/\s+/g, ' ').trim();

  if (!cleanNew) return cleanBase;
  if (!cleanBase) return cleanNew;

  const normBase = normalizeForSpeechDedup(cleanBase);
  const normNew = normalizeForSpeechDedup(cleanNew);

  if (!normNew) return cleanBase;
  if (normBase === normNew) return cleanBase;

  if (normNew.startsWith(normBase)) {
    return cleanNew;
  }

  if (normBase.endsWith(normNew)) {
    return cleanBase;
  }

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
}

function extractCleanTranscript(
  event: any,
  isContinuous: boolean,
  lastFinalIndexRef: { current: number }
): { finalTranscript: string; interimTranscript: string; fullSessionTranscript: string } {
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
}

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

  // Recording & input states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [draftTranscript, setDraftTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [pendingStudentText, setPendingStudentText] = useState<string | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Gemini Neural Audio playback states (strictly no window.speechSynthesis fallback)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState<boolean>(false);
  const [activeSpeakingInteractionId, setActiveSpeakingInteractionId] = useState<string | null>(null);
  const [synthesizingInteractionId, setSynthesizingInteractionId] = useState<string | null>(null);
  const [unavailableAudioIds, setUnavailableAudioIds] = useState<Record<string, boolean>>({});

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

  // Refs for continuous SpeechRecognition & Barge-in neural audio tracking
  const isRecordingRef = useRef<boolean>(false);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const confirmedTextRef = useRef<string>('');
  const sessionBaseConfirmedRef = useRef<string>('');
  const sessionLatestTranscriptRef = useRef<string>('');
  const lastFinalIndexRef = useRef<number>(-1);
  const restartTimerRef = useRef<number | null>(null);

  const fullSpokenTextRef = useRef<string>('');
  const spokenCharIndexRef = useRef<number>(0);
  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const speakingSessionIdRef = useRef<number>(0);
  const spokenAudioCacheRef = useRef<Map<string, { audioBase64: string; mimeType: string }>>(
    new Map()
  );
  const activeInteractionIdRef = useRef<string | null>(null);
  const currentQuestionIdRef = useRef<number>(question.sequence_id);
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  const revokeActiveAudioUrl = useCallback(() => {
    if (activeAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(activeAudioUrlRef.current);
      } catch {
        // Ignore
      }
      activeAudioUrlRef.current = null;
    }
  }, []);

  const stopSpeechCleanup = useCallback(() => {
    speakingSessionIdRef.current += 1;
    if (activeAudioElementRef.current) {
      try {
        activeAudioElementRef.current.onended = null;
        activeAudioElementRef.current.onerror = null;
        activeAudioElementRef.current.ontimeupdate = null;
        activeAudioElementRef.current.pause();
        activeAudioElementRef.current.src = '';
      } catch {
        // Ignore
      }
      activeAudioElementRef.current = null;
    }
    revokeActiveAudioUrl();
    setIsSpeaking(false);
    setIsSpeechPaused(false);
    setActiveSpeakingInteractionId(null);
    setSynthesizingInteractionId(null);
    activeInteractionIdRef.current = null;
  }, [revokeActiveAudioUrl]);

  const stopRecordingInternal = useCallback(() => {
    isRecordingRef.current = false;
    shouldKeepListeningRef.current = false;
    if (restartTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
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
    confirmedTextRef.current = '';
    sessionBaseConfirmedRef.current = '';
    sessionLatestTranscriptRef.current = '';
    setErrorBanner(null);
  }, [stopRecordingInternal]);

  // Load isolated question thread from IndexedDB whenever question.sequence_id changes
  useEffect(() => {
    currentQuestionIdRef.current = question.sequence_id;
    stopRecordingInternal();
    stopSpeechCleanup();
    setDraftTranscript('');
    setInterimTranscript('');
    setPendingStudentText(null);
    confirmedTextRef.current = '';
    sessionBaseConfirmedRef.current = '';
    sessionLatestTranscriptRef.current = '';
    setErrorBanner(null);
    setIsHistoryExpanded(false);
    setUnavailableAudioIds({});
    setSynthesizingInteractionId(null);

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

  // Play Gemini neural audio (zero fallback to robotic browser speechSynthesis)
  const speakResponseAloud = useCallback(
    async (
      fullText: string,
      interactionId: string,
      options?: {
        preloadedAudio?: { audioBase64: string; mimeType: string };
        forceRefresh?: boolean;
      }
    ) => {
      if (typeof window === 'undefined' || !fullText) return;

      stopSpeechCleanup();
      const sessionToken = speakingSessionIdRef.current;
      const questionIdAtStart = currentQuestionIdRef.current;

      setUnavailableAudioIds(prev => {
        if (!prev[interactionId]) return prev;
        const next = { ...prev };
        delete next[interactionId];
        return next;
      });

      const markAudioUnavailable = () => {
        if (currentQuestionIdRef.current !== questionIdAtStart) return;
        setIsSpeaking(false);
        setIsSpeechPaused(false);
        setActiveSpeakingInteractionId(null);
        setSynthesizingInteractionId(null);
        activeInteractionIdRef.current = null;
        setUnavailableAudioIds(prev => ({ ...prev, [interactionId]: true }));
      };

      let audioPayload = options?.forceRefresh
        ? undefined
        : options?.preloadedAudio || spokenAudioCacheRef.current.get(interactionId);

      if (audioPayload?.audioBase64) {
        spokenAudioCacheRef.current.set(interactionId, audioPayload);
      } else {
        const cleanSpeechText = sanitizeTextForSpeech(fullText) || fullText;
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
        if (!cleanSpeechText || !isOnline) {
          markAudioUnavailable();
          return;
        }

        setSynthesizingInteractionId(interactionId);
        const res = await notifyQuatNativeAudioDialog({
          action: 'speak',
          textToSpeak: cleanSpeechText,
        });

        if (
          speakingSessionIdRef.current !== sessionToken ||
          currentQuestionIdRef.current !== questionIdAtStart
        ) {
          return;
        }

        setSynthesizingInteractionId(null);

        if (res.error || !res.audioBase64) {
          markAudioUnavailable();
          return;
        }

        audioPayload = {
          audioBase64: res.audioBase64,
          mimeType: res.mimeType || 'audio/wav',
        };
        spokenAudioCacheRef.current.set(interactionId, audioPayload);
      }

      if (
        speakingSessionIdRef.current !== sessionToken ||
        currentQuestionIdRef.current !== questionIdAtStart
      ) {
        return;
      }

      try {
        const blobUrl = base64AudioToBlobUrl(audioPayload.audioBase64, audioPayload.mimeType);
        if (
          speakingSessionIdRef.current !== sessionToken ||
          currentQuestionIdRef.current !== questionIdAtStart
        ) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        activeAudioUrlRef.current = blobUrl;
        const audio = new Audio(blobUrl);
        activeAudioElementRef.current = audio;

        fullSpokenTextRef.current = fullText;
        spokenCharIndexRef.current = 0;
        activeInteractionIdRef.current = interactionId;

        audio.ontimeupdate = () => {
          if (speakingSessionIdRef.current !== sessionToken) return;
          const totalText = fullSpokenTextRef.current;
          if (!totalText) return;
          const duration =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : Math.max(1.5, totalText.length / 14.5);
          const ratio = Math.min(1, Math.max(0, audio.currentTime / duration));
          spokenCharIndexRef.current = Math.max(
            spokenCharIndexRef.current,
            Math.floor(ratio * totalText.length)
          );
        };

        audio.onended = () => {
          if (speakingSessionIdRef.current !== sessionToken) return;
          spokenCharIndexRef.current = fullText.length;
          revokeActiveAudioUrl();
          activeAudioElementRef.current = null;
          setIsSpeaking(false);
          setIsSpeechPaused(false);
          setActiveSpeakingInteractionId(null);
          activeInteractionIdRef.current = null;
        };

        audio.onerror = () => {
          if (speakingSessionIdRef.current !== sessionToken) return;
          revokeActiveAudioUrl();
          activeAudioElementRef.current = null;
          markAudioUnavailable();
        };

        setIsSpeaking(true);
        setIsSpeechPaused(false);
        setActiveSpeakingInteractionId(interactionId);

        await audio.play();
      } catch (err) {
        console.warn('[QuestionVoiceBar] Gemini neural audio playback error:', err);
        revokeActiveAudioUrl();
        activeAudioElementRef.current = null;
        markAudioUnavailable();
      }
    },
    [stopSpeechCleanup, revokeActiveAudioUrl]
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

  // Start microphone recording with shouldKeepListeningRef and Android deduplication
  const startMicrophoneSession = useCallback(() => {
    setErrorBanner(null);
    setIsHistoryExpanded(true);

    const SpeechRecognitionAPI =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionAPI) {
      isRecordingRef.current = false;
      shouldKeepListeningRef.current = false;
      setIsRecording(false);
      setInterimTranscript('');
      setErrorBanner(
        'Reconhecimento de voz não disponível neste navegador. Digite seu raciocínio no campo abaixo.'
      );
      return;
    }

    const isAndroid =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    isRecordingRef.current = true;
    shouldKeepListeningRef.current = true;
    setIsRecording(true);

    const createAndStartInstance = () => {
      if (!isRecordingRef.current || !shouldKeepListeningRef.current) return;
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
            extractCleanTranscript(event, !isAndroid, lastFinalIndexRef);

          if (isAndroid) {
            sessionLatestTranscriptRef.current = fullSessionTranscript;
            if (finalTranscript) {
              confirmedTextRef.current = joinCleanSpeech(
                sessionBaseConfirmedRef.current,
                finalTranscript
              );
              setDraftTranscript(confirmedTextRef.current);
            }
            setInterimTranscript(interimTranscript);
          } else {
            if (finalTranscript) {
              confirmedTextRef.current = joinCleanSpeech(
                confirmedTextRef.current,
                finalTranscript
              );
              setDraftTranscript(confirmedTextRef.current);
            }
            setInterimTranscript(interimTranscript);
          }
        };

        recognition.onerror = (event: any) => {
          const errCode = String(event?.error || '').toLowerCase();
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
            stopRecordingInternal();
            setErrorBanner(
              errCode === 'audio-capture'
                ? 'Dispositivo de microfone indisponível ou ocupado por outro programa.'
                : 'Permissão de microfone negada no navegador. Você também pode digitar seu raciocínio abaixo.'
            );
          }
        };

        recognition.onend = () => {
          if (isAndroid && sessionLatestTranscriptRef.current) {
            confirmedTextRef.current = joinCleanSpeech(
              sessionBaseConfirmedRef.current,
              sessionLatestTranscriptRef.current
            );
            sessionLatestTranscriptRef.current = '';
            setDraftTranscript(confirmedTextRef.current);
            setInterimTranscript('');
          }

          if (isRecordingRef.current && shouldKeepListeningRef.current) {
            if (restartTimerRef.current !== null && typeof window !== 'undefined') {
              window.clearTimeout(restartTimerRef.current);
            }
            restartTimerRef.current = window.setTimeout(() => {
              restartTimerRef.current = null;
              if (isRecordingRef.current && shouldKeepListeningRef.current) {
                createAndStartInstance();
              }
            }, 120);
          } else {
            setIsRecording(false);
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch {
        stopRecordingInternal();
        setErrorBanner(
          'Não foi possível iniciar o microfone neste ambiente. Digite seu raciocínio no campo abaixo.'
        );
      }
    };

    createAndStartInstance();
  }, [stopRecordingInternal]);

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

      confirmedTextRef.current = '';
      sessionBaseConfirmedRef.current = '';
      sessionLatestTranscriptRef.current = '';
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
    confirmedTextRef.current = draftTranscript.trim();
    sessionBaseConfirmedRef.current = confirmedTextRef.current;
    sessionLatestTranscriptRef.current = '';
    startMicrophoneSession();
  };

  // Pause / Resume Assistant Neural Audio
  const handleTogglePauseSpeech = (e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = activeAudioElementRef.current;
    if (!audio) return;

    if (isSpeechPaused) {
      audio
        .play()
        .then(() => {
          setIsSpeechPaused(false);
        })
        .catch(() => {
          stopSpeechCleanup();
        });
    } else {
      audio.pause();
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

  // Submit student's reasoning to Quat (via voice or text input)
  const handleSubmitReasoning = async () => {
    if (isLoadingAI) return;
    const fullStudentText = joinCleanSpeech(draftTranscript, interimTranscript).trim();
    if (!fullStudentText) {
      setErrorBanner('Fale ou digite seu raciocínio antes de enviar para o Quat.');
      return;
    }

    if (!hasAnyAIKey()) {
      onRequireAPIKey();
      return;
    }

    stopRecordingInternal();
    setDraftTranscript('');
    setInterimTranscript('');
    confirmedTextRef.current = '';
    sessionBaseConfirmedRef.current = '';
    sessionLatestTranscriptRef.current = '';
    setPendingStudentText(fullStudentText);
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

      setPendingStudentText(null);
      setInteractions(thread.interactions);
      setIsHistoryExpanded(true);

      if (result.audioBase64 && !result.audioError) {
        speakResponseAloud(result.spoken_response, interaction.id, {
          preloadedAudio: {
            audioBase64: result.audioBase64,
            mimeType: result.mimeType || 'audio/wav',
          },
        });
      } else {
        setUnavailableAudioIds(prev => ({ ...prev, [interaction.id]: true }));
      }
    } catch (err: any) {
      console.error('[QuestionVoiceBar] Error calling AI:', err);
      setPendingStudentText(null);
      setDraftTranscript(prev => {
        if (prev.trim()) return prev;
        confirmedTextRef.current = fullStudentText;
        sessionBaseConfirmedRef.current = fullStudentText;
        return fullStudentText;
      });
      const friendly = mapToStudentFriendlyError(err);
      setErrorBanner(friendly.displayText);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const combinedLiveTranscript = joinCleanSpeech(draftTranscript, interimTranscript);

  const isFloatingPopupOpen = isHistoryExpanded || isRecording || isLoadingAI;

  // Keep conversation scrolled to newest exchange when popup is open
  useEffect(() => {
    if (!isFloatingPopupOpen) return;
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isFloatingPopupOpen, interactions.length, pendingStudentText, isLoadingAI]);

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

            <button
              type="button"
              onClick={() => setIsHistoryExpanded(prev => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-surface hover:bg-surface-hover text-secondary hover:text-primary border border-border text-xs font-medium transition-colors cursor-pointer"
              title={isFloatingPopupOpen ? 'Minimizar janela do Quat' : 'Abrir janela do Quat'}
              aria-label={isFloatingPopupOpen ? 'Minimizar janela do Quat' : 'Abrir janela do Quat'}
            >
              <MessageSquare className="w-3.5 h-3.5 text-accent" />
              {isFloatingPopupOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>
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
            className="fixed bottom-5 right-5 z-30 w-[340px] sm:w-[380px] max-w-[calc(100vw-24px)] h-[440px] max-h-[calc(100dvh-32px)] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden select-none"
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

              <div className="flex items-center gap-1 shrink-0">
                {isSpeaking && (
                  <>
                    <button
                      type="button"
                      onClick={handleTogglePauseSpeech}
                      className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-primary border border-border transition-colors cursor-pointer"
                      title={isSpeechPaused ? 'Retomar fala do Quat' : 'Pausar fala do Quat'}
                      aria-label={isSpeechPaused ? 'Retomar fala' : 'Pausar fala'}
                    >
                      {isSpeechPaused ? (
                        <Play className="w-3 h-3 fill-current text-accent" />
                      ) : (
                        <Pause className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleStopSpeech}
                      className="p-1.5 rounded-lg bg-danger-bg hover:opacity-90 text-danger border border-danger-border transition-colors cursor-pointer"
                      title="Parar fala do Quat"
                      aria-label="Parar fala"
                    >
                      <Square className="w-3 h-3 fill-current" />
                    </button>
                  </>
                )}

                <GripHorizontal className="w-3.5 h-3.5 text-muted pointer-events-none mx-0.5" />
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

            {/* Single Scrollable Conversation History Area (Flat, no nested card borders) */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-4">
              {errorBanner && (
                <div className="p-2.5 rounded-xl bg-danger-bg border border-danger-border text-danger text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-snug">{errorBanner}</span>
                </div>
              )}

              {interactions.length === 0 && !pendingStudentText && !isLoadingAI && (
                <p className="text-xs text-muted text-center py-6 px-2 leading-relaxed">
                  Explique como você pensou nesta questão falando no microfone ou digitando abaixo.
                </p>
              )}

              {interactions.map((item) => {
                const isReasoningOpen = Boolean(expandedReasoningIds[item.id]);
                const isContextOpen = Boolean(expandedContextIds[item.id]);
                const isThisItemSpeaking = isSpeaking && activeSpeakingInteractionId === item.id;
                const isThisItemSynthesizing = synthesizingInteractionId === item.id;
                const isAudioUnavailable = Boolean(unavailableAudioIds[item.id]);

                return (
                  <div key={item.id} className="space-y-2 text-xs">
                    {/* Student message bubble aligned right */}
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface-subtle px-3 py-2 text-primary theme-text-primary leading-relaxed select-text">
                        {item.studentTranscript}
                      </div>
                    </div>

                    {/* Quat response directly below without extra bordered container */}
                    <div className="space-y-1.5">
                      <p className="text-primary theme-text-primary leading-relaxed select-text">
                        {item.aiSpokenResponse}
                      </p>

                      {isAudioUnavailable && !isThisItemSynthesizing && !isThisItemSpeaking && (
                        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                          <VolumeX className="w-3 h-3 shrink-0" />
                          <span>Áudio neural indisponível no momento</span>
                        </p>
                      )}

                      {/* Single subtle action line */}
                      <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px]">
                        <button
                          type="button"
                          disabled={isThisItemSynthesizing}
                          onClick={() =>
                            speakResponseAloud(item.aiSpokenResponse, item.id, {
                              forceRefresh: isAudioUnavailable,
                            })
                          }
                          className="inline-flex items-center gap-1 text-secondary hover:text-primary font-medium transition-colors cursor-pointer disabled:opacity-60"
                          title={
                            isAudioUnavailable
                              ? 'Tentar ouvir novamente'
                              : 'Ouvir esta resposta com voz neural'
                          }
                        >
                          {isThisItemSynthesizing ? (
                            <Loader2 className="w-3 h-3 text-accent animate-spin" />
                          ) : isAudioUnavailable ? (
                            <RotateCcw className="w-3 h-3 text-accent" />
                          ) : (
                            <Volume2
                              className={`w-3 h-3 ${isThisItemSpeaking ? 'text-accent animate-pulse' : ''}`}
                            />
                          )}
                          <span>
                            {isThisItemSynthesizing
                              ? 'Gerando voz...'
                              : isThisItemSpeaking
                              ? 'Falando...'
                              : isAudioUnavailable
                              ? 'Tentar ouvir'
                              : 'Ouvir'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReasoningIds(prev => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          className="inline-flex items-center gap-1 font-medium text-accent hover:underline cursor-pointer"
                        >
                          <Brain className="w-3 h-3" />
                          <span>{isReasoningOpen ? 'Ocultar Análise' : 'Ver Análise'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedContextIds(prev => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          className="inline-flex items-center gap-1 font-medium text-muted hover:text-primary transition-colors cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                          <span>{isContextOpen ? 'Ocultar Questão' : 'Referência'}</span>
                        </button>

                        <span className="ml-auto text-[10px] text-muted">
                          {item.wasInterrupted ? 'Interrompido · ' : ''}
                          {formatRelativeTime(item.updatedAt || item.createdAt)}
                        </span>
                      </div>

                      {isReasoningOpen && (
                        <div className="pl-2.5 border-l-2 border-accent/40 text-secondary text-[11px] leading-relaxed select-text">
                          {item.aiInternalReasoning}
                        </div>
                      )}

                      {isContextOpen && (
                        <div className="pl-2.5 border-l-2 border-border text-[10px] text-secondary font-mono leading-relaxed select-text">
                          {item.questionStemAndAnswer}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {pendingStudentText && (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface-subtle px-3 py-2 text-primary theme-text-primary leading-relaxed select-text">
                      {pendingStudentText}
                    </div>
                  </div>
                  {isLoadingAI && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      <span>Quat analisando seu raciocínio...</span>
                    </div>
                  )}
                </div>
              )}

              <div ref={historyEndRef} />
            </div>

            {/* Always-Visible Fixed Footer Input Bar */}
            <div className="shrink-0 border-t border-border bg-surface-subtle px-3 py-2.5 space-y-1.5">
              {isRecording && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-secondary px-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-danger" />
                    </span>
                    <span>Ouvindo...</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelRecording}
                    className="inline-flex items-center gap-1 text-muted hover:text-danger transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>Cancelar</span>
                  </button>
                </div>
              )}

              <div className="flex items-end gap-1.5">
                <textarea
                  rows={2}
                  value={combinedLiveTranscript}
                  onChange={(e) => {
                    const val = e.target.value;
                    confirmedTextRef.current = val;
                    sessionBaseConfirmedRef.current = val;
                    sessionLatestTranscriptRef.current = '';
                    setDraftTranscript(val);
                    setInterimTranscript('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!isLoadingAI && combinedLiveTranscript.trim()) {
                        handleSubmitReasoning();
                      }
                    }
                  }}
                  placeholder="Digite ou fale seu raciocínio... (Enter para enviar)"
                  className="flex-1 min-w-0 rounded-xl px-2.5 py-2 text-xs bg-surface border border-border text-primary placeholder:text-muted focus:outline-none focus:border-accent resize-none leading-relaxed"
                />

                <button
                  type="button"
                  onClick={handleMicButtonClick}
                  disabled={isLoadingAI}
                  className={`p-2.5 rounded-xl border transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                    isRecording
                      ? 'bg-danger text-danger-contrast border-danger-border'
                      : isSpeaking
                      ? 'bg-accent text-accent-contrast border-accent-subtle-border'
                      : 'bg-surface hover:bg-surface-hover text-secondary hover:text-primary border-border'
                  }`}
                  title={
                    isSpeaking
                      ? 'Interromper fala do Quat e iniciar gravação'
                      : isRecording
                      ? 'Cancelar gravação de voz'
                      : 'Falar raciocínio no microfone'
                  }
                  aria-label={
                    isSpeaking
                      ? 'Interromper e falar'
                      : isRecording
                      ? 'Cancelar gravação'
                      : 'Falar no microfone'
                  }
                >
                  <Mic className={`w-4 h-4 ${isRecording ? 'animate-pulse' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={handleSubmitReasoning}
                  disabled={isLoadingAI || !combinedLiveTranscript.trim()}
                  className="p-2.5 rounded-xl theme-btn-accent transition-all cursor-pointer shrink-0 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Enviar raciocínio (Enter)"
                  aria-label="Enviar mensagem para o Quat"
                >
                  {isLoadingAI ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
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
          confirmedTextRef.current = draftTranscript.trim();
          sessionBaseConfirmedRef.current = confirmedTextRef.current;
          sessionLatestTranscriptRef.current = '';
          startMicrophoneSession();
        }}
      />
    </div>
  );
};

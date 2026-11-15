import { useState, useEffect, useCallback, useRef } from 'react';
import { StudyMode } from '../types/question';
import { runCarouselDiagnostic } from '../lib/carouselDiagnosticProbe';
import { useHorizontalCarousel } from './useHorizontalCarousel';

export const MODE_KEYS: StudyMode[] = ['practice', 'srs', 'error_notebook', 'simulado', 'metrics'];
export const LAST_ACTIVE_MODE_STORAGE_KEY = 'silenon_last_active_mode_v1';

export function parseSavedStudyMode(raw: string | null | undefined): StudyMode | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'practice':
    case 'pratica':
    case 'prática':
      return 'practice';
    case 'srs':
    case 'fixacao':
    case 'fixação':
      return 'srs';
    case 'error_notebook':
    case 'erros':
      return 'error_notebook';
    case 'simulado':
      return 'simulado';
    case 'metrics':
    case 'metricas':
    case 'métricas':
      return 'metrics';
    default:
      return null;
  }
}

export function saveLastActiveStudyMode(mode: StudyMode | string): void {
  const parsed = parseSavedStudyMode(mode);
  if (typeof window === 'undefined' || !parsed) return;
  try {
    sessionStorage.setItem(LAST_ACTIVE_MODE_STORAGE_KEY, parsed);
  } catch {
    // Ignore sessionStorage errors
  }
  try {
    localStorage.setItem(LAST_ACTIVE_MODE_STORAGE_KEY, parsed);
  } catch {
    // Ignore localStorage errors
  }
}

interface UseStudyCarouselOptions {
  isDevEnvironment: boolean;
  onBeforeModeChange?: (currentMode: StudyMode) => void;
  onModeChanged?: (newMode: StudyMode) => void;
}

export function useStudyCarousel({
  isDevEnvironment,
  onBeforeModeChange,
}: UseStudyCarouselOptions) {
  const [currentMode, setCurrentMode] = useState<StudyMode>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode');
      if (
        isDevEnvironment &&
        (modeParam === 'dev' ||
          params.get('dev') === '1' ||
          modeParam === 'kitchen_sink')
      ) {
        return 'kitchen_sink';
      }
      const fromQuery = parseSavedStudyMode(modeParam);
      if (fromQuery) {
        return fromQuery;
      }
      try {
        const fromSession = parseSavedStudyMode(
          sessionStorage.getItem(LAST_ACTIVE_MODE_STORAGE_KEY)
        );
        if (fromSession) return fromSession;
      } catch {
        // Ignore sessionStorage read error
      }
      try {
        const fromLocal = parseSavedStudyMode(
          localStorage.getItem(LAST_ACTIVE_MODE_STORAGE_KEY)
        );
        if (fromLocal) return fromLocal;
      } catch {
        // Ignore localStorage read error
      }
    }
    return 'practice';
  });

  const rightVeilRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentModeRef = useRef<StudyMode>(currentMode);
  currentModeRef.current = currentMode;

  const onBeforeModeChangeRef = useRef(onBeforeModeChange);
  onBeforeModeChangeRef.current = onBeforeModeChange;

  const isCarouselMode = MODE_KEYS.includes(currentMode);
  const activeModeIndex = Math.max(0, MODE_KEYS.indexOf(currentMode));

  const {
    dragProgress: modeDragProgress,
    setDragProgress: setModeDragProgress,
    handleDragProgress: handleModeDragProgress,
    isTransitioning: isModeTransitioning,
    setIsTransitioning: setIsModeTransitioning,
    isDragging,
    carouselContainerRef,
    containerWidth,
    continuousPos,
    pixelOffset,
    slideWidthStyle,
    trackWidthStyle,
  } = useHorizontalCarousel({
    itemCount: MODE_KEYS.length,
    activeIndex: activeModeIndex,
    enableContentSwipe: false,
    transitionDurationMs: 320,
    measureDeps: [currentMode],
    onBeforeIndexChange: () => {
      if (onBeforeModeChangeRef.current) {
        onBeforeModeChangeRef.current(currentModeRef.current);
      }
    },
    onIndexChange: (newIndex) => {
      const targetMode = MODE_KEYS[newIndex];
      if (targetMode) {
        setCurrentMode(targetMode);
      }
    },
  });

  const handleSelectMode = useCallback(
    (newMode: StudyMode) => {
      setModeDragProgress(null);
      if (newMode === currentModeRef.current) return;
      if (onBeforeModeChangeRef.current) {
        onBeforeModeChangeRef.current(currentModeRef.current);
      }
      setIsModeTransitioning(true);
      setCurrentMode(newMode);
    },
    [setIsModeTransitioning, setModeDragProgress]
  );

  // Diagnostic tool integration in development mode
  useEffect(() => {
    if (!isDevEnvironment) return;
    const timer = setTimeout(() => {
      if (carouselContainerRef.current) {
        runCarouselDiagnostic(
          containerWidth,
          carouselContainerRef.current,
          slideRefs.current,
          rightVeilRef.current
        );
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [containerWidth, currentMode, isDevEnvironment, carouselContainerRef]);

  // Sync mode with URL query parameter and persist active study mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (MODE_KEYS.includes(currentMode)) {
        saveLastActiveStudyMode(currentMode);
      }
      const url = new URL(window.location.href);
      if (currentMode === 'kitchen_sink') {
        url.searchParams.set('mode', 'kitchen_sink');
        window.history.replaceState(null, '', url.toString());
      } else if (url.searchParams.has('mode')) {
        url.searchParams.delete('mode');
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }
    }
  }, [currentMode]);

  return {
    currentMode,
    setCurrentMode,
    handleSelectMode,
    modeDragProgress,
    handleModeDragProgress,
    isModeTransitioning,
    setIsModeTransitioning,
    isDragging,
    carouselContainerRef,
    rightVeilRef,
    slideRefs,
    containerWidth,
    isCarouselMode,
    activeModeIndex,
    continuousPos,
    pixelOffset,
    slideWidthStyle,
    trackWidthStyle,
  };
}

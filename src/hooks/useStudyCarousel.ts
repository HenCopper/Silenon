import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { StudyMode } from '../types/question';
import { runCarouselDiagnostic } from '../lib/carouselDiagnosticProbe';

export const MODE_KEYS: StudyMode[] = ['practice', 'srs', 'error_notebook', 'simulado', 'metrics'];

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
      if (
        isDevEnvironment &&
        (params.get('mode') === 'dev' ||
          params.get('dev') === '1' ||
          params.get('mode') === 'kitchen_sink')
      ) {
        return 'kitchen_sink';
      }
    }
    return 'practice';
  });

  const [modeDragProgress, setModeDragProgress] = useState<{
    activeIndex: number;
    offsetFraction: number;
    isDragging: boolean;
  } | null>(null);

  const [isModeTransitioning, setIsModeTransitioning] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  const carouselContainerRef = useRef<HTMLDivElement>(null);
  const rightVeilRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentModeRef = useRef<StudyMode>(currentMode);
  currentModeRef.current = currentMode;

  const onBeforeModeChangeRef = useRef(onBeforeModeChange);
  onBeforeModeChangeRef.current = onBeforeModeChange;

  const handleSelectMode = useCallback((newMode: StudyMode) => {
    setModeDragProgress(null);
    if (newMode === currentModeRef.current) return;
    if (onBeforeModeChangeRef.current) {
      onBeforeModeChangeRef.current(currentModeRef.current);
    }
    setIsModeTransitioning(true);
    setCurrentMode(newMode);
  }, []);

  useEffect(() => {
    if (!isModeTransitioning) return;
    const timer = window.setTimeout(() => {
      setIsModeTransitioning(false);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [isModeTransitioning, currentMode]);

  const handleModeDragProgress = useCallback(
    (dragProgress: { activeIndex: number; offsetFraction: number; isDragging: boolean }) => {
      if (dragProgress.isDragging) {
        if (!modeDragProgress?.isDragging && onBeforeModeChangeRef.current) {
          onBeforeModeChangeRef.current(currentModeRef.current);
        }
        setModeDragProgress(dragProgress);
      } else {
        setModeDragProgress(null);
      }
    },
    [modeDragProgress?.isDragging]
  );

  // Synchronous initial width measurement
  useLayoutEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return;
    const w = Math.round(container.getBoundingClientRect().width || container.clientWidth || 0);
    if (w > 0) {
      setContainerWidth(w);
    }
  }, []);

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
  }, [containerWidth, currentMode, isDevEnvironment]);

  // Measure only container width for horizontal track positioning
  useEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const w = Math.round(container.getBoundingClientRect().width || container.clientWidth || 0);
      if (w > 0) {
        setContainerWidth((prev) => (prev !== w ? w : prev));
      }
    };

    updateWidth();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateWidth();
      });
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', updateWidth, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateWidth, { passive: true });
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateWidth);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateWidth);
      }
    };
  }, [currentMode]);

  // Sync mode with URL query parameter
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (currentMode === 'kitchen_sink') {
        url.searchParams.set('mode', 'kitchen_sink');
        window.history.replaceState(null, '', url.toString());
      } else if (url.searchParams.get('mode') === 'kitchen_sink') {
        url.searchParams.delete('mode');
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }
    }
  }, [currentMode]);

  // Horizontal layout calculations
  const isCarouselMode = MODE_KEYS.includes(currentMode);
  const activeModeIndex = Math.max(0, MODE_KEYS.indexOf(currentMode));

  const continuousPos = modeDragProgress?.isDragging
    ? Math.max(
        0,
        Math.min(
          MODE_KEYS.length - 1,
          modeDragProgress.activeIndex + modeDragProgress.offsetFraction
        )
      )
    : activeModeIndex;

  const isDragging = !!modeDragProgress?.isDragging;
  const pixelOffset = containerWidth > 0 ? -Math.round(continuousPos * containerWidth) : 0;
  const slideWidthStyle = containerWidth > 0 ? `${containerWidth}px` : '100%';
  const trackWidthStyle = containerWidth > 0 ? `${MODE_KEYS.length * containerWidth}px` : '500%';

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

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';

export interface CarouselDragProgress {
  activeIndex: number;
  offsetFraction: number;
  isDragging: boolean;
}

export interface UseHorizontalCarouselOptions {
  itemCount: number;
  activeIndex: number;
  onIndexChange?: (newIndex: number) => void;
  onBeforeIndexChange?: (currentIndex: number) => void;
  transitionDurationMs?: number;
  enableContentSwipe?: boolean;
  swipeThresholdPx?: number;
  snapDistanceRatio?: number;
  snapVelocityThreshold?: number;
  measureDeps?: readonly unknown[];
}

export interface UseHorizontalCarouselReturn {
  activeIndex: number;
  dragProgress: CarouselDragProgress | null;
  setDragProgress: React.Dispatch<React.SetStateAction<CarouselDragProgress | null>>;
  handleDragProgress: (nextProgress: CarouselDragProgress) => void;
  selectIndex: (newIndex: number) => void;
  isTransitioning: boolean;
  setIsTransitioning: React.Dispatch<React.SetStateAction<boolean>>;
  isDragging: boolean;
  carouselContainerRef: React.RefObject<HTMLDivElement | null>;
  containerWidth: number;
  continuousPos: number;
  pixelOffset: number;
  slideWidthStyle: string;
  trackWidthStyle: string;
  contentSwipeHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
}

interface SwipeGestureState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  startIndex: number;
  lockedAxis: 'x' | 'y' | null;
}

function getTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target && typeof target === 'object' && 'parentElement' in target) {
    return (target as Node).parentElement;
  }
  return null;
}

function isInteractiveSwipeTarget(target: EventTarget | null): boolean {
  const el = getTargetElement(target);
  if (!el) return false;
  return Boolean(
    el.closest(
      'input, select, textarea, button, a, [role="button"], [contenteditable="true"], [data-no-carousel-drag="true"]'
    )
  );
}

function hasHorizontalScrollAncestor(
  target: EventTarget | null,
  boundary: HTMLElement | null
): boolean {
  const startEl = getTargetElement(target);
  let node: HTMLElement | null = startEl instanceof HTMLElement ? startEl : startEl?.parentElement ?? null;
  while (node && node !== boundary) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const style = window.getComputedStyle(node);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
}

export function useHorizontalCarousel({
  itemCount,
  activeIndex,
  onIndexChange,
  onBeforeIndexChange,
  transitionDurationMs = 320,
  enableContentSwipe = true,
  swipeThresholdPx = 8,
  snapDistanceRatio = 0.25,
  snapVelocityThreshold = 0.35,
  measureDeps = [],
}: UseHorizontalCarouselOptions): UseHorizontalCarouselReturn {
  const maxIndex = Math.max(0, itemCount - 1);
  const safeActiveIndex = Math.max(0, Math.min(maxIndex, activeIndex));

  const [dragProgress, setDragProgress] = useState<CarouselDragProgress | null>(null);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  const carouselContainerRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef<number>(safeActiveIndex);
  activeIndexRef.current = safeActiveIndex;

  const isDraggingRef = useRef<boolean>(false);
  isDraggingRef.current = !!dragProgress?.isDragging;

  const containerWidthRef = useRef<number>(containerWidth);
  containerWidthRef.current = containerWidth;

  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;

  const onBeforeIndexChangeRef = useRef(onBeforeIndexChange);
  onBeforeIndexChangeRef.current = onBeforeIndexChange;

  const swipeStateRef = useRef<SwipeGestureState | null>(null);

  const selectIndex = useCallback(
    (newIndex: number) => {
      setDragProgress(null);
      const clamped = Math.max(0, Math.min(maxIndex, newIndex));
      if (clamped === activeIndexRef.current) return;
      onBeforeIndexChangeRef.current?.(activeIndexRef.current);
      setIsTransitioning(true);
      onIndexChangeRef.current?.(clamped);
    },
    [maxIndex]
  );

  useEffect(() => {
    if (!isTransitioning) return;
    const timer = window.setTimeout(() => {
      setIsTransitioning(false);
    }, transitionDurationMs);
    return () => window.clearTimeout(timer);
  }, [isTransitioning, safeActiveIndex, transitionDurationMs]);

  const handleDragProgress = useCallback((nextProgress: CarouselDragProgress) => {
    if (nextProgress.isDragging) {
      if (!isDraggingRef.current) {
        onBeforeIndexChangeRef.current?.(activeIndexRef.current);
      }
      setDragProgress(nextProgress);
    } else {
      setDragProgress(null);
    }
  }, []);

  // Synchronous initial width measurement before paint
  useLayoutEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return;
    const w = Math.round(container.getBoundingClientRect().width || container.clientWidth || 0);
    if (w > 0) {
      setContainerWidth((prev) => (prev !== w ? w : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemCount, ...measureDeps]);

  // Measure container width on resize & viewport changes
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeActiveIndex, itemCount, ...measureDeps]);

  const finishSwipeGesture = useCallback(
    (clientX: number, cancelled: boolean) => {
      const state = swipeStateRef.current;
      if (!state) return;
      swipeStateRef.current = null;

      if (state.lockedAxis !== 'x') return;

      if (cancelled) {
        setDragProgress(null);
        return;
      }

      const width =
        containerWidthRef.current ||
        carouselContainerRef.current?.clientWidth ||
        1;
      const dx = clientX - state.startX;
      const offsetFraction = -dx / width;
      const clampedPos = Math.max(0, Math.min(maxIndex, state.startIndex + offsetFraction));
      let targetIndex = Math.round(clampedPos);

      if (targetIndex === state.startIndex) {
        const crossedRatio = Math.abs(offsetFraction) >= snapDistanceRatio;
        const crossedVelocity =
          Math.abs(state.velocityX) >= snapVelocityThreshold && Math.abs(dx) >= 24;
        if (crossedRatio || crossedVelocity) {
          const direction = dx < 0 ? 1 : -1;
          targetIndex = Math.max(0, Math.min(maxIndex, state.startIndex + direction));
        }
      }

      setDragProgress(null);
      if (targetIndex !== activeIndexRef.current) {
        setIsTransitioning(true);
        onIndexChangeRef.current?.(targetIndex);
      }
    },
    [maxIndex, snapDistanceRatio, snapVelocityThreshold]
  );

  const handleContentPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enableContentSwipe || itemCount <= 1) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.shiftKey || e.detail > 1) return;
      if (isInteractiveSwipeTarget(e.target)) return;
      if (hasHorizontalScrollAncestor(e.target, carouselContainerRef.current)) return;

      swipeStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        startIndex: activeIndexRef.current,
        lockedAxis: null,
      };
    },
    [enableContentSwipe, itemCount]
  );

  const handleContentPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = swipeStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.lockedAxis === null) {
        if (hasActiveTextSelection()) {
          swipeStateRef.current = null;
          return;
        }
        if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) {
          state.lockedAxis = 'y';
          swipeStateRef.current = null;
          return;
        }
        if (Math.abs(dx) >= swipeThresholdPx && Math.abs(dx) > Math.abs(dy) * 1.15) {
          state.lockedAxis = 'x';
          onBeforeIndexChangeRef.current?.(state.startIndex);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Pointer capture may not be supported in all environments
          }
        } else {
          return;
        }
      }

      if (state.lockedAxis === 'x') {
        const now = performance.now();
        const dt = now - state.lastTime;
        if (dt > 0) {
          const instantV = (e.clientX - state.lastX) / dt;
          state.velocityX = state.velocityX * 0.4 + instantV * 0.6;
          state.lastX = e.clientX;
          state.lastTime = now;
        }

        const width =
          containerWidthRef.current ||
          carouselContainerRef.current?.clientWidth ||
          1;
        const rawOffsetFraction = -dx / width;
        const clampedPos = Math.max(0, Math.min(maxIndex, state.startIndex + rawOffsetFraction));
        const clampedOffsetFraction = clampedPos - state.startIndex;

        setDragProgress({
          activeIndex: state.startIndex,
          offsetFraction: clampedOffsetFraction,
          isDragging: true,
        });
      }
    },
    [maxIndex, swipeThresholdPx]
  );

  const handleContentPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = swipeStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors
      }

      finishSwipeGesture(e.clientX, false);
    },
    [finishSwipeGesture]
  );

  const handleContentPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = swipeStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors
      }

      finishSwipeGesture(e.clientX, true);
    },
    [finishSwipeGesture]
  );

  // Safety net if pointerup/pointercancel happens outside container without capture
  useEffect(() => {
    if (!enableContentSwipe) return;

    const handleWindowPointerUp = (e: PointerEvent) => {
      const state = swipeStateRef.current;
      if (state && state.pointerId === e.pointerId) {
        finishSwipeGesture(e.clientX, false);
      }
    };

    const handleWindowPointerCancel = (e: PointerEvent) => {
      const state = swipeStateRef.current;
      if (state && state.pointerId === e.pointerId) {
        finishSwipeGesture(e.clientX, true);
      }
    };

    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
    };
  }, [enableContentSwipe, finishSwipeGesture]);

  const continuousPos = dragProgress?.isDragging
    ? Math.max(0, Math.min(maxIndex, dragProgress.activeIndex + dragProgress.offsetFraction))
    : safeActiveIndex;

  const isDragging = !!dragProgress?.isDragging;
  const pixelOffset = containerWidth > 0 ? -Math.round(continuousPos * containerWidth) : 0;
  const slideWidthStyle = containerWidth > 0 ? `${containerWidth}px` : '100%';
  const trackWidthStyle =
    containerWidth > 0
      ? `${itemCount * containerWidth}px`
      : `${Math.max(1, itemCount) * 100}%`;

  return {
    activeIndex: safeActiveIndex,
    dragProgress,
    setDragProgress,
    handleDragProgress,
    selectIndex,
    isTransitioning,
    setIsTransitioning,
    isDragging,
    carouselContainerRef,
    containerWidth,
    continuousPos,
    pixelOffset,
    slideWidthStyle,
    trackWidthStyle,
    contentSwipeHandlers: {
      onPointerDown: handleContentPointerDown,
      onPointerMove: handleContentPointerMove,
      onPointerUp: handleContentPointerUp,
      onPointerCancel: handleContentPointerCancel,
    },
  };
}

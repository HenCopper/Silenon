import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useHorizontalCarousel } from '../../hooks/useHorizontalCarousel';
import { useTrackSnapDrag } from '../../hooks/usePointerDrag';

export interface HorizontalTabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  content: React.ReactNode;
  slideClassName?: string;
}

export interface HorizontalTabCarouselProps<T extends string = string> {
  tabs: HorizontalTabItem<T>[];
  activeIndex: number;
  onChange: (index: number) => void;
  onBeforeChange?: (currentIndex: number) => void;
  indicatorVariant?: 'underline' | 'pill';
  enableContentSwipe?: boolean;
  autoHeight?: boolean;
  measureDeps?: readonly unknown[];
  className?: string;
  tabBarClassName?: string;
  tabButtonClassName?: string;
  viewportClassName?: string;
  slideClassName?: string;
  ariaLabel?: string;
}

export function HorizontalTabCarousel<T extends string = string>({
  tabs,
  activeIndex,
  onChange,
  onBeforeChange,
  indicatorVariant = 'underline',
  enableContentSwipe = true,
  autoHeight = false,
  measureDeps = [],
  className = '',
  tabBarClassName = '',
  tabButtonClassName = '',
  viewportClassName = '',
  slideClassName = '',
  ariaLabel = 'Abas de navegação',
}: HorizontalTabCarouselProps<T>) {
  const tabBarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slideContentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [slideHeights, setSlideHeights] = useState<number[]>([]);
  const [enableHeightTransition, setEnableHeightTransition] = useState<boolean>(false);

  const {
    activeIndex: safeActiveIndex,
    dragProgress,
    handleDragProgress,
    selectIndex,
    isTransitioning,
    isDragging: isContentDragging,
    carouselContainerRef,
    continuousPos,
    pixelOffset,
    slideWidthStyle,
    trackWidthStyle,
    contentSwipeHandlers,
  } = useHorizontalCarousel({
    itemCount: tabs.length,
    activeIndex,
    onIndexChange: onChange,
    onBeforeIndexChange: onBeforeChange,
    enableContentSwipe,
    transitionDurationMs: 320,
    measureDeps,
  });

  const {
    isDragging: isTabDragging,
    dragProgress: tabDragProgress,
    pillGeometry,
    syncGeometry,
    handlePointerDown: handleTabPointerDown,
    handlePointerMove: handleTabPointerMove,
    handlePointerUp: handleTabPointerUp,
    handlePointerCancel: handleTabPointerCancel,
  } = useTrackSnapDrag({
    itemCount: tabs.length,
    activeIndex: safeActiveIndex,
    containerRef: tabBarRef,
    getItemElement: (idx) => buttonRefs.current[idx] ?? null,
    dragThreshold: 5,
    externalProgress: dragProgress,
    useContinuousInterpolation: true,
    onDragMove: (info) => {
      handleDragProgress({
        activeIndex: safeActiveIndex,
        offsetFraction: info.progress - safeActiveIndex,
        isDragging: true,
      });
    },
    onSnap: (finalIdx) => {
      if (finalIdx !== safeActiveIndex) {
        selectIndex(finalIdx);
      } else {
        syncGeometry(finalIdx);
      }
    },
    onDragEnd: (_hadDragged, finalIdx) => {
      handleDragProgress({
        activeIndex: finalIdx,
        offsetFraction: 0,
        isDragging: false,
      });
    },
  });

  const isAnyDragging = isContentDragging || isTabDragging;

  const measureSlideHeights = useCallback(() => {
    if (!autoHeight) return;
    const nextHeights = tabs.map((_, idx) => {
      const el = slideContentRefs.current[idx];
      if (!el) return 0;
      return Math.ceil(el.getBoundingClientRect().height || el.offsetHeight || 0);
    });
    setSlideHeights((prev) => {
      if (
        prev.length === nextHeights.length &&
        prev.every((val, i) => val === nextHeights[i])
      ) {
        return prev;
      }
      return nextHeights;
    });
  }, [autoHeight, tabs.length]);

  useLayoutEffect(() => {
    if (!autoHeight) return;
    measureSlideHeights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHeight, tabs.length, measureSlideHeights, ...measureDeps]);

  useEffect(() => {
    if (!autoHeight) return;
    const rafId = window.requestAnimationFrame(() => {
      setEnableHeightTransition(true);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [autoHeight]);

  useEffect(() => {
    if (!autoHeight || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureSlideHeights();
    });

    for (let i = 0; i < tabs.length; i++) {
      const el = slideContentRefs.current[i];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHeight, tabs.length, measureSlideHeights, ...measureDeps]);

  const handleTabButtonClick = (idx: number) => {
    if (isTabDragging) return;
    selectIndex(idx);
    syncGeometry(idx);
    handleDragProgress({
      activeIndex: idx,
      offsetFraction: 0,
      isDragging: false,
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(tabs.length - 1, idx + 1);
      handleTabButtonClick(next);
      buttonRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = Math.max(0, idx - 1);
      handleTabButtonClick(prev);
      buttonRefs.current[prev]?.focus();
    }
  };

  let targetViewportHeight: number | undefined;
  if (autoHeight && slideHeights.length > 0) {
    const fromIdx = Math.floor(continuousPos);
    const toIdx = Math.min(tabs.length - 1, fromIdx + 1);
    const frac = continuousPos - fromIdx;
    const hFrom = slideHeights[fromIdx] || 0;
    const hTo = slideHeights[toIdx] || hFrom;
    if (hFrom > 0 && hTo > 0) {
      targetViewportHeight = Math.round(hFrom * (1 - frac) + hTo * frac);
    } else if (hFrom > 0) {
      targetViewportHeight = hFrom;
    }
  }

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {/* Tab Bar with continuous sliding indicator */}
      <div
        ref={tabBarRef}
        role="tablist"
        aria-label={ariaLabel}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleTabPointerDown(e);
        }}
        onPointerMove={handleTabPointerMove}
        onPointerUp={handleTabPointerUp}
        onPointerCancel={handleTabPointerCancel}
        className={`relative flex items-center shrink-0 select-none touch-none ${
          indicatorVariant === 'pill'
            ? 'p-1 rounded-xl theme-card-subtle'
            : 'border-b border-border px-4 sm:px-5 text-xs font-semibold gap-4 sm:gap-6'
        } ${tabBarClassName}`}
      >
        {pillGeometry && indicatorVariant === 'underline' && (
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-0.5 bg-accent rounded-full pointer-events-none z-10"
            style={{
              transform: `translate3d(${pillGeometry.left}px, 0, 0)`,
              width: `${pillGeometry.width}px`,
              transition: isAnyDragging
                ? 'none'
                : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.22s ease',
              willChange: 'transform, width',
            }}
          />
        )}

        {pillGeometry && indicatorVariant === 'pill' && (
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 bg-surface text-primary theme-text-primary shadow-xs border border-border/70 rounded-lg pointer-events-none"
            style={{
              transform: `translate3d(${pillGeometry.left}px, ${pillGeometry.top}px, 0)`,
              width: `${pillGeometry.width}px`,
              height: `${pillGeometry.height}px`,
              transition: isAnyDragging
                ? 'none'
                : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.22s ease',
              willChange: 'transform, width',
            }}
          />
        )}

        {tabs.map((tab, idx) => {
          const continuousIdx =
            isTabDragging && tabDragProgress !== null ? tabDragProgress : continuousPos;
          const dist = Math.abs(continuousIdx - idx);
          const isVisualActive = dist < 0.45;
          const isSelected = idx === safeActiveIndex;

          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttonRefs.current[idx] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick(idx);
              }}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              style={{
                opacity: isVisualActive ? 1 : Math.max(0.65, 1 - dist * 0.35),
              }}
              className={`relative z-10 flex items-center gap-1.5 whitespace-nowrap cursor-pointer select-none transition-colors ${
                indicatorVariant === 'pill'
                  ? `flex-1 justify-center py-1.5 px-2 text-xs font-semibold rounded-lg ${
                      isVisualActive
                        ? 'text-primary theme-text-primary font-bold'
                        : 'text-secondary theme-text-secondary hover:text-primary'
                    }`
                  : `py-3 ${
                      isVisualActive
                        ? 'text-accent'
                        : 'text-muted hover:text-primary'
                    }`
              } ${tabButtonClassName}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge}
            </button>
          );
        })}
      </div>

      {/* Horizontal Carousel Viewport */}
      <div
        ref={carouselContainerRef}
        onScroll={(e) => {
          e.currentTarget.scrollLeft = 0;
        }}
        {...(enableContentSwipe ? contentSwipeHandlers : {})}
        style={{
          touchAction: enableContentSwipe ? 'pan-y' : undefined,
          height:
            autoHeight && targetViewportHeight !== undefined
              ? `${targetViewportHeight}px`
              : undefined,
          transition:
            autoHeight && enableHeightTransition && !isAnyDragging
              ? 'height 260ms cubic-bezier(0.2, 0.8, 0.2, 1)'
              : 'none',
        }}
        className={`relative w-full min-h-0 overflow-hidden ${
          autoHeight ? 'flex-[0_1_auto]' : 'flex-1 h-full'
        } ${viewportClassName}`}
      >
        <div
          className={`flex items-stretch flex-nowrap h-full ${
            isContentDragging ? 'select-none' : ''
          }`}
          style={{
            width: trackWidthStyle,
            transform: `translate3d(${pixelOffset}px, 0, 0)`,
            willChange: isAnyDragging || isTransitioning ? 'transform' : 'auto',
            transition: isAnyDragging
              ? 'none'
              : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          {tabs.map((tab, idx) => (
            <div
              key={tab.id}
              role="tabpanel"
              aria-hidden={idx !== safeActiveIndex && !isAnyDragging}
              className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
              style={{
                width: slideWidthStyle,
                minWidth: slideWidthStyle,
                maxWidth: slideWidthStyle,
                flexShrink: 0,
                boxSizing: 'border-box',
              }}
            >
              <div
                ref={(el) => {
                  slideContentRefs.current[idx] = el;
                }}
                className={`flow-root ${tab.slideClassName ?? slideClassName}`}
              >
                {tab.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

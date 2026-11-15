import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';

interface SmartQuestionImageProps {
  src: string;
  alt?: string;
  source?: string;
  className?: string;
  lazy?: boolean;
}

const MIN_MODAL_ZOOM = 1;
const MAX_MODAL_ZOOM = 3;
const MODAL_ZOOM_STEP = 0.25;

const loadedImageCache = new Set<string>();
const preloadInFlight = new Map<string, Promise<boolean>>();

function getExtensionFromMime(mime: string): string {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('avif')) return 'avif';
  return 'png';
}

function buildDownloadFilename(src: string, alt?: string, mimeType?: string): string {
  const baseRaw =
    alt && alt !== 'Material visual da questão' ? alt : 'imagem-questao';
  const baseSlug =
    baseRaw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'imagem-questao';

  if (mimeType) {
    return `${baseSlug}.${getExtensionFromMime(mimeType)}`;
  }

  const dataMatch = src.match(/^data:([^;,]+)/i);
  if (dataMatch) {
    return `${baseSlug}.${getExtensionFromMime(dataMatch[1])}`;
  }

  const urlExtMatch = src.split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,5})$/i);
  const ext = urlExtMatch ? urlExtMatch[1].toLowerCase() : 'png';
  return `${baseSlug}.${ext}`;
}

/**
 * Silently preloads an image into browser RAM and records it in cache
 * so adjacent questions render immediately without a white flash.
 */
export function preloadAndAnalyzeImage(src: string): Promise<boolean> {
  if (!src || typeof Image === 'undefined') {
    return Promise.resolve(false);
  }
  if (loadedImageCache.has(src)) {
    return Promise.resolve(true);
  }
  const existing = preloadInFlight.get(src);
  if (existing) {
    return existing;
  }

  const promise = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';

    img.onload = () => {
      loadedImageCache.add(src);
      preloadInFlight.delete(src);
      resolve(true);
    };

    img.onerror = () => {
      preloadInFlight.delete(src);
      resolve(false);
    };

    img.src = src;
  });

  preloadInFlight.set(src, promise);
  return promise;
}

export const SmartQuestionImage: React.FC<SmartQuestionImageProps> = ({
  src,
  alt = 'Material visual da questão',
  source,
  className = 'max-h-96 w-auto mx-auto rounded object-contain',
  lazy = false,
}) => {
  const filterId = useId().replace(/:/g, '');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const modalViewportRef = useRef<HTMLDivElement | null>(null);
  const modalImgRef = useRef<HTMLImageElement | null>(null);
  const baseModalImgSizeRef = useRef<{ width: number; height: number } | null>(null);
  const panStateRef = useRef<{
    isDragging: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    isDragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  const [trackedSrc, setTrackedSrc] = useState<string>(src);
  const [wasCachedOnMount, setWasCachedOnMount] = useState<boolean>(() =>
    loadedImageCache.has(src)
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(() => loadedImageCache.has(src));
  const [isZoomOpen, setIsZoomOpen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [baseModalImgSize, setBaseModalImgSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'night';
    }
    return 'night';
  });

  // Synchronously resolve RAM cache state before paint when src changes
  if (trackedSrc !== src) {
    const hasCached = loadedImageCache.has(src);
    setTrackedSrc(src);
    setWasCachedOnMount(hasCached);
    setIsLoaded(hasCached);
    setIsZoomOpen(false);
    setZoomScale(1);
    setBaseModalImgSize(null);
    baseModalImgSizeRef.current = null;
  }

  // Observe changes to document.documentElement[data-theme]
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const htmlEl = document.documentElement;
    const updateTheme = () => {
      setActiveTheme(htmlEl.getAttribute('data-theme') || 'night');
    };
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(htmlEl, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  const zoomScaleRef = useRef<number>(1);
  zoomScaleRef.current = zoomScale;

  const closeModal = useCallback(() => {
    setIsZoomOpen(false);
    zoomScaleRef.current = 1;
    setZoomScale(1);
    setIsPanning(false);
    setBaseModalImgSize(null);
    baseModalImgSizeRef.current = null;
  }, []);

  const captureBaseModalImageSize = useCallback(() => {
    const imgEl = modalImgRef.current;
    if (!imgEl) return baseModalImgSizeRef.current;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const size = { width: rect.width, height: rect.height };
      baseModalImgSizeRef.current = size;
      setBaseModalImgSize(size);
      return size;
    }
    return baseModalImgSizeRef.current;
  }, []);

  const applyZoomScale = useCallback(
    (nextScaleRaw: number) => {
      const current = zoomScaleRef.current;
      const clamped = Math.min(
        MAX_MODAL_ZOOM,
        Math.max(MIN_MODAL_ZOOM, Math.round(nextScaleRaw * 100) / 100)
      );
      if (clamped === current) return;
      if (current === 1 && clamped > 1) {
        captureBaseModalImageSize();
      }
      zoomScaleRef.current = clamped;
      setZoomScale(clamped);
      if (clamped === 1) {
        baseModalImgSizeRef.current = null;
        if (modalViewportRef.current) {
          modalViewportRef.current.scrollTo({ left: 0, top: 0 });
        }
      }
    },
    [captureBaseModalImageSize]
  );

  const handleZoomIn = useCallback(() => {
    applyZoomScale(zoomScaleRef.current + MODAL_ZOOM_STEP);
  }, [applyZoomScale]);

  const handleZoomOut = useCallback(() => {
    applyZoomScale(zoomScaleRef.current - MODAL_ZOOM_STEP);
  }, [applyZoomScale]);

  const handleResetZoom = useCallback(() => {
    applyZoomScale(1);
  }, [applyZoomScale]);

  // Close zoom modal on Esc
  useEffect(() => {
    if (!isZoomOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZoomOpen, closeModal]);

  // Attach non-passive wheel handler on modal viewport for Ctrl+wheel / wheel zoom
  useEffect(() => {
    if (!isZoomOpen) return;
    const viewport = modalViewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      const currentZoom = zoomScaleRef.current;
      const wantsZoom = e.ctrlKey || e.metaKey || currentZoom === 1;
      if (!wantsZoom) {
        // When zoomed > 1 without Ctrl, let native wheel scrolling work smoothly
        return;
      }

      // If at 100% and scrolling down without Ctrl, don't trap normal gesture unnecessarily
      if (!e.ctrlKey && !e.metaKey && currentZoom === 1 && e.deltaY >= 0) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? MODAL_ZOOM_STEP : -MODAL_ZOOM_STEP;
      applyZoomScale(currentZoom + delta);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [isZoomOpen, applyZoomScale]);

  const handlePointerDownPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomScale <= 1 || e.button !== 0) return;
    const viewport = modalViewportRef.current;
    if (!viewport) return;

    panStateRef.current = {
      isDragging: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
    try {
      viewport.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  };

  const handlePointerMovePan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isDragging) return;
    const viewport = modalViewportRef.current;
    if (!viewport) return;

    const dx = e.clientX - panStateRef.current.startX;
    const dy = e.clientY - panStateRef.current.startY;
    viewport.scrollLeft = panStateRef.current.startScrollLeft - dx;
    viewport.scrollTop = panStateRef.current.startScrollTop - dy;
  };

  const handlePointerUpPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isDragging) return;
    const viewport = modalViewportRef.current;
    panStateRef.current.isDragging = false;
    setIsPanning(false);
    if (viewport && panStateRef.current.pointerId !== null) {
      try {
        viewport.releasePointerCapture(panStateRef.current.pointerId);
      } catch {
        // Ignore capture release errors
      }
    }
    panStateRef.current.pointerId = null;
  };

  const handleDownloadImage = async () => {
    if (!src || isDownloading || typeof document === 'undefined') return;
    setIsDownloading(true);

    const triggerAnchorDownload = (href: string, filename: string, openInNewTab: boolean = false) => {
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      if (openInNewTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    try {
      if (src.startsWith('data:') || src.startsWith('blob:')) {
        const filename = buildDownloadFilename(src, alt);
        triggerAnchorDownload(src, filename);
        return;
      }

      const response = await fetch(src, {
        mode: 'cors',
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const filename = buildDownloadFilename(src, alt, blob.type);
      triggerAnchorDownload(objectUrl, filename);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch {
      // Fallback for external hosts that disallow CORS fetch
      const filename = buildDownloadFilename(src, alt);
      triggerAnchorDownload(src, filename, true);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleImageLoad = useCallback(() => {
    loadedImageCache.add(src);
    setIsLoaded(true);
  }, [src]);

  // Ensure cached browser images that complete synchronously never stay at opacity: 0
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && !isLoaded) {
      handleImageLoad();
    }
  }, [src, isLoaded, handleImageLoad]);

  const handleImageError = () => {
    setIsLoaded(true);
  };

  const normalizedTheme =
    activeTheme === 'amber'
      ? 'night'
      : activeTheme === 'sepia'
      ? 'reading'
      : activeTheme;

  const getAdaptiveStyle = (): React.CSSProperties => {
    if (normalizedTheme === 'light') return {};

    if (normalizedTheme === 'reading') {
      return {
        mixBlendMode: 'multiply',
      };
    }

    if (normalizedTheme === 'dark') {
      return {
        filter: 'invert(1) hue-rotate(180deg) contrast(1.06)',
        mixBlendMode: 'screen',
      };
    }

    if (normalizedTheme === 'night') {
      return {
        filter: `url(#night-diagram-${filterId})`,
        mixBlendMode: 'screen',
      };
    }

    return {};
  };

  const hasCustomCaption = Boolean(alt && alt !== 'Material visual da questão');
  const zoomPercent = Math.round(zoomScale * 100);
  const isZoomed = zoomScale > 1;
  const zoomedDimensions =
    isZoomed && baseModalImgSize
      ? {
          width: `${Math.round(baseModalImgSize.width * zoomScale)}px`,
          height: `${Math.round(baseModalImgSize.height * zoomScale)}px`,
          maxWidth: 'none',
          maxHeight: 'none',
        }
      : undefined;

  return (
    <div className="relative group flex flex-col items-center justify-center">
      {/* Inline SVG Filter for Circadian Night Mode */}
      <svg width="0" height="0" className="absolute w-0 h-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <filter id={`night-diagram-${filterId}`} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="-1 0 0 0 1  -0.22 0 0 0 0.22  0 0 0 0 0  0 0 0 1 0"
          />
        </filter>
      </svg>

      <img
        key={src}
        ref={imgRef}
        src={src}
        alt={alt}
        decoding="async"
        loading={lazy ? 'lazy' : 'eager'}
        data-smart-image="true"
        referrerPolicy="no-referrer"
        onLoad={handleImageLoad}
        onError={handleImageError}
        onClick={(e) => {
          e.stopPropagation();
          setZoomScale(1);
          setBaseModalImgSize(null);
          baseModalImgSizeRef.current = null;
          setIsZoomOpen(true);
        }}
        style={{
          ...getAdaptiveStyle(),
          opacity: isLoaded ? 1 : 0,
          transition: wasCachedOnMount ? undefined : 'opacity 100ms ease-out',
        }}
        title="Clique para ampliar a imagem original sem filtro"
        className={`${className} cursor-zoom-in`}
      />

      {isZoomOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-canvas/85 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={closeModal}
            role="dialog"
            aria-modal="true"
            aria-label="Visualização original da imagem"
          >
            <div
              className="theme-modal relative w-full max-w-4xl max-h-[92dvh] rounded-2xl border border-border bg-surface shadow-2xl p-3 sm:p-5 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Discrete Top Toolbar */}
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-border shrink-0">
                <div className="inline-flex items-center gap-1 rounded-xl bg-surface-subtle border border-border p-1">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    disabled={zoomScale <= MIN_MODAL_ZOOM}
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Diminuir zoom"
                    title="Diminuir zoom"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>

                  <span className="min-w-[3.25rem] text-center text-xs font-mono font-semibold text-primary tabular-nums px-1 select-none">
                    {zoomPercent}%
                  </span>

                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={zoomScale >= MAX_MODAL_ZOOM}
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Aumentar zoom"
                    title="Aumentar zoom"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>

                  {zoomScale !== 1 && (
                    <button
                      type="button"
                      onClick={handleResetZoom}
                      className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                      aria-label="Resetar zoom para 100%"
                      title="Resetar zoom (100%)"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleDownloadImage}
                    disabled={isDownloading}
                    className="p-2 rounded-xl bg-surface-subtle hover:bg-surface-hover text-secondary hover:text-primary border border-border transition-colors cursor-pointer disabled:opacity-50"
                    aria-label="Salvar imagem"
                    title="Salvar imagem"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={closeModal}
                    className="p-2 rounded-xl text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                    aria-label="Fechar visualização da imagem"
                    title="Fechar (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable & Pannable Image Viewport */}
              <div
                ref={modalViewportRef}
                onPointerDown={handlePointerDownPan}
                onPointerMove={handlePointerMovePan}
                onPointerUp={handlePointerUpPan}
                onPointerCancel={handlePointerUpPan}
                className={`w-full flex-1 min-h-0 flex overflow-auto rounded-xl p-2 bg-surface-subtle border border-border ${
                  isZoomed
                    ? isPanning
                      ? 'cursor-grabbing select-none touch-none'
                      : 'cursor-grab select-none touch-none'
                    : ''
                }`}
              >
                <img
                  ref={modalImgRef}
                  src={src}
                  alt={alt}
                  decoding="async"
                  data-smart-image="true"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onLoad={() => {
                    if (zoomScale === 1) {
                      baseModalImgSizeRef.current = null;
                      captureBaseModalImageSize();
                    }
                  }}
                  style={zoomedDimensions}
                  className={
                    isZoomed
                      ? 'm-auto block rounded select-none shrink-0'
                      : 'm-auto max-h-[72dvh] w-auto max-w-full object-contain rounded select-none'
                  }
                />
              </div>

              {(hasCustomCaption || source) && (
                <div className="w-full mt-3 space-y-1 text-center shrink-0">
                  {hasCustomCaption && (
                    <p className="text-xs text-secondary italic leading-relaxed">
                      {alt}
                    </p>
                  )}
                  {source && (
                    <p className="text-[11px] text-muted/80 leading-snug">
                      {source}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

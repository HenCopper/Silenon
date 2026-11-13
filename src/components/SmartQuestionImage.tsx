import React, { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SmartQuestionImageProps {
  src: string;
  alt?: string;
  source?: string;
  className?: string;
}

export const SmartQuestionImage: React.FC<SmartQuestionImageProps> = ({
  src,
  alt = 'Material visual da questão',
  source,
  className = 'max-h-96 w-auto mx-auto rounded object-contain',
}) => {
  const filterId = useId().replace(/:/g, '');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [useCors, setUseCors] = useState<boolean>(true);
  const [isMonochrome, setIsMonochrome] = useState<boolean>(false);
  const [isZoomOpen, setIsZoomOpen] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'night';
    }
    return 'night';
  });

  // Reset state when src changes
  useEffect(() => {
    setUseCors(true);
    setIsMonochrome(false);
    setIsZoomOpen(false);
  }, [src]);

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

  // Close zoom modal on Esc
  useEffect(() => {
    if (!isZoomOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsZoomOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZoomOpen]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !useCors) return;

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvas.width = 64;
      canvas.height = 64;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);

      const imageData = ctx.getImageData(0, 0, 64, 64).data;
      let totalValidPixels = 0;
      let lowSaturationPixels = 0;
      let lightBackgroundPixels = 0;

      for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        // Transparent pixels act like background
        if (a < 40) {
          totalValidPixels++;
          lowSaturationPixels++;
          lightBackgroundPixels++;
          continue;
        }

        totalValidPixels++;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const chromaDiff = maxC - minC;

        if (chromaDiff < 28) {
          lowSaturationPixels++;
        }
        if (r > 190 && g > 190 && b > 190) {
          lightBackgroundPixels++;
        }
      }

      if (totalValidPixels > 0) {
        const lowSatRatio = lowSaturationPixels / totalValidPixels;
        const lightBgRatio = lightBackgroundPixels / totalValidPixels;
        // Predominantly B&W diagram/formula/graph on light background
        const detectedMonochrome = lowSatRatio >= 0.85 && lightBgRatio >= 0.42;
        setIsMonochrome(detectedMonochrome);
      }
    } catch {
      // Canvas tainted or CORS blocked pixel inspection -> keep original untouched
      setIsMonochrome(false);
    }
  };

  const handleImageError = () => {
    // Graceful fallback if external server blocks anonymous CORS request
    if (useCors) {
      setUseCors(false);
      setIsMonochrome(false);
    }
  };

  const normalizedTheme =
    activeTheme === 'amber'
      ? 'night'
      : activeTheme === 'sepia'
      ? 'reading'
      : activeTheme;

  const shouldApplyFilter = isMonochrome && normalizedTheme !== 'light';

  const getAdaptiveStyle = (): React.CSSProperties => {
    if (!shouldApplyFilter) return {};

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

  return (
    <div className="relative group flex flex-col items-center justify-center">
      {/* Hidden 64x64 Canvas for Chroma & Background Luminance Inspection */}
      <canvas
        ref={canvasRef}
        width={64}
        height={64}
        className="hidden pointer-events-none"
        aria-hidden="true"
      />

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
        ref={imgRef}
        src={src}
        alt={alt}
        data-smart-image="true"
        crossOrigin={useCors ? 'anonymous' : undefined}
        referrerPolicy="no-referrer"
        onLoad={handleImageLoad}
        onError={handleImageError}
        onClick={(e) => {
          e.stopPropagation();
          setIsZoomOpen(true);
        }}
        style={getAdaptiveStyle()}
        title="Clique para ampliar a imagem original sem filtro"
        className={`${className} cursor-zoom-in transition-all duration-200`}
      />

      {isZoomOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-canvas/85 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => setIsZoomOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Visualização original da imagem"
          >
            <div
              className="theme-modal relative w-full max-w-4xl max-h-[90vh] max-h-[90dvh] rounded-2xl border border-border bg-surface shadow-2xl p-4 sm:p-6 flex flex-col items-center overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsZoomOpen(false)}
                className="self-end mb-2 p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                aria-label="Fechar visualização da imagem"
                title="Fechar (Esc)"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-full flex items-center justify-center rounded-xl p-2 bg-surface-subtle border border-border">
                <img
                  src={src}
                  alt={alt}
                  data-smart-image="true"
                  referrerPolicy="no-referrer"
                  className="max-h-[75dvh] w-auto max-w-full mx-auto object-contain rounded"
                />
              </div>

              {(hasCustomCaption || source) && (
                <div className="w-full mt-3 space-y-1 text-center">
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

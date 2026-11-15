import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { acquireMediaUrl, getCachedMediaUrlSync } from '../lib/mediaWindowCache';
import { SmartQuestionImage } from './SmartQuestionImage';

export interface QuestionMediaRendererProps {
  url: string;
  alt?: string | null;
  source?: string | null;
  type?: string;
  className?: string;
  lazy?: boolean;
}

const svgMarkupCache = new Map<string, string>();
const svgPreloadInFlight = new Map<string, Promise<string | null>>();

export function detectMediaRenderKind(
  url: string,
  explicitType?: string
): 'audio' | 'video' | 'svg' | 'image' {
  const t = (explicitType || '').toLowerCase().trim();
  if (t === 'audio' || t === 'áudio') return 'audio';
  if (t === 'video' || t === 'vídeo') return 'video';
  if (t === 'svg' || t === 'image/svg+xml') return 'svg';

  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp3|ogg|wav)$/i.test(cleanUrl)) return 'audio';
  if (/\.(mp4|webm)$/i.test(cleanUrl)) return 'video';
  if (/\.svg$/i.test(cleanUrl)) return 'svg';
  return 'image';
}

function normalizeInlineSvg(rawSvg: string): string {
  const svgStart = rawSvg.search(/<svg[\s>]/i);
  const extracted = svgStart >= 0 ? rawSvg.slice(svgStart) : rawSvg;

  return extracted
    // Strip scripts and event handlers for safety
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Replace hardcoded dark strokes/fills (#111111, #000000, #111, #000, rgb(0,0,0), black) with currentColor
    .replace(/#(?:111111|000000|111|000)\b/gi, 'currentColor')
    .replace(/rgb\(\s*(?:0\s*,\s*0\s*,\s*0|17\s*,\s*17\s*,\s*17)\s*\)/gi, 'currentColor')
    .replace(/(stroke|fill|color)\s*=\s*(["'])\s*black\s*\2/gi, '$1=$2currentColor$2')
    .replace(/(stroke|fill|color)\s*:\s*black\b/gi, '$1:currentColor');
}

function getCachedSvgSync(url: string, resolvedUrl: string | null): string | null {
  if (url && svgMarkupCache.has(url)) return svgMarkupCache.get(url) ?? null;
  if (resolvedUrl && svgMarkupCache.has(resolvedUrl)) return svgMarkupCache.get(resolvedUrl) ?? null;
  return null;
}

export function preloadSvgMarkup(resolvedUrl: string, rawUrl?: string): Promise<string | null> {
  if (!resolvedUrl) return Promise.resolve(null);
  const cached = getCachedSvgSync(rawUrl || resolvedUrl, resolvedUrl);
  if (cached) return Promise.resolve(cached);

  const key = rawUrl || resolvedUrl;
  const inFlight = svgPreloadInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetch(resolvedUrl)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to load SVG');
      return res.text();
    })
    .then((rawText) => {
      if (!/<svg[\s>]/i.test(rawText)) return null;
      const normalized = normalizeInlineSvg(rawText);
      svgMarkupCache.set(resolvedUrl, normalized);
      if (rawUrl) {
        svgMarkupCache.set(rawUrl, normalized);
      }
      return normalized;
    })
    .catch(() => null)
    .finally(() => {
      svgPreloadInFlight.delete(key);
    });

  svgPreloadInFlight.set(key, promise);
  return promise;
}

const SVG_GRAPHIC_SELECTOR = 'path, line, polyline, polygon, rect, circle, ellipse, text';

export const QuestionMediaRenderer: React.FC<QuestionMediaRendererProps> = ({
  url,
  alt,
  source,
  type,
  className,
  lazy = false,
}) => {
  const kind = detectMediaRenderKind(url, type);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);

  const [trackedKey, setTrackedKey] = useState<string>(`${kind}::${url}`);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => getCachedMediaUrlSync(url));
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!url || !url.trim()) return false;
    return getCachedMediaUrlSync(url) === null;
  });
  const [hasError, setHasError] = useState<boolean>(false);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(() => {
    if (kind !== 'svg') return null;
    const syncResolved = getCachedMediaUrlSync(url);
    return getCachedSvgSync(url, syncResolved);
  });
  const [isSvgLoading, setIsSvgLoading] = useState<boolean>(() => {
    if (kind !== 'svg') return false;
    const syncResolved = getCachedMediaUrlSync(url);
    return Boolean(syncResolved) && !getCachedSvgSync(url, syncResolved);
  });

  // Synchronously resolve cached media URL and cached SVG markup when url/kind changes
  const nextKey = `${kind}::${url}`;
  if (trackedKey !== nextKey) {
    setTrackedKey(nextKey);
    const trimmed = url?.trim() || '';
    const syncHit = trimmed ? getCachedMediaUrlSync(trimmed) : null;
    const cachedSvg = kind === 'svg' && trimmed ? getCachedSvgSync(trimmed, syncHit) : null;

    setResolvedUrl(syncHit);
    setIsLoading(Boolean(trimmed) && syncHit === null && !cachedSvg);
    setHasError(false);
    setSvgMarkup(cachedSvg);
    setIsSvgLoading(kind === 'svg' && Boolean(syncHit) && !cachedSvg);
  }

  useEffect(() => {
    let active = true;

    if (!url || !url.trim()) {
      setResolvedUrl(null);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    const syncHit = getCachedMediaUrlSync(url);
    if (syncHit) {
      setResolvedUrl(syncHit);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    acquireMediaUrl(url)
      .then((acquiredUrl) => {
        if (!active) return;
        if (acquiredUrl) {
          setResolvedUrl(acquiredUrl);
          setHasError(false);
        } else {
          setResolvedUrl(null);
          setHasError(true);
        }
      })
      .catch(() => {
        if (!active) return;
        setResolvedUrl(null);
        setHasError(true);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    let active = true;

    if (kind !== 'svg') {
      setSvgMarkup(null);
      setIsSvgLoading(false);
      return;
    }

    const cached = getCachedSvgSync(url, resolvedUrl);
    if (cached) {
      setSvgMarkup(cached);
      setIsSvgLoading(false);
      return;
    }

    if (!resolvedUrl) {
      setSvgMarkup(null);
      setIsSvgLoading(false);
      return;
    }

    setIsSvgLoading(true);
    preloadSvgMarkup(resolvedUrl, url)
      .then((normalized) => {
        if (!active) return;
        setSvgMarkup(normalized);
      })
      .finally(() => {
        if (active) {
          setIsSvgLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [kind, resolvedUrl, url]);

  // Trace-by-trace SVG animation (< 500ms total: max 350ms staggered delay + 120ms duration = 470ms)
  useLayoutEffect(() => {
    if (kind !== 'svg' || !svgMarkup || !svgContainerRef.current) return;
    const svgEl = svgContainerRef.current.querySelector('svg');
    if (!svgEl) return;

    const elements = (
      Array.from(svgEl.querySelectorAll(SVG_GRAPHIC_SELECTOR)) as SVGElement[]
    ).filter((el) => !el.closest('defs, clipPath, mask, pattern, marker'));

    const total = elements.length;
    if (total === 0) return;

    const cleanups: Array<() => void> = [];

    elements.forEach((el, index) => {
      const delayMs = Math.round((index / Math.max(1, total - 1)) * 350);
      const tag = el.tagName.toLowerCase();
      let strokeLen = 0;

      if (tag !== 'text' && typeof (el as unknown as SVGGeometryElement).getTotalLength === 'function') {
        try {
          const measured = (el as unknown as SVGGeometryElement).getTotalLength();
          if (Number.isFinite(measured) && measured > 0) {
            strokeLen = measured;
          }
        } catch {
          strokeLen = 0;
        }
      }

      if (strokeLen > 0) {
        const origInlineDashArray = el.style.strokeDasharray;
        const origInlineDashOffset = el.style.strokeDashoffset;

        el.style.setProperty('--svg-stroke-len', `${strokeLen}`);
        el.style.strokeDasharray = `${strokeLen} ${strokeLen}`;
        el.style.strokeDashoffset = `${strokeLen}`;
        el.style.animation = `svg-stroke-draw 120ms ease-out ${delayMs}ms both`;

        const handleAnimationEnd = () => {
          el.style.strokeDasharray = origInlineDashArray;
          el.style.strokeDashoffset = origInlineDashOffset;
          el.style.animation = '';
        };
        el.addEventListener('animationend', handleAnimationEnd, { once: true });
        cleanups.push(() => el.removeEventListener('animationend', handleAnimationEnd));
      } else {
        const hasExistingTransform = Boolean(el.getAttribute('transform') || el.style.transform);
        const keyframeName = hasExistingTransform ? 'svg-element-fade' : 'svg-element-fade-up';
        el.style.animation = `${keyframeName} 120ms ease-out ${delayMs}ms both`;

        const handleAnimationEnd = () => {
          el.style.animation = '';
        };
        el.addEventListener('animationend', handleAnimationEnd, { once: true });
        cleanups.push(() => el.removeEventListener('animationend', handleAnimationEnd));
      }
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [kind, svgMarkup, url, resolvedUrl]);

  if (!url || !url.trim()) return null;

  if (isLoading || (kind === 'svg' && isSvgLoading)) {
    return (
      <div className="w-full py-6 px-4 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-xs text-muted animate-pulse">
        Carregando mídia...
      </div>
    );
  }

  if (hasError || (!resolvedUrl && !svgMarkup)) {
    return (
      <div className="w-full py-3 px-4 rounded-lg bg-surface-subtle border border-border text-xs text-muted italic text-center">
        {alt || 'Mídia indisponível no pacote local.'}
      </div>
    );
  }

  if (kind === 'audio' && resolvedUrl) {
    return (
      <div className={`w-full space-y-1.5 ${className || ''}`}>
        <audio controls preload="metadata" className="w-full" src={resolvedUrl} />
        {alt && <p className="text-xs text-muted italic text-center">{alt}</p>}
      </div>
    );
  }

  if (kind === 'video' && resolvedUrl) {
    return (
      <div className={`w-full space-y-1.5 ${className || ''}`}>
        <video
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-96 rounded-lg bg-canvas border border-border"
          src={resolvedUrl}
        />
        {alt && <p className="text-xs text-muted italic text-center">{alt}</p>}
      </div>
    );
  }

  if (kind === 'svg' && svgMarkup) {
    return (
      <div
        ref={svgContainerRef}
        key={`${url}::${resolvedUrl || ''}`}
        role="img"
        aria-label={alt || 'Figura vetorial da questão'}
        className={`w-full flex items-center justify-center bg-transparent text-primary theme-text-primary [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-96 [&_svg]:mx-auto [&_svg]:block ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }

  if (!resolvedUrl) return null;

  return (
    <SmartQuestionImage
      src={resolvedUrl}
      alt={alt || undefined}
      source={source || undefined}
      className={className}
      lazy={lazy}
    />
  );
};

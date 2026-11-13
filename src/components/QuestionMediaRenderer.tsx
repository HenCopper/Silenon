import React, { useState, useEffect } from 'react';
import { acquireMediaUrl, getCachedMediaUrlSync } from '../lib/mediaWindowCache';
import { SmartQuestionImage } from './SmartQuestionImage';

export interface QuestionMediaRendererProps {
  url: string;
  alt?: string | null;
  source?: string | null;
  type?: string;
  className?: string;
}

function detectRenderKind(url: string, explicitType?: string): 'audio' | 'video' | 'svg' | 'image' {
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

export const QuestionMediaRenderer: React.FC<QuestionMediaRendererProps> = ({
  url,
  alt,
  source,
  type,
  className,
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => getCachedMediaUrlSync(url));
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!url || !url.trim()) return false;
    return getCachedMediaUrlSync(url) === null;
  });
  const [hasError, setHasError] = useState<boolean>(false);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [isSvgLoading, setIsSvgLoading] = useState<boolean>(false);

  const kind = detectRenderKind(url, type);

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

    if (kind !== 'svg' || !resolvedUrl) {
      setSvgMarkup(null);
      setIsSvgLoading(false);
      return;
    }

    setIsSvgLoading(true);
    fetch(resolvedUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load SVG');
        return res.text();
      })
      .then((rawText) => {
        if (!active) return;
        if (/<svg[\s>]/i.test(rawText)) {
          setSvgMarkup(normalizeInlineSvg(rawText));
        } else {
          setSvgMarkup(null);
        }
      })
      .catch(() => {
        if (!active) return;
        setSvgMarkup(null);
      })
      .finally(() => {
        if (active) {
          setIsSvgLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [kind, resolvedUrl]);

  if (!url || !url.trim()) return null;

  if (isLoading || (kind === 'svg' && isSvgLoading)) {
    return (
      <div className="w-full py-6 px-4 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-xs text-muted animate-pulse">
        Carregando mídia...
      </div>
    );
  }

  if (hasError || !resolvedUrl) {
    return (
      <div className="w-full py-3 px-4 rounded-lg bg-surface-subtle border border-border text-xs text-muted italic text-center">
        {alt || 'Mídia indisponível no pacote local.'}
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={`w-full space-y-1.5 ${className || ''}`}>
        <audio controls preload="metadata" className="w-full" src={resolvedUrl} />
        {alt && <p className="text-xs text-muted italic text-center">{alt}</p>}
      </div>
    );
  }

  if (kind === 'video') {
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
        role="img"
        aria-label={alt || 'Figura vetorial da questão'}
        className={`w-full flex items-center justify-center bg-transparent text-primary theme-text-primary [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-96 [&_svg]:mx-auto [&_svg]:block ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }

  return (
    <SmartQuestionImage
      src={resolvedUrl}
      alt={alt || undefined}
      source={source || undefined}
      className={className}
    />
  );
};

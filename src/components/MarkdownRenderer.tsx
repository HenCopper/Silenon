import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import {
  StriveGeneratedGraph,
  computeGraphMarkerKey,
  normalizeGraphShortTitle,
} from '../lib/aiOrchestrator';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  graphsByKey?: Record<string, StriveGeneratedGraph>;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

interface ActiveGraphModalData {
  title: string;
  description: string;
  svg: string;
}

type KatexModule = typeof import('katex');

let katexModuleCache: KatexModule | null = null;
let katexLoadPromise: Promise<KatexModule | null> | null = null;

function ensureKatexLoaded(): Promise<KatexModule | null> {
  if (katexModuleCache) {
    return Promise.resolve(katexModuleCache);
  }
  if (!katexLoadPromise) {
    katexLoadPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ])
      .then(([mod]) => {
        katexModuleCache = (mod as any)?.default ? mod : mod;
        return katexModuleCache;
      })
      .catch(() => {
        katexLoadPromise = null;
        return null;
      });
  }
  return katexLoadPromise;
}

function renderLatexToHtml(formula: string, displayMode: boolean): string | null {
  const cleanFormula = (formula || '').trim();
  if (!cleanFormula || !katexModuleCache) return null;
  try {
    const katexApi = (katexModuleCache as any).default || katexModuleCache;
    return katexApi.renderToString(cleanFormula, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  } catch {
    return null;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface GlossaryTermSpanProps {
  matchedText: string;
  term: string;
  definition: string;
}

const GlossaryTermSpan: React.FC<GlossaryTermSpanProps> = ({
  matchedText,
  term,
  definition,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeBelow: boolean } | null>(
    null
  );
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const isOpen = isHovered || isPinned;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const viewportW = window.innerWidth || 360;
    const halfPopoverMaxW = Math.min(160, Math.floor((viewportW - 24) / 2));
    const rawCenterX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      12 + halfPopoverMaxW,
      Math.min(viewportW - 12 - halfPopoverMaxW, rawCenterX)
    );
    const placeBelow = rect.top < 110;
    const top = placeBelow ? rect.bottom + 8 : rect.top - 8;

    setCoords({
      top,
      left: clampedLeft,
      placeBelow,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsPinned(false);
        setIsHovered(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPinned(false);
        setIsHovered(false);
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updatePosition]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => {
          updatePosition();
          setIsHovered(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          updatePosition();
          setIsPinned((prev) => !prev);
        }}
        className="cursor-help bg-accent/50 text-primary rounded px-1 py-0.5 transition-colors hover:bg-accent/70"
      >
        {matchedText}
      </span>
      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              transform: coords.placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="fixed bg-surface border border-border text-primary shadow-xl rounded-xl p-2.5 text-xs z-50 max-w-xs leading-relaxed font-normal not-italic"
          >
            <span className="font-bold text-primary block mb-0.5">{term}</span>
            <span className="text-secondary block">{definition}</span>
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * Extrai blocos cercados ```glossario ou ```glossary contendo Array<{ term: string; definition: string }>
 * e remove o bloco bruto do corpo do markdown (inclusive durante streaming se ainda estiver aberto).
 */
function extractGlossaryFromMarkdown(rawMarkdown: string): {
  cleanedMarkdown: string;
  glossary: GlossaryEntry[];
} {
  const glossaryMap = new Map<string, GlossaryEntry>();

  const parseAndCollect = (jsonCandidate: string) => {
    const trimmed = jsonCandidate.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            typeof item.term === 'string' &&
            typeof item.definition === 'string'
          ) {
            const cleanTerm = item.term.trim();
            const cleanDef = item.definition.trim();
            if (cleanTerm && cleanDef) {
              const key = cleanTerm.toLowerCase();
              if (!glossaryMap.has(key)) {
                glossaryMap.set(key, { term: cleanTerm, definition: cleanDef });
              }
            }
          }
        }
      }
    } catch {
      // Ignora silenciosamente JSON incompleto durante streaming ou inválido
    }
  };

  // 1. Extrai blocos fechados ```glossario ... ``` ou ```glossary ... ```
  const closedFenceRegex = /```(?:glossario|glossary)\b[ \t]*\r?\n?([\s\S]*?)```/gi;
  let cleaned = rawMarkdown.replace(closedFenceRegex, (_fullMatch, innerJson: string) => {
    parseAndCollect(innerJson);
    return '';
  });

  // 2. Remove bloco ```glossario ou ```glossary ainda aberto no final durante streaming
  const openFenceRegex = /```(?:glossario|glossary)\b[ \t]*(?:\r?\n?([\s\S]*))?$/i;
  cleaned = cleaned.replace(openFenceRegex, (_fullMatch, partialJson?: string) => {
    if (partialJson) {
      parseAndCollect(partialJson);
    }
    return '';
  });

  return {
    cleanedMarkdown: cleaned.trim(),
    glossary: Array.from(glossaryMap.values()),
  };
}

interface InlineRenderContext {
  graphsByKey?: Record<string, StriveGeneratedGraph>;
  onOpenGraphModal?: (graph: ActiveGraphModalData) => void;
}

function renderGraphWidget(
  rawTitle: string,
  rawDescription: string,
  key: string | number,
  ctx?: InlineRenderContext,
  forceLoading: boolean = false
): React.ReactNode {
  const shortTitle = normalizeGraphShortTitle(rawTitle);
  const cleanDescription = (rawDescription || '')
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const markerKey = computeGraphMarkerKey(shortTitle, cleanDescription);
  const graphEntry = ctx?.graphsByKey?.[markerKey];

  const isReady =
    !forceLoading &&
    graphEntry &&
    graphEntry.status === 'ready' &&
    Boolean(graphEntry.svg && graphEntry.svg.trim());

  if (!isReady || !graphEntry) {
    return (
      <span
        key={key}
        className="my-1.5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-subtle border border-border text-xs text-secondary align-middle"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
        <span className="font-medium text-primary">Carregando gráfico...</span>
        {shortTitle && shortTitle !== 'Gráfico ilustrativo' && (
          <span className="text-muted truncate max-w-[180px]">({shortTitle})</span>
        )}
      </span>
    );
  }

  return (
    <button
      key={key}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        ctx?.onOpenGraphModal?.({
          title: graphEntry.title || shortTitle,
          description: graphEntry.description || cleanDescription,
          svg: graphEntry.svg,
        });
      }}
      className="my-1.5 inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-border text-left transition-colors cursor-pointer group max-w-full align-middle shadow-2xs"
    >
      <span className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0 group-hover:scale-105 transition-transform">
        <ImageIcon className="w-3.5 h-3.5" />
      </span>
      <span className="min-w-0 flex flex-col">
        <span className="text-xs font-bold text-primary group-hover:text-accent transition-colors leading-tight">
          Abrir imagem gráfica
        </span>
        <span className="text-[11px] text-muted truncate max-w-[230px] sm:max-w-[300px]">
          {graphEntry.title || shortTitle}
        </span>
      </span>
    </button>
  );
}

/**
 * Renderizador de Markdown limpo e determinístico para respostas da IA no Silenon.
 * 100% aderente aos tokens semânticos (sem cores literais do Tailwind, sem dark:).
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  graphsByKey,
}) => {
  const [, setKatexTick] = useState(0);
  const [activeGraphModal, setActiveGraphModal] = useState<ActiveGraphModalData | null>(null);

  const hasMath = Boolean(content && content.includes('$'));

  useEffect(() => {
    if (!hasMath || katexModuleCache) return;
    let mounted = true;
    ensureKatexLoaded().then((mod) => {
      if (mounted && mod) {
        setKatexTick((t) => t + 1);
      }
    });
    return () => {
      mounted = false;
    };
  }, [hasMath]);

  useEffect(() => {
    if (!activeGraphModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveGraphModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeGraphModal]);

  if (!content) return null;

  const { cleanedMarkdown, glossary } = extractGlossaryFromMarkdown(content);
  const blocks = cleanedMarkdown ? parseMarkdownBlocks(cleanedMarkdown) : [];

  const inlineCtx: InlineRenderContext = {
    graphsByKey,
    onOpenGraphModal: (graph) => setActiveGraphModal(graph),
  };

  return (
    <>
      <div className={`space-y-2.5 text-xs sm:text-sm leading-relaxed select-text ${className}`}>
        {blocks.map((block, idx) => (
          <React.Fragment key={idx}>
            {renderBlock(block, idx, glossary, inlineCtx)}
          </React.Fragment>
        ))}
      </div>

      {activeGraphModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-strive-graph-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-canvas/85 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => setActiveGraphModal(null)}
            role="dialog"
            aria-modal="true"
            aria-label={activeGraphModal.title}
          >
            <div
              className="theme-modal relative w-full max-w-4xl max-h-[90vh] max-h-[90dvh] rounded-2xl border border-border bg-surface shadow-2xl p-4 sm:p-6 flex flex-col items-center overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between gap-3 mb-2">
                <span className="text-xs sm:text-sm font-bold text-primary truncate">
                  {activeGraphModal.title}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveGraphModal(null)}
                  className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                  aria-label="Fechar visualização do gráfico"
                  title="Fechar (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                className="w-full flex items-center justify-center rounded-xl p-3 sm:p-5 bg-surface-subtle border border-border text-primary overflow-hidden"
                dangerouslySetInnerHTML={{ __html: activeGraphModal.svg }}
              />

              {activeGraphModal.description && (
                <div className="w-full mt-3 text-center">
                  <p className="text-xs text-secondary leading-relaxed">
                    {activeGraphModal.description}
                  </p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

type BlockType =
  | { type: 'heading'; level: number; text: string }
  | { type: 'codeblock'; language: string; code: string }
  | { type: 'mathblock'; formula: string }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(markdown: string): BlockType[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockType[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Linha vazia
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Code Block: ```lang
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consome o ``` final
      if (/^(?:glossario|glossary)$/i.test(language)) {
        continue;
      }
      blocks.push({
        type: 'codeblock',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // 2.5. Math Block: $$ ... $$ (linha única ou múltiplas linhas)
    if (trimmed.startsWith('$$')) {
      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        blocks.push({
          type: 'mathblock',
          formula: trimmed.slice(2, -2).trim(),
        });
        i++;
        continue;
      }
      const mathLines: string[] = [];
      const firstLineRemainder = trimmed.slice(2).trim();
      if (firstLineRemainder) {
        mathLines.push(firstLineRemainder);
      }
      i++;
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        if (curTrim.endsWith('$$')) {
          const beforeClose = curTrim.slice(0, -2).trim();
          if (beforeClose) mathLines.push(beforeClose);
          i++;
          break;
        }
        mathLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'mathblock',
        formula: mathLines.join('\n').trim(),
      });
      continue;
    }

    // 3. Títulos: #, ##, ###, ####
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Blockquote: > text
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join(' '),
      });
      continue;
    }

    // 5. Tabelas em formato Markdown (| Col 1 | Col 2 |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && lines[i + 1]?.trim().startsWith('|')) {
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      i++; // pula para a linha separadora
      if (i < lines.length && isTableSeparator(lines[i].trim())) {
        i++; // consome o separador
      }
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      blocks.push({
        type: 'table',
        headers,
        rows,
      });
      continue;
    }

    // 6. Listas numeradas (1. , 2. )
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].trim().match(/^(\d+)\.\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[2].trim());
        i++;
      }
      blocks.push({
        type: 'ol',
        items,
      });
      continue;
    }

    // 7. Listas não-ordenadas (* , - )
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].trim().match(/^[-*]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        i++;
      }
      blocks.push({
        type: 'ul',
        items,
      });
      continue;
    }

    // 8. Parágrafos comuns (junta linhas contíguas)
    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().match(/^[-*]\s+/) &&
      !lines[i].trim().match(/^\d+\.\s+/) &&
      !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))
    ) {
      pLines.push(lines[i].trim());
      i++;
    }
    if (pLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: pLines.join(' '),
      });
    }
  }

  return blocks;
}

function splitTableRow(rowStr: string): string[] {
  return rowStr
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line);
}

function renderBlock(
  block: BlockType,
  key: number,
  glossary: GlossaryEntry[] = [],
  inlineCtx?: InlineRenderContext
) {
  switch (block.type) {
    case 'heading': {
      if (block.level === 1) {
        return (
          <h1 key={key} className="text-base sm:text-lg font-bold text-primary mt-3 mb-1.5 border-b border-border pb-1">
            {renderInlineMarkdown(block.text, glossary, inlineCtx)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 key={key} className="text-sm sm:text-base font-bold text-primary mt-2.5 mb-1">
            {renderInlineMarkdown(block.text, glossary, inlineCtx)}
          </h2>
        );
      }
      return (
        <h3 key={key} className="text-xs sm:text-sm font-semibold text-primary mt-2 mb-0.5">
          {renderInlineMarkdown(block.text, glossary, inlineCtx)}
        </h3>
      );
    }

    case 'codeblock':
      return (
        <div key={key} className="my-2 rounded-xl bg-surface-subtle border border-border overflow-hidden">
          {block.language && (
            <div className="px-3 py-1 bg-surface border-b border-border text-[10px] font-mono text-muted uppercase tracking-wider">
              {block.language}
            </div>
          )}
          <pre className="p-3 overflow-x-auto text-[11px] sm:text-xs font-mono text-primary leading-normal">
            <code>{block.code}</code>
          </pre>
        </div>
      );

    case 'mathblock': {
      const html = renderLatexToHtml(block.formula, true);
      if (html) {
        return (
          <div
            key={key}
            className="my-2 py-1.5 px-2 overflow-x-auto text-center text-primary [&_.katex]:text-current"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      return (
        <div
          key={key}
          className="my-2 py-1.5 px-3 rounded-lg bg-surface-subtle border border-border text-center font-mono text-xs text-primary overflow-x-auto"
        >
          {block.formula}
        </div>
      );
    }

    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-accent pl-3 py-1 my-2 bg-surface-subtle rounded-r-lg text-secondary italic"
        >
          {renderInlineMarkdown(block.text, glossary, inlineCtx)}
        </blockquote>
      );

    case 'table':
      return (
        <div key={key} className="overflow-x-auto my-2.5 rounded-xl border border-border">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-surface-subtle border-b border-border text-primary font-semibold">
              <tr>
                {block.headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 border-r border-border last:border-r-0">
                    {renderInlineMarkdown(h, glossary, inlineCtx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-surface-hover transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 border-r border-border last:border-r-0 text-secondary">
                      {renderInlineMarkdown(cell, glossary, inlineCtx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'ul':
      return (
        <ul key={key} className="list-disc pl-5 space-y-1 my-1 text-primary">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInlineMarkdown(item, glossary, inlineCtx)}</li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1 my-1 text-primary">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInlineMarkdown(item, glossary, inlineCtx)}</li>
          ))}
        </ol>
      );

    case 'paragraph':
      return (
        <p key={key} className="text-primary leading-relaxed">
          {renderInlineMarkdown(block.text, glossary, inlineCtx)}
        </p>
      );
  }
}

/**
 * Destaca automaticamente os termos do glossário em um trecho de texto puro,
 * ordenando do termo mais longo para o mais curto, case-insensitive e respeitando
 * limites de palavra (\b / fronteiras alfanuméricas Unicode) para não cortar palavras pela metade.
 */
function highlightGlossaryTermsInSegment(
  segment: string,
  sortedGlossary: GlossaryEntry[],
  keyPrefix: string
): React.ReactNode[] {
  if (!segment || sortedGlossary.length === 0) return [segment];

  const entriesByLower = new Map<string, GlossaryEntry>();
  const patterns: string[] = [];

  for (const item of sortedGlossary) {
    const cleanTerm = item.term.trim();
    if (!cleanTerm) continue;
    entriesByLower.set(cleanTerm.toLowerCase(), item);

    const escaped = escapeRegExp(cleanTerm);
    const startsWithWord = /^[\p{L}\p{N}_]/u.test(cleanTerm);
    const endsWithWord = /[\p{L}\p{N}_]$/u.test(cleanTerm);
    const leftBoundary = startsWithWord ? '(?<![\\p{L}\\p{N}_])' : '';
    const rightBoundary = endsWithWord ? '(?![\\p{L}\\p{N}_])' : '';
    patterns.push(`${leftBoundary}${escaped}${rightBoundary}`);
  }

  if (patterns.length === 0) return [segment];

  let regex: RegExp;
  try {
    regex = new RegExp(`(${patterns.join('|')})`, 'giu');
  } catch {
    return [segment];
  }

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchIdx = 0;

  while ((match = regex.exec(segment)) !== null) {
    if (match.index > lastIndex) {
      result.push(segment.slice(lastIndex, match.index));
    }
    const matchedText = match[0];
    const entry = entriesByLower.get(matchedText.toLowerCase());
    result.push(
      <GlossaryTermSpan
        key={`${keyPrefix}_mark_${matchIdx++}`}
        matchedText={matchedText}
        term={entry?.term || matchedText}
        definition={entry?.definition || ''}
      />
    );
    lastIndex = match.index + matchedText.length;
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }

  if (lastIndex < segment.length) {
    result.push(segment.slice(lastIndex));
  }

  return result.length > 0 ? result : [segment];
}

/**
 * Processa formatações inline:
 * - Marcadores de gráfico [[GRAFICO: "Título" | "Descrição"]] (e marcador parcial em streaming)
 * - LaTeX em bloco $$...$$ ou inline $...$ (preservado sem grifo de glossário)
 * - Código inline: `codigo` (preservado sem grifo de glossário)
 * - Negrito: **texto** ou __texto__
 * - Itálico: *texto* ou _texto_
 * - Links: [texto](url)
 * - Grifo automático de termos do glossário extraído
 */
export function renderInlineMarkdown(
  text: string,
  glossary: GlossaryEntry[] = [],
  inlineCtx?: InlineRenderContext
): React.ReactNode[] {
  if (!text) return [];

  const sortedGlossary =
    glossary.length > 0
      ? [...glossary].sort((a, b) => b.term.length - a.term.length)
      : [];

  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyCounter = 0;

  // Regex unificada priorizando [[GRAFICO: ...]], $$...$$, $...$ e `code` antes de negrito/itálico
  const inlineRegex =
    /(\[\[\s*GR[AÁ]FICO\s*:\s*"?[^"|\]\n]+?"?\s*\|\s*"?[\s\S]*?"?\s*\]\]|\[\[\s*GR[AÁ]FICO\s*:[\s\S]*$|\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/i;

  while (remaining.length > 0) {
    const match = remaining.match(inlineRegex);
    if (!match || match.index === undefined) {
      nodes.push(
        ...highlightGlossaryTermsInSegment(remaining, sortedGlossary, `tail_${keyCounter++}`)
      );
      break;
    }

    if (match.index > 0) {
      nodes.push(
        ...highlightGlossaryTermsInSegment(
          remaining.slice(0, match.index),
          sortedGlossary,
          `pre_${keyCounter++}`
        )
      );
    }

    const token = match[0];
    const key = `inline_${keyCounter++}`;

    // 1. Marcador completo [[GRAFICO: "Título" | "Descrição"]]
    const fullGraphMatch = token.match(
      /^\[\[\s*GR[AÁ]FICO\s*:\s*"?([^"|\]\n]+?)"?\s*\|\s*"?([\s\S]*?)"?\s*\]\]$/i
    );
    if (fullGraphMatch) {
      nodes.push(
        renderGraphWidget(fullGraphMatch[1], fullGraphMatch[2], key, inlineCtx, false)
      );
    }
    // 1b. Marcador parcial [[GRAFICO:... ainda aberto no fim durante streaming
    else if (/^\[\[\s*GR[AÁ]FICO\s*:/i.test(token)) {
      const partialTitleMatch = token.match(/^\[\[\s*GR[AÁ]FICO\s*:\s*"?([^"|\]\n]{1,50})/i);
      nodes.push(
        renderGraphWidget(partialTitleMatch?.[1] || '', '', key, inlineCtx, true)
      );
    }
    // 2. LaTeX Display $$...$$
    else if (token.startsWith('$$') && token.endsWith('$$') && token.length > 4) {
      const formula = token.slice(2, -2).trim();
      const html = renderLatexToHtml(formula, true);
      if (html) {
        nodes.push(
          <span
            key={key}
            className="block my-2 py-1 overflow-x-auto text-center text-primary [&_.katex]:text-current"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } else {
        nodes.push(
          <code
            key={key}
            className="block my-1.5 px-2.5 py-1 rounded bg-surface-subtle border border-border text-center font-mono text-xs text-primary"
          >
            {formula}
          </code>
        );
      }
    }
    // 3. LaTeX Inline $...$
    else if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
      const formula = token.slice(1, -1).trim();
      const html = renderLatexToHtml(formula, false);
      if (html) {
        nodes.push(
          <span
            key={key}
            className="inline-block align-middle mx-0.5 text-primary [&_.katex]:text-current"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } else {
        nodes.push(
          <code
            key={key}
            className="px-1 py-0.5 rounded bg-surface-subtle border border-border text-[11px] font-mono text-primary"
          >
            {formula}
          </code>
        );
      }
    }
    // 4. Código inline `code` (nunca aplica grifo de glossário dentro de `code`)
    else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-surface border border-border text-[11px] font-mono text-accent"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    // 5. Negrito **bold** ou __bold__
    else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      const innerText = token.slice(2, -2);
      nodes.push(
        <strong key={key} className="font-bold text-primary">
          {renderInlineMarkdown(innerText, sortedGlossary, inlineCtx)}
        </strong>
      );
    }
    // 6. Itálico *italic* ou _italic_
    else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      const innerText = token.slice(1, -1);
      nodes.push(
        <em key={key} className="italic text-secondary">
          {renderInlineMarkdown(innerText, sortedGlossary, inlineCtx)}
        </em>
      );
    }
    // 7. Link [texto](url)
    else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline hover:opacity-80 transition-opacity"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(
          ...highlightGlossaryTermsInSegment(token, sortedGlossary, `${key}_raw`)
        );
      }
    } else {
      nodes.push(
        ...highlightGlossaryTermsInSegment(token, sortedGlossary, `${key}_fallback`)
      );
    }

    remaining = remaining.slice(match.index + token.length);
  }

  return nodes;
}


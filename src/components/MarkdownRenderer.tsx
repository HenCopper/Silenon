import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
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

/**
 * Renderizador de Markdown limpo e determinístico para respostas da IA no Memoriz.
 * 100% aderente aos tokens semânticos (sem cores literais do Tailwind, sem dark:).
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  if (!content) return null;

  const { cleanedMarkdown, glossary } = extractGlossaryFromMarkdown(content);
  const blocks = cleanedMarkdown ? parseMarkdownBlocks(cleanedMarkdown) : [];

  return (
    <div className={`space-y-2.5 text-xs sm:text-sm leading-relaxed select-text ${className}`}>
      {blocks.map((block, idx) => (
        <React.Fragment key={idx}>{renderBlock(block, idx, glossary)}</React.Fragment>
      ))}
    </div>
  );
};

type BlockType =
  | { type: 'heading'; level: number; text: string }
  | { type: 'codeblock'; language: string; code: string }
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

function renderBlock(block: BlockType, key: number, glossary: GlossaryEntry[] = []) {
  switch (block.type) {
    case 'heading': {
      if (block.level === 1) {
        return (
          <h1 key={key} className="text-base sm:text-lg font-bold text-primary mt-3 mb-1.5 border-b border-border pb-1">
            {renderInlineMarkdown(block.text, glossary)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 key={key} className="text-sm sm:text-base font-bold text-primary mt-2.5 mb-1">
            {renderInlineMarkdown(block.text, glossary)}
          </h2>
        );
      }
      return (
        <h3 key={key} className="text-xs sm:text-sm font-semibold text-primary mt-2 mb-0.5">
          {renderInlineMarkdown(block.text, glossary)}
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

    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-accent pl-3 py-1 my-2 bg-surface-subtle rounded-r-lg text-secondary italic"
        >
          {renderInlineMarkdown(block.text, glossary)}
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
                    {renderInlineMarkdown(h, glossary)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-surface-hover transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 border-r border-border last:border-r-0 text-secondary">
                      {renderInlineMarkdown(cell, glossary)}
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
            <li key={itemIdx}>{renderInlineMarkdown(item, glossary)}</li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1 my-1 text-primary">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInlineMarkdown(item, glossary)}</li>
          ))}
        </ol>
      );

    case 'paragraph':
      return (
        <p key={key} className="text-primary leading-relaxed">
          {renderInlineMarkdown(block.text, glossary)}
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
 * - Código inline: `codigo` (preservado sem grifo de glossário)
 * - Negrito: **texto** ou __texto__
 * - Itálico: *texto* ou _texto_
 * - Links: [texto](url)
 * - Grifo automático de termos do glossário extraído
 */
export function renderInlineMarkdown(
  text: string,
  glossary: GlossaryEntry[] = []
): React.ReactNode[] {
  if (!text) return [];

  const sortedGlossary =
    glossary.length > 0
      ? [...glossary].sort((a, b) => b.term.length - a.term.length)
      : [];

  // Tokeniza sequencialmente por partes especiais
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyCounter = 0;

  // Regex para achar próxima marcação inline especial
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/;

  while (remaining.length > 0) {
    const match = remaining.match(inlineRegex);
    if (!match || match.index === undefined) {
      nodes.push(
        ...highlightGlossaryTermsInSegment(remaining, sortedGlossary, `tail_${keyCounter++}`)
      );
      break;
    }

    // Texto antes da marcação
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

    // 1. Código inline `code` (nunca aplica grifo de glossário dentro de `code`)
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-surface border border-border text-[11px] font-mono text-accent"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    // 2. Negrito **bold** ou __bold__
    else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      const innerText = token.slice(2, -2);
      nodes.push(
        <strong key={key} className="font-bold text-primary">
          {highlightGlossaryTermsInSegment(innerText, sortedGlossary, `${key}_b`)}
        </strong>
      );
    }
    // 3. Itálico *italic* ou _italic_
    else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      const innerText = token.slice(1, -1);
      nodes.push(
        <em key={key} className="italic text-secondary">
          {highlightGlossaryTermsInSegment(innerText, sortedGlossary, `${key}_i`)}
        </em>
      );
    }
    // 4. Link [texto](url)
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

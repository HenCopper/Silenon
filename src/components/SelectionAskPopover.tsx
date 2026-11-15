import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';

interface SelectionAskPopoverProps {
  onAskStrive: (selectedText: string) => void;
}

interface SelectionCoords {
  top: number;
  left: number;
  placeBelow: boolean;
  text: string;
}

export const SelectionAskPopover: React.FC<SelectionAskPopoverProps> = ({ onAskStrive }) => {
  const [selectionState, setSelectionState] = useState<SelectionCoords | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const evaluateSelection = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelectionState(null);
      return;
    }

    const rawText = sel.toString().replace(/\s+/g, ' ').trim();
    if (rawText.length < 4 || rawText.length > 1400) {
      setSelectionState(null);
      return;
    }

    const anchorNode = sel.anchorNode;
    const focusNode = sel.focusNode;
    const anchorEl =
      anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement || null;
    const focusEl =
      focusNode instanceof HTMLElement ? focusNode : focusNode?.parentElement || null;

    if (!anchorEl || !focusEl) {
      setSelectionState(null);
      return;
    }

    // Ignore selections inside inputs, textareas, buttons, or the popover itself
    if (
      anchorEl.closest('input, textarea, button, [contenteditable="true"], [data-selection-ask-popover="true"]') ||
      focusEl.closest('input, textarea, button, [contenteditable="true"], [data-selection-ask-popover="true"]')
    ) {
      setSelectionState(null);
      return;
    }

    // Must be inside question content ([data-question-selectable="true"]) or inside a Strive response bubble ([data-chat-msg-item="true"])
    const isInsideStudyOrStrive = Boolean(
      anchorEl.closest('[data-question-selectable="true"], [data-chat-msg-item="true"]') &&
        focusEl.closest('[data-question-selectable="true"], [data-chat-msg-item="true"]')
    );
    if (!isInsideStudyOrStrive) {
      setSelectionState(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelectionState(null);
      return;
    }

    const viewportW = window.innerWidth || 360;
    const halfBtnW = 92;
    const centerX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(12 + halfBtnW, Math.min(viewportW - 12 - halfBtnW, centerX));
    const placeBelow = rect.top < 56;
    const top = placeBelow ? rect.bottom + 8 : rect.top - 8;

    setSelectionState({
      top,
      left: clampedLeft,
      placeBelow,
      text: rawText,
    });
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const scheduleCheck = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        evaluateSelection();
      });
    };

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (target && buttonRef.current?.contains(target)) {
        return;
      }
      setSelectionState(null);
    };

    document.addEventListener('selectionchange', scheduleCheck);
    document.addEventListener('mouseup', scheduleCheck);
    document.addEventListener('touchend', scheduleCheck, { passive: true });
    document.addEventListener('keyup', scheduleCheck);
    window.addEventListener('scroll', scheduleCheck, true);
    window.addEventListener('resize', scheduleCheck);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      document.removeEventListener('selectionchange', scheduleCheck);
      document.removeEventListener('mouseup', scheduleCheck);
      document.removeEventListener('touchend', scheduleCheck);
      document.removeEventListener('keyup', scheduleCheck);
      window.removeEventListener('scroll', scheduleCheck, true);
      window.removeEventListener('resize', scheduleCheck);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [evaluateSelection]);

  if (!selectionState || typeof document === 'undefined') return null;

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      data-selection-ask-popover="true"
      onMouseDown={(e) => {
        // Prevent clearing the selection before onClick fires
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const textToQuote = selectionState.text;
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          // Ignore
        }
        setSelectionState(null);
        onAskStrive(textToQuote);
      }}
      style={{
        top: `${selectionState.top}px`,
        left: `${selectionState.left}px`,
        transform: selectionState.placeBelow
          ? 'translate(-50%, 0)'
          : 'translate(-50%, -100%)',
      }}
      className="fixed z-70 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-hover text-primary border border-border shadow-xl text-xs font-semibold transition-colors cursor-pointer animate-in fade-in zoom-in-95 duration-150"
    >
      <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
      <span>Perguntar ao Strive</span>
    </button>,
    document.body
  );
};

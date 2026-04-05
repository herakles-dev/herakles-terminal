/**
 * FloatingInput — Visible mobile command bar positioned above the virtual keyboard.
 *
 * Replaces the hidden MobileInputHandler + QuickKeyBar sidebar workflow with a
 * single always-visible bar that shows:
 * - A text input where the user can see what they're typing
 * - Inline quick keys for the most common terminal operations
 * - A send button (Enter)
 *
 * Input modes:
 * - Character mode (default): each keystroke goes to terminal immediately
 *   for interactive programs (vim, less, node REPL)
 * - The input field is visible so the user always sees what they're typing
 *
 * Positioning: uses visualViewport to sit directly above the virtual keyboard.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface FloatingInputHandle {
  focus: () => void;
  blur: () => void;
}

interface FloatingInputProps {
  onInput: (data: string) => void;
  enabled: boolean;
  windowId: string;
  /** 'terminal' = regular Linux shell, 'agent' = Claude Code, 'media' = player */
  windowType: 'terminal' | 'media' | 'agent';
}

// Inline quick keys — all essential terminal operations in a scrollable row
const INLINE_KEYS = [
  { id: 'ctrl-c', label: '^C', value: '\x03', title: 'Interrupt', accent: true },
  { id: 'ctrl-d', label: '^D', value: '\x04', title: 'EOF' },
  { id: 'ctrl-z', label: '^Z', value: '\x1a', title: 'Suspend' },
  { id: 'tab', label: 'Tab', value: '\t', title: 'Tab complete' },
  { id: 'esc', label: 'Esc', value: '\x1b', title: 'Escape' },
  { id: 'up', label: '\u2191', value: '\x1b[A', title: 'History up' },
  { id: 'down', label: '\u2193', value: '\x1b[B', title: 'History down' },
  { id: 'left', label: '\u2190', value: '\x1b[D', title: 'Cursor left' },
  { id: 'right', label: '\u2192', value: '\x1b[C', title: 'Cursor right' },
  { id: 'shift-tab', label: '\u21E7Tab', value: '\x1b[Z', title: 'Shift+Tab' },
  { id: 'slash', label: '/', value: '/', title: 'Slash' },
  { id: 'tilde', label: '~', value: '~', title: 'Home dir' },
  { id: 'find', label: 'Find', value: '__FIND__', title: 'Search' },
  { id: 'claude', label: 'Claude', value: 'claude --dangerously-skip-permissions\r', title: 'Launch Claude' },
] as const;

function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // RAF-batch: coalesce rapid visualViewport events during keyboard animation
      // (iOS fires 5-10 resize+scroll events over ~300ms keyboard transition)
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const keyboardHeight = window.innerHeight - vv.height;
        const scrollOffset = vv.offsetTop;
        setOffset(Math.max(0, keyboardHeight - scrollOffset));
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return offset;
}

// Keys that should NOT be sent as ANSI escapes to Claude/agent windows.
// Claude Code has its own UI navigation for these — sending raw escapes interferes.
// For regular terminals, these ARE sent (history navigation, cursor movement).
const CLAUDE_RESERVED_KEY_IDS = new Set(['up', 'down', 'left', 'right']);

// Quick keys that insert into the floating input field (typeable characters you compose
// into commands) rather than sending directly to the terminal.
const INSERT_INTO_INPUT_KEY_IDS = new Set(['slash', 'tilde']);

export const FloatingInput = forwardRef<FloatingInputHandle, FloatingInputProps>(
  ({ onInput, enabled, windowId, windowType }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);
    const prevWindowIdRef = useRef(windowId);
    const keyboardOffset = useKeyboardOffset();
    const isTerminal = windowType === 'terminal';

    // Clear state on window switch
    useEffect(() => {
      if (prevWindowIdRef.current !== windowId) {
        if (inputRef.current) inputRef.current.value = '';
        prevWindowIdRef.current = windowId;
      }
    }, [windowId]);

    // Auto-focus when enabled or window switches
    useEffect(() => {
      if (enabled) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [enabled, windowId]);

    // Prevent iOS pull-to-refresh (only outside terminal viewport)
    useEffect(() => {
      if (!enabled) return;
      let startY = 0;
      const handleTouchStart = (e: TouchEvent) => {
        startY = e.touches[0]?.clientY ?? 0;
      };
      const handleTouchMove = (e: TouchEvent) => {
        if ((e.target as HTMLElement)?.closest?.('.dom-term-viewport')) return;
        const currentY = e.touches[0]?.clientY ?? 0;
        if (document.documentElement.scrollTop <= 0 && currentY > startY) {
          e.preventDefault();
        }
      };
      document.addEventListener('touchstart', handleTouchStart, { passive: true });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      return () => {
        document.removeEventListener('touchstart', handleTouchStart);
        document.removeEventListener('touchmove', handleTouchMove);
      };
    }, [enabled]);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }));

    // --- Input handling ---
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (inputRef.current) {
            const val = inputRef.current.value;
            if (val) onInput(val);
            onInput('\r');
            inputRef.current.value = '';
          }
          break;
        case 'Backspace':
          if (inputRef.current && inputRef.current.value.length === 0) {
            e.preventDefault();
            onInput('\x7f');
          }
          break;
        case 'ArrowUp':
          if (isTerminal) {
            e.preventDefault();
            onInput('\x1b[A');
            if (inputRef.current) inputRef.current.value = '';
          }
          // Claude/agent: let browser handle (cursor nav in input field)
          break;
        case 'ArrowDown':
          if (isTerminal) {
            e.preventDefault();
            onInput('\x1b[B');
            if (inputRef.current) inputRef.current.value = '';
          }
          break;
        case 'ArrowLeft':
          if (isTerminal) {
            e.preventDefault();
            onInput('\x1b[D');
          }
          break;
        case 'ArrowRight':
          if (isTerminal) {
            e.preventDefault();
            onInput('\x1b[C');
          }
          break;
        case 'Tab':
          e.preventDefault();
          if (inputRef.current) {
            const val = inputRef.current.value;
            if (val) onInput(val);
            onInput('\t');
            inputRef.current.value = '';
          }
          break;
        case 'Escape':
          e.preventDefault();
          onInput('\x1b');
          break;
      }

      // Ctrl+key combinations
      if (e.ctrlKey && e.key.length === 1) {
        e.preventDefault();
        const code = e.key.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          onInput(String.fromCharCode(code - 64));
        }
      }
    }, [onInput, isTerminal]);

    // Accumulate in the floating input — sent on Enter, Tab, etc.
    const handleInput = useCallback(() => {
      if (composingRef.current) return;
    }, []);

    const handleCompositionStart = useCallback(() => {
      composingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
      composingRef.current = false;
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      if (text) {
        onInput(text);
        if (inputRef.current) inputRef.current.value = '';
      }
    }, [onInput]);

    // Placeholder text changes based on window type
    const placeholder = isTerminal ? 'terminal...' : 'message...';

    // --- Quick key handler ---
    const handleQuickKey = useCallback((keyId: string, value: string) => {
      if (value === '__FIND__') {
        const termContainer = document.querySelector('[data-renderer="dom"]');
        if (termContainer) {
          termContainer.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
          }));
        }
        return;
      }
      // For Claude/agent windows, skip reserved keys (arrows) — Claude handles its own nav
      if (!isTerminal && CLAUDE_RESERVED_KEY_IDS.has(keyId)) {
        return;
      }
      // Typeable characters (/, ~) insert into the floating input for command composition
      if (INSERT_INTO_INPUT_KEY_IDS.has(keyId) && inputRef.current) {
        const el = inputRef.current;
        const pos = el.selectionStart ?? el.value.length;
        el.value = el.value.slice(0, pos) + value + el.value.slice(pos);
        el.selectionStart = el.selectionEnd = pos + value.length;
        navigator.vibrate?.(10);
        requestAnimationFrame(() => el.focus());
        return;
      }
      // Send any pending input first, then the quick key
      if (inputRef.current?.value) {
        onInput(inputRef.current.value);
        inputRef.current.value = '';
      }
      onInput(value);
      navigator.vibrate?.(10);
      requestAnimationFrame(() => inputRef.current?.focus());
    }, [onInput, isTerminal]);

    if (!enabled) return null;

    return (
      <div
        className="floating-input-bar"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: keyboardOffset,
          zIndex: 150,
          padding: '4px 8px env(safe-area-inset-bottom, 0px) 8px',
          background: 'linear-gradient(180deg, rgba(10, 10, 20, 0.92) 0%, rgba(15, 15, 30, 0.97) 100%)',
          backdropFilter: 'blur(16px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.4)',
          touchAction: 'pan-x',
        }}
      >
        {/* Quick keys row — horizontally scrollable via touch drag */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            paddingBottom: 4,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x',
            msOverflowStyle: 'none',
          }}
        >
          {INLINE_KEYS.map(key => {
            // For Claude/agent windows, dim arrow keys to signal they're inactive
            const isReserved = !isTerminal && CLAUDE_RESERVED_KEY_IDS.has(key.id);
            return (
              <button
                key={key.id}
                onClick={() => handleQuickKey(key.id, key.value)}
                title={isReserved ? `${key.title} (Claude UI)` : key.title}
                style={{
                  flexShrink: 0,
                  padding: '4px 10px',
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontWeight: 500,
                  color: isReserved
                    ? '#52525b'
                    : 'accent' in key && key.accent ? '#f87171' : key.id === 'claude' ? '#00d4ff' : '#a1a1aa',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 6,
                  cursor: isReserved ? 'default' : 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation',
                  lineHeight: '1.2',
                  opacity: isReserved ? 0.4 : 1,
                }}
              >
                {key.label}
              </button>
            );
          })}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 10,
                color: '#00d4ff',
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                pointerEvents: 'none',
                opacity: 0.6,
              }}
            >
              $
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder={placeholder}
              data-window-id={windowId}
              aria-label="Terminal command input"
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onPaste={handlePaste}
              style={{
                width: '100%',
                padding: '8px 10px 8px 24px',
                fontSize: 15,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: '#e4e4e7',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                outline: 'none',
                caretColor: '#00d4ff',
                WebkitAppearance: 'none',
                touchAction: 'manipulation',
              }}
              onFocus={(e) => {
                (e.target as HTMLInputElement).style.borderColor = 'rgba(0, 212, 255, 0.3)';
                (e.target as HTMLInputElement).style.boxShadow = '0 0 0 2px rgba(0, 212, 255, 0.08)';
              }}
              onBlur={(e) => {
                (e.target as HTMLInputElement).style.borderColor = 'rgba(255, 255, 255, 0.08)';
                (e.target as HTMLInputElement).style.boxShadow = 'none';
              }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => {
              if (inputRef.current) {
                const val = inputRef.current.value;
                if (val) onInput(val);
                onInput('\r');
                inputRef.current.value = '';
                requestAnimationFrame(() => inputRef.current?.focus());
              }
            }}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(139, 92, 246, 0.1))',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              borderRadius: 8,
              color: '#00d4ff',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
            }}
            title="Send (Enter)"
            aria-label="Send command"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    );
  }
);

FloatingInput.displayName = 'FloatingInput';

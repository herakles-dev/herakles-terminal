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

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      const scrollOffset = vv.offsetTop;
      setOffset(Math.max(0, keyboardHeight - scrollOffset));
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return offset;
}

export const FloatingInput = forwardRef<FloatingInputHandle, FloatingInputProps>(
  ({ onInput, enabled, windowId }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);
    const prevWindowIdRef = useRef(windowId);
    const keyboardOffset = useKeyboardOffset();

    // Clear state on window switch
    useEffect(() => {
      if (prevWindowIdRef.current !== windowId) {
        if (inputRef.current) inputRef.current.value = '';
        prevWindowIdRef.current = windowId;
      }
    }, [windowId]);

    // Auto-focus when enabled
    useEffect(() => {
      if (enabled) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [enabled]);

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
          // Send current content + carriage return
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
          // If input has content, let browser handle deletion
          // The onChange handler will pick up the diff
          break;
        case 'ArrowUp':
          e.preventDefault();
          onInput('\x1b[A');
          if (inputRef.current) inputRef.current.value = '';
          break;
        case 'ArrowDown':
          e.preventDefault();
          onInput('\x1b[B');
          if (inputRef.current) inputRef.current.value = '';
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
    }, [onInput]);

    // Character-by-character for interactive programs: send each new char
    const handleInput = useCallback(() => {
      if (composingRef.current) return;
      // We let the input accumulate — it's sent on Enter, Tab, or ArrowUp/Down
      // This gives the user a visible command line experience
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

    // --- Quick key handler ---
    const handleQuickKey = useCallback((value: string) => {
      if (value === '__FIND__') {
        // Dispatch synthetic Ctrl+F to trigger search overlay
        const termContainer = document.querySelector('[data-renderer="dom"]');
        if (termContainer) {
          termContainer.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
          }));
        }
        return;
      }
      // Send any pending input first, then the quick key
      if (inputRef.current?.value) {
        onInput(inputRef.current.value);
        inputRef.current.value = '';
      }
      onInput(value);
      // Haptic feedback
      navigator.vibrate?.(10);
      // Re-focus input
      requestAnimationFrame(() => inputRef.current?.focus());
    }, [onInput]);

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
          {INLINE_KEYS.map(key => (
            <button
              key={key.id}
              onClick={() => handleQuickKey(key.value)}
              title={key.title}
              style={{
                flexShrink: 0,
                padding: '4px 10px',
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontWeight: 500,
                color: 'accent' in key && key.accent ? '#f87171' : key.id === 'claude' ? '#00d4ff' : '#a1a1aa',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 6,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                lineHeight: '1.2',
              }}
            >
              {key.label}
            </button>
          ))}
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
              placeholder="command..."
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

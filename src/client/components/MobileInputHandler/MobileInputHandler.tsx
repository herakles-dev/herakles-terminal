import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';

export interface MobileInputHandlerHandle {
  focus: () => void;
  blur: () => void;
}

interface MobileInputHandlerProps {
  onInput: (data: string) => void;
  enabled: boolean;
  windowId: string;
}

export const MobileInputHandler = forwardRef<MobileInputHandlerHandle, MobileInputHandlerProps>(
  ({ onInput, enabled, windowId }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const lastSentRef = useRef('');
    const processingRef = useRef(false);
    const prevWindowIdRef = useRef(windowId);
    
    useEffect(() => {
      if (prevWindowIdRef.current !== windowId) {
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        lastSentRef.current = '';
        processingRef.current = false;
        prevWindowIdRef.current = windowId;
      }
    }, [windowId]);

    // Auto-focus input when enabled becomes true (opens mobile keyboard)
    useEffect(() => {
      if (enabled) {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      }
    }, [enabled]);

    // Prevent iOS pull-to-refresh when swiping down from top
    useEffect(() => {
      if (!enabled) return;

      let startY = 0;
      const handleTouchStart = (e: TouchEvent) => {
        startY = e.touches[0]?.clientY ?? 0;
      };
      const handleTouchMove = (e: TouchEvent) => {
        const currentY = e.touches[0]?.clientY ?? 0;
        const isSwipingDown = currentY > startY;
        // Only block downward swipe when page is at scroll top (pull-to-refresh gesture)
        if (document.documentElement.scrollTop <= 0 && isSwipingDown) {
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

    const sendNewChars = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      
      const current = input.value;
      const lastSent = lastSentRef.current;
      
      if (current.length > lastSent.length) {
        const newChars = current.slice(lastSent.length);
        onInput(newChars);
        lastSentRef.current = current;
      }
      
      if (current.length > 50) {
        input.value = '';
        lastSentRef.current = '';
      }
    }, [onInput]);

    const handleInput = useCallback(() => {
      sendNewChars();
    }, [sendNewChars]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      const input = inputRef.current;
      
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          sendNewChars();
          onInput('\r');
          if (input) {
            input.value = '';
            lastSentRef.current = '';
          }
          break;
        case 'Backspace':
          if (input && input.value.length === 0) {
            e.preventDefault();
            onInput('\x7f');
          } else if (input) {
            lastSentRef.current = lastSentRef.current.slice(0, -1);
          }
          break;
        case 'Tab':
          e.preventDefault();
          onInput('\t');
          break;
        case 'Escape':
          e.preventDefault();
          onInput('\x1b');
          break;
        case 'ArrowUp':
          e.preventDefault();
          onInput('\x1b[A');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onInput('\x1b[B');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onInput('\x1b[C');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onInput('\x1b[D');
          break;
        case ' ':
          e.preventDefault();
          sendNewChars();
          onInput(' ');
          if (input) {
            input.value = '';
            lastSentRef.current = '';
          }
          break;
      }

      if (e.ctrlKey && e.key.length === 1) {
        e.preventDefault();
        const code = e.key.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          onInput(String.fromCharCode(code - 64));
        }
      }
    }, [onInput, sendNewChars]);

    const handleKeyUp = useCallback(() => {
      sendNewChars();
    }, [sendNewChars]);

    const handleBlur = useCallback(() => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        sendNewChars();
        if (inputRef.current) {
          inputRef.current.value = '';
          lastSentRef.current = '';
        }
      } finally {
        processingRef.current = false;
      }
    }, [sendNewChars]);

    if (!enabled) return null;

    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        data-window-id={windowId}
        aria-label="Terminal input"
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: '48px',
          opacity: 0,
          zIndex: 10,
          caretColor: 'transparent',
          fontSize: '16px',
          touchAction: 'manipulation',
          pointerEvents: 'auto',
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
      />
    );
  }
);

MobileInputHandler.displayName = 'MobileInputHandler';

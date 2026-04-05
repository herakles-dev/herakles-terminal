import { useCallback, useRef, useState, useEffect } from 'react';
import { QUICK_KEYS } from '@shared/constants';
import type { QuickKey } from '@shared/types';

interface QuickKeyBarProps {
  onKey: (value: string) => void;
  visible: boolean;
  onClose: () => void;
  onClear?: () => void;
  onRefocus?: () => void;
}

/** Ctrl+Arrow escape sequences (word movement in most terminals) */
const CTRL_ARROW: Record<string, string> = {
  '\x1b[A': '\x1b[1;5A', // Ctrl+Up
  '\x1b[B': '\x1b[1;5B', // Ctrl+Down
  '\x1b[C': '\x1b[1;5C', // Ctrl+Right (word right)
  '\x1b[D': '\x1b[1;5D', // Ctrl+Left (word left)
};

function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // RAF-batch: coalesce rapid visualViewport events during keyboard animation
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

export default function QuickKeyBar({ onKey, visible, onClose, onClear: _onClear, onRefocus }: QuickKeyBarProps) {
  const keyboardOffset = useKeyboardOffset();
  const [ctrlHeld, setCtrlHeld] = useState(false);

  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, []);

  const handleClick = useCallback((key: QuickKey) => {
    triggerHaptic();

    // Ctrl toggle — don't send a value, just flip state
    if (key.id === 'ctrl') {
      setCtrlHeld(prev => !prev);
      return;
    }

    // Find button — dispatch a synthetic Ctrl+F event on the DOM renderer container
    if (key.id === 'find') {
      const termContainer = document.querySelector('[data-renderer="dom"]');
      if (termContainer) {
        termContainer.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
        }));
      }
      onRefocus?.();
      return;
    }

    // Apply Ctrl modifier to arrow keys when held
    let value = key.value;
    if (ctrlHeld && CTRL_ARROW[value]) {
      value = CTRL_ARROW[value];
    }

    onKey(value);
    // Auto-reset Ctrl after sending any key (one-shot modifier)
    setCtrlHeld(false);
    onRefocus?.();
  }, [onKey, triggerHaptic, onRefocus, ctrlHeld]);

  const handleLongPress = useCallback((key: QuickKey) => {
    if (key.longPress) {
      triggerHaptic();
      onKey(key.longPress);
      onRefocus?.();
    }
  }, [onKey, triggerHaptic, onRefocus]);

  const preventFocus = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
  }, []);

  if (!visible) return null;

  // Group: modifier | nav keys | arrows | symbols | signal | claude
  const ctrlKey = QUICK_KEYS.find(k => k.id === 'ctrl')!;
  const navKeys = QUICK_KEYS.filter(k => k.category === 'navigation' && !['up', 'down', 'left', 'right'].includes(k.id));
  const arrowKeys = QUICK_KEYS.filter(k => ['up', 'down', 'left', 'right'].includes(k.id));
  const symbolKeys = QUICK_KEYS.filter(k => k.category === 'symbol');
  const signalKeys = QUICK_KEYS.filter(k => k.category === 'signal');
  const claudeKeys = QUICK_KEYS.filter(k => k.category === 'claude');

  return (
    <div
      className="quick-key-bar quick-key-bar-mobile safe-area-bottom"
      style={{ bottom: `${keyboardOffset}px` }}
      onTouchStart={preventFocus}
      onMouseDown={preventFocus}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="quick-key touch-feedback flex-shrink-0 !min-w-[36px] !px-2 text-[#71717a] hover:text-white"
        title="Close quick keys"
        tabIndex={-1}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="w-px h-7 bg-[#27272a] flex-shrink-0" />

      {/* Ctrl toggle */}
      <button
        className={`quick-key touch-feedback flex-shrink-0 ${ctrlHeld ? 'modifier--active' : 'modifier'}`}
        onClick={() => { triggerHaptic(); setCtrlHeld(prev => !prev); }}
        tabIndex={-1}
        title={ctrlHeld ? 'Ctrl ON (tap to release)' : 'Ctrl modifier (tap to hold)'}
      >
        {ctrlKey.label}
      </button>

      <div className="w-px h-7 bg-[#27272a]/50 flex-shrink-0" />

      {/* Nav keys: ESC, TAB, Shift+TAB, Enter */}
      {navKeys.map(key => (
        <KeyButton
          key={key.id}
          keyConfig={key}
          onClick={handleClick}
          onLongPress={handleLongPress}
          ctrlHeld={ctrlHeld}
        />
      ))}

      <div className="w-px h-7 bg-[#27272a]/50 flex-shrink-0" />

      {/* Arrow cluster */}
      {arrowKeys.map(key => (
        <KeyButton
          key={key.id}
          keyConfig={key}
          onClick={handleClick}
          onLongPress={handleLongPress}
          ctrlHeld={ctrlHeld}
        />
      ))}

      <div className="w-px h-7 bg-[#27272a]/50 flex-shrink-0" />

      {/* Symbols: / ~ */}
      {symbolKeys.map(key => (
        <KeyButton
          key={key.id}
          keyConfig={key}
          onClick={handleClick}
          onLongPress={handleLongPress}
          ctrlHeld={false}
        />
      ))}

      {signalKeys.length > 0 && (
        <>
          <div className="w-px h-7 bg-[#27272a]/50 flex-shrink-0" />
          {signalKeys.map(key => (
            <KeyButton
              key={key.id}
              keyConfig={key}
              onClick={handleClick}
              onLongPress={handleLongPress}
              ctrlHeld={false}
            />
          ))}
        </>
      )}

      {claudeKeys.length > 0 && (
        <>
          <div className="w-px h-7 bg-[#27272a]/50 flex-shrink-0" />
          {claudeKeys.map(key => (
            <KeyButton
              key={key.id}
              keyConfig={key}
              onClick={handleClick}
              onLongPress={handleLongPress}
              ctrlHeld={false}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface KeyButtonProps {
  keyConfig: QuickKey;
  onClick: (key: QuickKey) => void;
  onLongPress: (key: QuickKey) => void;
  ctrlHeld?: boolean;
}

function KeyButton({ keyConfig, onClick, onLongPress, ctrlHeld }: KeyButtonProps) {
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  const handleStart = useCallback(() => {
    isLongPressRef.current = false;
    if (keyConfig.longPress) {
      pressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        onLongPress(keyConfig);
      }, 500);
    }
  }, [keyConfig, onLongPress]);

  const handleEnd = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!isLongPressRef.current) {
      onClick(keyConfig);
    }
    isLongPressRef.current = false;
  }, [keyConfig, onClick]);

  const handleCancel = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    isLongPressRef.current = false;
  }, []);

  // Highlight arrow keys when Ctrl is held
  const isCtrlModified = ctrlHeld && CTRL_ARROW[keyConfig.value];
  const categoryClass = keyConfig.category;
  const modifiedClass = isCtrlModified ? 'ctrl-modified' : '';

  return (
    <button
      className={`quick-key touch-feedback ${categoryClass} ${modifiedClass} flex-shrink-0`}
      onPointerDown={handleStart}
      onPointerUp={handleEnd}
      onPointerLeave={handleCancel}
      onPointerCancel={handleCancel}
      tabIndex={-1}
      title={keyConfig.longPress ? `Long press: ${keyConfig.longPress}` : undefined}
    >
      {keyConfig.label}
    </button>
  );
}

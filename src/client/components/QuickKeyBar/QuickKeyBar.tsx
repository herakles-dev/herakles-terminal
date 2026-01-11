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

export default function QuickKeyBar({ onKey, visible, onClose, onClear, onRefocus }: QuickKeyBarProps) {
  const keyboardOffset = useKeyboardOffset();
  
  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, []);

  const handleClick = useCallback((key: QuickKey) => {
    triggerHaptic();
    onKey(key.value);
    onRefocus?.();
  }, [onKey, triggerHaptic, onRefocus]);

  const handleLongPress = useCallback((key: QuickKey) => {
    if (key.longPress) {
      triggerHaptic();
      onKey(key.longPress);
      onRefocus?.();
    }
  }, [onKey, triggerHaptic, onRefocus]);

  const handleClear = useCallback(() => {
    triggerHaptic();
    onClear?.();
    onRefocus?.();
  }, [onClear, triggerHaptic, onRefocus]);

  const preventFocus = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Detect mobile for layout
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  if (!visible) return null;
  
  // Split keys into two rows for mobile layout
  const firstRowKeys = isMobile ? QUICK_KEYS.slice(0, 8) : QUICK_KEYS;
  const secondRowKeys = isMobile ? QUICK_KEYS.slice(8) : [];

  return (
    <div 
      className={`quick-key-bar safe-area-bottom px-3 py-2.5 bg-black/95 backdrop-blur-sm border-t border-[#27272a] fixed left-0 right-0 z-50 ${
        isMobile ? 'flex flex-col gap-2' : 'flex items-center gap-2 overflow-x-auto'
      }`}
      style={{ bottom: `${keyboardOffset}px` }}
      onTouchStart={preventFocus}
      onMouseDown={preventFocus}
    >
      <div className="flex items-center gap-1.5 w-full">
        <button
          onClick={onClose}
          className="quick-key touch-feedback flex-shrink-0 !min-w-[40px] !px-2.5 text-[#a1a1aa] hover:text-white"
          title="Close quick keys"
          tabIndex={-1}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="w-px h-8 bg-[#27272a] flex-shrink-0" />
        <div className={`flex gap-1 ${isMobile ? 'flex-1 justify-between' : 'flex-shrink-0'}`}>
          {firstRowKeys.map(key => (
            <KeyButton 
              key={key.id} 
              keyConfig={key} 
              onClick={handleClick}
              onLongPress={handleLongPress}
            />
          ))}
        </div>
      </div>
      {isMobile && secondRowKeys.length > 0 && (
        <div className="flex gap-2 justify-between pl-[52px]">
          {secondRowKeys.map(key => (
            <KeyButton 
              key={key.id} 
              keyConfig={key} 
              onClick={handleClick}
              onLongPress={handleLongPress}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface KeyButtonProps {
  keyConfig: QuickKey;
  onClick: (key: QuickKey) => void;
  onLongPress: (key: QuickKey) => void;
}

function KeyButton({ keyConfig, onClick, onLongPress }: KeyButtonProps) {
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

  return (
    <button
      className={`quick-key touch-feedback ${keyConfig.category} flex-shrink-0`}
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

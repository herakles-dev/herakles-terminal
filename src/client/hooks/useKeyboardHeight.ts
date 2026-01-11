import { useState, useEffect, useCallback, useRef } from 'react';

interface KeyboardState {
  height: number;
  isVisible: boolean;
}

const MIN_KEYBOARD_HEIGHT = 50;
const KEYBOARD_SCREEN_RATIO = 0.1;
const SCROLL_THROTTLE_MS = 100;

export function useKeyboardHeight(): number {
  const [state, setState] = useState<KeyboardState>({ height: 0, isVisible: false });
  const lastScrollTimeRef = useRef<number>(0);

  const updateState = useCallback(() => {
    const viewport = window.visualViewport;
    const innerHeight = window.innerHeight;
    const viewportHeight = viewport?.height ?? innerHeight;

    const keyboardHeight = innerHeight - viewportHeight;
    const minThreshold = Math.max(MIN_KEYBOARD_HEIGHT, innerHeight * KEYBOARD_SCREEN_RATIO);
    const isVisible = keyboardHeight > minThreshold;
    
    setState({ height: Math.max(0, keyboardHeight), isVisible });
    
    document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, keyboardHeight)}px`);
    document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
    
    const now = Date.now();
    if (isVisible && now - lastScrollTimeRef.current > SCROLL_THROTTLE_MS) {
      lastScrollTimeRef.current = now;
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
    }
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (viewport) {
      viewport.addEventListener('resize', updateState);
      viewport.addEventListener('scroll', updateState);
    }
    window.addEventListener('resize', updateState);
    updateState();

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', updateState);
        viewport.removeEventListener('scroll', updateState);
      }
      window.removeEventListener('resize', updateState);
    };
  }, [updateState]);

  return state.height;
}

export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ height: 0, isVisible: false });

  useEffect(() => {
    const viewport = window.visualViewport;

    const updateState = () => {
      const innerHeight = window.innerHeight;
      const viewportHeight = viewport?.height ?? innerHeight;
      const keyboardHeight = innerHeight - viewportHeight;
      const minThreshold = Math.max(MIN_KEYBOARD_HEIGHT, innerHeight * KEYBOARD_SCREEN_RATIO);
      const isVisible = keyboardHeight > minThreshold;
      setState({ height: Math.max(0, keyboardHeight), isVisible });
    };

    if (viewport) {
      viewport.addEventListener('resize', updateState);
    }
    window.addEventListener('resize', updateState);
    updateState();

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', updateState);
      }
      window.removeEventListener('resize', updateState);
    };
  }, []);

  return state;
}

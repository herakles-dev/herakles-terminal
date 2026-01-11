import { useState, useEffect } from 'react';

interface MobileDetectResult {
  isMobile: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isTouchDevice: boolean;
}

export function useMobileDetect(): MobileDetectResult {
  const [result, setResult] = useState<MobileDetectResult>(() => {
    if (typeof window === 'undefined') {
      return { isMobile: false, isAndroid: false, isIOS: false, isTouchDevice: false };
    }
    return detect();
  });

  useEffect(() => {
    setResult(detect());
  }, []);

  return result;
}

function detect(): MobileDetectResult {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { isMobile: false, isAndroid: false, isIOS: false, isTouchDevice: false };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isMobile = isAndroid || isIOS || (isTouchDevice && window.innerWidth < 768);

  return {
    isMobile,
    isAndroid,
    isIOS,
    isTouchDevice,
  };
}

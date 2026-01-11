import { useState, useEffect, useCallback, createContext, useContext } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration = 2000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const success = useCallback((message: string) => showToast('success', message, 2000), [showToast]);
  const error = useCallback((message: string) => showToast('error', message, 4000), [showToast]);
  const warning = useCallback((message: string) => showToast('warning', message, 3000), [showToast]);
  const info = useCallback((message: string) => showToast('info', message, 2000), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-20 sm:bottom-4 right-4 left-4 sm:left-auto z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
    
    if (toast.duration) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(() => onDismiss(toast.id), 200);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast, onDismiss]);

  const getTypeStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-gradient-to-r from-[#0a0a0f]/98 to-[#0c140c]/98 border-[#22c55e]/30 text-[#4ade80] shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_24px_rgba(34,197,94,0.12)]';
      case 'error':
        return 'bg-gradient-to-r from-[#0a0a0f]/98 to-[#140c0c]/98 border-[#ef4444]/30 text-[#f87171] shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_24px_rgba(239,68,68,0.12)]';
      case 'warning':
        return 'bg-gradient-to-r from-[#0a0a0f]/98 to-[#14120c]/98 border-[#f59e0b]/30 text-[#fbbf24] shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_24px_rgba(245,158,11,0.12)]';
      case 'info':
        return 'bg-gradient-to-r from-[#0a0a0f]/98 to-[#0c1014]/98 border-[#00d4ff]/30 text-[#67e8f9] shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_24px_rgba(0,212,255,0.12)]';
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-mono">✓</span>
          </div>
        );
      case 'error':
        return (
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-mono">✗</span>
          </div>
        );
      case 'warning':
        return (
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-mono">!</span>
          </div>
        );
      case 'info':
        return (
          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-mono">i</span>
          </div>
        );
    }
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-5 py-4 border backdrop-blur-xl rounded-lg sm:min-w-72 sm:max-w-sm transform transition-all duration-300 ease-out ${getTypeStyles()} ${
        isVisible && !isLeaving ? 'translate-y-0 sm:translate-x-0 opacity-100 scale-100' : 'translate-y-2 sm:translate-y-0 sm:translate-x-full opacity-0 scale-95'
      }`}
      style={{
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {getIcon()}
      <span className="flex-1 text-sm font-medium tracking-wide">{toast.message}</span>
      <button
        onClick={() => {
          setIsLeaving(true);
          setTimeout(() => onDismiss(toast.id), 200);
        }}
        className="p-1.5 hover:bg-white/10 rounded transition-all flex-shrink-0 font-mono text-base opacity-50 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

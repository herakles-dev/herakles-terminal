import { useEffect, useRef } from 'react';

interface WindowOption {
  id: string;
  name: string;
  isMain: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  selectedText: string;
  windows: WindowOption[];
  currentWindowId: string;
  onSendToWindow: (windowId: string, text: string) => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}

export default function ContextMenu({
  x,
  y,
  selectedText,
  windows,
  currentWindowId,
  onSendToWindow,
  onCopy,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  const otherWindows = windows.filter(w => w.id !== currentWindowId);
  const hasSelection = selectedText.length > 0;
  const previewText = selectedText.length > 50 ? selectedText.slice(0, 50) + '...' : selectedText;

  return (
    <div
      ref={menuRef}
      className="fixed bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl overflow-hidden z-[9999]"
      style={{ left: x, top: y, minWidth: 240 }}
    >
      {hasSelection && (
        <>
          <div className="px-4 py-2.5 border-b border-[#27272a]">
            <div className="text-sm text-[#a1a1aa] mb-1">Selected:</div>
            <div className="text-sm text-[#d4d4d8] font-mono truncate max-w-[280px]">{previewText}</div>
          </div>

          <button
            onClick={() => {
              onCopy(selectedText);
              onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-base text-[#e4e4e7] hover:bg-[#27272a] transition-colors"
          >
            <svg className="w-5 h-5 text-[#a1a1aa]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>

          {otherWindows.length > 0 && (
            <>
              <div className="border-t border-[#27272a]" />
              <div className="px-4 py-2 text-sm text-[#a1a1aa] bg-[#0a0a0f]">Send to Window</div>
              {otherWindows.map((window) => (
                <button
                  key={window.id}
                  onClick={() => {
                    onSendToWindow(window.id, selectedText);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-base text-[#e4e4e7] hover:bg-[#27272a] transition-colors"
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${window.isMain ? 'bg-[#00d4ff]' : 'bg-[#22c55e]'}`} />
                  <span className="truncate">{window.name}</span>
                  <svg className="w-4 h-4 text-[#a1a1aa] ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              ))}
            </>
          )}
        </>
      )}

      {!hasSelection && (
        <div className="px-4 py-3 text-base text-[#a1a1aa]">No text selected</div>
      )}
    </div>
  );
}

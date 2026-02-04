import { useState, useCallback, useEffect, useRef } from 'react';
import type { Artifact } from '../../types/canvas';
import ArtifactRenderer from './ArtifactRenderer';

interface FullscreenViewerProps {
  artifact: Artifact;
  viewMode: 'code' | 'preview';
  onClose: () => void;
  onToggleViewMode: () => void;
  onSendToTerminal?: (content: string) => void;
}

export default function FullscreenViewer({
  artifact,
  viewMode,
  onClose,
  onToggleViewMode,
  onSendToTerminal,
}: FullscreenViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 25, 300));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 25, 25));
  }, []);

  const handleFitToScreen = useCallback(() => {
    setZoom(100);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleActualSize = useCallback(() => {
    setZoom(100);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [artifact.content]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setZoom(prev => Math.max(25, Math.min(300, prev + delta)));
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && zoom > 100) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  }, [zoom, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleFitToScreen();
      } else if (e.key === 'c' || e.key === 'C') {
        handleCopy();
      } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSendToTerminal?.(artifact.content);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleFitToScreen, handleCopy, onSendToTerminal, artifact.content]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col animate-in fade-in duration-200"
      style={{
        background: 'rgba(0, 0, 0, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-gradient-to-r from-[#08080e] via-[#0c0c14] to-[#08080e]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[#00d4ff] text-sm font-medium">
              {artifact.title || `${artifact.type}${artifact.language ? ` (${artifact.language})` : ''}`}
            </span>
            <span className="text-[#52525b] text-xs">
              {artifact.type.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#18181b] rounded-lg p-1 border border-[#27272a]">
            <button
              onClick={handleZoomOut}
              className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded transition-colors"
              title="Zoom out (-)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <span className="px-2 text-xs text-[#a1a1aa] font-mono min-w-[48px] text-center">
              {zoom}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded transition-colors"
              title="Zoom in (+)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="w-px h-6 bg-[#27272a]" />

          <button
            onClick={handleFitToScreen}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded transition-colors"
            title="Fit to screen (0)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M4 8V4h4M4 16v4h4M16 4h4v4M16 20h4v-4" />
            </svg>
          </button>

          <button
            onClick={handleActualSize}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded transition-colors"
            title="Actual size (1:1)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          <div className="w-px h-6 bg-[#27272a]" />

          <button
            onClick={onToggleViewMode}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              viewMode === 'preview'
                ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#27272a] border border-transparent'
            }`}
          >
            {viewMode === 'preview' ? 'Preview' : 'Code'}
          </button>

          <button
            onClick={handleCopy}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded transition-all ${
              copied
                ? 'bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30'
                : 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20 hover:bg-[#00d4ff]/20'
            }`}
            title="Copy full artifact content"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>

          {onSendToTerminal && (
            <button
              onClick={() => onSendToTerminal(artifact.content)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded transition-all bg-[#22c55e]/10 text-[#4ade80] border border-[#22c55e]/20 hover:bg-[#22c55e]/20"
              title="Send to terminal (S)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              Send
            </button>
          )}

          <div className="w-px h-6 bg-[#27272a]" />

          <button
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-red-500/20 hover:text-red-400 rounded transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-hidden relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 100 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <div
          ref={contentRef}
          className="absolute inset-0 flex items-center justify-center p-8"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom / 100})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          <div
            className="max-w-4xl w-full max-h-full overflow-auto rounded-xl animate-in zoom-in-95 duration-200"
            style={{
              background: 'linear-gradient(180deg, #0c0c14 0%, #08080e 100%)',
              border: '1px solid rgba(0, 212, 255, 0.1)',
              boxShadow: '0 0 80px rgba(0, 212, 255, 0.08), 0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
            }}
          >
            <div className="p-6">
              <ArtifactRenderer artifact={artifact} viewMode={viewMode} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 px-4 py-2.5 border-t border-white/[0.06] bg-gradient-to-r from-[#08080e] via-[#0c0c14] to-[#08080e] text-[11px] text-[#71717a]">
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">Esc</kbd> Close</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">+</kbd> / <kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">-</kbd> Zoom</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">0</kbd> Reset</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">Ctrl</kbd> + Scroll</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">C</kbd> Copy</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">S</kbd> Send</span>
      </div>
    </div>
  );
}

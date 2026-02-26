import { useState, useCallback, useEffect, useRef } from 'react';
import type { Artifact } from '../../types/canvas';
import ArtifactRenderer from './ArtifactRenderer';

interface FullscreenViewerProps {
  artifact: Artifact;
  artifacts?: Artifact[];
  currentIndex?: number;
  viewMode: 'code' | 'preview';
  onClose: () => void;
  onToggleViewMode: () => void;
  onSendToTerminal?: (content: string) => void;
  onNavigate?: (index: number) => void;
}

export default function FullscreenViewer({
  artifact,
  artifacts,
  currentIndex = 0,
  viewMode,
  onClose,
  onToggleViewMode,
  onSendToTerminal,
  onNavigate,
}: FullscreenViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  const totalArtifacts = artifacts?.length ?? 1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalArtifacts - 1;

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in certain contexts
    }
  }, [artifact.content]);

  const handleDownload = useCallback(() => {
    const ext = artifact.language || artifact.type;
    const extMap: Record<string, string> = {
      markdown: 'md',
      mermaid: 'mmd',
      html: 'html',
      svg: 'svg',
      json: 'json',
      code: ext === 'code' ? 'txt' : ext,
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
    };
    const fileExt = extMap[ext] || ext || 'txt';
    const filename = `${artifact.title || `artifact-${artifact.id.slice(0, 8)}`}.${fileExt}`;

    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [artifact]);

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      onNavigate(currentIndex - 1);
      setZoom(100);
      setPosition({ x: 0, y: 0 });
    }
  }, [hasPrev, currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate) {
      onNavigate(currentIndex + 1);
      setZoom(100);
      setPosition({ x: 0, y: 0 });
    }
  }, [hasNext, currentIndex, onNavigate]);

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
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
        handleDownload();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleFitToScreen, handleCopy, onSendToTerminal, artifact.content, handlePrev, handleNext, handleDownload]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col animate-in fade-in duration-200"
      style={{
        background: 'rgba(0, 0, 0, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-gradient-to-r from-[#08080e] via-[#0c0c14] to-[#08080e]">
        <div className="flex items-center gap-4">
          {/* Navigation arrows + counter */}
          {totalArtifacts > 1 && onNavigate && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePrev}
                disabled={!hasPrev}
                className={`p-1.5 rounded transition-colors ${
                  hasPrev
                    ? 'text-[#a1a1aa] hover:text-white hover:bg-[#27272a]'
                    : 'text-[#3f3f46] cursor-not-allowed'
                }`}
                title="Previous artifact (Left arrow)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-[11px] text-[#71717a] font-mono min-w-[40px] text-center">
                {currentIndex + 1}/{totalArtifacts}
              </span>
              <button
                onClick={handleNext}
                disabled={!hasNext}
                className={`p-1.5 rounded transition-colors ${
                  hasNext
                    ? 'text-[#a1a1aa] hover:text-white hover:bg-[#27272a]'
                    : 'text-[#3f3f46] cursor-not-allowed'
                }`}
                title="Next artifact (Right arrow)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Artifact title + type */}
          <div className="flex items-center gap-2">
            <span className="text-[#00d4ff] text-sm font-medium">
              {artifact.title || `${artifact.type}${artifact.language ? ` (${artifact.language})` : ''}`}
            </span>
            <span className="text-[#52525b] text-xs">
              {artifact.type.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
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

          <div className="w-px h-6 bg-[#27272a]" />

          {/* View mode toggle */}
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

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-all ${
              copied
                ? 'bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#27272a] border border-transparent'
            }`}
            title="Copy (C)"
          >
            {copied ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>

          {/* Download button */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors text-[#a1a1aa] hover:text-white hover:bg-[#27272a] border border-transparent"
            title="Download (D)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </button>

          {/* Send to terminal */}
          {onSendToTerminal && (
            <button
              onClick={() => onSendToTerminal(artifact.content)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors bg-[#22c55e]/10 text-[#4ade80] border border-[#22c55e]/20 hover:bg-[#22c55e]/20"
              title="Send to terminal (S)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              Send
            </button>
          )}

          <div className="w-px h-6 bg-[#27272a]" />

          {/* Close */}
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

      {/* Content area */}
      <div
        className="flex-1 overflow-hidden relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 100 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* Side navigation arrows (visible on hover) */}
        {totalArtifacts > 1 && onNavigate && (
          <>
            {hasPrev && (
              <button
                onClick={handlePrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 text-[#a1a1aa] hover:text-white hover:bg-black/70 transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                style={{ backdropFilter: 'blur(8px)' }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {hasNext && (
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 text-[#a1a1aa] hover:text-white hover:bg-black/70 transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                style={{ backdropFilter: 'blur(8px)' }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}

        <div
          ref={contentRef}
          className="absolute inset-0 flex items-center justify-center p-4"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom / 100})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          <div
            className="w-[95vw] h-[85vh] overflow-auto rounded-xl animate-in zoom-in-95 duration-200"
            style={{
              background: 'linear-gradient(180deg, #0c0c14 0%, #08080e 100%)',
              border: '1px solid rgba(0, 212, 255, 0.1)',
              boxShadow: '0 0 80px rgba(0, 212, 255, 0.08), 0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
            }}
          >
            <div className="p-6 h-full">
              <ArtifactRenderer artifact={artifact} viewMode={viewMode} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-center gap-4 px-4 py-2.5 border-t border-white/[0.06] bg-gradient-to-r from-[#08080e] via-[#0c0c14] to-[#08080e] text-[11px] text-[#71717a]">
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">Esc</kbd> Close</span>
        {totalArtifacts > 1 && (
          <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">&larr;</kbd> <kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">&rarr;</kbd> Navigate</span>
        )}
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">+</kbd> / <kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">-</kbd> Zoom</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">C</kbd> Copy</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">D</kbd> Download</span>
        <span><kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[#a1a1aa]">S</kbd> Send</span>
      </div>
    </div>
  );
}

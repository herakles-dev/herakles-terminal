import { useState, useCallback, useMemo, useRef } from 'react';
import type { Artifact, ArtifactType } from '../../types/canvas';
import ArtifactRenderer from '../Canvas/ArtifactRenderer';
import FullscreenViewer from '../Canvas/FullscreenViewer';

interface CanvasPanelProps {
  artifacts: Artifact[];
  activeArtifactId: string | null;
  viewMode: 'code' | 'preview';
  onSelectArtifact: (id: string) => void;
  onClear: () => void;
  onToggleViewMode: () => void;
  onRemoveArtifact?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onSendToTerminal?: (content: string) => void;
}

const TYPE_ICONS: Record<ArtifactType, React.ReactNode> = {
  markdown: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M4 6h16M4 12h8M4 18h12" />
    </svg>
  ),
  code: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  html: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  ),
  svg: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  mermaid: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  ),
  json: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function CanvasPanel({
  artifacts,
  activeArtifactId,
  viewMode,
  onSelectArtifact,
  onClear,
  onToggleViewMode,
  onRemoveArtifact,
  onToggleStar,
  onSendToTerminal,
}: CanvasPanelProps) {
  const [filter, setFilter] = useState<ArtifactType | 'all'>('all');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoveredArtifact, setHoveredArtifact] = useState<Artifact | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const mouseLongPressRef = useRef<number | null>(null);
  const wasLongPressRef = useRef(false);

  const activeArtifact = useMemo(
    () => artifacts.find(a => a.id === activeArtifactId) || null,
    [artifacts, activeArtifactId]
  );

  const filteredArtifacts = useMemo(
    () => filter === 'all' ? artifacts : artifacts.filter(a => a.type === filter),
    [artifacts, filter]
  );

  const handleCopy = useCallback(() => {
    if (activeArtifact) {
      navigator.clipboard.writeText(activeArtifact.content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [activeArtifact]);

  const handleMouseEnter = useCallback((artifact: Artifact) => {
    setHoveredArtifact(artifact);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredArtifact(null);
  }, []);

  const handleTouchStart = useCallback((artifact: Artifact) => {
    longPressTimerRef.current = window.setTimeout(() => {
      setHoveredArtifact(artifact);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setHoveredArtifact(null);
  }, []);

  const handleMouseDown = useCallback((artifact: Artifact) => {
    wasLongPressRef.current = false;
    mouseLongPressRef.current = window.setTimeout(() => {
      wasLongPressRef.current = true;
      setHoveredArtifact(artifact);
    }, 300);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (mouseLongPressRef.current) {
      clearTimeout(mouseLongPressRef.current);
      mouseLongPressRef.current = null;
    }
    if (wasLongPressRef.current) {
      setHoveredArtifact(null);
    }
  }, []);

  const handleItemClick = useCallback((artifactId: string) => {
    if (!wasLongPressRef.current) {
      onSelectArtifact(artifactId);
    }
    wasLongPressRef.current = false;
  }, [onSelectArtifact]);

  const handleExport = useCallback(() => {
    if (activeArtifact) {
      const ext = activeArtifact.type === 'markdown' ? 'md' : 
                  activeArtifact.type === 'mermaid' ? 'mmd' :
                  activeArtifact.type === 'json' ? 'json' :
                  activeArtifact.type;
      const blob = new Blob([activeArtifact.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `artifact-${activeArtifact.id.slice(-6)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [activeArtifact]);

  if (artifacts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-[#00d4ff]/5 border border-[#00d4ff]/10 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-[#00d4ff]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" d="M4 5h16v14H4zM8 9h8M8 13h5" />
          </svg>
        </div>
        <p className="text-[#a1a1aa] text-base font-medium mb-1">No artifacts detected</p>
        <p className="text-[#8a8a92] text-sm max-w-[200px]">
          Artifacts will appear here when detected in terminal output
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#00d4ff]/10">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#8a8a92] font-medium tabular-nums">
            {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
          </span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ArtifactType | 'all')}
            className="text-[12px] bg-[#0a0a0f] border border-[#27272a] rounded px-2 py-1 text-[#d4d4d8] focus:border-[#00d4ff]/30 focus:outline-none"
          >
            <option value="all">All types</option>
            <option value="markdown">Markdown</option>
            <option value="code">Code</option>
            <option value="html">HTML</option>
            <option value="svg">SVG</option>
            <option value="mermaid">Mermaid</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleViewMode}
            className={`px-2.5 py-1.5 text-[12px] font-medium rounded transition-all ${
              viewMode === 'preview'
                ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20'
                : 'text-[#a1a1aa] hover:text-[#d4d4d8] border border-transparent'
            }`}
          >
            {viewMode === 'preview' ? 'Preview' : 'Code'}
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 max-h-40 overflow-y-auto border-b border-[#00d4ff]/10">
        {filteredArtifacts.map((artifact) => (
          <div
            key={artifact.id}
            onClick={() => handleItemClick(artifact.id)}
            onMouseDown={() => handleMouseDown(artifact)}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseLeave(); handleMouseUp(); }}
            onTouchStart={() => handleTouchStart(artifact)}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all cursor-pointer group ${
              artifact.id === activeArtifactId
                ? 'bg-[#00d4ff]/10 border-l-2 border-l-[#00d4ff]'
                : 'hover:bg-[#ffffff]/[0.02] border-l-2 border-l-transparent'
            }`}
          >
            <span className={artifact.id === activeArtifactId ? 'text-[#00d4ff]' : 'text-[#8a8a92]'}>
              {TYPE_ICONS[artifact.type]}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[13px] font-medium truncate ${
                  artifact.id === activeArtifactId ? 'text-[#e0e0e8]' : 'text-[#d4d4d8]'
                }`}>
                  {artifact.title || `${artifact.type}${artifact.language ? ` (${artifact.language})` : ''}`}
                </span>
              </div>
              <span className="text-[11px] text-[#8a8a92]">
                {formatTimestamp(artifact.timestamp)}
              </span>
            </div>
            {onToggleStar && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(artifact.id);
                }}
                className={`p-1.5 transition-colors ${
                  artifact.starred
                    ? 'text-yellow-400 hover:text-yellow-300'
                    : 'text-[#8a8a92] hover:text-yellow-400 opacity-0 group-hover:opacity-100'
                }`}
                title={artifact.starred ? 'Unstar (persisted)' : 'Star to persist'}
              >
                <svg className="w-4 h-4" fill={artifact.starred ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
              </button>
            )}
            {onRemoveArtifact && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveArtifact(artifact.id);
                }}
                className="p-1.5 text-[#8a8a92] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-2 relative group/preview">
        {(hoveredArtifact || activeArtifact) ? (
          <>
            <ArtifactRenderer artifact={hoveredArtifact || activeArtifact!} viewMode={viewMode} />
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-3 right-3 p-2 bg-[#18181b]/90 hover:bg-[#27272a] border border-[#27272a] rounded-lg text-[#71717a] hover:text-[#00d4ff] transition-all opacity-0 group-hover/preview:opacity-100"
              title="View fullscreen"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" d="M4 8V4h4M4 16v4h4M16 4h4v4M16 20h4v-4" />
              </svg>
            </button>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[#8a8a92] text-base">
            Select an artifact to view
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2.5 border-t border-[#00d4ff]/10 bg-[#06060c]">
        <button
          onClick={handleCopy}
          disabled={!activeArtifact}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[#a1a1aa] hover:text-[#00d4ff] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
        <button
          onClick={() => onSendToTerminal?.(activeArtifact!.content)}
          disabled={!activeArtifact || !onSendToTerminal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[#a1a1aa] hover:text-[#22c55e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Send to terminal"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          Send
        </button>
        <button
          onClick={handleExport}
          disabled={!activeArtifact}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[#a1a1aa] hover:text-[#00d4ff] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-[#a1a1aa] hover:text-red-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Clear
        </button>
      </div>

      {isFullscreen && activeArtifact && (
        <FullscreenViewer
          artifact={activeArtifact}
          viewMode={viewMode}
          onClose={() => setIsFullscreen(false)}
          onToggleViewMode={onToggleViewMode}
          onSendToTerminal={onSendToTerminal}
        />
      )}
    </div>
  );
}

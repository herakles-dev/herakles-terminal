import { useRef, useEffect, useState, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';

interface TimeMarker {
  line: number;
  timestamp: number;
}

interface TerminalMinimapProps {
  terminal: Terminal | null;
  isVisible: boolean;
  onClose: () => void;
  sidePanelOpen?: boolean;
  sidePanelExpanded?: boolean;
}

export default function TerminalMinimap({ terminal, isVisible, onClose, sidePanelOpen = false, sidePanelExpanded = false }: TerminalMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const rafRef = useRef<number | null>(null);
  const timeMarkersRef = useRef<TimeMarker[]>([]);
  const lastBufferLengthRef = useRef<number>(0);
  const lastFullRenderRef = useRef<number>(0);
  const cachedBlocksRef = useRef<Map<number, { color: string; width: number; glow: boolean }>>(new Map());

  const MIN_RENDER_INTERVAL_MS = 100;

  const MINIMAP_WIDTH = sidePanelOpen ? 65 : 122;

  const renderMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !terminal) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const buffer = terminal.buffer.active;
    const baseY = buffer.baseY;
    const visibleRows = terminal.rows;
    const viewportY = buffer.viewportY;
    const totalContentLines = baseY + visibleRows;
    
    setTotalLines(totalContentLines);

    const containerHeight = container.clientHeight - 20;
    if (totalContentLines === 0 || containerHeight <= 0) return;

    canvas.width = MINIMAP_WIDTH;
    canvas.height = containerHeight;

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bufferLength = buffer.length;
    if (bufferLength === 0) return;

    const numBlocks = Math.min(containerHeight, 500);
    const blockHeight = containerHeight / numBlocks;
    const linesPerBlock = bufferLength / numBlocks;
    
    for (let block = 0; block < numBlocks; block++) {
      const y = block * blockHeight;
      const startLine = Math.floor(block * linesPerBlock);
      const endLine = Math.min(Math.ceil((block + 1) * linesPerBlock), bufferLength);
      
      let contentCount = 0;
      let totalLen = 0;
      let aiCount = 0;
      let thinkingCount = 0;
      let userCount = 0;
      let codeCount = 0;
      let errorCount = 0;
      let additionCount = 0;
      let removalCount = 0;
      let toolCount = 0;
      let outputCount = 0;
      
      const linesToCheck = endLine - startLine;
      const samplesToCheck = Math.min(linesToCheck, 8);
      const sampleStep = Math.max(1, Math.floor(linesToCheck / samplesToCheck));
      
      for (let li = startLine; li < endLine; li += sampleStep) {
        const line = buffer.getLine(li);
        if (!line) continue;
        
        const str = line.translateToString(true);
        if (!str) continue;
        
        const trimmed = str.trim();
        if (trimmed.length === 0) continue;
        
        contentCount++;
        totalLen += trimmed.length;
        
        const lower = str.toLowerCase();
        
        const isGitAddition = (trimmed.startsWith('+') && !trimmed.startsWith('++')) ||
                             str.includes('\x1b[32m');
        
        const isGitRemoval = (trimmed.startsWith('-') && !trimmed.startsWith('--')) ||
                            str.includes('\x1b[31m');
        
        const isDiffHeader = trimmed.startsWith('@@') || 
                            trimmed.startsWith('diff ') ||
                            trimmed.startsWith('index ') ||
                            trimmed.startsWith('+++') || 
                            trimmed.startsWith('---');
        
        const isError = lower.includes('error') || lower.includes('failed') ||
                       lower.includes('failure') || lower.includes('exception') ||
                       lower.includes('denied') || lower.includes('refused') ||
                       lower.includes('fatal') || lower.includes('panic');
        
        const isThinking = trimmed === '...' || trimmed === '…' ||
                          str.includes('⏳') || str.includes('💭') ||
                          lower.includes('thinking') || lower.includes('processing') ||
                          /^\s*[\.]{2,}\s*$/.test(trimmed);
        
        const isUserPrompt = (trimmed.startsWith('$ ') || trimmed === '$') ||
                            (trimmed.startsWith('> ') && !trimmed.startsWith('> ╭') && !trimmed.startsWith('> │')) ||
                            trimmed.startsWith('❯ ') || trimmed.startsWith('% ') ||
                            /^[a-z]+@[a-z0-9-]+:[~\/]/.test(lower) ||
                            str.includes('hercules@') || str.includes('root@') ||
                            trimmed.startsWith('>>> ') || trimmed.startsWith('Human:') ||
                            /^\[[0-9;]*m?\s*\$/.test(str);
        
        const isTool = /^\s*(Read|Write|Edit|Bash|Grep|Glob|Task|LS|WebFetch|MultiEdit)\s/.test(trimmed) ||
                      str.includes('<invoke') || str.includes('</') ||
                      str.includes('<parameter') ||
                      /^\s*\[?(Reading|Writing|Editing|Running|Searching|Fetching)/.test(trimmed) ||
                      str.includes('mcp__');
        
        const isAIResponse = str.includes('⏺') || str.includes('╭') || str.includes('╰') ||
                            str.includes('│') || str.includes('Claude') ||
                            str.includes('Assistant') || str.includes('assistant:') ||
                            /^(I'll|I will|Let me|Here's|Here is|This|The |To )/.test(trimmed) ||
                            /^[\*#]+ /.test(trimmed) ||
                            /^\d+\.\s+\w/.test(trimmed) ||
                            /^[-\*]\s+\w/.test(trimmed);
        
        const isCodeBlock = trimmed.startsWith('```') ||
                           trimmed.startsWith('import ') || trimmed.startsWith('export ') ||
                           trimmed.startsWith('const ') || trimmed.startsWith('let ') ||
                           trimmed.startsWith('function ') || trimmed.startsWith('class ') ||
                           trimmed.startsWith('def ') || trimmed.startsWith('return ') ||
                           trimmed.startsWith('async ') || trimmed.startsWith('await ') ||
                           trimmed.startsWith('if ') || trimmed.startsWith('else ') ||
                           trimmed.startsWith('for ') || trimmed.startsWith('while ') ||
                           /^[\s]*[{}();\[\]]$/.test(trimmed) ||
                           str.includes('=>') || str.includes('->') ||
                           trimmed.startsWith('//') || trimmed.startsWith('/*') ||
                           (trimmed.startsWith('#') && !isUserPrompt && trimmed.length > 1) ||
                           /^\s*["'{\[]/.test(trimmed) ||
                           /^\s*\w+:\s*["'\[{]/.test(trimmed) ||
                           /^\/[a-z]+\//.test(lower);
        
        if (isDiffHeader) outputCount++;
        else if (isGitAddition) additionCount++;
        else if (isGitRemoval) removalCount++;
        else if (isError) errorCount++;
        else if (isThinking) thinkingCount++;
        else if (isUserPrompt) userCount++;
        else if (isTool) toolCount++;
        else if (isAIResponse) aiCount++;
        else if (isCodeBlock) codeCount++;
        else outputCount++;
      }
      
      if (contentCount > 0) {
        const avgLen = totalLen / contentCount;
        
        let color: string;
        let glowColor: string | null = null;
        let intensity = 0.8;
        
        const counts = [
          { type: 'addition', count: additionCount, color: '#4ade80', glow: true, weight: 1 },
          { type: 'removal', count: removalCount, color: '#f87171', glow: true, weight: 1 },
          { type: 'error', count: errorCount, color: '#fb923c', glow: true, weight: 1.5 },
          { type: 'thinking', count: thinkingCount, color: '#fbbf24', glow: false, weight: 1 },
          { type: 'user', count: userCount, color: '#e879f9', glow: true, weight: 2 },
          { type: 'tool', count: toolCount, color: '#22d3ee', glow: true, weight: 1.2 },
          { type: 'ai', count: aiCount, color: '#00d4ff', glow: false, weight: 0.8 },
          { type: 'code', count: codeCount, color: '#2a2a35', glow: false, weight: 0.6 },
        ];
        
        const dominant = counts.reduce((max, c) => {
          const weighted = c.count * (c.weight || 1);
          const maxWeighted = max.count * (max.weight || 1);
          return weighted > maxWeighted ? c : max;
        }, { type: 'output', count: 0, color: '#64748b', glow: false, weight: 1 });
        
        if (dominant.count === 0 || (dominant.type === 'output' && outputCount > 0)) {
          color = '#64748b';
          intensity = 0.4;
        } else {
          color = dominant.color;
          if (dominant.glow) glowColor = dominant.color;
          intensity = 0.6 + (dominant.count / contentCount) * 0.4;
        }
        
        const lenRatio = Math.min(avgLen / 80, 1);
        const barWidth = 40 + lenRatio * (MINIMAP_WIDTH - 44);
        const barHeight = Math.max(blockHeight, 1.5);
        
        if (glowColor) {
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 6;
        }
        
        ctx.globalAlpha = intensity;
        ctx.fillStyle = color;
        
        ctx.beginPath();
        ctx.roundRect(2, y, barWidth, barHeight, 1);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      
    }
    
    const markers = timeMarkersRef.current;
    if (markers.length >= 2) {
      const firstTime = markers[0].timestamp;
      const lastTime = markers[markers.length - 1].timestamp;
      const totalDuration = lastTime - firstTime;
      
      const numTimeLabels = Math.min(8, Math.floor(containerHeight / 60));
      const labelStep = Math.max(1, Math.floor(markers.length / numTimeLabels));
      
      for (let i = 0; i < markers.length; i += labelStep) {
        const marker = markers[i];
        const lineRatio = marker.line / bufferLength;
        const markerY = lineRatio * containerHeight;
        
        const elapsed = marker.timestamp - firstTime;
        let timeStr: string;
        if (totalDuration < 60000) {
          timeStr = `${Math.floor(elapsed / 1000)}s`;
        } else if (totalDuration < 3600000) {
          const mins = Math.floor(elapsed / 60000);
          const secs = Math.floor((elapsed % 60000) / 1000);
          timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        } else {
          const hrs = Math.floor(elapsed / 3600000);
          const mins = Math.floor((elapsed % 3600000) / 60000);
          timeStr = `${hrs}h${mins}m`;
        }
        
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#475569';
        ctx.fillRect(0, markerY, 3, 1);
        
        ctx.globalAlpha = 0.5;
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(timeStr, MINIMAP_WIDTH - 3, markerY + 3);
        ctx.globalAlpha = 1;
      }
    }
    
    const renderedHeight = containerHeight;
    
    const vpTopRatio = viewportY / bufferLength;
    const vpHeightRatio = visibleRows / bufferLength;
    
    const vpTop = vpTopRatio * renderedHeight;
    const vpHeight = Math.max(vpHeightRatio * renderedHeight, 20);
    
    setViewportTop(Math.max(0, vpTop));
    setViewportHeight(vpHeight);
    setCanScrollUp(viewportY > 0);
    setCanScrollDown(viewportY < baseY);
  }, [terminal]);

  const scrollToTop = useCallback(() => {
    if (terminal) {
      terminal.scrollToTop();
    }
  }, [terminal]);

  const scrollToBottom = useCallback(() => {
    if (terminal) {
      terminal.scrollToBottom();
    }
  }, [terminal]);

  useEffect(() => {
    if (!isVisible) return;
    if (!terminal) {
      return;
    }

    renderMinimap();
    lastFullRenderRef.current = Date.now();

    const scheduleRender = (forceImmediate = false) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      const now = Date.now();
      const timeSinceLastRender = now - lastFullRenderRef.current;

      if (forceImmediate || timeSinceLastRender >= MIN_RENDER_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(() => {
          renderMinimap();
          lastFullRenderRef.current = Date.now();
        });
      } else {
        const delay = MIN_RENDER_INTERVAL_MS - timeSinceLastRender;
        rafRef.current = requestAnimationFrame(() => {
          setTimeout(() => {
            renderMinimap();
            lastFullRenderRef.current = Date.now();
          }, delay);
        });
      }
    };

    const trackTime = () => {
      const buffer = terminal.buffer.active;
      const currentLength = buffer.length;
      
      if (currentLength > lastBufferLengthRef.current) {
        timeMarkersRef.current.push({
          line: currentLength,
          timestamp: Date.now(),
        });
        
        if (timeMarkersRef.current.length > 1000) {
          timeMarkersRef.current = timeMarkersRef.current.slice(-500);
        }
        
        lastBufferLengthRef.current = currentLength;
      }
      scheduleRender();
    };

    scheduleRender(true);

    const scrollDisposable = terminal.onScroll(() => scheduleRender(true));
    const writeDisposable = terminal.onWriteParsed(trackTime);
    const resizeDisposable = terminal.onResize(() => scheduleRender(true));

    const interval = setInterval(() => scheduleRender(), 1000);

    const resizeObserver = new ResizeObserver(() => scheduleRender(true));
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      scrollDisposable.dispose();
      writeDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      clearInterval(interval);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      cachedBlocksRef.current.clear();
    };
  }, [isVisible, terminal, renderMinimap]);

  const scrollToPosition = useCallback((clientY: number) => {
    if (!terminal || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const clickY = clientY - rect.top - 20;
    const containerHeight = rect.height - 20;
    
    const buffer = terminal.buffer.active;
    const totalContentLines = buffer.baseY + terminal.rows;
    const targetLine = Math.floor((clickY / containerHeight) * totalContentLines);
    
    const scrollLine = Math.max(0, Math.min(targetLine - Math.floor(terminal.rows / 2), buffer.baseY));
    terminal.scrollToLine(scrollLine);
  }, [terminal]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.minimap-close')) return;
    setIsDragging(true);
    scrollToPosition(e.clientY);
  }, [scrollToPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    scrollToPosition(e.clientY);
  }, [isDragging, scrollToPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => setIsDragging(false);
      const handleGlobalMouseMove = (e: MouseEvent) => {
        scrollToPosition(e.clientY);
      };

      document.addEventListener('mouseup', handleGlobalMouseUp);
      document.addEventListener('mousemove', handleGlobalMouseMove);
      
      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
      };
    }
  }, [isDragging, scrollToPosition]);

  if (!isVisible) return null;

  const showLoading = !terminal;

  return (
    <div 
      ref={containerRef}
      className={`terminal-minimap hidden sm:flex ${sidePanelOpen ? 'minimap-narrow' : ''}`}
      style={{ width: MINIMAP_WIDTH, right: sidePanelOpen ? (sidePanelExpanded ? '50vw' : 340) : 0 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 border border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div className="minimap-header">
        <span className="minimap-title">
          {totalLines > 0 ? `${totalLines}` : '0'}
        </span>
        {!sidePanelOpen && (
          <div className="minimap-legend">
            <span className="legend-dot" style={{ background: '#4ade80' }} data-tooltip="Add" />
            <span className="legend-dot" style={{ background: '#f87171' }} data-tooltip="Del" />
            <span className="legend-dot" style={{ background: '#e879f9', boxShadow: '0 0 6px #e879f9' }} data-tooltip="You" />
            <span className="legend-dot" style={{ background: '#22d3ee', boxShadow: '0 0 4px #22d3ee' }} data-tooltip="Tool" />
            <span className="legend-dot" style={{ background: '#00d4ff' }} data-tooltip="AI" />
            <span className="legend-dot" style={{ background: 'linear-gradient(135deg, #1a1a22 0%, #2d2d3a 50%, #1a1a22 100%)', border: '1px solid #3a3a45' }} data-tooltip="Code" />
          </div>
        )}
        <button 
          className="minimap-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close minimap"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <canvas 
        ref={canvasRef} 
        className="minimap-canvas"
      />
      <div 
        className="minimap-slider"
        style={{
          top: `${viewportTop + 20}px`,
          height: `${viewportHeight}px`,
        }}
      />
      {canScrollUp && (
        <button
          className="minimap-scroll-btn minimap-scroll-up"
          onClick={(e) => { e.stopPropagation(); scrollToTop(); }}
          title="Scroll to top"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
      )}
      {canScrollDown && (
        <button
          className="minimap-scroll-btn minimap-scroll-down"
          onClick={(e) => { e.stopPropagation(); scrollToBottom(); }}
          title="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

import { useRef, useEffect, useState, useCallback } from 'react';
import type { Terminal, IBufferLine } from '@xterm/xterm';

interface TimeMarker {
  line: number;
  timestamp: number;
}

// Conversation states for the minimap
type ConversationState = 'user' | 'claude' | 'tool' | 'output' | 'error' | 'diff-add' | 'diff-remove';

interface LineClassification {
  state: ConversationState;
  inCodeBlock: boolean;
  confidence: number;
}

// Color palette for conversation states - muted, subtle tones
const STATE_COLORS: Record<ConversationState, { primary: string; muted: string; glow: boolean }> = {
  user:        { primary: '#a855f7', muted: '#7c3aed', glow: false },  // Purple - your input
  claude:      { primary: '#0ea5e9', muted: '#0284c7', glow: false },  // Sky blue - Claude's response
  tool:        { primary: '#d97706', muted: '#b45309', glow: false },  // Amber - tool calls
  output:      { primary: '#52525b', muted: '#3f3f46', glow: false },  // Zinc - tool output
  error:       { primary: '#dc2626', muted: '#b91c1c', glow: false },  // Red - errors
  'diff-add':  { primary: '#16a34a', muted: '#15803d', glow: false },  // Green - added lines
  'diff-remove': { primary: '#dc2626', muted: '#b91c1c', glow: false }, // Red - removed lines
};

// Anchor detection - definitive patterns that establish context
function detectAnchor(trimmed: string, currentState: ConversationState): { type: ConversationState | 'code_fence' | null; confidence: number } {
  // User prompt anchors (highest priority - definitive)
  // Shell prompts: $, ❯, %, or username@host:path patterns
  if (/^(\$|❯|%)(\s|$)/.test(trimmed) ||
      /^[a-z_][a-z0-9_-]*@[\w.-]+:[~\/]/.test(trimmed) ||
      /^(Human|User):\s/.test(trimmed) ||
      trimmed.startsWith('>>> ')) {
    return { type: 'user', confidence: 1.0 };
  }

  // Claude Code uses ● (bullet U+25CF) for tool calls in format: ● ToolName(args)
  if (/^●\s*(Read|Write|Edit|MultiEdit|Bash|Grep|Glob|Task|WebFetch|LS|TodoWrite|NotebookEdit|AskUser|Skill|mcp__|WebSearch|Update)/.test(trimmed)) {
    return { type: 'tool', confidence: 1.0 };
  }

  // Claude Code uses ● (bullet) for prose responses too
  if (/^●\s/.test(trimmed) || /^●$/.test(trimmed)) {
    return { type: 'claude', confidence: 1.0 };
  }

  // Tool result/output lines start with ⎿ (U+23BF)
  if (/^\s*⎿/.test(trimmed)) {
    return { type: 'output', confidence: 0.95 };
  }

  // Code fence toggle
  if (/^```/.test(trimmed)) {
    return { type: 'code_fence', confidence: 1.0 };
  }

  // Error anchors (definitive error patterns)
  if (/^(Error|ERROR|error\[|FAILED|Fatal|FATAL|panic|Traceback)[\s:\[]/.test(trimmed) ||
      /^✗\s/.test(trimmed) ||
      /^error:/.test(trimmed.toLowerCase())) {
    return { type: 'error', confidence: 0.95 };
  }

  // NOTE: Diff detection (+/- lines) moved to classifyBuffer() with context tracking
  // to avoid false positives from markdown lists and other content

  // Claude prose anchors - CRITICAL: These transition FROM user state to claude
  // Only definitive Claude intro patterns (removed broad patterns like "The ", "This ", etc.)
  if (currentState === 'user' || currentState === 'output') {
    if (/^(I'll |I will |I'm going to |Let me |Here's |Looking at the |Based on the )/.test(trimmed)) {
      return { type: 'claude', confidence: 0.9 };
    }
    // Box drawing at line start (Claude's formatted output)
    if (/^[│╭╰├└┌┐┘└┤┬┴┼]/.test(trimmed)) {
      return { type: 'claude', confidence: 0.9 };
    }
  }

  return { type: null, confidence: 0 };
}

// Secondary classification for lines between anchors
function classifyLine(line: string, trimmed: string, currentState: ConversationState): { state: ConversationState; confidence: number } {
  // Tool progress indicators (spinners, progress messages)
  if (/^\s*\[(Reading|Writing|Editing|Running|Searching|Fetching|Checking)/.test(trimmed) ||
      /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)) {
    return { state: 'tool', confidence: 0.85 };
  }

  // Explicit error keywords in tool output context - tightened to reduce false positives
  if (currentState === 'output' || currentState === 'tool') {
    // Exclude false positives first
    const lowerTrimmed = trimmed.toLowerCase();
    const isFalsePositive =
      /error[._-]?(ts|js|log|handler|code|message|type|class)/i.test(trimmed) ||  // filenames/identifiers
      /['"]error['"]/i.test(trimmed) ||                                           // string literals
      /(handle|catch|on|is|has|get|set|throw)Error/i.test(trimmed) ||            // function names
      /errors?:\s*0\b/.test(trimmed) ||                                           // zero count
      /no\s+errors?\b/i.test(lowerTrimmed) ||                                     // "no error(s)"
      /without\s+errors?\b/i.test(lowerTrimmed) ||                                // "without error(s)"
      /error.?free\b/i.test(lowerTrimmed);                                        // "error-free"

    if (!isFalsePositive) {
      // Only explicit error patterns
      if (/^(Error|ERROR|error):/.test(trimmed) ||                  // Error: messages
          /^(fatal|panic|FATAL):/.test(trimmed) ||                  // fatal errors
          /^(SyntaxError|TypeError|ReferenceError|RangeError):/.test(trimmed) ||  // JS errors
          /^npm\s+ERR!/.test(trimmed) ||                            // npm errors
          /^\s*✗\s/.test(trimmed) ||                                // failure marker
          /FAILED\s*$/.test(trimmed)) {                             // trailing FAILED
        return { state: 'error', confidence: 0.85 };
      }
    }
  }

  // Shell continuation - ONLY for actual multi-line commands
  // Must start with pipe, ampersand, semicolon, or end with backslash
  if (currentState === 'user') {
    if (/^[|&;]/.test(trimmed) || /\\$/.test(trimmed)) {
      return { state: 'user', confidence: 0.7 };
    }
    // After user input, content without anchors is likely output or claude response
    // Let it fall through to inherit state, which will transition on next anchor
  }

  // Default: inherit current state with lower confidence
  return { state: currentState, confidence: 0.5 };
}

// Classify entire buffer with state machine
function classifyBuffer(
  getLine: (index: number) => IBufferLine | undefined,
  bufferLength: number
): LineClassification[] {
  const classifications: LineClassification[] = new Array(bufferLength);

  let currentState: ConversationState = 'output';
  let inCodeBlock = false;
  let inDiffContext = false;  // Track whether we're inside a diff block

  // DEBUG: Collect samples for server
  const debugLines: Array<{ idx: number; text: string }> = [];
  for (let i = 0; i < Math.min(100, bufferLength); i++) {
    const line = getLine(i);
    if (line) {
      const text = line.translateToString(true);
      debugLines.push({ idx: i, text: text.substring(0, 120) });
    }
  }
  const debugClassifications: Array<{ idx: number; state: string; conf: number }> = [];

  for (let i = 0; i < bufferLength; i++) {
    const bufferLine = getLine(i);
    if (!bufferLine) {
      classifications[i] = { state: currentState, inCodeBlock, confidence: 0.3 };
      continue;
    }

    const line = bufferLine.translateToString(true);
    const trimmed = line.trim();

    // Empty lines inherit state but may end diff context
    if (trimmed.length === 0) {
      // Multiple empty lines end diff context
      if (inDiffContext && i > 0) {
        const prevLine = getLine(i - 1);
        if (prevLine && prevLine.translateToString(true).trim() === '') {
          inDiffContext = false;
        }
      }
      classifications[i] = { state: currentState, inCodeBlock, confidence: 0.4 };
      continue;
    }

    // Diff context tracking - detect diff headers and Claude Code edit summaries
    if (/^(diff --git|---\s+[ab]\/|@@\s+-\d+)/.test(trimmed) ||
        /^\s*⎿\s+(Added|Removed|Changed)\s+\d+\s+lines?/.test(trimmed)) {
      inDiffContext = true;
    }

    // End diff context on ● (tool/prose marker)
    if (/^●/.test(trimmed)) {
      inDiffContext = false;
    }

    // Diff line classification - only when in diff context
    if (inDiffContext) {
      // Claude Code diff format: "line_num +" or "line_num -" (number followed by +/-)
      // Also handle standard diff format: "+text" or "-text"
      if (/^\s*\d+\s*\+/.test(trimmed) || /^\+[^+]/.test(trimmed) || /^\+$/.test(trimmed)) {
        classifications[i] = { state: 'diff-add', inCodeBlock, confidence: 0.95 };
        currentState = 'diff-add';
        continue;
      }
      if (/^\s*\d+\s*-/.test(trimmed) || /^-[^-]/.test(trimmed)) {
        classifications[i] = { state: 'diff-remove', inCodeBlock, confidence: 0.95 };
        currentState = 'diff-remove';
        continue;
      }
    }

    // Check for anchor (pass currentState for context-aware detection)
    const anchor = detectAnchor(trimmed, currentState);

    if (anchor.type === 'code_fence') {
      inCodeBlock = !inCodeBlock;
      classifications[i] = { state: currentState, inCodeBlock, confidence: 0.9 };
      continue;
    }

    if (anchor.type !== null) {
      // New anchor found - switch state
      currentState = anchor.type;
      classifications[i] = { state: currentState, inCodeBlock, confidence: anchor.confidence };

      // After tool anchor, prepare for output
      if (anchor.type === 'tool') {
        // Tool lines themselves are 'tool', output comes after
      }
      continue;
    }

    // No anchor - classify based on context
    const classification = classifyLine(line, trimmed, currentState);

    // Tool calls are followed by output
    if (currentState === 'tool' && classification.state === 'tool' && classification.confidence < 0.8) {
      // This line is probably tool output, not the tool call itself
      classifications[i] = { state: 'output', inCodeBlock, confidence: 0.6 };
      currentState = 'output';
    } else {
      classifications[i] = { state: classification.state, inCodeBlock, confidence: classification.confidence };
      // Require higher confidence to switch states (was 0.7, now 0.85)
      if (classification.confidence > 0.85) {
        currentState = classification.state;
      }
    }

    // DEBUG: Collect first 100 classifications
    if (i < 100) {
      debugClassifications.push({ idx: i, state: classifications[i].state, conf: classifications[i].confidence });
    }
  }

  // DEBUG: Send to server (once per session)
  const win = window as unknown as { _minimapDebugSent?: boolean };
  if (!win._minimapDebugSent && debugLines.length > 0) {
    win._minimapDebugSent = true;
    fetch('/api/debug/minimap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: debugLines, classifications: debugClassifications })
    }).catch(() => { /* ignore */ });
  }

  return classifications;
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

    // Classify entire buffer using anchor-based state machine
    const classifications = classifyBuffer(
      (i) => buffer.getLine(i),
      bufferLength
    );

    // Render blocks
    const numBlocks = Math.min(containerHeight, 500);
    const blockHeight = containerHeight / numBlocks;
    const linesPerBlock = bufferLength / numBlocks;

    for (let block = 0; block < numBlocks; block++) {
      const y = block * blockHeight;
      const startLine = Math.floor(block * linesPerBlock);
      const endLine = Math.min(Math.ceil((block + 1) * linesPerBlock), bufferLength);

      // Aggregate classifications for this block
      const stateCounts: Record<ConversationState, number> = {
        user: 0, claude: 0, tool: 0, output: 0, error: 0, 'diff-add': 0, 'diff-remove': 0
      };
      let totalConfidence = 0;
      let codeBlockLines = 0;
      let contentLines = 0;
      let totalLen = 0;

      for (let li = startLine; li < endLine; li++) {
        const classification = classifications[li];
        if (!classification) continue;

        const bufferLine = buffer.getLine(li);
        if (bufferLine) {
          const text = bufferLine.translateToString(true).trim();
          if (text.length > 0) {
            contentLines++;
            totalLen += text.length;
          }
        }

        stateCounts[classification.state] += classification.confidence;
        totalConfidence += classification.confidence;
        if (classification.inCodeBlock) codeBlockLines++;
      }

      if (contentLines === 0) continue;

      // Find dominant state (weighted by confidence)
      let dominantState: ConversationState = 'output';
      let maxScore = 0;
      for (const [state, score] of Object.entries(stateCounts)) {
        if (score > maxScore) {
          maxScore = score;
          dominantState = state as ConversationState;
        }
      }

      // Determine if mostly code
      const isCodeBlock = codeBlockLines > (endLine - startLine) / 2;

      // Get color from palette
      const colorInfo = STATE_COLORS[dominantState];
      const color = isCodeBlock ? colorInfo.muted : colorInfo.primary;

      // Calculate intensity based on confidence - subtle range
      const avgConfidence = totalConfidence / Math.max(1, endLine - startLine);
      const intensity = 0.35 + avgConfidence * 0.35;

      // Calculate bar width based on content length
      const avgLen = totalLen / contentLines;
      const lenRatio = Math.min(avgLen / 80, 1);
      const barWidth = 35 + lenRatio * (MINIMAP_WIDTH - 40);
      const barHeight = Math.max(blockHeight, 1.2);

      ctx.globalAlpha = intensity;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.roundRect(2, y, barWidth, barHeight, 1);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
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
  }, [terminal, MINIMAP_WIDTH]);

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
            <span className="legend-dot" style={{ background: '#a855f7' }} data-tooltip="You" />
            <span className="legend-dot" style={{ background: '#0ea5e9' }} data-tooltip="Claude" />
            <span className="legend-dot" style={{ background: '#d97706' }} data-tooltip="Tool" />
            <span className="legend-dot" style={{ background: '#16a34a' }} data-tooltip="+ Add" />
            <span className="legend-dot" style={{ background: '#dc2626' }} data-tooltip="- Del" />
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

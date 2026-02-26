import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { SessionTodos } from '../../../shared/todoProtocol';
import { TodoSection } from './TodoSection';

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 280;
const COLLAPSED_WIDTH = 48;

interface TodoPanelProps {
  expanded: boolean;
  onToggle: () => void;
  sessions: SessionTodos[];
  isLoading?: boolean;
  onWidthChange?: (width: number) => void;
}

function TodoPanelComponent({
  expanded,
  onToggle,
  sessions,
  isLoading = false,
  onWidthChange,
}: TodoPanelProps) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(DEFAULT_WIDTH);

  // Resize drag handling
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = panelWidth;
    },
    [panelWidth]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidthRef.current + delta));
      setPanelWidth(newWidth);
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onWidthChange]);

  // Get total counts across all sessions
  const { totalPending, totalInProgress } = useMemo(() => {
    let pending = 0;
    let inProgress = 0;

    for (const session of sessions) {
      for (const todo of session.todos) {
        if (todo.status === 'pending') pending++;
        else if (todo.status === 'in_progress') inProgress++;
      }
    }

    return { totalPending: pending, totalInProgress: inProgress };
  }, [sessions]);

  // Per-session stats for collapsed progress bars
  const sessionStats = useMemo(() => {
    return sessions.map((session) => {
      let pending = 0;
      let inProgress = 0;
      let completed = 0;
      for (const todo of session.todos) {
        if (todo.status === 'pending') pending++;
        else if (todo.status === 'in_progress') inProgress++;
        else if (todo.status === 'completed') completed++;
      }
      const total = pending + inProgress + completed;
      return {
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        pending,
        inProgress,
        completed,
        total,
        completedPct: total > 0 ? completed / total : 0,
        inProgressPct: total > 0 ? inProgress / total : 0,
        pendingPct: total > 0 ? pending / total : 0,
      };
    });
  }, [sessions]);

  const hasTodos = sessions.length > 0;
  const totalNotCompleted = totalPending + totalInProgress;
  const currentWidth = expanded ? panelWidth : COLLAPSED_WIDTH;

  const handleSessionHover = useCallback((id: string | null) => {
    setHoveredSession(id);
  }, []);

  return (
    <div
      className={`
        h-full flex flex-col
        border-r border-white/[0.06]
        overflow-hidden relative
        ${isDragging ? 'select-none' : 'transition-[width,min-width] duration-200 ease-out'}
      `}
      style={{
        width: `${currentWidth}px`,
        minWidth: `${currentWidth}px`,
        background: 'rgba(10, 10, 15, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div
        className={`
          flex items-center border-b border-white/[0.04]
          ${expanded ? 'justify-between px-3 py-2.5' : 'justify-center py-2.5'}
        `}
      >
        {expanded ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-1 h-4 bg-gradient-to-b from-[#00d4ff] to-[#00d4ff]/20 rounded-full flex-shrink-0" />
              <span className="text-[12px] font-semibold text-[#e0e0e8] uppercase tracking-wider truncate">
                Tasks
              </span>
              {/* Total count badge */}
              {totalNotCompleted > 0 && (
                <span
                  className={`
                    text-[9px] font-bold px-1.5 py-0.5 rounded-full
                    ${
                      totalInProgress > 0
                        ? 'bg-[#00d4ff]/15 text-[#00d4ff]'
                        : 'bg-white/[0.06] text-[#a1a1aa]'
                    }
                  `}
                >
                  {totalNotCompleted}
                </span>
              )}
            </div>
            <button
              onClick={onToggle}
              className="
                flex-shrink-0 p-1.5 rounded-md
                text-[#71717a] hover:text-[#a1a1aa]
                hover:bg-white/[0.04]
                transition-colors duration-150
              "
              title="Collapse panel"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 19l-7-7 7-7M19 19l-7-7 7-7"
                />
              </svg>
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="
              relative flex items-center justify-center
              w-9 h-9 rounded-md
              text-[#71717a] hover:text-[#00d4ff]
              hover:bg-[#00d4ff]/5
              transition-colors duration-150
            "
            title="Expand panel"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {/* Badge for pending count when collapsed */}
            {totalNotCompleted > 0 && (
              <span
                className={`
                  absolute -top-0.5 -right-0.5
                  min-w-[16px] h-[16px]
                  flex items-center justify-center
                  text-[9px] font-bold
                  rounded-full px-1
                  ${
                    totalInProgress > 0
                      ? 'bg-[#00d4ff] text-black shadow-[0_0_8px_rgba(0,212,255,0.5)]'
                      : 'bg-[#71717a] text-white'
                  }
                `}
              >
                {totalNotCompleted > 9 ? '9+' : totalNotCompleted}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center h-full py-8">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin" />
                <span className="text-[11px] text-[#71717a]">Loading...</span>
              </div>
            </div>
          ) : !hasTodos ? (
            <div className="flex flex-col items-center justify-center h-full py-8 px-4">
              <div className="w-10 h-10 rounded-full bg-white/[0.02] flex items-center justify-center mb-3">
                <svg
                  className="w-5 h-5 text-[#4a4a52]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <span className="text-[11px] text-[#71717a] text-center">
                No active tasks
              </span>
              <span className="text-[10px] text-[#4a4a52] text-center mt-1">
                Tasks will appear when Claude is working
              </span>
            </div>
          ) : (
            <div
              className="
                flex-1 overflow-y-auto py-1
                scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/[0.08]
                hover:scrollbar-thumb-white/[0.12]
              "
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255, 255, 255, 0.08) transparent',
              }}
            >
              {sessions.map((session, index) => (
                <TodoSection
                  key={session.sessionId}
                  sessionId={session.sessionId}
                  sessionName={session.sessionName}
                  todos={session.todos}
                  isActive={index === 0}
                  defaultExpanded={index === 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsed state - vertical progress bars per session */}
      {!expanded && hasTodos && (
        <div className="flex-1 flex flex-col items-center pt-3 gap-2.5 px-1.5">
          {sessionStats.map((stat) => (
            <div
              key={stat.sessionId}
              className="relative group"
              onMouseEnter={() => handleSessionHover(stat.sessionId)}
              onMouseLeave={() => handleSessionHover(null)}
            >
              {/* Vertical progress bar */}
              <div className="w-2.5 h-14 rounded-full bg-white/[0.04] overflow-hidden flex flex-col-reverse cursor-pointer">
                {stat.completedPct > 0 && (
                  <div
                    className="w-full bg-[#22c55e]/60 transition-all duration-300"
                    style={{ height: `${stat.completedPct * 100}%` }}
                  />
                )}
                {stat.inProgressPct > 0 && (
                  <div
                    className="w-full bg-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.5)] transition-all duration-300"
                    style={{ height: `${stat.inProgressPct * 100}%` }}
                  />
                )}
                {stat.pendingPct > 0 && (
                  <div
                    className="w-full bg-[#71717a]/40 transition-all duration-300"
                    style={{ height: `${stat.pendingPct * 100}%` }}
                  />
                )}
              </div>

              {/* Tooltip on hover */}
              {hoveredSession === stat.sessionId && (
                <div className="absolute left-full ml-2.5 top-0 z-[9999] px-3 py-2 bg-[#0a0a0f] border border-white/[0.08] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] whitespace-nowrap pointer-events-none">
                  <div className="text-[11px] font-medium text-[#e0e0e8] mb-1.5">
                    {stat.sessionName}
                  </div>
                  <div className="flex items-center gap-3 text-[9px]">
                    {stat.inProgress > 0 && (
                      <span className="flex items-center gap-1 text-[#00d4ff]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] inline-block" />
                        {stat.inProgress} active
                      </span>
                    )}
                    {stat.pending > 0 && (
                      <span className="flex items-center gap-1 text-[#a1a1aa]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#71717a] inline-block" />
                        {stat.pending} pending
                      </span>
                    )}
                    {stat.completed > 0 && (
                      <span className="flex items-center gap-1 text-[#22c55e]/70">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]/60 inline-block" />
                        {stat.completed} done
                      </span>
                    )}
                  </div>
                  {/* Mini progress bar in tooltip */}
                  <div className="mt-1.5 w-full h-1 rounded-full bg-white/[0.04] overflow-hidden flex">
                    {stat.completedPct > 0 && (
                      <div
                        className="h-full bg-[#22c55e]/60"
                        style={{ width: `${stat.completedPct * 100}%` }}
                      />
                    )}
                    {stat.inProgressPct > 0 && (
                      <div
                        className="h-full bg-[#00d4ff]"
                        style={{ width: `${stat.inProgressPct * 100}%` }}
                      />
                    )}
                    {stat.pendingPct > 0 && (
                      <div
                        className="h-full bg-[#71717a]/40"
                        style={{ width: `${stat.pendingPct * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drag handle (only when expanded) */}
      {expanded && (
        <div
          className={`
            absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-20
            transition-colors duration-150
            ${isDragging ? 'bg-[#00d4ff]/30' : 'hover:bg-[#00d4ff]/15'}
          `}
          onMouseDown={handleDragStart}
        />
      )}
    </div>
  );
}

export const TodoPanel = memo(TodoPanelComponent);
export default TodoPanel;

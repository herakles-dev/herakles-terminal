import { memo, useMemo } from 'react';
import type { SessionTodos } from '../../../shared/todoProtocol';
import { TodoSection } from './TodoSection';

interface TodoPanelProps {
  expanded: boolean;
  onToggle: () => void;
  sessions: SessionTodos[];
  isLoading?: boolean;
}

function TodoPanelComponent({
  expanded,
  onToggle,
  sessions,
  isLoading = false,
}: TodoPanelProps) {
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

  // Check if any session has todos
  const hasTodos = sessions.length > 0;
  const totalNotCompleted = totalPending + totalInProgress;

  return (
    <div
      className="
        h-full flex flex-col
        border-r border-white/[0.06]
        transition-[width] duration-200 ease-out
        overflow-hidden
      "
      style={{
        width: expanded ? '280px' : '48px',
        minWidth: expanded ? '280px' : '48px',
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

      {/* Content */}
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
                  isActive={index === 0} // Most recent session is "active"
                  defaultExpanded={index === 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsed state indicator */}
      {!expanded && hasTodos && (
        <div className="flex-1 flex flex-col items-center pt-3 gap-1">
          {totalInProgress > 0 && (
            <div className="w-2 h-2 rounded-full bg-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.5)] animate-pulse" />
          )}
          {totalPending > 0 && (
            <div
              className="w-1.5 h-1.5 rounded-full bg-[#71717a]"
              style={{
                opacity: Math.min(1, 0.3 + totalPending * 0.15),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export const TodoPanel = memo(TodoPanelComponent);
export default TodoPanel;

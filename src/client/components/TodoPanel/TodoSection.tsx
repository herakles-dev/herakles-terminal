import { memo, useState, useMemo, useCallback } from 'react';
import type { TodoItem as TodoItemType } from '../../../shared/todoProtocol';
import { TodoItem } from './TodoItem';

interface TodoSectionProps {
  sessionId: string;
  sessionName: string;
  todos: TodoItemType[];
  isActive: boolean;
  defaultExpanded?: boolean;
}

function TodoSectionComponent({
  sessionId,
  sessionName,
  todos,
  isActive,
  defaultExpanded = false,
}: TodoSectionProps) {
  const [sectionExpanded, setSectionExpanded] = useState(defaultExpanded);
  const [showAllTodos, setShowAllTodos] = useState(false);

  // Sort todos: in_progress first, then pending, then completed
  const sortedTodos = useMemo(() => {
    const statusOrder = {
      in_progress: 0,
      pending: 1,
      completed: 2,
    };

    return [...todos].sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      return b.updatedAt - a.updatedAt;
    });
  }, [todos]);

  // Smart filtering: show in-progress, next 2 pending, most recent completed
  const { visibleTodos, hiddenCount } = useMemo(() => {
    if (showAllTodos) {
      return { visibleTodos: sortedTodos, hiddenCount: 0 };
    }

    const inProgress = sortedTodos.filter((t) => t.status === 'in_progress');
    const pending = sortedTodos.filter((t) => t.status === 'pending');
    const completed = sortedTodos.filter((t) => t.status === 'completed');

    const visible: TodoItemType[] = [
      ...inProgress,
      ...pending.slice(0, 2),
      ...completed.slice(0, 1),
    ];

    const totalHidden = sortedTodos.length - visible.length;

    return { visibleTodos: visible, hiddenCount: totalHidden };
  }, [sortedTodos, showAllTodos]);

  // Count stats
  const { inProgressCount, pendingCount, completedCount } = useMemo(() => {
    let ip = 0;
    let pend = 0;
    let comp = 0;
    for (const t of todos) {
      if (t.status === 'in_progress') ip++;
      else if (t.status === 'pending') pend++;
      else if (t.status === 'completed') comp++;
    }
    return {
      inProgressCount: ip,
      pendingCount: pend,
      completedCount: comp,
    };
  }, [todos]);

  const handleHeaderClick = useCallback(() => {
    setSectionExpanded((prev) => !prev);
    if (sectionExpanded) {
      setShowAllTodos(false);
    }
  }, [sectionExpanded]);

  const handleShowMore = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAllTodos(true);
  }, []);

  const handleShowLess = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAllTodos(false);
  }, []);

  if (todos.length === 0) return null;

  return (
    <div
      className={`
        border-l-2 transition-colors duration-200
        ${isActive ? 'border-[#00d4ff]' : 'border-transparent hover:border-white/10'}
      `}
      data-session-id={sessionId}
    >
      {/* Section Header */}
      <button
        onClick={handleHeaderClick}
        className={`
          w-full flex flex-col gap-1.5 px-3 py-2.5
          transition-all duration-150 text-left
          ${isActive ? 'bg-[#00d4ff]/[0.04]' : 'hover:bg-white/[0.02]'}
        `}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            {/* Expand/collapse chevron */}
            <svg
              className={`
                w-3 h-3 text-[#71717a] transition-transform duration-150 flex-shrink-0
                ${sectionExpanded ? 'rotate-90' : ''}
              `}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>

            {/* Session name - larger heading */}
            <span
              className={`
                text-[13px] font-semibold truncate
                ${isActive ? 'text-[#00d4ff]' : 'text-[#d4d4d8]'}
              `}
            >
              {sessionName}
            </span>

            {/* Active indicator dot */}
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.5)] flex-shrink-0" />
            )}
          </div>

          {/* Stats badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {inProgressCount > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-[#00d4ff]">
                <span className="drop-shadow-[0_0_3px_rgba(0,212,255,0.5)] animate-pulse">
                  ●
                </span>
                {inProgressCount}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-[#a1a1aa]">
                <span>○</span>
                {pendingCount}
              </span>
            )}
            {completedCount > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-[#22c55e]/60">
                <span>✓</span>
                {completedCount}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar under header */}
        <div className="w-full h-1 rounded-full bg-white/[0.04] overflow-hidden flex">
          {completedCount > 0 && (
            <div
              className="h-full bg-[#22c55e]/50 transition-all duration-500"
              style={{ width: `${(completedCount / todos.length) * 100}%` }}
            />
          )}
          {inProgressCount > 0 && (
            <div
              className="h-full bg-[#00d4ff]/70 transition-all duration-500"
              style={{ width: `${(inProgressCount / todos.length) * 100}%` }}
            />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {sectionExpanded && (
        <div className="pb-1.5 space-y-0.5">
          {visibleTodos.map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}

          {/* Show more/less button */}
          {hiddenCount > 0 && (
            <button
              onClick={handleShowMore}
              className="
                w-full flex items-center justify-center gap-1.5
                py-1.5 mt-0.5
                text-[10px] text-[#71717a] hover:text-[#a1a1aa]
                hover:bg-white/[0.02]
                transition-colors duration-150
              "
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span>+{hiddenCount} more</span>
            </button>
          )}

          {showAllTodos && sortedTodos.length > 4 && (
            <button
              onClick={handleShowLess}
              className="
                w-full flex items-center justify-center gap-1.5
                py-1.5 mt-0.5
                text-[10px] text-[#71717a] hover:text-[#a1a1aa]
                hover:bg-white/[0.02]
                transition-colors duration-150
              "
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              <span>Show less</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const TodoSection = memo(TodoSectionComponent);
export default TodoSection;

import { memo, useMemo } from 'react';
import type { TodoItem as TodoItemType } from '../../../shared/todoProtocol';
import { TodoItem } from './TodoItem';

interface TodoListProps {
  todos: TodoItemType[];
  isLoading?: boolean;
}

function TodoListComponent({ todos, isLoading = false }: TodoListProps) {
  // Sort todos: in_progress first, then pending, then completed at bottom
  const sortedTodos = useMemo(() => {
    const statusOrder = {
      in_progress: 0,
      pending: 1,
      completed: 2,
    };

    return [...todos].sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      // Within same status, sort by updatedAt (most recent first)
      return b.updatedAt - a.updatedAt;
    });
  }, [todos]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-8">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin" />
          <span className="text-[11px] text-[#71717a]">Loading...</span>
        </div>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
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
    );
  }

  return (
    <div
      className="
        h-full overflow-y-auto
        scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/[0.08]
        hover:scrollbar-thumb-white/[0.12]
      "
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.08) transparent',
      }}
    >
      <div className="py-2 space-y-0.5">
        {sortedTodos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} />
        ))}
      </div>
    </div>
  );
}

export const TodoList = memo(TodoListComponent);
export default TodoList;

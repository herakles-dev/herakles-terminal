import { memo } from 'react';
import type { TodoItem as TodoItemType } from '../../../shared/todoProtocol';

interface TodoItemProps {
  todo: TodoItemType;
}

function TodoItemComponent({ todo }: TodoItemProps) {
  const { status, content, activeForm, subject, description, owner, blocks, blockedBy, metadata } = todo;

  // Status indicator configuration
  const statusConfig = {
    pending: {
      icon: (
        <span className="text-[#a1a1aa] text-[11px]">○</span>
      ),
      textClass: 'text-[#a1a1aa]',
    },
    in_progress: {
      icon: (
        <span className="text-[#00d4ff] text-[11px] drop-shadow-[0_0_4px_rgba(0,212,255,0.6)]">●</span>
      ),
      textClass: 'text-[#e0e0e8]',
    },
    completed: {
      icon: (
        <span className="text-[#22c55e] text-[11px] opacity-60">✓</span>
      ),
      textClass: 'text-[#a1a1aa] opacity-60 line-through',
    },
  };

  const config = statusConfig[status];
  // Prefer subject over content if available (new format)
  const displayText = status === 'in_progress' ? activeForm : (subject || content);

  // Check for new format features
  const hasBlockedBy = blockedBy && blockedBy.length > 0;
  const hasBlocks = blocks && blocks.length > 0;
  const hasOwner = Boolean(owner);
  const hasPriority = metadata && 'priority' in metadata;

  return (
    <div
      className={`
        group flex flex-col gap-1 px-3 py-2 rounded-md
        transition-all duration-150
        hover:bg-white/[0.02]
        ${status === 'completed' ? 'opacity-60' : ''}
      `}
    >
      {/* Main content */}
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 w-4 h-5 flex items-center justify-center mt-0.5">
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <span
            className={`
              text-[11px] leading-[1.35]
              ${config.textClass}
              ${status === 'in_progress' ? 'font-medium' : ''}
            `}
          >
            {displayText}
          </span>

          {/* Description tooltip on hover (if present) */}
          {description && description !== displayText && (
            <div
              className="hidden group-hover:block mt-1 text-[9px] text-[#71717a] italic"
              title={description}
            >
              {description.length > 80 ? `${description.slice(0, 80)}...` : description}
            </div>
          )}
        </div>
      </div>

      {/* Extended fields (Claude Code 2.1.16+ format) */}
      {(hasBlockedBy || hasBlocks || hasOwner || hasPriority) && (
        <div className="flex items-center gap-2 ml-6 flex-wrap">
          {/* Blocked by indicator */}
          {hasBlockedBy && (
            <div className="flex items-center gap-1 text-[9px] text-yellow-500/80">
              <svg
                className="w-2.5 h-2.5 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1zm2 6V4.5a2 2 0 1 0-4 0V7h4z"/>
              </svg>
              <span className="opacity-80">Blocked by {blockedBy.length}</span>
            </div>
          )}

          {/* Blocks indicator */}
          {hasBlocks && (
            <div className="flex items-center gap-1 text-[9px] text-cyan-500/80">
              <svg
                className="w-2.5 h-2.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 16 16"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.5L8 10l7-7" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 8l2 2 4-4" />
              </svg>
              <span className="opacity-80">Blocks {blocks.length}</span>
            </div>
          )}

          {/* Owner badge */}
          {hasOwner && owner && (
            <div className="flex items-center gap-1 text-[9px] text-[#a1a1aa]">
              <svg
                className="w-2.5 h-2.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 16 16"
                strokeWidth={1.5}
              >
                <circle cx="8" cy="5" r="2.5" />
                <path strokeLinecap="round" d="M3 13c0-2.5 2-4 5-4s5 1.5 5 4" />
              </svg>
              <span className="opacity-70 truncate max-w-[100px]" title={owner}>
                {owner.split('-')[1] || owner}
              </span>
            </div>
          )}

          {/* Priority badge */}
          {hasPriority && (
            <div
              className={`
                flex items-center gap-1 px-1.5 py-0.5 rounded
                text-[8px] font-medium uppercase tracking-wide
                ${
                  metadata.priority === 'high'
                    ? 'bg-red-500/10 text-red-400/90'
                    : metadata.priority === 'medium'
                    ? 'bg-yellow-500/10 text-yellow-400/90'
                    : 'bg-blue-500/10 text-blue-400/90'
                }
              `}
            >
              <span>⚡</span>
              <span>{String(metadata.priority)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const TodoItem = memo(TodoItemComponent);
export default TodoItem;

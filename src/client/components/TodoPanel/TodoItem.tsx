import { memo } from 'react';
import type { TodoItem as TodoItemType } from '../../../shared/todoProtocol';

interface TodoItemProps {
  todo: TodoItemType;
}

// Metadata chip color mapping
const CHIP_COLORS: Record<string, string> = {
  sprint: 'bg-[#8b5cf6]/15 text-[#a78bfa] border-[#8b5cf6]/20',
  gate: 'bg-[#f97316]/15 text-[#fb923c] border-[#f97316]/20',
  phase: 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/20',
  wave: 'bg-[#06b6d4]/15 text-[#22d3ee] border-[#06b6d4]/20',
};

function TodoItemComponent({ todo }: TodoItemProps) {
  const { status, content, activeForm, subject, description, owner, blocks, blockedBy, metadata } = todo;

  // Prefer subject over content if available (new format)
  const displayText = status === 'in_progress' ? activeForm : (subject || content);

  // Check for extended format features
  const hasBlockedBy = blockedBy && blockedBy.length > 0;
  const hasBlocks = blocks && blocks.length > 0;
  const hasOwner = Boolean(owner);

  // Extract metadata chips (sprint, gate, phase, wave, priority)
  const metadataChips: { key: string; value: string; colorClass: string }[] = [];
  if (metadata) {
    for (const key of ['sprint', 'gate', 'phase', 'wave']) {
      if (key in metadata && metadata[key] != null) {
        metadataChips.push({
          key,
          value: String(metadata[key]),
          colorClass: CHIP_COLORS[key] || 'bg-white/[0.06] text-[#a1a1aa] border-white/[0.08]',
        });
      }
    }
  }
  const hasPriority = metadata && 'priority' in metadata;

  return (
    <div
      className={`
        group flex flex-col gap-1.5 px-3 py-2.5 rounded-md
        transition-all duration-150
        hover:bg-white/[0.02]
        ${status === 'completed' ? 'opacity-50' : ''}
      `}
    >
      {/* Main content row */}
      <div className="flex items-start gap-2.5">
        {/* Status badge */}
        <div className="flex-shrink-0 mt-0.5">
          {status === 'pending' && (
            <div className="w-4 h-4 rounded-full border border-[#71717a]/50 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-[#71717a]/40" />
            </div>
          )}
          {status === 'in_progress' && (
            <div className="w-4 h-4 rounded-full border border-[#00d4ff]/60 flex items-center justify-center shadow-[0_0_8px_rgba(0,212,255,0.3)] animate-pulse">
              <div className="w-2 h-2 rounded-full bg-[#00d4ff]" />
            </div>
          )}
          {status === 'completed' && (
            <div className="w-4 h-4 rounded-full bg-[#22c55e]/20 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <span
            className={`
              text-[11px] leading-[1.4] block
              ${status === 'completed' ? 'text-[#a1a1aa] line-through' : ''}
              ${status === 'in_progress' ? 'text-[#e0e0e8] font-medium' : ''}
              ${status === 'pending' ? 'text-[#a1a1aa]' : ''}
            `}
          >
            {displayText}
          </span>

          {/* Description on hover */}
          {description && description !== displayText && (
            <div
              className="hidden group-hover:block mt-1 text-[9px] text-[#71717a] italic leading-relaxed"
              title={description}
            >
              {description.length > 100 ? `${description.slice(0, 100)}...` : description}
            </div>
          )}
        </div>
      </div>

      {/* Metadata chips row */}
      {metadataChips.length > 0 && (
        <div className="flex items-center gap-1.5 ml-6 flex-wrap">
          {metadataChips.map((chip) => (
            <span
              key={chip.key}
              className={`
                inline-flex items-center gap-1 px-1.5 py-0.5
                text-[8px] font-medium uppercase tracking-wider
                rounded border
                ${chip.colorClass}
              `}
            >
              {chip.key}:{chip.value}
            </span>
          ))}
        </div>
      )}

      {/* Extended fields (blocked, owner, priority) */}
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
                <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1zm2 6V4.5a2 2 0 1 0-4 0V7h4z" />
              </svg>
              <span className="opacity-80">Blocked by {blockedBy!.length}</span>
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
              <span className="opacity-80">Blocks {blocks!.length}</span>
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
                flex items-center gap-1 px-1.5 py-0.5 rounded border
                text-[8px] font-medium uppercase tracking-wide
                ${
                  metadata!.priority === 'high'
                    ? 'bg-red-500/10 text-red-400/90 border-red-500/20'
                    : metadata!.priority === 'medium'
                    ? 'bg-yellow-500/10 text-yellow-400/90 border-yellow-500/20'
                    : 'bg-blue-500/10 text-blue-400/90 border-blue-500/20'
                }
              `}
            >
              <span>P:{String(metadata!.priority)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const TodoItem = memo(TodoItemComponent);
export default TodoItem;

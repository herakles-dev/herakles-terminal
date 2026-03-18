/**
 * WindowGrid - CSS Grid-based layout container for terminal windows
 *
 * Replaces SplitView's absolute positioning + CSS transitions with
 * CSS Grid + ResizeObserver for zero-transition, glitch-free resizing.
 *
 * Key design:
 * - Grid template updated via DOM ref during drag (zero React re-renders)
 * - ResizeObserver on each pane triggers fitAddon.fit() — single resize path
 * - CSS containment (`contain: strict`) isolates each pane
 * - No CSS transitions on terminal containers — ever
 */

import React, {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from 'react';
import {
  fractionsToGrid,
  updateColumnFraction,
  updateRowFraction,
  fractionsToTemplate,
  syncFractionsFromGrid,
  HANDLE_SIZE_PX,
  type GridLayout,
} from './gridLayout';

export type WindowType = 'terminal' | 'media' | 'agent';

export interface GridWindowConfig {
  id: string;
  name: string;
  type: WindowType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMain: boolean;
  isMinimized: boolean;
}

interface GridWindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowGridProps {
  windows: GridWindowConfig[];
  activeWindowId: string | null;
  zoomedWindowId?: string | null;
  onWindowFocus: (id: string) => void;
  onWindowClose: (id: string) => void;
  onWindowMinimize: (id: string) => void;
  onWindowRestore: (id: string) => void;
  onWindowZoom?: (id: string) => void;
  onLayoutChange: (id: string, layout: GridWindowLayout, isDragging?: boolean, skipResize?: boolean) => void;
  onAddWindow: () => void;
  renderWindow: (id: string, type: WindowType) => React.ReactNode;
  renderTitleBar: (id: string, config: GridWindowConfig) => React.ReactNode;
  className?: string;
}

export const WindowGrid: React.FC<WindowGridProps> = ({
  windows,
  activeWindowId,
  zoomedWindowId,
  onWindowFocus,
  onLayoutChange,
  onAddWindow,
  renderWindow,
  renderTitleBar,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const windowDragRef = useRef<{
    sourceId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const dragStateRef = useRef<{
    type: 'vertical' | 'horizontal';
    handleIndex: number;
    startPos: number;
    layout: GridLayout;
  } | null>(null);

  // Compute grid layout from fractional coordinates
  const visibleWindows = useMemo(
    () => windows.filter(w => !w.isMinimized),
    [windows]
  );

  // When zoomed, only show the zoomed window filling the entire grid
  const effectiveWindows = useMemo(() => {
    if (zoomedWindowId) {
      const zoomed = visibleWindows.find(w => w.id === zoomedWindowId);
      if (zoomed) return [zoomed];
    }
    return visibleWindows;
  }, [visibleWindows, zoomedWindowId]);

  const gridLayout = useMemo(() => {
    return fractionsToGrid(
      effectiveWindows.map(w => ({
        id: w.id,
        type: w.type,
        x: zoomedWindowId ? 0 : w.x,
        y: zoomedWindowId ? 0 : w.y,
        width: zoomedWindowId ? 1 : w.width,
        height: zoomedWindowId ? 1 : w.height,
      }))
    );
  }, [effectiveWindows, zoomedWindowId]);

  // Apply grid template to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.gridTemplateColumns = gridLayout.columns;
    el.style.gridTemplateRows = gridLayout.rows;
    el.style.gridTemplateAreas = gridLayout.areas.join(' ');
  }, [gridLayout]);

  // Drag handle mouse down
  const handleDragStart = useCallback((
    e: React.MouseEvent,
    type: 'vertical' | 'horizontal',
    handleIndex: number
  ) => {
    e.preventDefault();
    setIsDragging(true);
    dragStateRef.current = {
      type,
      handleIndex,
      startPos: type === 'vertical' ? e.clientX : e.clientY,
      layout: gridLayout,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const delta = state.type === 'vertical'
        ? moveEvent.clientX - state.startPos
        : moveEvent.clientY - state.startPos;

      // Update grid-template directly via DOM ref — NO React state update
      if (state.type === 'vertical') {
        const newFractions = updateColumnFraction(
          state.layout.columnFractions,
          state.handleIndex,
          delta,
          rect.width
        );
        container.style.gridTemplateColumns = fractionsToTemplate(newFractions);
      } else {
        const newFractions = updateRowFraction(
          state.layout.rowFractions,
          state.handleIndex,
          delta,
          rect.height
        );
        container.style.gridTemplateRows = fractionsToTemplate(newFractions);
      }
      // ResizeObserver fires on affected panes → fit() → done
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      const state = dragStateRef.current;
      if (!state) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const delta = state.type === 'vertical'
        ? upEvent.clientX - state.startPos
        : upEvent.clientY - state.startPos;

      // Compute final layout
      let newLayout: GridLayout;
      if (state.type === 'vertical') {
        const newFractions = updateColumnFraction(
          state.layout.columnFractions,
          state.handleIndex,
          delta,
          rect.width
        );
        newLayout = syncFractionsFromGrid(state.layout, newFractions, state.layout.rowFractions);
      } else {
        const newFractions = updateRowFraction(
          state.layout.rowFractions,
          state.handleIndex,
          delta,
          rect.height
        );
        newLayout = syncFractionsFromGrid(state.layout, state.layout.columnFractions, newFractions);
      }

      // Commit final fractional coords to React state + server
      for (const [id, pane] of newLayout.panes) {
        onLayoutChange(id, pane.fraction, false, true);
      }

      dragStateRef.current = null;
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [gridLayout, onLayoutChange]);

  // Build handle elements between panes
  const handles = useMemo(() => {
    const result: React.ReactNode[] = [];

    // Vertical handles (between columns) — span full column via named area
    for (let i = 0; i < gridLayout.columnFractions.length - 1; i++) {
      const areaName = `hv-${i}`;
      result.push(
        <div
          key={`vh-${i}`}
          className="grid-handle grid-handle-vertical"
          style={{
            gridArea: areaName,
            cursor: 'col-resize',
            width: `${HANDLE_SIZE_PX}px`,
            minHeight: 0,
            zIndex: 10,
          }}
          onMouseDown={(e) => handleDragStart(e, 'vertical', i)}
        >
          <div className="grid-handle-indicator" />
        </div>
      );
    }

    // Horizontal handles — one element per cell (unique area names for CSS rectangularity)
    for (const cell of gridLayout.horizontalHandleCells) {
      result.push(
        <div
          key={cell.areaName}
          className="grid-handle grid-handle-horizontal"
          style={{
            gridArea: cell.areaName,
            cursor: 'row-resize',
            height: `${HANDLE_SIZE_PX}px`,
            minWidth: 0,
            zIndex: 10,
          }}
          onMouseDown={(e) => handleDragStart(e, 'horizontal', cell.handleIndex)}
        >
          <div className="grid-handle-indicator" />
        </div>
      );
    }

    return result;
  }, [gridLayout, handleDragStart]);

  // Window swap: drag a title bar to swap positions with another window
  const handleWindowDragStart = useCallback((e: React.MouseEvent, sourceId: string) => {
    // Only start drag on left click
    if (e.button !== 0) return;
    e.preventDefault();

    windowDragRef.current = {
      sourceId,
      startX: e.clientX,
      startY: e.clientY,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const state = windowDragRef.current;
      if (!state) return;

      // Only activate after 10px movement (prevent accidental drag)
      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

      setIsDragging(true);

      // Find which pane the cursor is over
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const paneEl = el?.closest('[data-grid-pane-id]') as HTMLElement | null;
      const targetId = paneEl?.dataset.gridPaneId || null;

      if (targetId && targetId !== state.sourceId) {
        setSwapTargetId(targetId);
      } else {
        setSwapTargetId(null);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      const state = windowDragRef.current;
      if (state && swapTargetId && swapTargetId !== state.sourceId) {
        // Swap the two windows' fractional positions
        const sourceWin = windows.find(w => w.id === state.sourceId);
        const targetWin = windows.find(w => w.id === swapTargetId);
        if (sourceWin && targetWin) {
          onLayoutChange(state.sourceId, {
            x: targetWin.x, y: targetWin.y,
            width: targetWin.width, height: targetWin.height,
          }, false, true);
          onLayoutChange(swapTargetId, {
            x: sourceWin.x, y: sourceWin.y,
            width: sourceWin.width, height: sourceWin.height,
          }, false, true);
        }
      }

      windowDragRef.current = null;
      setSwapTargetId(null);
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [windows, swapTargetId, onLayoutChange]);

  return (
    <div
      ref={containerRef}
      className={`window-grid ${isDragging ? 'window-grid--dragging' : ''} ${className || ''}`}
      style={{
        display: 'grid',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        gap: 0,
      }}
    >
      {/* Render panes */}
      {effectiveWindows.map(w => {
        const pane = gridLayout.panes.get(w.id);
        if (!pane) return null;

        return (
          <div
            key={w.id}
            className={`grid-pane ${activeWindowId === w.id ? 'grid-pane--active' : ''} ${swapTargetId === w.id ? 'grid-pane--swap-target' : ''}`}
            style={{
              gridArea: pane.gridArea,
              contain: 'strict',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              position: 'relative',
              outline: swapTargetId === w.id ? '2px solid #00d4ff' : 'none',
              outlineOffset: '-2px',
            }}
            data-grid-pane-id={w.id}
            onClick={() => onWindowFocus(w.id)}
          >
            <div onMouseDown={(e) => handleWindowDragStart(e, w.id)} style={{ cursor: 'grab' }}>
              {renderTitleBar(w.id, w)}
            </div>
            <div
              className="grid-pane-content"
              style={{
                flex: 1,
                overflow: 'hidden',
                contain: 'strict',
                minHeight: 0,
              }}
            >
              {renderWindow(w.id, w.type)}
            </div>
          </div>
        );
      })}

      {/* Render handles (hidden when zoomed) */}
      {!zoomedWindowId && handles}

      {/* Add window button */}
      {effectiveWindows.length === 1 && (
        <button
          onClick={onAddWindow}
          className="absolute bottom-2 right-2 flex items-center gap-1 px-4 py-2.5 bg-[#18181b]/90 backdrop-blur-sm border border-[#27272a] rounded-lg text-[#a1a1aa] hover:text-[#00d4ff] hover:border-[#00d4ff]/50 transition-colors shadow-lg"
          style={{ zIndex: 1000 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-sm">New</span>
        </button>
      )}
    </div>
  );
};

export default WindowGrid;

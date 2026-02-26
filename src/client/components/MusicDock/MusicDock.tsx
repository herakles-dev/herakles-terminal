import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { MusicDockState, DockPosition, MusicPlayerState } from '../../../shared/musicProtocol';
import { MusicPlayer } from '../MusicPlayer';

const SNAP_THRESHOLD = 80; // px from corner to trigger snap
const DOCK_MARGIN = 16; // px margin from edges when docked
const COLLAPSED_WIDTH = 48;
const COLLAPSED_HEIGHT = 48;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;

interface SnapZone {
  position: DockPosition;
  x: number;
  y: number;
  active: boolean;
}

export interface MusicDockProps {
  dockState: MusicDockState;
  onDockStateChange: (state: MusicDockState) => void;
  musicPlayerState: Partial<MusicPlayerState>;
  musicPlayerVisible: boolean;
  onMusicPlayerStateChange: (state: MusicPlayerState) => void;
  onMusicPlayerSync: (state: Partial<MusicPlayerState>) => void;
}

function MusicDockComponent({
  dockState,
  onDockStateChange,
  musicPlayerState,
  musicPlayerVisible,
  onMusicPlayerStateChange,
  onMusicPlayerSync,
}: MusicDockProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [snapZones, setSnapZones] = useState<SnapZone[]>([]);
  const [activeSnap, setActiveSnap] = useState<DockPosition | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDir, setResizeDir] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const { position, size, collapsed } = dockState;

  // Calculate docked position from DockPosition
  const getDockedCoords = useCallback(
    (pos: DockPosition, w: number, h: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      switch (pos) {
        case 'bottom-right':
          return { x: vw - w - DOCK_MARGIN, y: vh - h - DOCK_MARGIN };
        case 'bottom-left':
          return { x: DOCK_MARGIN, y: vh - h - DOCK_MARGIN };
        case 'top-right':
          return { x: vw - w - DOCK_MARGIN, y: DOCK_MARGIN + 44 }; // 44px for toolbar
        case 'top-left':
          return { x: DOCK_MARGIN, y: DOCK_MARGIN + 44 };
        case 'floating':
        default:
          return { x: dragPos.x, y: dragPos.y };
      }
    },
    [dragPos]
  );

  // Compute snap zones based on window size
  const computeSnapZones = useCallback((): SnapZone[] => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return [
      { position: 'top-left', x: 0, y: 0, active: false },
      { position: 'top-right', x: vw, y: 0, active: false },
      { position: 'bottom-left', x: 0, y: vh, active: false },
      { position: 'bottom-right', x: vw, y: vh, active: false },
    ];
  }, []);

  // Detect which snap zone the drag point is closest to
  const detectSnap = useCallback(
    (x: number, y: number): DockPosition | null => {
      const zones = computeSnapZones();
      for (const zone of zones) {
        const dist = Math.sqrt((x - zone.x) ** 2 + (y - zone.y) ** 2);
        if (dist < SNAP_THRESHOLD * 2.5) {
          return zone.position;
        }
      }
      return null;
    },
    [computeSnapZones]
  );

  // Drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, .music-player-controls, .music-player-search')) {
        return;
      }
      e.preventDefault();
      const w = collapsed ? COLLAPSED_WIDTH : size.width;
      const h = collapsed ? COLLAPSED_HEIGHT : size.height;
      const coords = position === 'floating' ? dragPos : getDockedCoords(position, w, h);
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startX: coords.x,
        startY: coords.y,
      };
      setDragPos(coords);
      setSnapZones(computeSnapZones());
    },
    [collapsed, size, position, dragPos, getDockedCoords, computeSnapZones]
  );

  // Drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const newX = dragStartRef.current.startX + dx;
      const newY = dragStartRef.current.startY + dy;
      setDragPos({ x: newX, y: newY });

      // Check snap zones
      const snap = detectSnap(e.clientX, e.clientY);
      setActiveSnap(snap);
      setSnapZones((prev) =>
        prev.map((z) => ({ ...z, active: z.position === snap }))
      );
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setSnapZones([]);

      if (activeSnap) {
        // Snap to dock position
        onDockStateChange({ ...dockState, position: activeSnap });
      } else {
        // Stay floating
        onDockStateChange({ ...dockState, position: 'floating' });
      }
      setActiveSnap(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, activeSnap, dockState, onDockStateChange, detectSnap]);

  // Resize handling
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeDir(direction);
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        w: size.width,
        h: size.height,
      };
    },
    [size]
  );

  useEffect(() => {
    if (!isResizing || !resizeDir) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartRef.current.x;
      const dy = e.clientY - resizeStartRef.current.y;
      let newW = resizeStartRef.current.w;
      let newH = resizeStartRef.current.h;

      if (resizeDir.includes('e')) newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.w + dx));
      if (resizeDir.includes('w')) newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.w - dx));
      if (resizeDir.includes('s')) newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartRef.current.h + dy));
      if (resizeDir.includes('n')) newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartRef.current.h - dy));

      onDockStateChange({ ...dockState, size: { width: newW, height: newH } });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDir(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeDir, dockState, onDockStateChange]);

  // Toggle collapsed
  const handleToggleCollapse = useCallback(() => {
    onDockStateChange({ ...dockState, collapsed: !collapsed });
  }, [dockState, collapsed, onDockStateChange]);

  // Compute current coordinates
  const w = collapsed ? COLLAPSED_WIDTH : size.width;
  const h = collapsed ? COLLAPSED_HEIGHT : size.height;
  const coords =
    isDragging || position === 'floating'
      ? dragPos
      : getDockedCoords(position, w, h);

  if (!musicPlayerVisible) return null;

  return (
    <>
      {/* Snap zone indicators (visible during drag) */}
      {isDragging && (
        <div className="fixed inset-0 z-[89] pointer-events-none">
          {snapZones.map((zone) => {
            const isCorner = zone.position;
            const cornerClasses: Record<string, string> = {
              'top-left': 'top-0 left-0 rounded-br-2xl',
              'top-right': 'top-0 right-0 rounded-bl-2xl',
              'bottom-left': 'bottom-0 left-0 rounded-tr-2xl',
              'bottom-right': 'bottom-0 right-0 rounded-tl-2xl',
            };
            return (
              <div
                key={isCorner}
                className={`
                  absolute w-24 h-24
                  ${cornerClasses[isCorner] || ''}
                  transition-all duration-200
                  ${
                    zone.active
                      ? 'bg-[#00d4ff]/20 border-2 border-[#00d4ff]/50 shadow-[0_0_30px_rgba(0,212,255,0.3)]'
                      : 'bg-white/[0.03] border border-white/[0.06]'
                  }
                `}
              >
                {zone.active && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-[#00d4ff] shadow-[0_0_12px_rgba(0,212,255,0.6)] animate-pulse" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dock container */}
      <div
        ref={containerRef}
        className={`
          fixed z-[90]
          ${isDragging ? 'select-none' : 'transition-all duration-300 ease-out'}
          ${isResizing ? 'select-none !transition-none' : ''}
        `}
        style={{
          left: coords.x,
          top: coords.y,
          width: w,
          height: collapsed ? COLLAPSED_HEIGHT : undefined,
        }}
      >
        {collapsed ? (
          /* Collapsed pill */
          <div
            className="
              w-12 h-12 rounded-full cursor-grab
              bg-gradient-to-br from-[#0c0c14] to-[#111118]
              border border-white/[0.08]
              shadow-[0_4px_20px_rgba(0,0,0,0.5)]
              flex items-center justify-center
              hover:border-[#00d4ff]/30 hover:shadow-[0_0_20px_rgba(0,212,255,0.15)]
              transition-all duration-200
              group
            "
            onMouseDown={handleDragStart}
            onDoubleClick={handleToggleCollapse}
            title="Double-click to expand | Drag to reposition"
          >
            <svg
              className="w-5 h-5 text-[#00d4ff] group-hover:scale-110 transition-transform"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            {musicPlayerState.isPlaying && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
            )}
          </div>
        ) : (
          /* Expanded dock */
          <div
            className={`
              rounded-xl overflow-hidden
              bg-gradient-to-b from-[#0c0c14] to-[#08080e]
              border border-white/[0.08]
              shadow-[0_8px_40px_rgba(0,0,0,0.6)]
              ${isDragging ? 'opacity-90 scale-[0.98]' : ''}
              transition-all duration-200
            `}
            style={{ width: size.width, height: size.height }}
          >
            {/* Dock header (drag handle + controls) */}
            <div
              className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.04] cursor-grab active:cursor-grabbing"
              onMouseDown={handleDragStart}
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Drag grip */}
                <div className="flex flex-col gap-0.5 opacity-40">
                  <div className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-current" />
                    <span className="w-1 h-1 rounded-full bg-current" />
                  </div>
                  <div className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-current" />
                    <span className="w-1 h-1 rounded-full bg-current" />
                  </div>
                </div>
                <span className="text-[10px] text-[#71717a] font-medium truncate uppercase tracking-wider">
                  {musicPlayerState.videoTitle || 'Music'}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {/* Dock position indicator */}
                {position !== 'floating' && (
                  <span className="text-[8px] text-[#52525b] font-mono px-1">
                    {position}
                  </span>
                )}
                {/* Collapse button */}
                <button
                  onClick={handleToggleCollapse}
                  className="p-1 rounded text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04] transition-colors"
                  title="Collapse"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Music player content area */}
            <div className="flex-1 overflow-hidden" style={{ height: size.height - 36 }}>
              <MusicPlayer
                initialState={{
                  ...musicPlayerState,
                  mode: musicPlayerVisible
                    ? musicPlayerState.mode === 'hidden'
                      ? 'audio'
                      : musicPlayerState.mode
                    : 'hidden',
                }}
                onStateChange={onMusicPlayerStateChange}
                onSync={onMusicPlayerSync}
              />
            </div>

            {/* Resize handles (8 directions) */}
            {!isDragging && (
              <>
                {/* Edges */}
                <div className="absolute top-0 left-2 right-2 h-1 cursor-n-resize" onMouseDown={(e) => handleResizeStart(e, 'n')} />
                <div className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize" onMouseDown={(e) => handleResizeStart(e, 's')} />
                <div className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize" onMouseDown={(e) => handleResizeStart(e, 'w')} />
                <div className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize" onMouseDown={(e) => handleResizeStart(e, 'e')} />
                {/* Corners */}
                <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
                <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
                <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
                <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" onMouseDown={(e) => handleResizeStart(e, 'se')} />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export const MusicDock = memo(MusicDockComponent);
export default MusicDock;

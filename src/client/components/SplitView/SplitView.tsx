import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useOptionalResizeCoordinator } from '../../contexts/ResizeCoordinatorContext';
import { ContextProgressBar } from '../ContextProgressBar';
import type { ContextUsage } from '../../../shared/contextProtocol';
import { tokenColorBand } from '../../../shared/contextProtocol';

interface WindowConfig {
  id: string;
  name: string;
  type: 'terminal' | 'media' | 'agent';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMain: boolean;
  isMinimized: boolean;
}

interface DragZone {
  type: 'vertical' | 'horizontal';
  position: number;
  affectedWindows: [string, string];
  initialRatio: number;
}

interface DropZone {
  type: 'top' | 'right' | 'bottom' | 'left';
  targetId: string;
  preview: {
    target: { x: number; y: number; width: number; height: number };
    dragged: { x: number; y: number; width: number; height: number };
  };
}

interface WindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SplitViewProps {
  windows: WindowConfig[];
  activeWindowId: string | null;
  onWindowFocus: (id: string) => void;
  onWindowClose: (id: string) => void;
  onWindowMinimize: (id: string) => void;
  onWindowRestore: (id: string) => void;
  onLayoutChange: (id: string, layout: WindowLayout, isDragging?: boolean, skipResize?: boolean) => void;
  onAddWindow: () => void;
  onWindowRename?: (id: string, name: string) => void;
  onLayoutsChange?: (layouts: WindowLayout[]) => void;
  renderWindow: (windowId: string, isFocused: boolean, windowType: 'terminal' | 'media' | 'agent') => React.ReactNode;
  sidePanelOpen?: boolean;
  sidePanelExpanded?: boolean;
  minimapVisible?: boolean;
  leftOffset?: number;
  contextUsage?: Map<string, ContextUsage>; // Context usage by windowId
  todoCount?: number;        // Total pending + in_progress todos
  todoHasActive?: boolean;   // True if any are in_progress (for glow effect)
}

const SNAP_THRESHOLD = 0.03;
const SNAP_POINTS = [0, 0.25, 0.333, 0.5, 0.666, 0.75, 1];

function snapToGrid(value: number): number {
  for (const point of SNAP_POINTS) {
    if (Math.abs(value - point) < SNAP_THRESHOLD) {
      return point;
    }
  }
  return value;
}

export default function SplitView({
  windows,
  activeWindowId,
  onWindowFocus,
  onWindowClose,
  onWindowMinimize,
  onWindowRestore,
  onLayoutChange,
  onAddWindow,
  onWindowRename,
  onLayoutsChange: _onLayoutsChange,
  renderWindow,
  sidePanelOpen = false,
  sidePanelExpanded = false,
  minimapVisible = false,
  leftOffset = 0,
  contextUsage,
  todoCount,
  todoHasActive,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; startLayout: WindowConfig; flushStartLayouts: Map<string, WindowConfig> } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; edge: string; startX: number; startY: number; startLayout: WindowConfig } | null>(null);
  const [editingWindowId, setEditingWindowId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [dragZones, setDragZones] = useState<DragZone[]>([]);
  const [activeDragZone, setActiveDragZone] = useState<DragZone | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropZones, setDropZones] = useState<DropZone[]>([]);
  const [activeDropZone, setActiveDropZone] = useState<DropZone | null>(null);
  const [selectedWindows, setSelectedWindows] = useState<Set<string>>(new Set());
  const [zoomedWindowId, setZoomedWindowId] = useState<string | null>(null);
  // animating state managed by resize coordinator
  const animationFrameRef = useRef<number | null>(null);
  const [flushGroup, setFlushGroup] = useState<Set<string>>(new Set());
  const resizeCoordinator = useOptionalResizeCoordinator();
  const dragIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DRAG_IDLE_DELAY_MS = 2000; // 2 second idle before resize during drag
  const [dividerPreview, setDividerPreview] = useState<{
    type: 'vertical' | 'horizontal';
    position: number;
    affectedWindows: [string, string];
  } | null>(null);
  // Suppress cosmetic CSS transitions during resize completion so fitAddon.fit() sees final dimensions.
  // Layout transitions (width, height, left, top) were removed from window containers entirely —
  // only cosmetic transitions (border-color, box-shadow, outline, ring) remain in the className.
  // This suppression mechanism disables even those cosmetic transitions during resize to prevent
  // findTransitionAncestor() from detecting them and adding unnecessary wait delays.
  const suppressTransitionsRef = useRef(false);
  const windowContainerRefs = useRef<Map<string, HTMLElement>>(new Map());
  const COSMETIC_TRANSITION_CLASS = 'transition-[border-color,box-shadow,outline,ring]';
  const DURATION_CLASS = 'duration-200';
  const SAFETY_TIMEOUT_MS = 500;

  const setTransitionsSuppressed = useCallback((suppress: boolean) => {
    suppressTransitionsRef.current = suppress;
    windowContainerRefs.current.forEach((el) => {
      if (suppress) {
        el.classList.remove(COSMETIC_TRANSITION_CLASS, DURATION_CLASS);
      } else {
        el.classList.add(COSMETIC_TRANSITION_CLASS, DURATION_CLASS);
      }
    });
  }, []);

  const windowContainerRefCallback = useCallback((windowId: string) => (el: HTMLElement | null) => {
    if (el) {
      windowContainerRefs.current.set(windowId, el);
      // Enforce current suppression state on newly registered elements
      if (suppressTransitionsRef.current) {
        el.classList.remove(COSMETIC_TRANSITION_CLASS, DURATION_CLASS);
      } else {
        el.classList.add(COSMETIC_TRANSITION_CLASS, DURATION_CLASS);
      }
    } else {
      windowContainerRefs.current.delete(windowId);
    }
  }, []);

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const checkMobile = () => {
      // Debounce: orientation change fires resize multiple times over ~200ms.
      // Without this, SplitView re-renders 3-5 times during keyboard toggle.
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsMobile(window.innerWidth < 768);
      }, 150);
    };

    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  const visibleWindows = useMemo(() => windows.filter(w => !w.isMinimized), [windows]);
  const minimizedWindows = useMemo(() => windows.filter(w => w.isMinimized), [windows]);

  useEffect(() => {
    if (isMobile && visibleWindows.length > 0 && !mobileActiveTab) {
      setMobileActiveTab(visibleWindows[0].id);
    }
  }, [isMobile, visibleWindows, mobileActiveTab]);

  useEffect(() => {
    if (activeWindowId && isMobile) {
      setMobileActiveTab(activeWindowId);
    }
  }, [activeWindowId, isMobile]);

  const calculateDragZones = useCallback((windows: WindowConfig[]): DragZone[] => {
    const zones: DragZone[] = [];
    const threshold = 0.02;
    
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const w1 = windows[i];
        const w2 = windows[j];
        
        // Vertical divider: w1's right edge touches w2's left edge with Y overlap
        if (Math.abs((w1.x + w1.width) - w2.x) < threshold) {
          // Check for Y overlap (not exact match, just overlap)
          if (w1.y < w2.y + w2.height && w1.y + w1.height > w2.y) {
            zones.push({
              type: 'vertical',
              position: w1.x + w1.width,
              affectedWindows: [w1.id, w2.id],
              initialRatio: w1.width / (w1.width + w2.width),
            });
          }
        }
        
        // Horizontal divider: w1's bottom edge touches w2's top edge with X overlap
        if (Math.abs((w1.y + w1.height) - w2.y) < threshold) {
          // Check for X overlap (not exact match, just overlap)
          if (w1.x < w2.x + w2.width && w1.x + w1.width > w2.x) {
            zones.push({
              type: 'horizontal',
              position: w1.y + w1.height,
              affectedWindows: [w1.id, w2.id],
              initialRatio: w1.height / (w1.height + w2.height),
            });
          }
        }
      }
    }
    
    return zones;
  }, []);

  // Clear zoom if the zoomed window is closed or minimized
  useEffect(() => {
    if (zoomedWindowId && !visibleWindows.find(w => w.id === zoomedWindowId)) {
      setZoomedWindowId(null);
    }
  }, [zoomedWindowId, visibleWindows]);

  // Ctrl+Shift+Z to toggle zoom on active window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        if (zoomedWindowId) {
          setZoomedWindowId(null);
        } else if (activeWindowId) {
          setZoomedWindowId(activeWindowId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedWindowId, activeWindowId]);

  useEffect(() => {
    if (!isMobile && visibleWindows.length > 1) {
      setDragZones(calculateDragZones(visibleWindows));
    } else {
      setDragZones([]);
    }
  }, [visibleWindows, calculateDragZones, isMobile]);

  const calculateDropZones = useCallback((targetWindow: WindowConfig, _draggedWindow: WindowConfig): DropZone[] => {
    const { x, y, width, height } = targetWindow;
    
    return [
      {
        type: 'top',
        targetId: targetWindow.id,
        preview: {
          target: { x, y: y + height/2, width, height: height/2 },
          dragged: { x, y, width, height: height/2 },
        },
      },
      {
        type: 'right',
        targetId: targetWindow.id,
        preview: {
          target: { x, y, width: width/2, height },
          dragged: { x: x + width/2, y, width: width/2, height },
        },
      },
      {
        type: 'bottom',
        targetId: targetWindow.id,
        preview: {
          target: { x, y, width, height: height/2 },
          dragged: { x, y: y + height/2, width, height: height/2 },
        },
      },
      {
        type: 'left',
        targetId: targetWindow.id,
        preview: {
          target: { x: x + width/2, y, width: width/2, height },
          dragged: { x, y, width: width/2, height },
        },
      },
    ];
  }, []);

  const handleWindowSwap = useCallback((draggingId: string, targetId: string) => {
    const draggingWindow = windows.find(w => w.id === draggingId);
    const targetWindow = windows.find(w => w.id === targetId);
    
    if (!draggingWindow || !targetWindow) return;
    
    const tempLayout = { ...draggingWindow };
    
    onLayoutChange(draggingId, {
      x: targetWindow.x,
      y: targetWindow.y,
      width: targetWindow.width,
      height: targetWindow.height,
    });
    
    onLayoutChange(targetId, {
      x: tempLayout.x,
      y: tempLayout.y,
      width: tempLayout.width,
      height: tempLayout.height,
    });
  }, [windows, onLayoutChange]);

  const handleZoomToggle = useCallback((windowId: string) => {
    setZoomedWindowId(prev => prev === windowId ? null : windowId);
    // Trigger resize after layout applies (no layout transitions, single-frame delay)
    setTimeout(() => {
      resizeCoordinator?.triggerResize();
    }, 16);
  }, [resizeCoordinator]);

  const handleWindowClick = useCallback((e: React.MouseEvent, windowId: string) => {
    if (e.shiftKey) {
      setSelectedWindows(prev => new Set([...prev, windowId]));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedWindows(prev => {
        const next = new Set(prev);
        if (next.has(windowId)) next.delete(windowId);
        else next.add(windowId);
        return next;
      });
    } else {
      setSelectedWindows(new Set([windowId]));
    }
    onWindowFocus(windowId);
  }, [onWindowFocus]);

  const findFlushWindows = useCallback((windowId: string, windows: WindowConfig[]): Set<string> => {
    const flushIds = new Set<string>([windowId]);
    const threshold = 0.02;
    let changed = true;
    
    while (changed) {
      changed = false;
      const currentSize = flushIds.size;
      
      for (const w1 of windows) {
        if (!flushIds.has(w1.id)) continue;
        
        for (const w2 of windows) {
          if (flushIds.has(w2.id)) continue;
          
          const rightEdgeFlush = Math.abs((w1.x + w1.width) - w2.x) < threshold && 
                                  w1.y < w2.y + w2.height && 
                                  w1.y + w1.height > w2.y;
          
          const leftEdgeFlush = Math.abs(w1.x - (w2.x + w2.width)) < threshold && 
                                 w1.y < w2.y + w2.height && 
                                 w1.y + w1.height > w2.y;
          
          const bottomEdgeFlush = Math.abs((w1.y + w1.height) - w2.y) < threshold && 
                                   Math.abs(w1.x - w2.x) < threshold && 
                                   Math.abs(w1.width - w2.width) < threshold;
          
          const topEdgeFlush = Math.abs(w1.y - (w2.y + w2.height)) < threshold && 
                                Math.abs(w1.x - w2.x) < threshold && 
                                Math.abs(w1.width - w2.width) < threshold;
          
          if (rightEdgeFlush || leftEdgeFlush || bottomEdgeFlush || topEdgeFlush) {
            flushIds.add(w2.id);
            changed = true;
          }
        }
      }
      
      if (flushIds.size > currentSize) {
        changed = true;
      }
    }
    
    return flushIds;
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, window: WindowConfig) => {
    if ((e.target as HTMLElement).closest('.window-controls')) return;
    e.preventDefault();
    
    if (!selectedWindows.has(window.id)) {
      onWindowFocus(window.id);
    }
    
    const flushIds = findFlushWindows(window.id, visibleWindows);
    setFlushGroup(flushIds);
    
    const flushStartLayouts = new Map<string, WindowConfig>();
    flushIds.forEach(id => {
      const w = visibleWindows.find(win => win.id === id);
      if (w) {
        flushStartLayouts.set(id, { ...w });
      }
    });
    
    setDragging({
      id: window.id,
      startX: e.clientX,
      startY: e.clientY,
      startLayout: window,
      flushStartLayouts,
    });
  }, [onWindowFocus, selectedWindows, findFlushWindows, visibleWindows]);

  const handleResizeStart = useCallback((e: React.MouseEvent, window: WindowConfig, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    onWindowFocus(window.id);
    setResizing({
      id: window.id,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startLayout: window,
    });
  }, [onWindowFocus]);

  // Helper: Calculate layout updates for vertical divider drag
  const calculateVerticalDividerLayouts = useCallback((
    newPosition: number,
    win1Id: string,
    win2Id: string,
    allWindows: WindowConfig[]
  ): Map<string, WindowLayout> => {
    const threshold = 0.02;
    const layouts = new Map<string, WindowLayout>();

    const win1 = allWindows.find(w => w.id === win1Id);
    const win2 = allWindows.find(w => w.id === win2Id);
    if (!win1 || !win2) return layouts;

    const win1RightEdge = win1.x + win1.width;
    const dividerDelta = newPosition - win1RightEdge;

    // Find all windows sharing the left column edge
    const leftColumnWindows = allWindows.filter(w =>
      Math.abs((w.x + w.width) - win1RightEdge) < threshold
    );

    // Find all windows sharing the right column edge
    const win2LeftEdge = win2.x;
    const rightColumnWindows = allWindows.filter(w =>
      Math.abs(w.x - win2LeftEdge) < threshold
    );

    // Apply resize to all affected windows
    leftColumnWindows.forEach(w => {
      layouts.set(w.id, {
        x: w.x,
        y: w.y,
        width: w.width + dividerDelta,
        height: w.height
      });
    });

    rightColumnWindows.forEach(w => {
      layouts.set(w.id, {
        x: w.x + dividerDelta,
        y: w.y,
        width: w.width - dividerDelta,
        height: w.height
      });
    });

    return layouts;
  }, []);

  // Helper: Calculate layout updates for horizontal divider drag
  const calculateHorizontalDividerLayouts = useCallback((
    newPosition: number,
    win1Id: string,
    win2Id: string,
    allWindows: WindowConfig[]
  ): Map<string, WindowLayout> => {
    const threshold = 0.02;
    const layouts = new Map<string, WindowLayout>();

    const win1 = allWindows.find(w => w.id === win1Id);
    const win2 = allWindows.find(w => w.id === win2Id);
    if (!win1 || !win2) return layouts;

    const win1BottomEdge = win1.y + win1.height;
    const dividerDelta = newPosition - win1BottomEdge;

    // Find all windows sharing the top row edge
    const topRowWindows = allWindows.filter(w =>
      Math.abs((w.y + w.height) - win1BottomEdge) < threshold
    );

    // Find all windows sharing the bottom row edge
    const win2TopEdge = win2.y;
    const bottomRowWindows = allWindows.filter(w =>
      Math.abs(w.y - win2TopEdge) < threshold
    );

    // Apply resize to all affected windows
    topRowWindows.forEach(w => {
      layouts.set(w.id, {
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height + dividerDelta
      });
    });

    bottomRowWindows.forEach(w => {
      layouts.set(w.id, {
        x: w.x,
        y: w.y + dividerDelta,
        width: w.width,
        height: w.height - dividerDelta
      });
    });

    return layouts;
  }, []);

  const handleDragZoneStart = useCallback((e: React.MouseEvent, zone: DragZone) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragZone(zone);
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (dragIdleTimerRef.current) {
        clearTimeout(dragIdleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragging && !resizing && !activeDragZone) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (dragging) {
        const deltaX = (e.clientX - dragging.startX) / rect.width;
        const deltaY = (e.clientY - dragging.startY) / rect.height;
        
        let newX = Math.max(0, Math.min(1 - dragging.startLayout.width, dragging.startLayout.x + deltaX));
        let newY = Math.max(0, Math.min(1 - dragging.startLayout.height, dragging.startLayout.y + deltaY));
        
        const mouseX = (e.clientX - rect.left) / rect.width;
        const mouseY = (e.clientY - rect.top) / rect.height;
        
        const hoveredWindow = visibleWindows.find(w => {
          if (w.id === dragging.id) return false;
          return (
            mouseX >= w.x && mouseX <= w.x + w.width &&
            mouseY >= w.y && mouseY <= w.y + w.height
          );
        });
        setDropTarget(hoveredWindow?.id || null);
        
        if (hoveredWindow) {
          setDropZones(calculateDropZones(hoveredWindow, dragging.startLayout));
        } else {
          setDropZones([]);
        }
        
        const snappedX = snapToGrid(newX);
        const snappedY = snapToGrid(newY);
        const rightEdge = snapToGrid(newX + dragging.startLayout.width);
        const bottomEdge = snapToGrid(newY + dragging.startLayout.height);
        
        const guides: { x?: number; y?: number } = {};
        if (snappedX !== newX) {
          newX = snappedX;
          guides.x = snappedX;
        } else if (rightEdge !== newX + dragging.startLayout.width) {
          newX = rightEdge - dragging.startLayout.width;
          guides.x = rightEdge;
        }
        if (snappedY !== newY) {
          newY = snappedY;
          guides.y = snappedY;
        } else if (bottomEdge !== newY + dragging.startLayout.height) {
          newY = bottomEdge - dragging.startLayout.height;
          guides.y = bottomEdge;
        }
        setSnapGuides(guides);
        
        dragging.flushStartLayouts.forEach((startLayout, windowId) => {
          if (windowId === dragging.id) {
            onLayoutChange(dragging.id, {
              x: newX,
              y: newY,
              width: dragging.startLayout.width,
              height: dragging.startLayout.height,
            }, true);
          } else {
            onLayoutChange(windowId, {
              x: startLayout.x + deltaX,
              y: startLayout.y + deltaY,
              width: startLayout.width,
              height: startLayout.height,
            }, true);
          }
        });
      }

      if (activeDragZone) {
        const [win1Id, win2Id] = activeDragZone.affectedWindows;
        const win1 = visibleWindows.find(w => w.id === win1Id);
        const win2 = visibleWindows.find(w => w.id === win2Id);

        if (!win1 || !win2) return;

        // Calculate new divider position based on mouse
        let newPosition: number;
        if (activeDragZone.type === 'vertical') {
          const mouseX = (e.clientX - rect.left) / rect.width;
          newPosition = Math.max(win1.x + 0.15, Math.min(win2.x + win2.width - 0.15, mouseX));
        } else {
          const mouseY = (e.clientY - rect.top) / rect.height;
          newPosition = Math.max(win1.y + 0.15, Math.min(win2.y + win2.height - 0.15, mouseY));
        }

        // Update preview state ONLY (no layout changes during drag)
        setDividerPreview({
          type: activeDragZone.type,
          position: newPosition,
          affectedWindows: [win1Id, win2Id],
        });

        // Reset and schedule resize if drag is idle for 2 seconds
        if (dragIdleTimerRef.current) {
          clearTimeout(dragIdleTimerRef.current);
        }
        dragIdleTimerRef.current = setTimeout(() => {
          // Apply layouts from current preview position after 2s idle
          if (dividerPreview) {
            // Apply snapping to final position
            const snappedPosition = snapToGrid(dividerPreview.position);
            const layouts = dividerPreview.type === 'vertical'
              ? calculateVerticalDividerLayouts(snappedPosition, win1Id, win2Id, visibleWindows)
              : calculateHorizontalDividerLayouts(snappedPosition, win1Id, win2Id, visibleWindows);

            layouts.forEach((layout, windowId) => {
              onLayoutChange(windowId, layout, false);
            });

            setDividerPreview(null);
            resizeCoordinator?.triggerResize();
          }
        }, DRAG_IDLE_DELAY_MS);
      }

      if (resizing) {
        const deltaX = (e.clientX - resizing.startX) / rect.width;
        const deltaY = (e.clientY - resizing.startY) / rect.height;
        const { startLayout, edge } = resizing;

        let newX = startLayout.x;
        let newY = startLayout.y;
        let newWidth = startLayout.width;
        let newHeight = startLayout.height;
        const guides: { x?: number; y?: number } = {};

        if (edge.includes('e')) {
          let proposedRight = startLayout.x + startLayout.width + deltaX;
          const snappedRight = snapToGrid(proposedRight);
          if (snappedRight !== proposedRight) {
            guides.x = snappedRight;
            proposedRight = snappedRight;
          }
          newWidth = Math.max(0.15, Math.min(1 - startLayout.x, proposedRight - startLayout.x));
        }
        if (edge.includes('w')) {
          let proposedX = startLayout.x + deltaX;
          const snappedX = snapToGrid(proposedX);
          if (snappedX !== proposedX) {
            guides.x = snappedX;
            proposedX = snappedX;
          }
          const proposedWidth = startLayout.x + startLayout.width - proposedX;
          if (proposedWidth >= 0.15 && proposedX >= 0) {
            newWidth = proposedWidth;
            newX = proposedX;
          }
        }
        if (edge.includes('s')) {
          let proposedBottom = startLayout.y + startLayout.height + deltaY;
          const snappedBottom = snapToGrid(proposedBottom);
          if (snappedBottom !== proposedBottom) {
            guides.y = snappedBottom;
            proposedBottom = snappedBottom;
          }
          newHeight = Math.max(0.15, Math.min(1 - startLayout.y, proposedBottom - startLayout.y));
        }
        if (edge.includes('n')) {
          let proposedY = startLayout.y + deltaY;
          const snappedY = snapToGrid(proposedY);
          if (snappedY !== proposedY) {
            guides.y = snappedY;
            proposedY = snappedY;
          }
          const proposedHeight = startLayout.y + startLayout.height - proposedY;
          if (proposedHeight >= 0.15 && proposedY >= 0) {
            newHeight = proposedHeight;
            newY = proposedY;
          }
        }

        setSnapGuides(guides);
        onLayoutChange(resizing.id, { x: newX, y: newY, width: newWidth, height: newHeight }, true);
      }
    };

    const handleMouseUp = () => {
      // FIX Bug 1: Suppress CSS transitions via direct DOM manipulation (synchronous).
      // React useState is batched and wouldn't take effect before RAF fires.
      setTransitionsSuppressed(true);

      // Apply divider preview to actual layouts on mouseup
      if (activeDragZone && dividerPreview) {
        const [win1Id, win2Id] = dividerPreview.affectedWindows;

        // Apply snapping to final position
        const snappedPosition = snapToGrid(dividerPreview.position);

        // Calculate final layouts with snapped position
        const layouts = dividerPreview.type === 'vertical'
          ? calculateVerticalDividerLayouts(snappedPosition, win1Id, win2Id, visibleWindows)
          : calculateHorizontalDividerLayouts(snappedPosition, win1Id, win2Id, visibleWindows);

        // FIX Bug 2: Pass skipResize=true — SplitView handles resize itself below
        layouts.forEach((layout, windowId) => {
          onLayoutChange(windowId, layout, false, true);
        });

        // Clear preview state
        setDividerPreview(null);
      }

      if (dropTarget && dragging && !activeDropZone) {
        handleWindowSwap(dragging.id, dropTarget);
      }

      if (activeDropZone && dragging) {
        const targetWindow = visibleWindows.find(w => w.id === activeDropZone.targetId);
        if (targetWindow) {
          // FIX Bug 2: skipResize=true
          onLayoutChange(activeDropZone.targetId, activeDropZone.preview.target, false, true);
          onLayoutChange(dragging.id, activeDropZone.preview.dragged, false, true);
        }
      }

      if (dragging && dragging.flushStartLayouts.size > 0) {
        dragging.flushStartLayouts.forEach((_, windowId) => {
          const currentWindow = visibleWindows.find(w => w.id === windowId);
          if (currentWindow) {
            // FIX Bug 2: skipResize=true
            onLayoutChange(windowId, {
              x: currentWindow.x,
              y: currentWindow.y,
              width: currentWindow.width,
              height: currentWindow.height,
            }, false, true);
          }
        });
      }

      setDragging(null);
      setResizing(null);
      setActiveDragZone(null);
      setSnapGuides({});
      setDropTarget(null);
      setDividerPreview(null); // Clear divider preview

      // Clear drag idle timer on mouseup
      if (dragIdleTimerRef.current) {
        clearTimeout(dragIdleTimerRef.current);
        dragIdleTimerRef.current = null;
      }
      setDropZones([]);
      setActiveDropZone(null);
      setFlushGroup(new Set());

      // FIX Bug 4: Use onComplete callback to re-enable transitions AFTER resize finishes.
      // This ensures fitAddon.fit() + canvas verify complete before transitions animate again.
      const safetyTimer = setTimeout(() => {
        // Safety fallback: re-enable transitions even if onComplete never fires
        setTransitionsSuppressed(false);
      }, SAFETY_TIMEOUT_MS);

      requestAnimationFrame(() => {
        resizeCoordinator?.triggerResize(true, () => {
          clearTimeout(safetyTimer);
          setTransitionsSuppressed(false);
        });
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, resizing, activeDragZone, dropTarget, activeDropZone, visibleWindows, onLayoutChange, handleWindowSwap, calculateDropZones, findFlushWindows, dividerPreview, calculateVerticalDividerLayouts, calculateHorizontalDividerLayouts, resizeCoordinator]);

  if (isMobile) {
    const activeWindow = visibleWindows.find(w => w.id === mobileActiveTab) || visibleWindows[0];

    return (
      <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0f] flex flex-col">
        {/* Slim tab bar — always visible, even with 1 window */}
        <div className="flex items-center bg-[#0a0a0f] border-b border-[#27272a]" style={{ minHeight: 32, paddingLeft: 'env(safe-area-inset-left, 0)', paddingRight: 'env(safe-area-inset-right, 0)' }}>
          <div className="flex flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {visibleWindows.map((window) => {
              const u = contextUsage?.get(window.id);
              const band = u ? tokenColorBand(u.usedTokens) : null;
              const fillRgb = band === 'green' ? '34,197,94' : band === 'yellow' ? '234,179,8' : band === 'red' ? '239,68,68' : null;
              const fillPct = u ? Math.min(100, Math.max(0, u.percentage)) : 0;
              return (
                <div
                  key={window.id}
                  className={`relative flex items-center min-w-0 overflow-hidden transition-colors ${
                    mobileActiveTab === window.id
                      ? 'bg-[#18181b] border-b border-[#00d4ff]'
                      : 'hover:bg-[#18181b]/50'
                  }`}
                  style={{ maxWidth: 160 }}
                >
                  {/* Context tint fill: absolute band behind tab content */}
                  {fillRgb && (
                    <div
                      aria-hidden
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{
                        width: `${fillPct}%`,
                        background: `linear-gradient(90deg, rgba(${fillRgb},0.22) 0%, rgba(${fillRgb},0.12) 70%, rgba(${fillRgb},0.04) 100%)`,
                        transition: 'width 0.3s ease-in-out, background 0.3s ease-in-out',
                        zIndex: 0,
                      }}
                    />
                  )}
                  <button
                    onClick={() => {
                      setMobileActiveTab(window.id);
                      onWindowFocus(window.id);
                    }}
                    className={`relative flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 min-w-0 text-xs ${
                      mobileActiveTab === window.id ? 'text-white' : 'text-[#71717a]'
                    }`}
                    style={{ zIndex: 1 }}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${window.isMain ? 'bg-[#00d4ff]' : 'bg-[#22c55e]'}`} />
                    <span className="truncate">{window.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onWindowClose(window.id);
                    }}
                    className="relative flex-shrink-0 p-2 mr-0.5 text-[#52525b] hover:text-[#ef4444] rounded transition-colors"
                    style={{ zIndex: 1 }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={onAddWindow}
            className="flex-shrink-0 flex items-center justify-center px-2 py-1.5 text-[#52525b] hover:text-[#00d4ff] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {activeWindow && (
          <div className="flex-1 min-h-0 relative bg-[#18181b]" style={{ touchAction: 'pan-y' }}>
            {visibleWindows.map(window => (
              <div
                key={window.id}
                className="terminal-wrapper"
                style={{
                  display: window.id === activeWindow.id ? 'flex' : 'none',
                  touchAction: 'pan-y',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0
                }}
              >
                {renderWindow(window.id, window.id === activeWindow.id, window.type || 'terminal')}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const minimapWidth = sidePanelOpen ? 65 : 122;
  const sidePanelWidth = sidePanelExpanded ? Math.floor(window.innerWidth * 0.5) : 340;
  const rightOffset = (minimapVisible ? minimapWidth : 0) + (sidePanelOpen ? sidePanelWidth : 0);

  return (
    <div ref={containerRef} className="absolute bg-[#0a0a0f]" style={{ top: 0, left: leftOffset, bottom: 0, right: rightOffset }}>
      {snapGuides.x !== undefined && (
        <div 
          className="snap-guide snap-guide-v"
          style={{ left: `${snapGuides.x * 100}%` }}
        />
      )}
      {snapGuides.y !== undefined && (
        <div 
          className="snap-guide snap-guide-h"
          style={{ top: `${snapGuides.y * 100}%` }}
        />
      )}
      
      {dragZones.map((zone, i) => (
        <div
          key={`zone-${i}`}
          className={`absolute ${activeDragZone === zone ? 'bg-[#00d4ff]/30' : 'hover:bg-[#00d4ff]/10'} transition-colors cursor-${zone.type === 'vertical' ? 'col' : 'row'}-resize`}
          style={{
            [zone.type === 'vertical' ? 'left' : 'top']: `${zone.position * 100}%`,
            [zone.type === 'vertical' ? 'top' : 'left']: '0',
            [zone.type === 'vertical' ? 'width' : 'height']: '12px',
            [zone.type === 'vertical' ? 'height' : 'width']: '100%',
            transform: zone.type === 'vertical' ? 'translateX(-6px)' : 'translateY(-6px)',
            zIndex: 1000,
          }}
          onMouseDown={(e) => handleDragZoneStart(e, zone)}
        />
      ))}

      {/* Visual preview divider during drag */}
      {dividerPreview && (
        <div
          className="absolute bg-[#00d4ff]/50 pointer-events-none"
          style={{
            [dividerPreview.type === 'vertical' ? 'left' : 'top']: `${dividerPreview.position * 100}%`,
            [dividerPreview.type === 'vertical' ? 'top' : 'left']: '0',
            [dividerPreview.type === 'vertical' ? 'width' : 'height']: '3px',
            [dividerPreview.type === 'vertical' ? 'height' : 'width']: '100%',
            transform: dividerPreview.type === 'vertical' ? 'translateX(-1.5px)' : 'translateY(-1.5px)',
            zIndex: 1001,
            boxShadow: '0 0 8px rgba(0, 212, 255, 0.6)',
            transition: 'none', // Instant update for smooth 60fps drag
          }}
        />
      )}

      {dragging && dropTarget && dropZones.map((zone, i) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        
        const isActive = activeDropZone === zone;
        const dropZoneSize = 0.25;
        
        let style: React.CSSProperties = {
          position: 'absolute',
          backgroundColor: isActive ? 'rgba(0, 212, 255, 0.2)' : 'rgba(0, 212, 255, 0.05)',
          border: '2px dashed rgba(0, 212, 255, 0.5)',
          zIndex: 900,
          transition: 'all 150ms',
        };
        
        if (zone.type === 'top') {
          style = { ...style,
            left: `${zone.preview.target.x * 100}%`,
            top: `${zone.preview.target.y * 100}%`,
            width: `${zone.preview.target.width * 100}%`,
            height: `${dropZoneSize * 100}%`,
          };
        } else if (zone.type === 'right') {
          style = { ...style,
            left: `${(zone.preview.dragged.x + zone.preview.dragged.width * (1 - dropZoneSize)) * 100}%`,
            top: `${zone.preview.target.y * 100}%`,
            width: `${dropZoneSize * 100}%`,
            height: `${zone.preview.target.height * 100}%`,
          };
        } else if (zone.type === 'bottom') {
          style = { ...style,
            left: `${zone.preview.target.x * 100}%`,
            top: `${(zone.preview.dragged.y + zone.preview.dragged.height * (1 - dropZoneSize)) * 100}%`,
            width: `${zone.preview.target.width * 100}%`,
            height: `${dropZoneSize * 100}%`,
          };
        } else {
          style = { ...style,
            left: `${zone.preview.dragged.x * 100}%`,
            top: `${zone.preview.target.y * 100}%`,
            width: `${dropZoneSize * 100}%`,
            height: `${zone.preview.target.height * 100}%`,
          };
        }
        
        return (
          <div
            key={`drop-${i}`}
            style={style}
            onMouseEnter={() => setActiveDropZone(zone)}
            onMouseLeave={() => setActiveDropZone(null)}
          />
        );
      })}
      
      {windows.map((window) => {
        const isZoomed = zoomedWindowId === window.id;
        const isHiddenByZoom = zoomedWindowId !== null && zoomedWindowId !== window.id;

        return (
        <div
          key={window.id}
          ref={windowContainerRefCallback(window.id)}
          className={`absolute flex flex-col bg-black border rounded-xl overflow-hidden transition-[border-color,box-shadow,outline,ring] duration-200 ${
            isZoomed
              ? 'border-[#00d4ff]/60 shadow-[0_0_32px_rgba(0,212,255,0.15)] ring-1 ring-[#00d4ff]/20'
              : dropTarget === window.id
              ? 'border-[#00d4ff] shadow-[0_0_40px_rgba(0,212,255,0.25),inset_0_1px_0_rgba(255,255,255,0.05)] scale-[0.98]'
              : flushGroup.has(window.id) && flushGroup.size > 1
              ? 'border-[#22c55e]/50 shadow-[0_0_20px_rgba(34,197,94,0.12)] ring-1 ring-[#22c55e]/30'
              : selectedWindows.has(window.id) && selectedWindows.size > 1
              ? 'border-[#00d4ff]/60 shadow-[0_0_20px_rgba(0,212,255,0.12)] ring-2 ring-[#00d4ff]/25'
              : activeWindowId === window.id
              ? 'border-[#00d4ff]/40 shadow-[0_0_24px_rgba(0,212,255,0.08),0_8px_32px_rgba(0,0,0,0.4)]'
              : 'border-white/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.3)]'
          } ${window.isMinimized || isHiddenByZoom ? 'invisible pointer-events-none' : ''}`}
          style={{
            left: isZoomed ? 0 : `${window.x * 100}%`,
            top: isZoomed ? 0 : `${window.y * 100}%`,
            width: isZoomed ? '100%' : `${window.width * 100}%`,
            height: isZoomed ? '100%' : `${window.height * 100}%`,
            zIndex: isZoomed ? 9000 : window.isMinimized ? -1 : window.zIndex + 10,
          }}
          onClick={(e) => !window.isMinimized && handleWindowClick(e, window.id)}
        >
          <div
            className={`relative flex items-center justify-between px-3 py-1.5 border-b cursor-move select-none window-header overflow-hidden ${
              activeWindowId === window.id
                ? 'bg-gradient-to-r from-[#0c0c14] via-[#0f0f18] to-[#0c0c14] border-white/[0.06]'
                : 'bg-[#0a0a0f] border-white/[0.04]'
            }`}
            onMouseDown={(e) => handleDragStart(e, window)}
          >
            {/* Context tint fill: colored band behind the tab content, width = usage % */}
            {(() => {
              const u = contextUsage?.get(window.id);
              if (!u) return null;
              const band = tokenColorBand(u.usedTokens);
              const fillRgb = band === 'green' ? '34,197,94' : band === 'yellow' ? '234,179,8' : '239,68,68';
              const fillPct = Math.min(100, Math.max(0, u.percentage));
              return (
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 pointer-events-none"
                  style={{
                    width: `${fillPct}%`,
                    background: `linear-gradient(90deg, rgba(${fillRgb},0.18) 0%, rgba(${fillRgb},0.10) 70%, rgba(${fillRgb},0.04) 100%)`,
                    transition: 'width 0.3s ease-in-out, background 0.3s ease-in-out',
                    zIndex: 0,
                  }}
                />
              );
            })()}

            {/* Progress bar at bottom of header — replaces gradient separator when context data exists */}
            {contextUsage?.get(window.id) ? (
              <div className="absolute inset-x-0 bottom-0" style={{ zIndex: 1 }}>
                <ContextProgressBar usage={contextUsage.get(window.id) || null} height={2} />
              </div>
            ) : (
              activeWindowId === window.id && (
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff]/20 to-transparent" />
              )
            )}
            <div className="flex items-center gap-2.5 relative" style={{ zIndex: 2 }}>
              <span className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                window.isMain
                  ? 'bg-[#00d4ff] shadow-[0_0_8px_rgba(0,212,255,0.5)]'
                  : 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.4)]'
              }`} />
              {todoCount !== undefined && todoCount > 0 && activeWindowId === window.id && (
                <span className={`
                  min-w-[16px] h-[16px] flex items-center justify-center
                  text-[9px] font-bold rounded-full px-1
                  ${todoHasActive
                    ? 'bg-[#00d4ff] text-black shadow-[0_0_8px_rgba(0,212,255,0.5)] animate-pulse'
                    : 'bg-[#71717a] text-white'}
                `}>
                  {todoCount > 9 ? '9+' : todoCount}
                </span>
              )}
              {editingWindowId === window.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (editingName.trim() && onWindowRename) {
                      onWindowRename(window.id, editingName.trim());
                    }
                    setEditingWindowId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingName.trim() && onWindowRename) {
                        onWindowRename(window.id, editingName.trim());
                      }
                      setEditingWindowId(null);
                    } else if (e.key === 'Escape') {
                      setEditingWindowId(null);
                    }
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  autoFocus
                  className="text-sm text-white bg-[#1c1c26] border border-[#00d4ff]/40 rounded-md px-2 py-0.5 outline-none w-28 focus:border-[#00d4ff]/60 focus:shadow-[0_0_8px_rgba(0,212,255,0.15)]"
                />
              ) : (
                <span
                  className={`text-sm cursor-text transition-colors ${
                    activeWindowId === window.id ? 'text-[#e4e4e7]' : 'text-[#a1a1aa] hover:text-white'
                  }`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingWindowId(window.id);
                    setEditingName(window.name);
                  }}
                  title="Double-click to rename"
                >
                  {window.name}
                </span>
              )}
            </div>
            <div className="window-controls flex items-center gap-0.5 relative" style={{ zIndex: 2 }}>
              <button
                onClick={() => onWindowMinimize(window.id)}
                className="p-1.5 text-[#8a8a92] hover:text-[#fbbf24] hover:bg-[#fbbf24]/10 rounded-md transition-all duration-150"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleZoomToggle(window.id); }}
                className={`p-1.5 rounded-md transition-all duration-150 ${
                  zoomedWindowId === window.id
                    ? 'text-[#00d4ff] bg-[#00d4ff]/10'
                    : 'text-[#8a8a92] hover:text-[#00d4ff] hover:bg-[#00d4ff]/10'
                }`}
                title={zoomedWindowId === window.id ? 'Restore (Ctrl+Shift+Z)' : 'Zoom (Ctrl+Shift+Z)'}
              >
                {zoomedWindowId === window.id ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
                  </svg>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onWindowClose(window.id); }}
                className="p-1.5 text-[#8a8a92] hover:text-[#f87171] hover:bg-[#ef4444]/10 rounded-md transition-all duration-150"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div 
            className="terminal-wrapper"
            onMouseDown={() => {
              if (activeWindowId !== window.id) {
                onWindowFocus(window.id);
              }
            }}
          >
            {renderWindow(window.id, activeWindowId === window.id, window.type || 'terminal')}
          </div>

          <div
            className="resize-handle resize-e"
            onMouseDown={(e) => handleResizeStart(e, window, 'e')}
          />
          <div
            className="resize-handle resize-w"
            onMouseDown={(e) => handleResizeStart(e, window, 'w')}
          />
          <div
            className="resize-handle resize-s"
            onMouseDown={(e) => handleResizeStart(e, window, 's')}
          />
          <div
            className="resize-handle resize-se"
            onMouseDown={(e) => handleResizeStart(e, window, 'se')}
          />
        </div>
        );
      })}

      {minimizedWindows.length > 0 && (
        <div className="absolute bottom-3 left-3 flex gap-2" style={{ zIndex: 1000 }}>
          {minimizedWindows.map((window) => (
            <button
              key={window.id}
              onClick={() => onWindowRestore(window.id)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-[#111118] to-[#0c0c14] border border-white/[0.06] rounded-lg hover:border-[#00d4ff]/40 hover:shadow-[0_0_16px_rgba(0,212,255,0.1)] transition-all duration-200 shadow-lg"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${window.isMain ? 'bg-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.5)]' : 'bg-[#22c55e] shadow-[0_0_4px_rgba(34,197,94,0.4)]'}`} />
              <span className="text-sm text-[#d4d4d8]">{window.name}</span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onAddWindow}
        className="absolute flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-b from-[#111118]/95 to-[#0c0c14]/95 backdrop-blur-xl border border-white/[0.06] rounded-xl text-[#a1a1aa] hover:text-[#00d4ff] hover:border-[#00d4ff]/30 hover:shadow-[0_0_20px_rgba(0,212,255,0.1)] transition-all duration-200 shadow-lg group"
        style={{
          zIndex: 1000,
          bottom: 72,
          right: 8 + (sidePanelOpen ? (minimapVisible ? 413 : 348) : minimapVisible ? 73 : 0)
        }}
      >
        <svg className="w-5 h-5 transition-transform duration-200 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="hidden sm:inline text-sm font-medium">New Window</span>
      </button>
    </div>
  );
}

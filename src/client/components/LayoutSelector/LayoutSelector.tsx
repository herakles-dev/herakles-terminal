import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

type WindowLayout = { x: number; y: number; width: number; height: number };

interface LayoutPreset {
  id: string;
  name: string;
  layouts: WindowLayout[];
}

const LAYOUT_PRESETS: Record<number, LayoutPreset[]> = {
  1: [
    { id: '1-full', name: 'Full', layouts: [{ x: 0, y: 0, width: 1, height: 1 }] },
  ],
  2: [
    { id: '2-h-split', name: 'Side by Side', layouts: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ]},
    { id: '2-v-split', name: 'Stacked', layouts: [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ]},
    { id: '2-left-focus', name: 'Left Focus', layouts: [
      { x: 0, y: 0, width: 0.7, height: 1 },
      { x: 0.7, y: 0, width: 0.3, height: 1 },
    ]},
    { id: '2-right-focus', name: 'Right Focus', layouts: [
      { x: 0, y: 0, width: 0.3, height: 1 },
      { x: 0.3, y: 0, width: 0.7, height: 1 },
    ]},
  ],
  3: [
    { id: '3-left-stack', name: 'Left + Stack', layouts: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ]},
    { id: '3-cols', name: '3 Columns', layouts: [
      { x: 0, y: 0, width: 0.333, height: 1 },
      { x: 0.333, y: 0, width: 0.334, height: 1 },
      { x: 0.667, y: 0, width: 0.333, height: 1 },
    ]},
    { id: '3-top-split', name: 'Top + 2 Bottom', layouts: [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ]},
    { id: '3-bottom-wide', name: '2 Top + Bottom', layouts: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ]},
  ],
  4: [
    { id: '4-grid', name: '2x2 Grid', layouts: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ]},
    { id: '4-left-stack', name: 'Left + 3 Stack', layouts: [
      { x: 0, y: 0, width: 0.4, height: 1 },
      { x: 0.4, y: 0, width: 0.6, height: 0.333 },
      { x: 0.4, y: 0.333, width: 0.6, height: 0.334 },
      { x: 0.4, y: 0.667, width: 0.6, height: 0.333 },
    ]},
    { id: '4-top-3', name: 'Top + 3 Bottom', layouts: [
      { x: 0, y: 0, width: 1, height: 0.4 },
      { x: 0, y: 0.4, width: 0.333, height: 0.6 },
      { x: 0.333, y: 0.4, width: 0.334, height: 0.6 },
      { x: 0.667, y: 0.4, width: 0.333, height: 0.6 },
    ]},
    { id: '4-cols', name: '4 Columns', layouts: [
      { x: 0, y: 0, width: 0.25, height: 1 },
      { x: 0.25, y: 0, width: 0.25, height: 1 },
      { x: 0.5, y: 0, width: 0.25, height: 1 },
      { x: 0.75, y: 0, width: 0.25, height: 1 },
    ]},
  ],
  5: [
    { id: '5-left-grid', name: 'Left + 2x2', layouts: [
      { x: 0, y: 0, width: 0.4, height: 1 },
      { x: 0.4, y: 0, width: 0.3, height: 0.5 },
      { x: 0.7, y: 0, width: 0.3, height: 0.5 },
      { x: 0.4, y: 0.5, width: 0.3, height: 0.5 },
      { x: 0.7, y: 0.5, width: 0.3, height: 0.5 },
    ]},
    { id: '5-top-3', name: '2 Top + 3 Bottom', layouts: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.333, height: 0.5 },
      { x: 0.333, y: 0.5, width: 0.334, height: 0.5 },
      { x: 0.667, y: 0.5, width: 0.333, height: 0.5 },
    ]},
    { id: '5-bottom-2', name: '3 Top + 2 Bottom', layouts: [
      { x: 0, y: 0, width: 0.333, height: 0.5 },
      { x: 0.333, y: 0, width: 0.334, height: 0.5 },
      { x: 0.667, y: 0, width: 0.333, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ]},
    { id: '5-cols', name: '5 Columns', layouts: [
      { x: 0, y: 0, width: 0.2, height: 1 },
      { x: 0.2, y: 0, width: 0.2, height: 1 },
      { x: 0.4, y: 0, width: 0.2, height: 1 },
      { x: 0.6, y: 0, width: 0.2, height: 1 },
      { x: 0.8, y: 0, width: 0.2, height: 1 },
    ]},
  ],
  6: [
    { id: '6-grid-2x3', name: '2x3 Grid', layouts: [
      { x: 0, y: 0, width: 0.333, height: 0.5 },
      { x: 0.333, y: 0, width: 0.334, height: 0.5 },
      { x: 0.667, y: 0, width: 0.333, height: 0.5 },
      { x: 0, y: 0.5, width: 0.333, height: 0.5 },
      { x: 0.333, y: 0.5, width: 0.334, height: 0.5 },
      { x: 0.667, y: 0.5, width: 0.333, height: 0.5 },
    ]},
    { id: '6-grid-3x2', name: '3x2 Grid', layouts: [
      { x: 0, y: 0, width: 0.5, height: 0.333 },
      { x: 0.5, y: 0, width: 0.5, height: 0.333 },
      { x: 0, y: 0.333, width: 0.5, height: 0.334 },
      { x: 0.5, y: 0.333, width: 0.5, height: 0.334 },
      { x: 0, y: 0.667, width: 0.5, height: 0.333 },
      { x: 0.5, y: 0.667, width: 0.5, height: 0.333 },
    ]},
    { id: '6-left-stack', name: 'Left + 5 Stack', layouts: [
      { x: 0, y: 0, width: 0.4, height: 1 },
      { x: 0.4, y: 0, width: 0.6, height: 0.2 },
      { x: 0.4, y: 0.2, width: 0.6, height: 0.2 },
      { x: 0.4, y: 0.4, width: 0.6, height: 0.2 },
      { x: 0.4, y: 0.6, width: 0.6, height: 0.2 },
      { x: 0.4, y: 0.8, width: 0.6, height: 0.2 },
    ]},
    { id: '6-left-2x2', name: '2 Left + 2x2 Right', layouts: [
      { x: 0, y: 0, width: 0.3, height: 0.5 },
      { x: 0, y: 0.5, width: 0.3, height: 0.5 },
      { x: 0.3, y: 0, width: 0.35, height: 0.5 },
      { x: 0.65, y: 0, width: 0.35, height: 0.5 },
      { x: 0.3, y: 0.5, width: 0.35, height: 0.5 },
      { x: 0.65, y: 0.5, width: 0.35, height: 0.5 },
    ]},
  ],
};

function LayoutPreview({ preset, isActive }: { preset: LayoutPreset; isActive?: boolean }) {
  return (
    <div 
      className={`relative w-16 h-10 rounded border ${isActive ? 'border-[#00d4ff] bg-[#00d4ff]/10' : 'border-[#3f3f46] bg-[#18181b]'}`}
    >
      {preset.layouts.map((layout, i) => (
        <div
          key={i}
          className={`absolute ${isActive ? 'bg-[#00d4ff]/40' : 'bg-[#3f3f46]'} rounded-sm`}
          style={{
            left: `${layout.x * 100 + 4}%`,
            top: `${layout.y * 100 + 8}%`,
            width: `${layout.width * 100 - 8}%`,
            height: `${layout.height * 100 - 16}%`,
          }}
        />
      ))}
    </div>
  );
}

interface LayoutSelectorProps {
  windowCount: number;
  onSelectLayout: (layouts: WindowLayout[]) => void;
  currentLayoutId?: string;
}

export default function LayoutSelector({ windowCount, onSelectLayout, currentLayoutId }: LayoutSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  
  const presets = LAYOUT_PRESETS[windowCount] || LAYOUT_PRESETS[1];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className={`p-2 rounded-md transition-all duration-200 ${
          isOpen ? 'bg-[#00d4ff]/15 text-[#00d4ff] ring-1 ring-[#00d4ff]/30 shadow-[0_0_8px_rgba(0,212,255,0.2)]' : 'text-[#71717a] hover:text-white hover:bg-white/5'
        }`}
        title="Layout presets"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      </button>

      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed p-3 bg-[#0a0a0f] border border-[#27272a] rounded-lg shadow-xl z-[9999] min-w-[200px] animate-scale-in"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div className="text-sm text-[#71717a] mb-2 font-medium">
            Layouts for {windowCount} window{windowCount !== 1 ? 's' : ''}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  onSelectLayout(preset.layouts);
                  setIsOpen(false);
                }}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all duration-150 ${
                  currentLayoutId === preset.id 
                    ? 'bg-[#00d4ff]/10 border border-[#00d4ff]/30' 
                    : 'hover:bg-[#27272a] border border-transparent'
                }`}
              >
                <LayoutPreview preset={preset} isActive={currentLayoutId === preset.id} />
                <span className="text-[12px] text-[#a1a1aa] truncate w-full text-center">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export { LAYOUT_PRESETS };
export type { WindowLayout, LayoutPreset };

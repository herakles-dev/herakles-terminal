import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../../services/api';
import { TemplateIconButton } from './TemplateIconButton';
import {
  DeployIcon,
  TerminalIcon,
  LightbulbIcon,
  ChipIcon,
  SparkleIcon,
} from './icons';

interface Template {
  id: string;
  name: string;
  category: string;
  command: string;
  description?: string;
  variables?: { name: string; default?: string; required?: boolean; description?: string }[];
  isBuiltIn: boolean;
}

interface CategoryConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
  highlight?: boolean;
}

const CATEGORIES: CategoryConfig[] = [
  { id: 'orchestrate', label: 'Orchestrate', icon: <SparkleIcon className="w-[18px] h-[18px]" />, highlight: true },
  { id: 'observe', label: 'Observe', icon: <LightbulbIcon className="w-[18px] h-[18px]" /> },
  { id: 'develop', label: 'Develop', icon: <TerminalIcon className="w-[18px] h-[18px]" /> },
  { id: 'ship', label: 'Ship', icon: <DeployIcon className="w-[18px] h-[18px]" /> },
  { id: 'session', label: 'Session', icon: <ChipIcon className="w-[18px] h-[18px]" /> },
];

export interface TemplateToolbarProps {
  onExecuteCommand: (command: string) => void;
  visible?: boolean;
  /** Render only the mobile hamburger (skip desktop icons) */
  mobileOnly?: boolean;
}

export function TemplateToolbar({ onExecuteCommand, visible = true, mobileOnly = false }: TemplateToolbarProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const fetchTemplates = async () => {
      try {
        const res = await fetch(apiUrl('/templates'), { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await res.json();
        const all: Template[] = [
          ...(json.data?.builtIn || []),
          ...(json.data?.custom || []),
        ];
        if (!cancelled) {
          setTemplates(all);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTemplates();
    return () => { cancelled = true; };
  }, [visible]);

  // Close mobile menu on outside click/tap
  useEffect(() => {
    if (!mobileOpen) return;
    const handleOutside = (e: Event) => {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    // Use pointerdown — works for both mouse and touch, avoids touchstart/click race
    const frame = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handleOutside);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handleOutside);
    };
  }, [mobileOpen]);

  const handleExecute = useCallback((command: string) => {
    onExecuteCommand(command);
    setMobileOpen(false);
  }, [onExecuteCommand]);

  if (!visible) return null;

  // Filter categories that have templates
  const activeCategories = CATEGORIES.filter(cat =>
    templates.some(t => t.category === cat.id)
  );
  const hasTemplates = activeCategories.length > 0;

  const mobileMenu = (
    <div className={mobileOnly ? 'relative' : 'sm:hidden relative'} ref={mobileRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setMobileOpen(prev => !prev); }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`p-2.5 rounded-md transition-all duration-150 ${
          mobileOpen
            ? 'text-[#00d4ff] bg-[#00d4ff]/10'
            : 'text-[#71717a] active:text-[#a1a1aa] active:bg-white/[0.06]'
        }`}
        title="Templates"
        aria-label="Templates menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {mobileOpen && (
        <div className="absolute top-full right-0 mt-2 w-[260px] sm:w-[240px] max-h-[60vh] overflow-y-auto bg-[#0a0a0f]/95 backdrop-blur-lg border border-[#27272a] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-[9999] animate-scale-in" style={{ touchAction: 'pan-y' }}>
          <div className="p-2">
            {/* Quick actions — always available */}
            <div className="mb-2">
              <div className="flex items-center gap-2 px-2 py-1.5 text-[#71717a]">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
                <span className="text-[11px] font-semibold uppercase tracking-wider">Quick Actions</span>
              </div>
              {[
                { label: 'Clear Screen', cmd: 'clear\r' },
                { label: 'Cancel Command', cmd: '\x03' },
                { label: 'New Window', cmd: '__NEW_WINDOW__' },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => {
                    if (action.cmd === '__NEW_WINDOW__') {
                      // Dispatch keyboard shortcut for new window
                      document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'T', ctrlKey: true, shiftKey: true, bubbles: true,
                      }));
                      setMobileOpen(false);
                    } else {
                      handleExecute(action.cmd);
                    }
                  }}
                  className="w-full text-left px-3 py-2.5 sm:py-1.5 text-[12px] sm:text-[11px] text-[#a1a1aa] hover:text-[#00d4ff] hover:bg-[#27272a]/40 active:bg-[#27272a]/60 rounded transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Template categories — only when loaded */}
            {activeCategories.map(cat => {
              const catTemplates = templates.filter(t => t.category === cat.id);
              return (
                <div key={cat.id} className="mb-2 last:mb-0">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[#71717a]">
                    {cat.icon}
                    <span className="text-[11px] font-semibold uppercase tracking-wider">{cat.label}</span>
                    <span className="text-[10px] text-[#3f3f46] ml-auto">{catTemplates.length}</span>
                  </div>
                  {catTemplates.map(t => {
                    const hasVars = t.variables && t.variables.length > 0;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (!hasVars) {
                            handleExecute(t.command + '\r');
                          }
                        }}
                        className={`w-full text-left px-3 py-2.5 sm:py-1.5 text-[12px] sm:text-[11px] hover:bg-[#27272a]/40 active:bg-[#27272a]/60 rounded transition-colors flex items-center gap-1.5 ${
                          hasVars ? 'text-[#71717a]' : 'text-[#a1a1aa] hover:text-[#00d4ff]'
                        }`}
                      >
                        <span className="truncate">{t.name}</span>
                        {hasVars && (
                          <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-white/[0.04] text-[#52525b]">vars</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {loading && (
              <div className="px-3 py-2 text-[11px] text-[#52525b]">Loading templates...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (mobileOnly) return mobileMenu;

  return (
    <>
      {/* Desktop: inline icon bar (only when templates loaded) */}
      {hasTemplates && (
        <div className="hidden sm:flex items-center gap-0.5">
          <div className="w-px h-5 bg-gradient-to-b from-transparent via-[#27272a] to-transparent mx-1" />
          {activeCategories.map(cat => (
            <TemplateIconButton
              key={cat.id}
              icon={cat.icon}
              label={cat.label}
              categoryId={cat.id}
              templates={templates}
              onExecute={handleExecute}
              highlight={cat.highlight}
            />
          ))}
          <div className="w-px h-5 bg-gradient-to-b from-transparent via-[#27272a] to-transparent mx-1" />
        </div>
      )}

      {/* Mobile: hamburger menu (sm:hidden) — always shows, has quick actions even without templates */}
      {mobileMenu}
    </>
  );
}

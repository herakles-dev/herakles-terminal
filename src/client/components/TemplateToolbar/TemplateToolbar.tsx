import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
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

  const dropdownContent = mobileOpen ? (
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
                  onClick={() => { if (!hasVars) handleExecute(t.command + '\r'); }}
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
  ) : null;

  const mobileMenu = (
    <div className={mobileOnly ? 'relative' : 'sm:hidden relative'} ref={mobileRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setMobileOpen(prev => !prev); }}
        className={`p-2.5 rounded-md transition-all duration-150 ${
          mobileOpen
            ? 'text-[#00d4ff] bg-[#00d4ff]/10'
            : 'text-[#71717a] active:text-[#a1a1aa] active:bg-white/[0.06]'
        }`}
        title="Templates"
        aria-label="Templates menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      </button>

      {/* Portal the dropdown to document.body so it escapes all overflow/stacking contexts */}
      {mobileOpen && createPortal(
        <>
          {/* Backdrop — tap to close */}
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9998,
              background: 'rgba(0,0,0,0.4)',
            }}
          />
          {/* Dropdown panel */}
          <div
            style={{
              position: 'fixed',
              top: 48,
              right: 8,
              width: 260,
              maxHeight: '70vh',
              overflowY: 'auto',
              zIndex: 9999,
              background: 'rgba(10, 10, 15, 0.97)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              touchAction: 'pan-y',
            }}
          >
            {dropdownContent}
          </div>
        </>,
        document.body
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

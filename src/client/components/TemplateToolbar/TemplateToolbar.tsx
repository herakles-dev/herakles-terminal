import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../../services/api';
import { TemplateIconButton } from './TemplateIconButton';
import {
  RocketIcon,
  TeamIcon,
  BrainIcon,
  ShieldIcon,
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
}

const CATEGORIES: CategoryConfig[] = [
  { id: 'v9-start', label: 'Project Start', icon: <RocketIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-formation', label: 'Formations', icon: <TeamIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-effort', label: 'Effort & Thinking', icon: <BrainIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-autonomy', label: 'Autonomy', icon: <ShieldIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-deploy', label: 'Deploy & Ops', icon: <DeployIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-scripts', label: 'CLI Scripts', icon: <TerminalIcon className="w-[18px] h-[18px]" /> },
  { id: 'v9-tips', label: 'Quick Ref', icon: <LightbulbIcon className="w-[18px] h-[18px]" /> },
  { id: 'cc-model', label: 'Models', icon: <ChipIcon className="w-[18px] h-[18px]" /> },
  { id: 'claude-meta', label: 'Meta-Prompts', icon: <SparkleIcon className="w-[18px] h-[18px]" /> },
];

export interface TemplateToolbarProps {
  onExecuteCommand: (command: string) => void;
  visible?: boolean;
}

export function TemplateToolbar({ onExecuteCommand, visible = true }: TemplateToolbarProps) {
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
        if (!res.ok) return;
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

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mobileOpen]);

  const handleExecute = useCallback((command: string) => {
    onExecuteCommand(command);
    setMobileOpen(false);
  }, [onExecuteCommand]);

  if (!visible || loading) return null;

  // Filter categories that have templates
  const activeCategories = CATEGORIES.filter(cat =>
    templates.some(t => t.category === cat.id)
  );

  if (activeCategories.length === 0) return null;

  return (
    <>
      {/* Desktop: inline icon bar */}
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
          />
        ))}
        <div className="w-px h-5 bg-gradient-to-b from-transparent via-[#27272a] to-transparent mx-1" />
      </div>

      {/* Mobile: hamburger toggle */}
      <div className="sm:hidden relative" ref={mobileRef}>
        <button
          onClick={() => setMobileOpen(prev => !prev)}
          className={`p-1.5 rounded-md transition-all duration-150 ${
            mobileOpen
              ? 'text-[#00d4ff] bg-[#00d4ff]/10'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
          title="Templates"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {mobileOpen && (
          <div className="absolute top-full right-0 mt-2 w-[240px] max-h-[60vh] overflow-y-auto bg-[#0a0a0f] border border-[#27272a] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-[9999] animate-scale-in">
            <div className="p-2">
              {activeCategories.map(cat => {
                const catTemplates = templates.filter(t => t.category === cat.id);
                return (
                  <div key={cat.id} className="mb-2 last:mb-0">
                    <div className="flex items-center gap-2 px-2 py-1.5 text-[#71717a]">
                      {cat.icon}
                      <span className="text-[11px] font-semibold uppercase tracking-wider">{cat.label}</span>
                      <span className="text-[10px] text-[#3f3f46] ml-auto">{catTemplates.length}</span>
                    </div>
                    {catTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (!t.variables || t.variables.length === 0) {
                            handleExecute(t.command + '\r');
                          }
                          // For templates with variables, user should use the SidePanel
                        }}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-[#a1a1aa] hover:text-[#00d4ff] hover:bg-[#27272a]/40 rounded transition-colors truncate"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

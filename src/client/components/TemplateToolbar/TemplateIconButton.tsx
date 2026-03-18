import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface Template {
  id: string;
  name: string;
  category: string;
  command: string;
  description?: string;
  variables?: { name: string; default?: string; required?: boolean; description?: string }[];
  isBuiltIn: boolean;
}

interface TemplateIconButtonProps {
  icon: React.ReactNode;
  label: string;
  categoryId: string;
  templates: Template[];
  onExecute: (command: string) => void;
  highlight?: boolean;
}

export function TemplateIconButton({ icon, label, categoryId, templates, onExecute, highlight }: TemplateIconButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [variableInputs, setVariableInputs] = useState<Record<string, Record<string, string>>>({});
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 280;
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 8) {
        left = window.innerWidth - dropdownWidth - 8;
      }
      setDropdownPos({
        top: rect.bottom + 6,
        left,
      });
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
    updatePosition();
    setIsOpen(true);
  }, [updatePosition]);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      setExpandedTemplate(null);
    }, 200);
  }, []);

  const handleDropdownEnter = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handleDropdownLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      setExpandedTemplate(null);
    }, 200);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hoverTimeoutRef.current);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setExpandedTemplate(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleTemplateClick = useCallback((template: Template) => {
    if (template.variables && template.variables.length > 0) {
      // Toggle expanded state for variable input
      if (expandedTemplate === template.id) {
        setExpandedTemplate(null);
      } else {
        setExpandedTemplate(template.id);
        // Initialize variable inputs with defaults
        if (!variableInputs[template.id]) {
          const initial: Record<string, string> = {};
          template.variables.forEach(v => {
            initial[v.name] = v.default || '';
          });
          setVariableInputs(prev => ({ ...prev, [template.id]: initial }));
        }
      }
      return;
    }
    // No variables - execute directly
    onExecute(template.command + '\r');
    setIsOpen(false);
  }, [expandedTemplate, variableInputs, onExecute]);

  const handleExecuteWithVars = useCallback((template: Template) => {
    let command = template.command;
    const vars = variableInputs[template.id] || {};
    for (const v of template.variables || []) {
      const value = vars[v.name] || v.default || '';
      command = command.replace(new RegExp(`\\{\\{${v.name}\\}\\}`, 'g'), value);
    }
    onExecute(command + '\r');
    setIsOpen(false);
    setExpandedTemplate(null);
  }, [variableInputs, onExecute]);

  const categoryTemplates = templates.filter(t => t.category === categoryId);
  if (categoryTemplates.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => {
          updatePosition();
          setIsOpen(prev => !prev);
        }}
        className={`p-1.5 rounded-md transition-all duration-150 ${
          isOpen
            ? 'text-[#00d4ff] bg-[#00d4ff]/10 shadow-[0_0_8px_rgba(0,212,255,0.15)]'
            : highlight
              ? 'text-[#00d4ff]/70 hover:text-[#00d4ff] hover:bg-[#00d4ff]/5 drop-shadow-[0_0_4px_rgba(0,212,255,0.3)]'
              : 'text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04]'
        }`}
        title={label}
      >
        {icon}
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
          className="fixed z-[9999] w-[280px] max-h-[400px] overflow-y-auto bg-[#0a0a0f] border border-[#27272a] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] animate-scale-in"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="sticky top-0 bg-[#0a0a0f] px-3 py-2 border-b border-[#27272a]">
            <span className="text-[11px] font-semibold text-[#71717a] uppercase tracking-wider">{label}</span>
            <span className="ml-2 text-[10px] text-[#3f3f46]">{categoryTemplates.length}</span>
          </div>
          <div className="p-1.5">
            {categoryTemplates.map((template, idx) => (
              <div key={template.id}>
                <button
                  onClick={() => handleTemplateClick(template)}
                  className={`w-full text-left px-2.5 py-2 rounded-md hover:bg-[#27272a]/60 transition-colors group ${
                    highlight && idx === 0 ? 'border-l-2 border-[#00d4ff] pl-2' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] group-hover:text-[#00d4ff] transition-colors font-medium truncate flex-1 ${
                      highlight && idx === 0 ? 'text-[#00d4ff]' : 'text-[#d4d4d8]'
                    }`}>
                      {template.name}
                    </span>
                    {template.variables && template.variables.length > 0 ? (
                      <svg className={`w-3 h-3 text-[#3f3f46] transition-transform ${expandedTemplate === template.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3 text-[#3f3f46] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-[10px] text-[#52525b] mt-0.5 truncate">{template.description}</p>
                  )}
                </button>

                {/* Variable inputs */}
                {expandedTemplate === template.id && template.variables && (
                  <div className="mx-2.5 mb-2 p-2 bg-[#111118] rounded-md border border-[#27272a]/60">
                    {template.variables.map(v => (
                      <div key={v.name} className="mb-1.5 last:mb-0">
                        <label className="text-[10px] text-[#71717a] mb-0.5 block">
                          {v.name}{v.required && <span className="text-[#ef4444]">*</span>}
                        </label>
                        <input
                          type="text"
                          value={variableInputs[template.id]?.[v.name] || ''}
                          onChange={e => {
                            setVariableInputs(prev => ({
                              ...prev,
                              [template.id]: {
                                ...prev[template.id],
                                [v.name]: e.target.value,
                              },
                            }));
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleExecuteWithVars(template);
                            e.stopPropagation();
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          placeholder={v.description || v.default || ''}
                          className="w-full bg-[#0a0a0f] border border-[#3f3f46] rounded px-2 py-1 text-[11px] text-white focus:border-[#00d4ff]/40 focus:outline-none"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => handleExecuteWithVars(template)}
                      className="w-full mt-1.5 py-1 bg-[#00d4ff]/10 text-[#00d4ff] text-[10px] font-semibold rounded hover:bg-[#00d4ff]/20 border border-[#00d4ff]/20 transition-colors"
                    >
                      Execute
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

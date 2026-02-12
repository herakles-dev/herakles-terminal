import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../services/api';

interface TemplatePanelProps {
  onExecute: (command: string) => void;
}

interface TemplateVariable {
  name: string;
  default?: string;
  required?: boolean;
  description?: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  command: string;
  description?: string;
  variables?: TemplateVariable[];
  isBuiltIn: boolean;
}

interface HiddenTemplate {
  id: string;
  name: string;
  category: string;
}

interface TemplatesResponse {
  builtIn: Template[];
  custom: Template[];
  hidden?: HiddenTemplate[];
}

interface GroupInfo {
  name: string;
  count: number;
  isBuiltIn: boolean;
}

type ViewMode = 'list' | 'detail' | 'create' | 'edit' | 'group-manage';

// Inline confirmation dialog (replaces browser confirm())
function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-5 max-w-sm mx-4 shadow-xl">
        <p className="text-sm text-[#d4d4d8] mb-4">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-[#a1a1aa] bg-[#27272a] rounded hover:bg-[#3f3f46] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm text-white bg-[#ef4444]/80 rounded hover:bg-[#ef4444] transition-colors"
          >
            {confirmLabel || 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatePanel({ onExecute }: TemplatePanelProps) {
  const [templates, setTemplates] = useState<TemplatesResponse>({ builtIn: [], custom: [] });
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<Template[]>([]);
  const [multiVariables, setMultiVariables] = useState<Record<string, Record<string, string>>>({});
  const [showMultiReview, setShowMultiReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Group management state
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupRenameValue, setGroupRenameValue] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    category: 'custom',
    command: '',
    description: '',
    variables: [] as TemplateVariable[],
  });
  const [newVarName, setNewVarName] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const [templatesRes, categoriesRes, groupsRes] = await Promise.all([
        apiClient.get<TemplatesResponse>('/templates'),
        apiClient.get<string[]>('/templates/categories'),
        apiClient.get<GroupInfo[]>('/templates/groups'),
      ]);
      setTemplates(templatesRes.data || { builtIn: [], custom: [] });
      setCategories(['all', ...(categoriesRes.data || [])]);
      setGroups(groupsRes.data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template: Template) => {
    if (multiSelectMode) {
      toggleMultiSelect(template);
      return;
    }
    setSelectedTemplate(template);
    const initialVars: Record<string, string> = {};
    (template.variables || []).forEach((v) => {
      initialVars[v.name] = v.default || '';
    });
    setVariables(initialVars);
    setViewMode('detail');
  };

  const toggleMultiSelect = (template: Template) => {
    const index = selectedTemplates.findIndex(t => t.id === template.id);
    if (index >= 0) {
      setSelectedTemplates(selectedTemplates.filter(t => t.id !== template.id));
      const newVars = { ...multiVariables };
      delete newVars[template.id];
      setMultiVariables(newVars);
    } else {
      setSelectedTemplates([...selectedTemplates, template]);
      const initialVars: Record<string, string> = {};
      (template.variables || []).forEach((v) => {
        initialVars[v.name] = v.default || '';
      });
      setMultiVariables({ ...multiVariables, [template.id]: initialVars });
    }
  };

  const getSelectionOrder = (templateId: string): number => {
    return selectedTemplates.findIndex(t => t.id === templateId) + 1;
  };

  const clearMultiSelect = () => {
    setSelectedTemplates([]);
    setMultiVariables({});
    setMultiSelectMode(false);
    setShowMultiReview(false);
  };

  const executeMultipleTemplates = async () => {
    const commands: string[] = [];
    for (const template of selectedTemplates) {
      try {
        const response = await apiClient.post<{ command: string }>('/templates/execute', {
          templateId: template.id,
          variables: multiVariables[template.id] || {},
        });
        if (response.data?.command) {
          commands.push(response.data.command);
        }
      } catch (err) {
        console.error(`Failed to execute template ${template.name}:`, err);
      }
    }
    if (commands.length > 0) {
      const fullCommand = commands.join(' && ');
      onExecute(fullCommand);
      setTimeout(() => onExecute('\r'), 50);
    }
    clearMultiSelect();
  };

  const handleExecuteTemplate = async () => {
    if (!selectedTemplate) return;
    try {
      const response = await apiClient.post<{ command: string }>('/templates/execute', {
        templateId: selectedTemplate.id,
        variables,
      });
      const cmd = response.data?.command || '';
      onExecute(cmd);
      setTimeout(() => onExecute('\r'), 50);
      setSelectedTemplate(null);
      setVariables({});
      setViewMode('list');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: { message?: string } } } };
      console.error('Failed to execute template:', error.response?.data?.error?.message);
    }
  };

  const handleCreateTemplate = async () => {
    if (!formData.name || !formData.command) return;
    try {
      await apiClient.post('/templates', {
        name: formData.name,
        category: formData.category,
        command: formData.command,
        description: formData.description,
        variables: formData.variables,
      });
      resetForm();
      setViewMode('list');
      loadTemplates();
      showToast('Template created');
    } catch (err) {
      console.error('Failed to create template:', err);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!selectedTemplate || !formData.name || !formData.command) return;
    try {
      await apiClient.put(`/templates/${selectedTemplate.id}`, {
        name: formData.name,
        category: formData.category,
        command: formData.command,
        description: formData.description,
        variables: formData.variables,
      });
      resetForm();
      setSelectedTemplate(null);
      setViewMode('list');
      loadTemplates();
      showToast('Template updated');
    } catch (err) {
      console.error('Failed to update template:', err);
    }
  };

  const handleDeleteTemplate = (id: string, name: string, isBuiltIn: boolean) => {
    const message = isBuiltIn
      ? `Hide system template "${name}"? You can restore it from Manage Groups.`
      : `Delete template "${name}"? This cannot be undone.`;
    setConfirmDialog({
      message,
      confirmLabel: isBuiltIn ? 'Hide' : 'Delete',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          if (isBuiltIn) {
            await apiClient.post(`/templates/hide/${id}`);
            showToast('Template hidden');
          } else {
            await apiClient.delete(`/templates/${id}`);
            showToast('Template deleted');
          }
          setSelectedTemplate(null);
          setViewMode('list');
          loadTemplates();
        } catch (err) {
          console.error('Failed to delete/hide template:', err);
        }
      },
    });
  };

  const handleUnhideTemplate = async (id: string) => {
    try {
      await apiClient.post(`/templates/unhide/${id}`);
      loadTemplates();
      showToast('Template restored');
    } catch (err) {
      console.error('Failed to unhide template:', err);
    }
  };

  const handleUnhideAll = async () => {
    try {
      await apiClient.post('/templates/unhide-all');
      loadTemplates();
      showToast('All hidden templates restored');
    } catch (err) {
      console.error('Failed to unhide all:', err);
    }
  };

  const handleHideGroup = (groupName: string) => {
    const groupTemplates = templates.builtIn.filter(t => t.category === groupName);
    if (groupTemplates.length === 0) return;
    setConfirmDialog({
      message: `Hide all ${groupTemplates.length} system template(s) in "${groupName}"? You can restore them individually.`,
      confirmLabel: 'Hide All',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await apiClient.post('/templates/batch-hide', {
            templateIds: groupTemplates.map(t => t.id),
          });
          loadTemplates();
          showToast(`${groupTemplates.length} template(s) hidden`);
        } catch (err) {
          console.error('Failed to hide group:', err);
        }
      },
    });
  };

  const handleBatchDelete = () => {
    const customSelected = selectedTemplates.filter(t => !t.isBuiltIn);
    if (customSelected.length === 0) {
      showToast('No custom templates selected');
      return;
    }
    setConfirmDialog({
      message: `Delete ${customSelected.length} custom template${customSelected.length > 1 ? 's' : ''}? Built-in templates will be skipped.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await apiClient.post('/templates/batch-delete', {
            templateIds: customSelected.map(t => t.id),
          });
          clearMultiSelect();
          loadTemplates();
          showToast(`${customSelected.length} template(s) deleted`);
        } catch (err) {
          console.error('Failed to batch delete:', err);
        }
      },
    });
  };

  const handleBatchMove = async (category: string) => {
    const customSelected = selectedTemplates.filter(t => !t.isBuiltIn);
    if (customSelected.length === 0) {
      showToast('No custom templates selected');
      return;
    }
    try {
      await apiClient.post('/templates/batch-move', {
        templateIds: customSelected.map(t => t.id),
        category,
      });
      clearMultiSelect();
      loadTemplates();
      showToast(`Moved ${customSelected.length} template(s) to "${category}"`);
    } catch (err) {
      console.error('Failed to batch move:', err);
    }
  };

  const handleEditTemplate = (template: Template) => {
    if (template.isBuiltIn) {
      // Fork: open create form pre-filled with system template data
      setSelectedTemplate(null);
      setFormData({
        name: template.name + ' (Custom)',
        category: template.category,
        command: template.command,
        description: template.description || '',
        variables: template.variables || [],
      });
      setViewMode('create');
      showToast('Forking system template to custom');
    } else {
      setSelectedTemplate(template);
      setFormData({
        name: template.name,
        category: template.category,
        command: template.command,
        description: template.description || '',
        variables: template.variables || [],
      });
      setViewMode('edit');
    }
  };

  const handleQuickExecute = async (template: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.variables && template.variables.length > 0) {
      handleSelectTemplate(template);
      return;
    }
    try {
      const response = await apiClient.post<{ command: string }>('/templates/execute', {
        templateId: template.id,
        variables: {},
      });
      const cmd = response.data?.command || '';
      onExecute(cmd);
      setTimeout(() => onExecute('\r'), 50);
    } catch (err) {
      console.error('Failed to execute template:', err);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', category: 'custom', command: '', description: '', variables: [] });
    setNewVarName('');
  };

  const addVariable = () => {
    if (!newVarName.trim()) return;
    setFormData({
      ...formData,
      variables: [...formData.variables, { name: newVarName.trim(), required: false }],
    });
    setNewVarName('');
  };

  const removeVariable = (index: number) => {
    setFormData({
      ...formData,
      variables: formData.variables.filter((_, i) => i !== index),
    });
  };

  const updateVariable = (index: number, field: keyof TemplateVariable, value: string | boolean) => {
    const updated = [...formData.variables];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, variables: updated });
  };

  // --- Group Management ---

  const handleRenameGroup = async (oldName: string) => {
    if (!groupRenameValue.trim() || groupRenameValue.trim() === oldName) {
      setEditingGroup(null);
      return;
    }
    try {
      await apiClient.put(`/templates/groups/${encodeURIComponent(oldName)}`, {
        newName: groupRenameValue.trim(),
      });
      setEditingGroup(null);
      loadTemplates();
      showToast(`Group renamed to "${groupRenameValue.trim()}"`);
    } catch (err) {
      console.error('Failed to rename group:', err);
    }
  };

  const handleDeleteGroup = (groupName: string) => {
    const group = groups.find(g => g.name === groupName);
    if (!group || group.isBuiltIn) return;
    setConfirmDialog({
      message: `Delete group "${groupName}" and its ${group.count} template(s)? Or move them to "custom"?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await apiClient.delete(`/templates/groups/${encodeURIComponent(groupName)}`);
          loadTemplates();
          if (selectedCategory === groupName) setSelectedCategory('all');
          showToast(`Group "${groupName}" deleted`);
        } catch (err) {
          console.error('Failed to delete group:', err);
        }
      },
    });
  };

  const handleMoveGroupTemplates = async (groupName: string) => {
    try {
      await apiClient.delete(`/templates/groups/${encodeURIComponent(groupName)}?action=move`);
      loadTemplates();
      if (selectedCategory === groupName) setSelectedCategory('all');
      showToast(`Templates moved to "custom"`);
    } catch (err) {
      console.error('Failed to move group templates:', err);
    }
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    // Groups are implicit — they appear when templates use the category.
    // So we just set the form category to the new group name and switch to create mode.
    setFormData({ ...formData, category: newGroupName.trim() });
    setNewGroupName('');
    setViewMode('create');
    showToast(`Create a template in "${newGroupName.trim()}" to add the group`);
  };

  const startGroupEdit = (groupName: string) => {
    setEditingGroup(groupName);
    setGroupRenameValue(groupName);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  // Get custom categories for the category selector dropdown
  const customCategories = categories.filter(c => c !== 'all');

  const allTemplates = [...templates.builtIn, ...templates.custom];
  const filteredTemplates = allTemplates.filter((t) => {
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesSearch = searchQuery === '' ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.command.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Toast notification
  const toastEl = toast ? (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#18181b] border border-[#00d4ff]/20 text-[#00d4ff] text-sm rounded-lg shadow-lg animate-pulse">
      {toast}
    </div>
  ) : null;

  // --- GROUP MANAGEMENT VIEW ---
  if (viewMode === 'group-manage') {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        {toastEl}
        {confirmDialog && (
          <ConfirmDialog
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
        <button
          onClick={() => setViewMode('list')}
          className="flex items-center gap-2 text-[#a1a1aa] hover:text-white text-base mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h3 className="text-lg font-semibold text-white mb-4">Manage Groups</h3>

        {/* Create new group */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
            placeholder="New group name..."
            className="flex-1 bg-[#08080e] border border-[#00d4ff]/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/30 focus:outline-none placeholder:text-[#3a3a42]"
          />
          <button
            onClick={handleCreateGroup}
            disabled={!newGroupName.trim()}
            className="px-3 py-2 bg-[#00d4ff]/10 text-[#00d4ff] text-sm rounded-lg border border-[#00d4ff]/20 hover:bg-[#00d4ff]/15 disabled:opacity-40 transition-all"
          >
            Add
          </button>
        </div>

        {/* Group list */}
        <div className="space-y-1.5">
          {groups.map((group) => (
            <div
              key={group.name}
              className="flex items-center gap-2 p-2.5 bg-[#08080e] border border-[#00d4ff]/5 rounded-lg group"
            >
              {editingGroup === group.name ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={groupRenameValue}
                  onChange={(e) => setGroupRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameGroup(group.name);
                    if (e.key === 'Escape') setEditingGroup(null);
                  }}
                  onBlur={() => handleRenameGroup(group.name)}
                  className="flex-1 bg-[#18181b] border border-[#00d4ff]/30 rounded px-2 py-1 text-sm text-white focus:outline-none"
                />
              ) : (
                <span className="flex-1 text-sm text-[#e0e0e8]">{group.name}</span>
              )}

              <span className="text-[11px] text-[#8a8a92] tabular-nums">{group.count}</span>

              {group.isBuiltIn ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#8b5cf6] font-semibold uppercase tracking-wider">System</span>
                  <button
                    onClick={() => handleHideGroup(group.name)}
                    className="p-1 text-[#3a3a42] hover:text-[#ef4444] rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Hide all templates in this group"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startGroupEdit(group.name)}
                    className="p-1 text-[#a1a1aa] hover:text-[#00d4ff] rounded"
                    title="Rename"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveGroupTemplates(group.name)}
                    className="p-1 text-[#a1a1aa] hover:text-[#eab308] rounded"
                    title="Move all to custom"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.name)}
                    className="p-1 text-[#a1a1aa] hover:text-[#ef4444] rounded"
                    title="Delete group & templates"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {groups.length === 0 && (
          <p className="text-[12px] text-[#3a3a42] italic text-center py-6">
            No custom groups yet. Create templates to add groups.
          </p>
        )}

        {/* Hidden Templates Section */}
        {templates.hidden && templates.hidden.length > 0 && (
          <>
            <div className="flex items-center justify-between mt-6 mb-3">
              <h4 className="text-sm font-semibold text-[#a1a1aa]">
                Hidden Templates ({templates.hidden.length})
              </h4>
              <button
                onClick={handleUnhideAll}
                className="text-[11px] text-[#00d4ff]/70 hover:text-[#00d4ff] transition-colors"
              >
                Restore All
              </button>
            </div>
            <div className="space-y-1.5">
              {templates.hidden.map((ht) => (
                <div
                  key={ht.id}
                  className="flex items-center gap-2 p-2.5 bg-[#08080e]/60 border border-[#27272a]/50 rounded-lg"
                >
                  <svg className="w-3.5 h-3.5 text-[#3a3a42] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                  </svg>
                  <span className="flex-1 text-sm text-[#8a8a92]">{ht.name}</span>
                  <span className="text-[10px] text-[#3a3a42]">{ht.category}</span>
                  <button
                    onClick={() => handleUnhideTemplate(ht.id)}
                    className="p-1 text-[#3a3a42] hover:text-[#00d4ff] rounded transition-colors"
                    title="Restore"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // --- CREATE / EDIT VIEW ---
  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        {toastEl}
        <button
          onClick={() => { resetForm(); setSelectedTemplate(null); setViewMode('list'); }}
          className="flex items-center gap-2 text-[#a1a1aa] hover:text-white text-base mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h3 className="text-lg font-semibold text-white mb-4">
          {viewMode === 'edit' ? 'Edit Template' : 'New Template'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Template"
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Group</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none appearance-none"
            >
              {customCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                placeholder="Or type new group..."
                className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-white focus:border-[#00d4ff]/50 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    setFormData({ ...formData, category: (e.target as HTMLInputElement).value.trim() });
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What does this command do?"
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Command *</label>
            <textarea
              value={formData.command}
              onChange={(e) => setFormData({ ...formData, command: e.target.value })}
              placeholder="echo 'Hello {{name}}'"
              rows={3}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-[#00d4ff]/50 focus:outline-none resize-none"
            />
            <p className="mt-1 text-xs text-[#8a8a92]">Use {"{{variable}}"} for placeholders</p>
          </div>

          <div>
            <label className="block text-sm text-[#a1a1aa] mb-2">Variables</label>
            <div className="space-y-2">
              {formData.variables.map((v, i) => (
                <div key={i} className="flex items-center gap-2 bg-[#18181b] p-2 rounded-lg">
                  <span className="text-sm text-white flex-1">{v.name}</span>
                  <input
                    type="text"
                    value={v.default || ''}
                    onChange={(e) => updateVariable(i, 'default', e.target.value)}
                    placeholder="default"
                    className="w-20 bg-[#27272a] border border-[#3f3f46] rounded px-2 py-1 text-xs text-white"
                  />
                  <label className="flex items-center gap-1 text-xs text-[#a1a1aa]">
                    <input
                      type="checkbox"
                      checked={v.required || false}
                      onChange={(e) => updateVariable(i, 'required', e.target.checked)}
                      className="rounded"
                    />
                    Req
                  </label>
                  <button
                    onClick={() => removeVariable(i)}
                    className="text-[#a1a1aa] hover:text-[#ef4444]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addVariable()}
                  placeholder="Variable name"
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
                />
                <button
                  onClick={addVariable}
                  className="px-3 py-1.5 bg-[#27272a] text-[#a1a1aa] text-sm rounded hover:bg-[#3f3f46] hover:text-white"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={viewMode === 'edit' ? handleUpdateTemplate : handleCreateTemplate}
            disabled={!formData.name || !formData.command}
            className="w-full py-2 bg-[#00d4ff]/10 text-[#00d4ff] font-semibold rounded-lg hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {viewMode === 'edit' ? 'Update Template' : 'Create Template'}
          </button>
        </div>
      </div>
    );
  }

  // --- DETAIL VIEW ---
  if (viewMode === 'detail' && selectedTemplate) {
    const hasRequiredMissing = (selectedTemplate.variables || []).some(
      (v) => v.required && !variables[v.name]
    );

    return (
      <div className="h-full flex flex-col p-4">
        {toastEl}
        {confirmDialog && (
          <ConfirmDialog
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
        <button
          onClick={() => { setSelectedTemplate(null); setViewMode('list'); }}
          className="flex items-center gap-2 text-[#a1a1aa] hover:text-white text-base mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to templates
        </button>

        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{selectedTemplate.name}</h3>
            <div className="flex gap-1">
              <button
                onClick={() => handleEditTemplate(selectedTemplate)}
                className="p-1.5 text-[#a1a1aa] hover:text-[#00d4ff] rounded hover:bg-[#00d4ff]/10 transition-all"
                title={selectedTemplate.isBuiltIn ? 'Fork to custom' : 'Edit'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDeleteTemplate(selectedTemplate.id, selectedTemplate.name, selectedTemplate.isBuiltIn)}
                className="p-1.5 text-[#a1a1aa] hover:text-[#ef4444] rounded hover:bg-[#ef4444]/10 transition-all"
                title={selectedTemplate.isBuiltIn ? 'Hide' : 'Delete'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {selectedTemplate.isBuiltIn ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-[#8a8a92] px-2 py-0.5 bg-[#0c0c12] rounded">{selectedTemplate.category}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${selectedTemplate.isBuiltIn ? 'text-[#8b5cf6]' : 'text-[#00d4ff]/60'}`}>
              {selectedTemplate.isBuiltIn ? 'System' : 'Custom'}
            </span>
          </div>
          {selectedTemplate.description && (
            <p className="text-sm text-[#a1a1aa] mt-2">{selectedTemplate.description}</p>
          )}
        </div>

        <div className="bg-[#18181b] rounded-lg p-3 mb-4 font-mono text-sm text-[#d4d4d8]">
          {selectedTemplate.command}
        </div>

        {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
          <div className="space-y-4 mb-4">
            <h4 className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">Variables</h4>
            {selectedTemplate.variables.map((v) => (
              <div key={v.name}>
                <label className="block text-sm text-[#d4d4d8] mb-1">
                  {v.name}
                  {v.required && <span className="text-[#ef4444] ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={variables[v.name] || ''}
                  onChange={(e) => setVariables({ ...variables, [v.name]: e.target.value })}
                  placeholder={v.description || v.default || ''}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleExecuteTemplate}
          disabled={hasRequiredMissing}
          className="w-full py-2 bg-[#00d4ff]/10 text-[#00d4ff] font-semibold rounded-lg hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Execute Command
        </button>
      </div>
    );
  }

  // --- MULTI REVIEW VIEW ---
  if (showMultiReview && selectedTemplates.length > 0) {
    const hasRequiredMissing = selectedTemplates.some(t =>
      (t.variables || []).some(v => v.required && !multiVariables[t.id]?.[v.name])
    );

    return (
      <div className="h-full flex flex-col p-4">
        {toastEl}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setShowMultiReview(false)}
            className="flex items-center gap-2 text-[#a1a1aa] hover:text-white text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Add more
          </button>
          <button
            onClick={clearMultiSelect}
            className="text-sm text-[#a1a1aa] hover:text-[#ef4444]"
          >
            Clear all
          </button>
        </div>
        <h3 className="text-lg font-semibold text-white mb-3">Review ({selectedTemplates.length})</h3>

        <div className="flex-1 overflow-y-auto space-y-3">
          {selectedTemplates.map((template, idx) => (
            <div key={template.id} className="bg-[#18181b] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 flex items-center justify-center bg-[#00d4ff]/20 text-[#00d4ff] rounded-full text-xs font-bold">
                  {idx + 1}
                </span>
                <span className="font-medium text-white flex-1">{template.name}</span>
                <button
                  onClick={() => toggleMultiSelect(template)}
                  className="text-[#a1a1aa] hover:text-[#ef4444]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-[#a1a1aa] font-mono mb-2 truncate">{template.command}</p>
              {(template.variables || []).length > 0 && (
                <div className="space-y-2 mt-2 pt-2 border-t border-[#27272a]">
                  {template.variables!.map((v) => (
                    <div key={v.name} className="flex items-center gap-2">
                      <label className="text-xs text-[#a1a1aa] w-20 truncate">
                        {v.name}{v.required && <span className="text-[#ef4444]">*</span>}
                      </label>
                      <input
                        type="text"
                        value={multiVariables[template.id]?.[v.name] || ''}
                        onChange={(e) => setMultiVariables({
                          ...multiVariables,
                          [template.id]: { ...multiVariables[template.id], [v.name]: e.target.value }
                        })}
                        placeholder={v.default || v.description || ''}
                        className="flex-1 bg-[#27272a] border border-[#3f3f46] rounded px-2 py-1 text-xs text-white focus:border-[#00d4ff]/50 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs text-[#8a8a92] text-center">Commands joined with &&</p>
          <button
            onClick={executeMultipleTemplates}
            disabled={hasRequiredMissing}
            className="w-full py-2 bg-[#00d4ff]/10 text-[#00d4ff] font-semibold rounded-lg hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Execute {selectedTemplates.length} Commands
          </button>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <div className="h-full flex flex-col overflow-y-auto p-4">
      {toastEl}
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Search + action bar */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search templates..."
          className="flex-1 bg-[#08080e] border border-[#00d4ff]/10 rounded-lg px-3 py-2 text-[#e0e0e4] text-sm focus:border-[#00d4ff]/30 focus:shadow-[0_0_12px_rgba(0,212,255,0.1)] focus:outline-none placeholder:text-[#3a3a42] transition-all duration-200"
        />
        <button
          onClick={() => setMultiSelectMode(!multiSelectMode)}
          className={`p-2 rounded-lg border transition-all duration-200 ${
            multiSelectMode
              ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/20 shadow-[0_0_8px_rgba(0,212,255,0.15)]'
              : 'bg-[#08080e] text-[#8a8a92] hover:text-[#a1a1aa] border-[#00d4ff]/5 hover:border-[#00d4ff]/15'
          }`}
          title="Multi-select"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>
        <button
          onClick={() => setViewMode('group-manage')}
          className="p-2 bg-[#08080e] text-[#8a8a92] hover:text-[#a1a1aa] rounded-lg border border-[#00d4ff]/5 hover:border-[#00d4ff]/15 transition-all duration-200"
          title="Manage Groups"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
        <button
          onClick={() => { resetForm(); setViewMode('create'); }}
          className="p-2 bg-[#00d4ff]/10 text-[#00d4ff] rounded-lg border border-[#00d4ff]/20 hover:bg-[#00d4ff]/15 hover:shadow-[0_0_12px_rgba(0,212,255,0.2)] transition-all duration-200"
          title="New Template"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Multi-select actions */}
      {multiSelectMode && (
        <div className="mb-2 space-y-1.5">
          <div className="px-2 py-1.5 bg-[#00b8db]/6 rounded text-[12px] text-[#00b8db]">
            Click to select. Order matters!
            {selectedTemplates.length > 0 && (
              <span className="ml-1.5 font-semibold">({selectedTemplates.length})</span>
            )}
          </div>
          {selectedTemplates.length > 0 && (
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowMultiReview(true)}
                className="flex-1 py-1.5 bg-[#00b8db]/10 text-[#00b8db] font-medium rounded hover:bg-[#00b8db]/15 transition-colors text-[13px]"
              >
                Execute ({selectedTemplates.length})
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 bg-[#ef4444]/10 text-[#ef4444] font-medium rounded hover:bg-[#ef4444]/15 transition-colors text-[13px]"
                title="Delete selected custom templates"
              >
                Delete
              </button>
              {/* Move-to dropdown */}
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchMove(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-2 py-1.5 bg-[#18181b] text-[#a1a1aa] text-[13px] rounded border border-[#27272a] hover:border-[#00d4ff]/20 focus:outline-none appearance-none cursor-pointer"
                defaultValue=""
              >
                <option value="" disabled>Move to...</option>
                {customCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Category filter */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`py-2 px-3 text-[12px] font-semibold rounded-md text-center transition-all duration-200 ${
              selectedCategory === category
                ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20 shadow-[0_0_6px_rgba(0,212,255,0.15)]'
                : 'bg-[#08080e] text-[#8a8a92] hover:text-[#a1a1aa] border border-transparent hover:border-[#00d4ff]/10'
            }`}
          >
            {category === 'all' ? 'All' : category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {loading ? (
          <div className="col-span-2 flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 border-[#00b8db] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <p className="col-span-2 text-[12px] text-[#3a3a42] italic text-center py-3">No templates found</p>
        ) : (
          filteredTemplates.map((template) => {
            const selectionOrder = getSelectionOrder(template.id);
            const isSelected = selectionOrder > 0;
            return (
              <div
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                className={`p-3 rounded-lg transition-all duration-200 group cursor-pointer ${
                  isSelected
                    ? 'bg-[#00d4ff]/5 border border-[#00d4ff]/20 shadow-[0_0_12px_rgba(0,212,255,0.1)]'
                    : 'bg-[#08080e] hover:bg-[#0c0c14] border border-[#00d4ff]/5 hover:border-[#00d4ff]/15'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {multiSelectMode && isSelected && (
                    <span className="w-5 h-5 flex items-center justify-center bg-[#00d4ff] text-[#04040a] rounded-md text-[10px] font-bold shrink-0">
                      {selectionOrder}
                    </span>
                  )}
                  <span className={`text-sm font-medium text-left truncate flex-1 ${
                    isSelected ? 'text-[#00d4ff]' : 'text-[#e0e0e8] group-hover:text-[#00d4ff]'
                  } transition-colors`}>
                    {template.name}
                  </span>
                  {!multiSelectMode && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditTemplate(template); }}
                        className="p-1 text-[#3a3a42] hover:text-[#00d4ff] rounded"
                        title={template.isBuiltIn ? 'Fork to custom' : 'Edit'}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(template.id, template.name, template.isBuiltIn); }}
                        className="p-1 text-[#3a3a42] hover:text-[#ef4444] rounded"
                        title={template.isBuiltIn ? 'Hide' : 'Delete'}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {template.isBuiltIn ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          )}
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] text-[#8a8a92] px-2.5 py-1 bg-[#0c0c12] rounded-md font-medium">
                    {template.category}
                  </span>
                  <span className={`text-[11px] font-semibold tracking-wide uppercase ${
                    template.isBuiltIn ? 'text-[#8b5cf6]' : 'text-[#00d4ff]/60'
                  }`}>
                    {template.isBuiltIn ? 'System' : 'Custom'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[12px] text-[#8a8a92] truncate font-mono flex-1">{template.command}</p>
                  {!multiSelectMode && (
                    <button
                      onClick={(e) => handleQuickExecute(template, e)}
                      className="px-2.5 py-1.5 bg-[#00d4ff]/10 text-[#00d4ff] text-[11px] font-semibold rounded hover:bg-[#00d4ff]/20 border border-[#00d4ff]/20 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                      title={template.variables?.length ? 'Configure & Send' : 'Send command'}
                    >
                      SEND
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
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

interface TemplatesResponse {
  builtIn: Template[];
  custom: Template[];
}

type ViewMode = 'list' | 'detail' | 'create' | 'edit';

export default function TemplatePanel({ onExecute }: TemplatePanelProps) {
  const [templates, setTemplates] = useState<TemplatesResponse>({ builtIn: [], custom: [] });
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
  
  const [formData, setFormData] = useState({
    name: '',
    category: 'custom',
    command: '',
    description: '',
    variables: [] as TemplateVariable[],
  });
  const [newVarName, setNewVarName] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const [templatesRes, categoriesRes] = await Promise.all([
        apiClient.get<TemplatesResponse>('/templates'),
        apiClient.get<string[]>('/templates/categories'),
      ]);
      setTemplates(templatesRes.data || { builtIn: [], custom: [] });
      setCategories(['all', ...(categoriesRes.data || [])]);
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

  const openMultiReview = () => {
    if (selectedTemplates.length > 0) {
      setShowMultiReview(true);
    }
  };

  const backToMultiSelect = () => {
    setShowMultiReview(false);
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
    } catch (err) {
      console.error('Failed to update template:', err);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return;

    try {
      await apiClient.delete(`/templates/${id}`);
      setSelectedTemplate(null);
      setViewMode('list');
      loadTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handleEditTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      category: template.category,
      command: template.command,
      description: template.description || '',
      variables: template.variables || [],
    });
    setViewMode('edit');
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
    setFormData({
      name: '',
      category: 'custom',
      command: '',
      description: '',
      variables: [],
    });
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

  const allTemplates = [...templates.builtIn, ...templates.custom];
  const filteredTemplates = allTemplates.filter((t) => {
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesSearch = searchQuery === '' || 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.command.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
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
            <label className="block text-sm text-[#a1a1aa] mb-1">Category</label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              placeholder="custom"
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
            />
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
                    Required
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

  if (viewMode === 'detail' && selectedTemplate) {
    const hasRequiredMissing = (selectedTemplate.variables || []).some(
      (v) => v.required && !variables[v.name]
    );

    return (
      <div className="h-full flex flex-col p-4">
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
            {!selectedTemplate.isBuiltIn && (
              <div className="flex gap-1">
                <button
                  onClick={() => handleEditTemplate(selectedTemplate)}
                  className="p-1 text-[#a1a1aa] hover:text-white"
                  title="Edit"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteTemplate(selectedTemplate.id)}
                  className="p-1 text-[#a1a1aa] hover:text-[#ef4444]"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-[#a1a1aa]">{selectedTemplate.description}</p>
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

  if (showMultiReview && selectedTemplates.length > 0) {
    const hasRequiredMissing = selectedTemplates.some(t =>
      (t.variables || []).some(v => v.required && !multiVariables[t.id]?.[v.name])
    );

    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={backToMultiSelect}
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

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4">
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
          onClick={() => { resetForm(); setViewMode('create'); }}
          className="p-2 bg-[#00d4ff]/10 text-[#00d4ff] rounded-lg border border-[#00d4ff]/20 hover:bg-[#00d4ff]/15 hover:shadow-[0_0_12px_rgba(0,212,255,0.2)] transition-all duration-200"
          title="New Template"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {multiSelectMode && (
        <div className="mb-2 space-y-1.5">
          <div className="px-2 py-1.5 bg-[#00b8db]/6 rounded text-[12px] text-[#00b8db]">
            Click to select. Order matters!
            {selectedTemplates.length > 0 && (
              <span className="ml-1.5 font-semibold">({selectedTemplates.length})</span>
            )}
          </div>
          {selectedTemplates.length > 0 && (
            <button
              onClick={openMultiReview}
              className="w-full py-1.5 bg-[#00b8db]/10 text-[#00b8db] font-medium rounded hover:bg-[#00b8db]/15 transition-colors text-[13px]"
            >
              Review & Execute ({selectedTemplates.length})
            </button>
          )}
        </div>
      )}

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
                  {!template.isBuiltIn && !multiSelectMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditTemplate(template); }}
                      className="p-1 text-[#3a3a42] hover:text-[#00d4ff] opacity-0 group-hover:opacity-100 transition-all rounded shrink-0"
                      title="Edit"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
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

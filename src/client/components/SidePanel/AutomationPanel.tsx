import { useState, useEffect } from 'react';
import { apiClient } from '../../services/api';

interface AutomationPanelProps {
  sessionId?: string;
  onExecute?: (command: string) => void;
}

interface CommandStep {
  id: string;
  command: string;
  delayAfter: number;
}

interface Automation {
  id: string;
  sessionId: string;
  name: string;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  command: string;
  steps: CommandStep[] | null;
  createWindow: boolean;
  windowName: string | null;
  enabled: boolean;
  createdAt: string;
}

const TRIGGER_TYPES = [
  { id: 'on_connect', label: 'On Connect', description: 'When session connects' },
  { id: 'on_disconnect', label: 'On Disconnect', description: 'When session disconnects' },
  { id: 'on_resume', label: 'On Resume', description: 'When session resumes from dormant' },
  { id: 'on_idle', label: 'On Idle', description: 'After period of inactivity' },
  { id: 'on_output_match', label: 'On Output Match', description: 'When output matches pattern' },
  { id: 'scheduled', label: 'Scheduled', description: 'At scheduled intervals' },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function parseCronToNextRun(cron: string): Date | null {
  if (!cron) return null;
  const parts = cron.split(' ');
  if (parts.length !== 5) return null;

  const [minPart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  const now = new Date();
  
  for (let i = 0; i < 60 * 24 * 7; i++) {
    const candidate = new Date(now.getTime() + i * 60 * 1000);
    const min = candidate.getMinutes();
    const hour = candidate.getHours();
    const day = candidate.getDate();
    const month = candidate.getMonth() + 1;
    const weekday = candidate.getDay();

    const matchesPart = (part: string, value: number, _max: number): boolean => {
      if (part === '*') return true;
      if (part.startsWith('*/')) {
        const interval = parseInt(part.slice(2));
        return value % interval === 0;
      }
      return parseInt(part) === value;
    };

    if (
      matchesPart(minPart, min, 60) &&
      matchesPart(hourPart, hour, 24) &&
      matchesPart(dayPart, day, 31) &&
      matchesPart(monthPart, month, 12) &&
      matchesPart(weekdayPart, weekday, 7) &&
      candidate > now
    ) {
      return candidate;
    }
  }
  return null;
}

export default function AutomationPanel({ sessionId, onExecute }: AutomationPanelProps) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [formData, setFormData] = useState({
    name: '',
    trigger: 'on_connect',
    triggerConfig: {} as Record<string, unknown>,
    steps: [{ id: generateId(), command: '', delayAfter: 0 }] as CommandStep[],
    createWindow: false,
    windowName: '',
  });

  useEffect(() => {
    loadAutomations();
  }, [sessionId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getCountdown = (automation: Automation): string => {
    if (automation.trigger !== 'scheduled' || !automation.enabled || !automation.triggerConfig.cron) {
      return '';
    }
    const nextRun = parseCronToNextRun(automation.triggerConfig.cron as string);
    if (!nextRun) return '';
    
    const diff = nextRun.getTime() - now;
    if (diff <= 0) return 'now';
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const loadAutomations = async () => {
    try {
      setLoading(true);
      const url = sessionId ? `/automations/session/${sessionId}` : '/automations';
      const response = await apiClient.get<Automation[]>(url);
      setAutomations(response.data || []);
    } catch (err) {
      console.error('Failed to load automations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!sessionId) {
      console.error('No sessionId');
      return;
    }
    if (!formData.name) {
      console.error('No name');
      return;
    }
    if (formData.steps.length === 0 || !formData.steps[0].command) {
      console.error('No command in steps');
      return;
    }

    try {
      const payload = {
        sessionId,
        name: formData.name,
        trigger: formData.trigger,
        triggerConfig: formData.triggerConfig,
        steps: formData.steps.filter(s => s.command.trim()),
        createWindow: formData.createWindow,
        windowName: formData.windowName || undefined,
      };
      console.log('Creating automation with payload:', JSON.stringify(payload, null, 2));
      const result = await apiClient.post('/automations', payload);
      console.log('Create result:', result);

      resetForm();
      setShowCreate(false);
      loadAutomations();
    } catch (err: unknown) {
      console.error('Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      const error = err as { response?: { data?: unknown; status?: number }; error?: { message?: string }; message?: string };
      alert(`Failed: ${error.message || error.error?.message || error.response?.status || 'Check console'}`);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;

    try {
      await apiClient.put(`/automations/${editingId}`, {
        name: formData.name,
        trigger: formData.trigger,
        triggerConfig: formData.triggerConfig,
        steps: formData.steps.filter(s => s.command.trim()),
        createWindow: formData.createWindow,
        windowName: formData.windowName || undefined,
      });

      setEditingId(null);
      resetForm();
      loadAutomations();
    } catch (err) {
      console.error('Failed to update automation:', err);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await apiClient.post(`/automations/${id}/toggle`);
      loadAutomations();
    } catch (err) {
      console.error('Failed to toggle automation:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation?')) return;

    try {
      await apiClient.delete(`/automations/${id}`);
      loadAutomations();
    } catch (err) {
      console.error('Failed to delete automation:', err);
    }
  };

  const handleEdit = (automation: Automation) => {
    setEditingId(automation.id);
    setFormData({
      name: automation.name,
      trigger: automation.trigger,
      triggerConfig: automation.triggerConfig,
      steps: automation.steps && automation.steps.length > 0 
        ? automation.steps 
        : [{ id: generateId(), command: automation.command, delayAfter: 0 }],
      createWindow: automation.createWindow,
      windowName: automation.windowName || '',
    });
  };

  const resetForm = () => {
    setFormData({
      name: '',
      trigger: 'on_connect',
      triggerConfig: {},
      steps: [{ id: generateId(), command: '', delayAfter: 0 }],
      createWindow: false,
      windowName: '',
    });
  };

  const executeSequence = async (steps: CommandStep[]) => {
    if (!onExecute) return;

    for (const step of steps) {
      if (!step.command.trim()) continue;
      
      onExecute(step.command);
      await new Promise(r => setTimeout(r, 50));
      onExecute('\r');
      
      if (step.delayAfter > 0) {
        await new Promise(r => setTimeout(r, step.delayAfter * 1000));
      }
    }
  };

  const handleRunNow = async (automation: Automation) => {
    setRunningId(automation.id);
    
    try {
      if (automation.createWindow) {
        await apiClient.post(`/automations/${automation.id}/run`);
      } else if (onExecute) {
        const steps = automation.steps && automation.steps.length > 0
          ? automation.steps
          : [{ id: '1', command: automation.command, delayAfter: 0 }];
        await executeSequence(steps);
      }
    } catch (err) {
      console.error('Failed to run automation:', err);
    } finally {
      setRunningId(null);
    }
  };

  const addStep = () => {
    setFormData(prev => ({
      ...prev,
      steps: [...prev.steps, { id: generateId(), command: '', delayAfter: 0 }],
    }));
  };

  const updateStep = (stepId: string, field: 'command' | 'delayAfter', value: string | number) => {
    setFormData(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === stepId ? { ...s, [field]: value } : s),
    }));
  };

  const removeStep = (stepId: string) => {
    if (formData.steps.length <= 1) return;
    setFormData(prev => ({
      ...prev,
      steps: prev.steps.filter(s => s.id !== stepId),
    }));
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const idx = formData.steps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === formData.steps.length - 1) return;

    const newSteps = [...formData.steps];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]];
    setFormData(prev => ({ ...prev, steps: newSteps }));
  };

  const renderTriggerConfig = () => {
    switch (formData.trigger) {
      case 'on_idle':
        return (
          <div className="mt-2">
            <label className="block text-sm text-[#a1a1aa] mb-1">Idle timeout (seconds)</label>
            <input
              type="number"
              value={(formData.triggerConfig.timeout as number) || 300}
              onChange={(e) => setFormData({
                ...formData,
                triggerConfig: { ...formData.triggerConfig, timeout: parseInt(e.target.value) },
              })}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-2 text-white text-base"
            />
          </div>
        );
      case 'on_output_match':
        return (
          <div className="mt-2">
            <label className="block text-sm text-[#a1a1aa] mb-1">Pattern (regex)</label>
            <input
              type="text"
              value={(formData.triggerConfig.pattern as string) || ''}
              onChange={(e) => setFormData({
                ...formData,
                triggerConfig: { ...formData.triggerConfig, pattern: e.target.value },
              })}
              placeholder="e.g., error|failed"
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-2 text-white text-base font-mono"
            />
          </div>
        );
      case 'scheduled':
        return (
          <div className="mt-2 space-y-3">
            <div>
              <label className="block text-sm text-[#a1a1aa] mb-1.5">Quick presets</label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: 'Every 5m', cron: '*/5 * * * *' },
                  { label: 'Every 15m', cron: '*/15 * * * *' },
                  { label: 'Every 30m', cron: '*/30 * * * *' },
                  { label: 'Hourly', cron: '0 * * * *' },
                  { label: 'Every 2h', cron: '0 */2 * * *' },
                  { label: 'Every 6h', cron: '0 */6 * * *' },
                  { label: 'Daily 9am', cron: '0 9 * * *' },
                  { label: 'Daily 6pm', cron: '0 18 * * *' },
                  { label: 'Weekly', cron: '0 9 * * 1' },
                ].map((preset) => (
                  <button
                    key={preset.cron}
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      triggerConfig: { ...formData.triggerConfig, cron: preset.cron },
                    })}
                    className={`px-2.5 py-1.5 text-[11px] rounded border transition-colors ${
                      formData.triggerConfig.cron === preset.cron
                        ? 'bg-[#00d4ff]/20 text-[#00d4ff] border-[#00d4ff]/40'
                        : 'bg-[#14141a] text-[#a1a1aa] border-[#27272a] hover:border-[#3a3a42] hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-2 bg-[#0c0c10] rounded border border-[#1a1a1e]">
              <label className="block text-[11px] text-[#8a8a92] uppercase tracking-wide mb-1.5">Custom schedule</label>
              <div className="grid grid-cols-5 gap-1 mb-2">
                <div>
                  <label className="block text-[10px] text-[#8a8a92] mb-0.5 text-center">Min</label>
                  <select
                    value={(() => {
                      const cron = (formData.triggerConfig.cron as string) || '* * * * *';
                      return cron.split(' ')[0] || '*';
                    })()}
                    onChange={(e) => {
                      const parts = ((formData.triggerConfig.cron as string) || '* * * * *').split(' ');
                      parts[0] = e.target.value;
                      setFormData({
                        ...formData,
                        triggerConfig: { ...formData.triggerConfig, cron: parts.join(' ') },
                      });
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-1.5 py-1.5 text-white text-[12px] text-center"
                  >
                    <option value="*">*</option>
                    <option value="0">0</option>
                    <option value="*/5">*/5</option>
                    <option value="*/10">*/10</option>
                    <option value="*/15">*/15</option>
                    <option value="*/30">*/30</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#8a8a92] mb-0.5 text-center">Hour</label>
                  <select
                    value={(() => {
                      const cron = (formData.triggerConfig.cron as string) || '* * * * *';
                      return cron.split(' ')[1] || '*';
                    })()}
                    onChange={(e) => {
                      const parts = ((formData.triggerConfig.cron as string) || '* * * * *').split(' ');
                      parts[1] = e.target.value;
                      setFormData({
                        ...formData,
                        triggerConfig: { ...formData.triggerConfig, cron: parts.join(' ') },
                      });
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-1.5 py-1.5 text-white text-[12px] text-center"
                  >
                    <option value="*">*</option>
                    <option value="*/2">*/2</option>
                    <option value="*/6">*/6</option>
                    {[...Array(24)].map((_, i) => (
                      <option key={i} value={i.toString()}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#8a8a92] mb-0.5 text-center">Day</label>
                  <select
                    value={(() => {
                      const cron = (formData.triggerConfig.cron as string) || '* * * * *';
                      return cron.split(' ')[2] || '*';
                    })()}
                    onChange={(e) => {
                      const parts = ((formData.triggerConfig.cron as string) || '* * * * *').split(' ');
                      parts[2] = e.target.value;
                      setFormData({
                        ...formData,
                        triggerConfig: { ...formData.triggerConfig, cron: parts.join(' ') },
                      });
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-1.5 py-1.5 text-white text-[12px] text-center"
                  >
                    <option value="*">*</option>
                    {[...Array(31)].map((_, i) => (
                      <option key={i} value={(i + 1).toString()}>{i + 1}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#8a8a92] mb-0.5 text-center">Mon</label>
                  <select
                    value={(() => {
                      const cron = (formData.triggerConfig.cron as string) || '* * * * *';
                      return cron.split(' ')[3] || '*';
                    })()}
                    onChange={(e) => {
                      const parts = ((formData.triggerConfig.cron as string) || '* * * * *').split(' ');
                      parts[3] = e.target.value;
                      setFormData({
                        ...formData,
                        triggerConfig: { ...formData.triggerConfig, cron: parts.join(' ') },
                      });
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-1.5 py-1.5 text-white text-[12px] text-center"
                  >
                    <option value="*">*</option>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                      <option key={i} value={(i + 1).toString()}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#8a8a92] mb-0.5 text-center">Week</label>
                  <select
                    value={(() => {
                      const cron = (formData.triggerConfig.cron as string) || '* * * * *';
                      return cron.split(' ')[4] || '*';
                    })()}
                    onChange={(e) => {
                      const parts = ((formData.triggerConfig.cron as string) || '* * * * *').split(' ');
                      parts[4] = e.target.value;
                      setFormData({
                        ...formData,
                        triggerConfig: { ...formData.triggerConfig, cron: parts.join(' ') },
                      });
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-1.5 py-1.5 text-white text-[12px] text-center"
                  >
                    <option value="*">*</option>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                      <option key={i} value={i.toString()}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#8a8a92]">Expression:</span>
                <input
                  type="text"
                  value={(formData.triggerConfig.cron as string) || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    triggerConfig: { ...formData.triggerConfig, cron: e.target.value },
                  })}
                  placeholder="* * * * *"
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-2 py-1.5 text-white text-[12px] font-mono"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-2 p-2 bg-[#0c0c10] rounded border border-[#1a1a1e]">
              <label className="text-[11px] text-[#8a8a92]">Repeat:</label>
              <select
                value={(formData.triggerConfig.maxRuns as number) || 0}
                onChange={(e) => setFormData({
                  ...formData,
                  triggerConfig: { ...formData.triggerConfig, maxRuns: parseInt(e.target.value) },
                })}
                className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-white text-[12px]"
              >
                <option value={0}>Forever</option>
                <option value={1}>Once</option>
                <option value={2}>2 times</option>
                <option value={3}>3 times</option>
                <option value={5}>5 times</option>
                <option value={10}>10 times</option>
                <option value={20}>20 times</option>
                <option value={50}>50 times</option>
                <option value={100}>100 times</option>
              </select>
              <span className="text-[11px] text-[#8a8a92]">
                {(formData.triggerConfig.maxRuns as number) === 1 
                  ? '(runs once then disables)' 
                  : (formData.triggerConfig.maxRuns as number) > 1 
                    ? `(disables after ${formData.triggerConfig.maxRuns} runs)` 
                    : ''}
              </span>
            </div>
            
            <div className="text-[11px] text-[#8a8a92] bg-[#0c0c10] rounded p-2 border border-[#1a1a1e]">
              <span className="text-[#a1a1aa]">Preview: </span>
              <span className="text-white">
                {(() => {
                  const cron = (formData.triggerConfig.cron as string) || '';
                  if (!cron) return 'No schedule set';
                  const parts = cron.split(' ');
                  if (parts.length !== 5) return 'Invalid expression';
                  
                  const [min, hour, day, month, weekday] = parts;
                  const descriptions: string[] = [];
                  
                  if (min.startsWith('*/')) descriptions.push(`every ${min.slice(2)} minutes`);
                  else if (min === '0') descriptions.push('at minute 0');
                  else if (min !== '*') descriptions.push(`at minute ${min}`);
                  
                  if (hour.startsWith('*/')) descriptions.push(`every ${hour.slice(2)} hours`);
                  else if (hour !== '*') descriptions.push(`at ${hour}:00`);
                  
                  if (day !== '*') descriptions.push(`on day ${day}`);
                  if (month !== '*') descriptions.push(`in month ${month}`);
                  if (weekday !== '*') {
                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    descriptions.push(`on ${days[parseInt(weekday)] || weekday}`);
                  }
                  
                  return descriptions.length > 0 ? descriptions.join(', ') : 'Every minute';
                })()}
              </span>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (showCreate || editingId) {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        <button
          onClick={() => {
            setShowCreate(false);
            setEditingId(null);
            resetForm();
          }}
          className="flex items-center gap-2 text-[#a1a1aa] hover:text-white text-base mb-4"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h3 className="text-lg font-semibold text-white mb-4">
          {editingId ? 'Edit Automation' : 'New Automation'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Automation"
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2.5 text-white text-base focus:border-[#00d4ff]/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-[#a1a1aa] mb-1">Trigger</label>
            <select
              value={formData.trigger}
              onChange={(e) => setFormData({ ...formData, trigger: e.target.value, triggerConfig: {} })}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2.5 text-white text-base focus:border-[#00d4ff]/50 focus:outline-none"
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {renderTriggerConfig()}
          </div>

          <div className="flex items-center gap-3 p-3 bg-[#0c0c10] rounded-lg border border-[#1a1a1e]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.createWindow}
                onChange={(e) => setFormData({ ...formData, createWindow: e.target.checked })}
                className="w-4 h-4 rounded border-[#27272a] bg-[#18181b] text-[#00d4ff] focus:ring-[#00d4ff]/50"
              />
              <span className="text-sm text-[#a0a0a8]">Create new window</span>
            </label>
            {formData.createWindow && (
              <input
                type="text"
                value={formData.windowName}
                onChange={(e) => setFormData({ ...formData, windowName: e.target.value })}
                placeholder="Window name"
                className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-white text-sm focus:border-[#00d4ff]/50 focus:outline-none"
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[#a1a1aa]">Command Sequence</label>
              <span className="text-[11px] text-[#8a8a92]">{formData.steps.length} step{formData.steps.length !== 1 ? 's' : ''}</span>
            </div>
            
            <div className="space-y-2">
              {formData.steps.map((step, idx) => (
                <div key={step.id} className="p-2 bg-[#0c0c10] rounded border border-[#1a1a1e]">
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-[12px] text-[#8a8a92] w-5">{idx + 1}.</span>
                    <input
                      type="text"
                      value={step.command}
                      onChange={(e) => updateStep(step.id, 'command', e.target.value)}
                      placeholder="Enter command..."
                      className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-2.5 py-2 text-white text-sm font-mono focus:border-[#00d4ff]/50 focus:outline-none"
                    />
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => moveStep(step.id, 'up')}
                        disabled={idx === 0}
                        className="p-1 text-[#8a8a92] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveStep(step.id, 'down')}
                        disabled={idx === formData.steps.length - 1}
                        className="p-1 text-[#8a8a92] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeStep(step.id)}
                        disabled={formData.steps.length <= 1}
                        className="p-1 text-[#c04040] hover:text-[#e06060] disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Remove step"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-5">
                    <label className="text-[11px] text-[#8a8a92]">Wait after:</label>
                    <input
                      type="number"
                      min="0"
                      max="300"
                      value={step.delayAfter}
                      onChange={(e) => updateStep(step.id, 'delayAfter', parseInt(e.target.value) || 0)}
                      className="w-16 bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-white text-[12px] focus:border-[#00d4ff]/50 focus:outline-none"
                    />
                    <span className="text-[11px] text-[#8a8a92]">seconds</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addStep}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#00d4ff] hover:bg-[#00d4ff]/10 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Step
            </button>
          </div>

          <button
            onClick={editingId ? handleUpdate : handleCreate}
            disabled={!formData.name || !formData.steps[0]?.command}
            className="w-full py-2 bg-[#00d4ff]/10 text-[#00d4ff] font-semibold rounded-lg hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingId ? 'Update Automation' : 'Create Automation'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] font-semibold text-[#8a8a92] uppercase tracking-[0.15em]">Automations</h3>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!sessionId}
          className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-[#00b8db] hover:bg-[#00b8db]/10 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>

      {!sessionId && (
        <div className="text-[12px] text-[#3a3a42] italic text-center py-3">
          Connect to a session to manage automations
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-[#00b8db] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : automations.length === 0 ? (
          <p className="text-[12px] text-[#3a3a42] italic text-center py-3">No automations yet</p>
        ) : (
          automations.map((automation) => (
            <div
              key={automation.id}
              className="p-2 bg-[#0c0c10] rounded border border-[#1a1a1e]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-medium text-[#c0c0c8]">{automation.name}</span>
                <button
                  onClick={() => handleToggle(automation.id)}
                  className={`w-9 h-5 rounded-full transition-colors ${
                    automation.enabled ? 'bg-[#1a9a5a]' : 'bg-[#1a1a1e]'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transform transition-transform ${
                      automation.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] text-[#8a8a92] px-2 py-1 bg-[#14141a] rounded">
                  {TRIGGER_TYPES.find((t) => t.id === automation.trigger)?.label || automation.trigger}
                </span>
                {automation.steps && automation.steps.length > 1 && (
                  <span className="text-[11px] text-[#00d4ff] px-2 py-1 bg-[#00d4ff]/10 rounded">
                    {automation.steps.length} steps
                  </span>
                )}
                {automation.createWindow && (
                  <span className="text-[11px] text-[#9a6a1a] px-2 py-1 bg-[#9a6a1a]/10 rounded">
                    +window
                  </span>
                )}
                {getCountdown(automation) && (
                  <span className="text-[11px] text-[#22c55e] px-2 py-1 bg-[#22c55e]/10 rounded font-mono">
                    {getCountdown(automation)}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#8a8a92] font-mono truncate mb-2">
                {automation.steps && automation.steps.length > 0 
                  ? automation.steps[0].command 
                  : automation.command}
                {automation.steps && automation.steps.length > 1 && ' ...'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(automation)}
                  className="text-[11px] text-[#8a8a92] hover:text-[#a0a0a8] px-1.5 py-0.5"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(automation.id)}
                  className="text-[11px] text-[#c04040] hover:text-[#e06060] px-1.5 py-0.5"
                >
                  Delete
                </button>
                <div className="flex-1" />
                {onExecute && (
                  <button
                    onClick={() => handleRunNow(automation)}
                    disabled={runningId === automation.id}
                    className={`px-3 py-1 text-[11px] font-semibold rounded border transition-all ${
                      runningId === automation.id
                        ? 'bg-[#9a6a1a]/20 text-[#9a6a1a] border-[#9a6a1a]/30 cursor-wait'
                        : 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/20 hover:bg-[#00d4ff]/20'
                    }`}
                    title="Run automation now"
                  >
                    {runningId === automation.id ? 'RUNNING...' : 'RUN'}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

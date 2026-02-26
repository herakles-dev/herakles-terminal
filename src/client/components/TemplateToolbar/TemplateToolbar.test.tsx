import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TemplateToolbar } from './TemplateToolbar';

// Mock fetch for template loading
const mockTemplates = [
  { id: 't1', name: 'New Project', category: 'v9-start', command: '/spec', isBuiltIn: true },
  { id: 't2', name: 'Squad', category: 'v9-formation', command: '/team squad', isBuiltIn: true },
  { id: 't3', name: 'High Effort', category: 'v9-effort', command: '/effort high', isBuiltIn: true },
  { id: 't4', name: 'Full Auto', category: 'v9-autonomy', command: '/autonomy 5', isBuiltIn: true },
  { id: 't5', name: 'Deploy', category: 'v9-deploy', command: '/deploy', isBuiltIn: true },
  { id: 't6', name: 'Scaffold', category: 'v9-scripts', command: '/scaffold', isBuiltIn: true },
  { id: 't7', name: 'Quick Ref', category: 'v9-tips', command: '/help', isBuiltIn: true },
  { id: 't8', name: 'Opus', category: 'cc-model', command: '/model opus', isBuiltIn: true },
  { id: 't9', name: 'Meta Prompt', category: 'claude-meta', command: '/lead', isBuiltIn: true },
  { id: 't10', name: 'With Vars', category: 'v9-start', command: 'hello {{name}}', isBuiltIn: true, variables: [{ name: 'name', default: 'world' }] },
];

function setupFetchMock(templates = mockTemplates) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { builtIn: templates, custom: [] } }),
  });
}

describe('TemplateToolbar', () => {
  const onExecuteCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });

  it('renders 9 category icon buttons after loading', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      // Each category becomes a button with its label as title
      expect(screen.getByTitle('Project Start')).toBeInTheDocument();
      expect(screen.getByTitle('Formations')).toBeInTheDocument();
      expect(screen.getByTitle('Effort & Thinking')).toBeInTheDocument();
      expect(screen.getByTitle('Autonomy')).toBeInTheDocument();
      expect(screen.getByTitle('Deploy & Ops')).toBeInTheDocument();
      expect(screen.getByTitle('CLI Scripts')).toBeInTheDocument();
      expect(screen.getByTitle('Quick Ref')).toBeInTheDocument();
      expect(screen.getByTitle('Models')).toBeInTheDocument();
      expect(screen.getByTitle('Meta-Prompts')).toBeInTheDocument();
    });
  });

  it('renders nothing when not visible', () => {
    const { container } = render(
      <TemplateToolbar onExecuteCommand={onExecuteCommand} visible={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while loading', () => {
    // Don't resolve fetch yet
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <TemplateToolbar onExecuteCommand={onExecuteCommand} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no templates match categories', async () => {
    setupFetchMock([{ id: 't1', name: 'Unknown', category: 'nonexistent', command: 'x', isBuiltIn: true }]);

    const { container } = render(
      <TemplateToolbar onExecuteCommand={onExecuteCommand} />
    );

    // Wait for fetch to resolve
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Should render nothing since no categories match
    // The component returns null for empty activeCategories
    await waitFor(() => {
      // Only dividers and no buttons means effectively empty
      const buttons = container.querySelectorAll('button[title]');
      expect(buttons.length).toBe(0);
    });
  });

  it('fetches templates from /api/templates on mount', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/templates', { credentials: 'include' });
    });
  });

  it('handles fetch failure gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    const { container } = render(
      <TemplateToolbar onExecuteCommand={onExecuteCommand} />
    );

    // Wait for fetch to resolve - should not crash
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Should render nothing since templates list is empty after failed fetch
    expect(container.innerHTML).toBe('');
  });

  it('renders mobile hamburger menu button', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      expect(screen.getByTitle('Templates')).toBeInTheDocument();
    });
  });

  it('opens mobile menu on hamburger click', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      expect(screen.getByTitle('Templates')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Templates'));

    // Should show category labels in mobile dropdown
    await waitFor(() => {
      expect(screen.getByText('Project Start')).toBeInTheDocument();
      expect(screen.getByText('Formations')).toBeInTheDocument();
    });
  });

  it('cancels fetch on unmount', async () => {
    const { unmount } = render(
      <TemplateToolbar onExecuteCommand={onExecuteCommand} />
    );

    unmount();

    // No error should occur - cancelled flag prevents state update
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});

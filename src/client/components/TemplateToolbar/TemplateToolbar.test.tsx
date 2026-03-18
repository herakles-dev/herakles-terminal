import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TemplateToolbar } from './TemplateToolbar';

// Mock fetch for template loading
const mockTemplates = [
  { id: 't1', name: 'Start V11 Session', category: 'orchestrate', command: '/v11', isBuiltIn: true },
  { id: 't2', name: 'Session Status', category: 'observe', command: '/status', isBuiltIn: true },
  { id: 't3', name: 'Run Tests', category: 'develop', command: '/test', isBuiltIn: true },
  { id: 't4', name: 'Deploy Service', category: 'ship', command: '/deploy svc', isBuiltIn: true },
  { id: 't5', name: 'Switch to Opus', category: 'session', command: '/model opus', isBuiltIn: true },
  { id: 't6', name: 'With Vars', category: 'orchestrate', command: 'Build {{feature}}.', isBuiltIn: true, variables: [{ name: 'feature', required: true }] },
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

  it('renders 5 category icon buttons after loading', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      expect(screen.getByTitle('Orchestrate')).toBeInTheDocument();
      expect(screen.getByTitle('Observe')).toBeInTheDocument();
      expect(screen.getByTitle('Develop')).toBeInTheDocument();
      expect(screen.getByTitle('Ship')).toBeInTheDocument();
      expect(screen.getByTitle('Session')).toBeInTheDocument();
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
    await waitFor(() => {
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
      expect(screen.getByText('Orchestrate')).toBeInTheDocument();
      expect(screen.getByText('Observe')).toBeInTheDocument();
    });
  });

  it('applies highlight styling to Orchestrate button', async () => {
    render(<TemplateToolbar onExecuteCommand={onExecuteCommand} />);

    await waitFor(() => {
      const orchestrateBtn = screen.getByTitle('Orchestrate');
      expect(orchestrateBtn.className).toContain('text-[#00d4ff]');
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

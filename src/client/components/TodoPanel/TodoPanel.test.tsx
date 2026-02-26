import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodoPanel } from './TodoPanel';
import type { SessionTodos, TodoItem } from '../../../shared/todoProtocol';

const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: 'todo-1',
  content: 'Test task',
  activeForm: 'Testing task',
  status: 'pending',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const makeSession = (overrides: Partial<SessionTodos> = {}): SessionTodos => ({
  sessionId: 'session-1',
  sessionName: 'Test Session',
  todos: [
    makeTodo({ id: '1', content: 'Active task', activeForm: 'Working on task', status: 'in_progress' }),
    makeTodo({ id: '2', content: 'Pending task', status: 'pending' }),
    makeTodo({ id: '3', content: 'Done task', status: 'completed' }),
  ],
  lastModified: Date.now(),
  ...overrides,
});

describe('TodoPanel', () => {
  const defaultProps = {
    expanded: true,
    onToggle: vi.fn(),
    sessions: [makeSession()],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('expanded state', () => {
    it('renders "Tasks" header when expanded', () => {
      render(<TodoPanel {...defaultProps} />);
      expect(screen.getByText('Tasks')).toBeInTheDocument();
    });

    it('renders collapse button when expanded', () => {
      render(<TodoPanel {...defaultProps} />);
      expect(screen.getByTitle('Collapse panel')).toBeInTheDocument();
    });

    it('calls onToggle when collapse button clicked', () => {
      const onToggle = vi.fn();
      render(<TodoPanel {...defaultProps} onToggle={onToggle} />);
      fireEvent.click(screen.getByTitle('Collapse panel'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('shows session name', () => {
      render(<TodoPanel {...defaultProps} />);
      expect(screen.getByText('Test Session')).toBeInTheDocument();
    });

    it('shows total non-completed count badge', () => {
      render(<TodoPanel {...defaultProps} />);
      // 1 in_progress + 1 pending = 2 non-completed
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows loading spinner when isLoading', () => {
      render(<TodoPanel {...defaultProps} isLoading={true} sessions={[]} />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows empty state when no sessions', () => {
      render(<TodoPanel {...defaultProps} sessions={[]} />);
      expect(screen.getByText('No active tasks')).toBeInTheDocument();
      expect(screen.getByText('Tasks will appear when Claude is working')).toBeInTheDocument();
    });
  });

  describe('collapsed state', () => {
    it('renders expand button when collapsed', () => {
      render(<TodoPanel {...defaultProps} expanded={false} />);
      expect(screen.getByTitle('Expand panel')).toBeInTheDocument();
    });

    it('calls onToggle when expand button clicked', () => {
      const onToggle = vi.fn();
      render(<TodoPanel {...defaultProps} expanded={false} onToggle={onToggle} />);
      fireEvent.click(screen.getByTitle('Expand panel'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('shows count badge when collapsed with tasks', () => {
      render(<TodoPanel {...defaultProps} expanded={false} />);
      // Badge shows non-completed count
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('uses 48px collapsed width', () => {
      const { container } = render(<TodoPanel {...defaultProps} expanded={false} />);
      const panel = container.firstElementChild as HTMLElement;
      expect(panel.style.width).toBe('48px');
      expect(panel.style.minWidth).toBe('48px');
    });
  });

  describe('resize behavior', () => {
    it('uses default 280px width when expanded', () => {
      const { container } = render(<TodoPanel {...defaultProps} />);
      const panel = container.firstElementChild as HTMLElement;
      expect(panel.style.width).toBe('280px');
    });

    it('renders drag handle when expanded', () => {
      const { container } = render(<TodoPanel {...defaultProps} />);
      const handle = container.querySelector('.cursor-col-resize');
      expect(handle).toBeInTheDocument();
    });

    it('does not render drag handle when collapsed', () => {
      const { container } = render(<TodoPanel {...defaultProps} expanded={false} />);
      const handle = container.querySelector('.cursor-col-resize');
      expect(handle).not.toBeInTheDocument();
    });
  });

  describe('collapsed progress bars', () => {
    it('renders vertical progress bars when collapsed with sessions', () => {
      const { container } = render(<TodoPanel {...defaultProps} expanded={false} />);
      // Progress bars are rendered as colored divs inside the vertical bar container
      const progressBars = container.querySelectorAll('.rounded-full.bg-white\\/\\[0\\.04\\]');
      expect(progressBars.length).toBeGreaterThan(0);
    });
  });

  describe('multiple sessions', () => {
    it('renders all sessions', () => {
      const sessions = [
        makeSession({ sessionId: 's1', sessionName: 'Session A' }),
        makeSession({ sessionId: 's2', sessionName: 'Session B' }),
      ];
      render(<TodoPanel {...defaultProps} sessions={sessions} />);
      expect(screen.getByText('Session A')).toBeInTheDocument();
      expect(screen.getByText('Session B')).toBeInTheDocument();
    });
  });
});

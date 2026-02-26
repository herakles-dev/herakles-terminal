import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodoItem } from './TodoItem';
import type { TodoItem as TodoItemType } from '../../../shared/todoProtocol';

const makeTodo = (overrides: Partial<TodoItemType> = {}): TodoItemType => ({
  id: 'todo-1',
  content: 'Test task content',
  activeForm: 'Working on test',
  status: 'pending',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('TodoItem', () => {
  describe('status badges', () => {
    it('renders pending status indicator', () => {
      const { container } = render(<TodoItem todo={makeTodo({ status: 'pending' })} />);
      // Pending has a small circle inside a border circle
      const badges = container.querySelectorAll('.rounded-full');
      expect(badges.length).toBeGreaterThan(0);
    });

    it('renders in_progress status with pulse animation', () => {
      const { container } = render(<TodoItem todo={makeTodo({ status: 'in_progress' })} />);
      const pulseEl = container.querySelector('.animate-pulse');
      expect(pulseEl).toBeInTheDocument();
    });

    it('renders completed status with checkmark', () => {
      const { container } = render(<TodoItem todo={makeTodo({ status: 'completed' })} />);
      // Completed has a check path
      const check = container.querySelector('path[d="M5 13l4 4L19 7"]');
      expect(check).toBeInTheDocument();
    });
  });

  describe('text display', () => {
    it('shows content for pending items', () => {
      render(<TodoItem todo={makeTodo({ status: 'pending', content: 'My pending task' })} />);
      expect(screen.getByText('My pending task')).toBeInTheDocument();
    });

    it('shows activeForm for in_progress items', () => {
      render(<TodoItem todo={makeTodo({ status: 'in_progress', activeForm: 'Currently running' })} />);
      expect(screen.getByText('Currently running')).toBeInTheDocument();
    });

    it('prefers subject over content when available', () => {
      render(<TodoItem todo={makeTodo({ status: 'pending', subject: 'Subject text', content: 'Content text' })} />);
      expect(screen.getByText('Subject text')).toBeInTheDocument();
    });

    it('applies line-through for completed items', () => {
      render(<TodoItem todo={makeTodo({ status: 'completed', content: 'Done task' })} />);
      const text = screen.getByText('Done task');
      expect(text.className).toContain('line-through');
    });

    it('applies reduced opacity for completed items', () => {
      const { container } = render(<TodoItem todo={makeTodo({ status: 'completed' })} />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('opacity-50');
    });
  });

  describe('metadata chips', () => {
    it('renders sprint chip', () => {
      render(<TodoItem todo={makeTodo({ metadata: { sprint: '1' } })} />);
      expect(screen.getByText('sprint:1')).toBeInTheDocument();
    });

    it('renders gate chip', () => {
      render(<TodoItem todo={makeTodo({ metadata: { gate: 'review' } })} />);
      expect(screen.getByText('gate:review')).toBeInTheDocument();
    });

    it('renders phase chip', () => {
      render(<TodoItem todo={makeTodo({ metadata: { phase: 'build' } })} />);
      expect(screen.getByText('phase:build')).toBeInTheDocument();
    });

    it('renders wave chip', () => {
      render(<TodoItem todo={makeTodo({ metadata: { wave: '2' } })} />);
      expect(screen.getByText('wave:2')).toBeInTheDocument();
    });

    it('renders multiple chips', () => {
      render(<TodoItem todo={makeTodo({ metadata: { sprint: '1', gate: 'review' } })} />);
      expect(screen.getByText('sprint:1')).toBeInTheDocument();
      expect(screen.getByText('gate:review')).toBeInTheDocument();
    });

    it('renders no chips when metadata is empty', () => {
      const { container } = render(<TodoItem todo={makeTodo({ metadata: {} })} />);
      // No chip elements rendered
      expect(container.querySelectorAll('.uppercase.tracking-wider').length).toBe(0);
    });
  });

  describe('extended fields', () => {
    it('renders owner badge', () => {
      render(<TodoItem todo={makeTodo({ owner: 'team-backend' })} />);
      expect(screen.getByText('backend')).toBeInTheDocument();
    });

    it('renders blockedBy indicator', () => {
      render(<TodoItem todo={makeTodo({ blockedBy: ['task-1', 'task-2'] })} />);
      expect(screen.getByText('Blocked by 2')).toBeInTheDocument();
    });

    it('renders blocks indicator', () => {
      render(<TodoItem todo={makeTodo({ blocks: ['task-3'] })} />);
      expect(screen.getByText('Blocks 1')).toBeInTheDocument();
    });

    it('renders priority badge', () => {
      render(<TodoItem todo={makeTodo({ metadata: { priority: 'high' } })} />);
      expect(screen.getByText('P:high')).toBeInTheDocument();
    });
  });
});

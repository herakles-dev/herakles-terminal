import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomePage } from './WelcomePage';

// Mock LightningCanvas - it uses canvas API unavailable in jsdom
vi.mock('../LightningOverlay/LightningCanvas', () => ({
  LightningCanvas: ({ intensity }: { intensity: number }) => (
    <div data-testid="lightning-canvas" data-intensity={intensity} />
  ),
}));

describe('WelcomePage', () => {
  const onStart = vi.fn();

  it('renders 4 feature cards', () => {
    render(<WelcomePage onStart={onStart} />);

    expect(screen.getByText('tmux Sessions')).toBeInTheDocument();
    expect(screen.getByText('Claude Code Integration')).toBeInTheDocument();
    expect(screen.getByText('Hot Reload Dev')).toBeInTheDocument();
    expect(screen.getByText('Mobile Ready')).toBeInTheDocument();
  });

  it('renders feature descriptions', () => {
    render(<WelcomePage onStart={onStart} />);

    expect(screen.getByText(/Persistent terminal sessions/)).toBeInTheDocument();
    expect(screen.getByText(/Live task sync/)).toBeInTheDocument();
    expect(screen.getByText(/WebSocket-powered real-time/)).toBeInTheDocument();
    expect(screen.getByText(/Touch-optimized interface/)).toBeInTheDocument();
  });

  it('renders Zeus Terminal header', () => {
    render(<WelcomePage onStart={onStart} />);

    expect(screen.getByText('Zeus Terminal')).toBeInTheDocument();
    expect(screen.getByText('Claude Code CLI with orchestration superpowers')).toBeInTheDocument();
  });

  it('renders lightning canvas background', () => {
    render(<WelcomePage onStart={onStart} />);

    const canvas = screen.getByTestId('lightning-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute('data-intensity', '0.2');
  });

  it('calls onStart when "Create Session" button is clicked', () => {
    render(<WelcomePage onStart={onStart} />);

    const button = screen.getByText('Create Session');
    fireEvent.click(button);

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('renders keyboard shortcuts toggle button', () => {
    render(<WelcomePage onStart={onStart} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('shows shortcuts table when toggle is clicked', () => {
    render(<WelcomePage onStart={onStart} />);

    // Shortcuts not visible initially
    expect(screen.queryByText('New window')).not.toBeInTheDocument();

    // Click toggle
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));

    // Shortcuts now visible
    expect(screen.getByText('New window')).toBeInTheDocument();
    expect(screen.getByText('Toggle tools panel')).toBeInTheDocument();
    expect(screen.getByText('Close window')).toBeInTheDocument();
    expect(screen.getByText('Minimize window')).toBeInTheDocument();
    expect(screen.getByText('Cycle layouts')).toBeInTheDocument();
    expect(screen.getByText('Toggle minimap')).toBeInTheDocument();
    expect(screen.getByText('Switch to window')).toBeInTheDocument();
    expect(screen.getByText('Navigate windows')).toBeInTheDocument();
    expect(screen.getByText('Copy selection')).toBeInTheDocument();
    expect(screen.getByText('Paste clipboard')).toBeInTheDocument();
  });

  it('hides shortcuts table when toggle is clicked again', () => {
    render(<WelcomePage onStart={onStart} />);

    const toggle = screen.getByText('Keyboard Shortcuts');

    // Show
    fireEvent.click(toggle);
    expect(screen.getByText('New window')).toBeInTheDocument();

    // Hide
    fireEvent.click(toggle);
    expect(screen.queryByText('New window')).not.toBeInTheDocument();
  });

  it('renders keyboard shortcut key combinations', () => {
    render(<WelcomePage onStart={onStart} />);

    fireEvent.click(screen.getByText('Keyboard Shortcuts'));

    expect(screen.getByText('Ctrl+Shift+T')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+B')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+1-6')).toBeInTheDocument();
  });

  it('renders footer with domain', () => {
    render(<WelcomePage onStart={onStart} />);

    expect(screen.getByText('terminal.herakles.dev')).toBeInTheDocument();
  });
});

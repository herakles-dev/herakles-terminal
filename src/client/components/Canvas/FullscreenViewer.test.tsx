import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FullscreenViewer from './FullscreenViewer';
import type { Artifact } from '../../types/canvas';

// Mock ArtifactRenderer
vi.mock('./ArtifactRenderer', () => ({
  default: ({ artifact, viewMode }: { artifact: Artifact; viewMode: string }) => (
    <div data-testid="artifact-renderer" data-type={artifact.type} data-view={viewMode}>
      {artifact.content}
    </div>
  ),
}));

const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-1',
  type: 'code',
  content: 'console.log("hello")',
  language: 'javascript',
  title: 'Test Artifact',
  sourceWindow: 'win-1',
  timestamp: Date.now(),
  ...overrides,
});

describe('FullscreenViewer', () => {
  const defaultProps = {
    artifact: makeArtifact(),
    viewMode: 'preview' as const,
    onClose: vi.fn(),
    onToggleViewMode: vi.fn(),
    onSendToTerminal: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders artifact title', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByText('Test Artifact')).toBeInTheDocument();
  });

  it('renders artifact type label', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByText('CODE')).toBeInTheDocument();
  });

  it('renders artifact content via ArtifactRenderer', () => {
    render(<FullscreenViewer {...defaultProps} />);
    const renderer = screen.getByTestId('artifact-renderer');
    expect(renderer).toBeInTheDocument();
    expect(renderer).toHaveAttribute('data-type', 'code');
    expect(renderer).toHaveAttribute('data-view', 'preview');
  });

  it('shows zoom controls', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByTitle('Zoom out (-)')).toBeInTheDocument();
    expect(screen.getByTitle('Zoom in (+)')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('zooms in when + button clicked', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Zoom in (+)'));
    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  it('zooms out when - button clicked', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Zoom out (-)'));
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('resets zoom with fit to screen button', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Zoom in (+)'));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Fit to screen (0)'));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows copy button and handles click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Copy (C)'));
    expect(writeText).toHaveBeenCalledWith('console.log("hello")');
  });

  it('shows "Copied" feedback after copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Copy (C)'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Close (Esc)'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows view mode toggle button', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('calls onToggleViewMode when toggle clicked', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByText('Preview'));
    expect(defaultProps.onToggleViewMode).toHaveBeenCalledTimes(1);
  });

  it('shows Send button when onSendToTerminal provided', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByTitle('Send to terminal (S)')).toBeInTheDocument();
  });

  it('calls onSendToTerminal when Send clicked', () => {
    render(<FullscreenViewer {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Send to terminal (S)'));
    expect(defaultProps.onSendToTerminal).toHaveBeenCalledWith('console.log("hello")');
  });

  it('hides Send toolbar button when onSendToTerminal not provided', () => {
    render(<FullscreenViewer {...defaultProps} onSendToTerminal={undefined} />);
    expect(screen.queryByTitle('Send to terminal (S)')).not.toBeInTheDocument();
  });

  it('renders keyboard shortcut hints in footer', () => {
    const { container } = render(<FullscreenViewer {...defaultProps} />);
    // Footer contains kbd elements for shortcuts
    const kbdElements = container.querySelectorAll('kbd');
    expect(kbdElements.length).toBeGreaterThanOrEqual(5); // Esc, +, -, C, D, S
  });

  it('shows download button', () => {
    render(<FullscreenViewer {...defaultProps} />);
    expect(screen.getByTitle('Download (D)')).toBeInTheDocument();
  });

  it('falls back to type/language when no title', () => {
    render(
      <FullscreenViewer
        {...defaultProps}
        artifact={makeArtifact({ title: undefined, type: 'markdown', language: undefined })}
      />
    );
    expect(screen.getByText('markdown')).toBeInTheDocument();
  });
});

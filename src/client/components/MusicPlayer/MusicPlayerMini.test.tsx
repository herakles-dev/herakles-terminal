import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MusicPlayerMini } from './MusicPlayerMini';

describe('MusicPlayerMini', () => {
  it('renders expand button with title', () => {
    render(<MusicPlayerMini isPlaying={false} thumbnailUrl={null} onClick={vi.fn()} />);
    expect(screen.getByTitle('Expand music player')).toBeInTheDocument();
  });

  it('shows play icon when not playing', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={false} thumbnailUrl={null} onClick={vi.fn()} />
    );
    // Play icon has a triangular path
    expect(container.querySelector('path[d="M8 5v14l11-7z"]')).toBeInTheDocument();
  });

  it('shows pause icon when playing', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={true} thumbnailUrl={null} onClick={vi.fn()} />
    );
    // Pause icon has rect elements
    expect(container.querySelectorAll('rect').length).toBe(2);
  });

  it('shows thumbnail when provided', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={false} thumbnailUrl="https://example.com/thumb.jpg" onClick={vi.fn()} />
    );
    const thumb = container.querySelector('.music-player-mini-thumbnail');
    expect(thumb).toBeInTheDocument();
    expect(thumb?.getAttribute('style')).toContain('https://example.com/thumb.jpg');
  });

  it('does not show thumbnail when null', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={false} thumbnailUrl={null} onClick={vi.fn()} />
    );
    expect(container.querySelector('.music-player-mini-thumbnail')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<MusicPlayerMini isPlaying={false} thumbnailUrl={null} onClick={onClick} />);
    fireEvent.click(screen.getByTitle('Expand music player'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows pulse animation when playing', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={true} thumbnailUrl={null} onClick={vi.fn()} />
    );
    expect(container.querySelector('.music-player-mini-pulse')).toBeInTheDocument();
  });

  it('does not show pulse when paused', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={false} thumbnailUrl={null} onClick={vi.fn()} />
    );
    expect(container.querySelector('.music-player-mini-pulse')).not.toBeInTheDocument();
  });

  it('applies is-playing class when playing', () => {
    const { container } = render(
      <MusicPlayerMini isPlaying={true} thumbnailUrl={null} onClick={vi.fn()} />
    );
    expect(container.querySelector('.is-playing')).toBeInTheDocument();
  });
});

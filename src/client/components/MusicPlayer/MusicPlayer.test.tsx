import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MusicPlayer } from './MusicPlayer';
import { DEFAULT_MUSIC_PLAYER_STATE } from '../../../shared/musicProtocol';

// Mock MusicPlayerMini
vi.mock('./MusicPlayerMini.js', () => ({
  MusicPlayerMini: ({ isPlaying, onClick }: { isPlaying: boolean; thumbnailUrl: string | null; onClick: () => void }) => (
    <button data-testid="music-mini" data-playing={isPlaying} onClick={onClick}>
      Mini Player
    </button>
  ),
}));

// Mock MusicPlayerContent
vi.mock('./MusicPlayerContent.js', () => ({
  MusicPlayerContent: ({ mode, onClose, onMinimize, onTogglePlay, onLoadVideo }: {
    mode: string; onClose: () => void; onMinimize: () => void;
    onTogglePlay: () => void; onLoadVideo: (url: string) => void;
  }) => (
    <div data-testid="music-content" data-mode={mode}>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
      <button data-testid="minimize-btn" onClick={onMinimize}>Minimize</button>
      <button data-testid="play-btn" onClick={onTogglePlay}>Play</button>
      <button data-testid="load-btn" onClick={() => onLoadVideo('https://youtube.com/watch?v=dQw4w9WgXcB')}>Load</button>
    </div>
  ),
}));

// Mock CSS import
vi.mock('./musicPlayer.css', () => ({}));

// Mock fetch
function setupFetchMock() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/csrf-token') {
      return Promise.resolve({ json: () => Promise.resolve({ data: { token: 'test-csrf' } }) });
    }
    if (url === '/api/music/starred') {
      return Promise.resolve({ json: () => Promise.resolve({ data: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });
}

describe('MusicPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when mode is hidden (default)', async () => {
    const { container } = render(<MusicPlayer />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders mini player when mode is mini', async () => {
    render(<MusicPlayer initialState={{ mode: 'mini' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('music-mini')).toBeInTheDocument();
    });
  });

  it('renders audio content when mode is audio', async () => {
    render(<MusicPlayer initialState={{ mode: 'audio' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('music-content')).toBeInTheDocument();
      expect(screen.getByTestId('music-content')).toHaveAttribute('data-mode', 'audio');
    });
  });

  it('renders video content when mode is video', async () => {
    render(<MusicPlayer initialState={{ mode: 'video' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('music-content')).toHaveAttribute('data-mode', 'video');
    });
  });

  it('switches from mini to audio on click', async () => {
    render(<MusicPlayer initialState={{ mode: 'mini' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('music-mini')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('music-mini'));
    await waitFor(() => {
      expect(screen.getByTestId('music-content')).toHaveAttribute('data-mode', 'audio');
    });
  });

  it('hides player when close is clicked', async () => {
    const { container } = render(<MusicPlayer initialState={{ mode: 'audio' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('close-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="music-content"]')).not.toBeInTheDocument();
    });
  });

  it('minimizes player to mini mode', async () => {
    render(<MusicPlayer initialState={{ mode: 'audio' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('minimize-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('minimize-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('music-mini')).toBeInTheDocument();
    });
  });

  it('calls onSync when state changes', async () => {
    const onSync = vi.fn();
    render(<MusicPlayer initialState={{ mode: 'audio' }} onSync={onSync} />);
    await waitFor(() => {
      expect(screen.getByTestId('minimize-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('minimize-btn'));
    await waitFor(() => {
      expect(onSync).toHaveBeenCalledWith({ mode: 'mini' });
    });
  });

  it('calls onStateChange when state updates', async () => {
    const onStateChange = vi.fn();
    render(<MusicPlayer initialState={{ mode: 'audio' }} onStateChange={onStateChange} />);
    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalled();
    });
  });

  it('fetches CSRF token and starred videos on mount', async () => {
    render(<MusicPlayer initialState={{ mode: 'audio' }} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/csrf-token', { credentials: 'include' });
      expect(global.fetch).toHaveBeenCalledWith('/api/music/starred', { credentials: 'include' });
    });
  });

  it('positions at bottom-right by default', () => {
    expect(DEFAULT_MUSIC_PLAYER_STATE.position).toEqual({ x: 100, y: 100 });
    expect(DEFAULT_MUSIC_PLAYER_STATE.mode).toBe('hidden');
    expect(DEFAULT_MUSIC_PLAYER_STATE.volume).toBe(80);
  });
});

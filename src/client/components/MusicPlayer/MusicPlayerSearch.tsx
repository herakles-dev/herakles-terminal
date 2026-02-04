import React, { useState, useCallback, useRef, useEffect } from 'react';
import { extractVideoId } from '../../../shared/musicProtocol.js';

interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration?: string;
}

interface MusicPlayerSearchProps {
  onLoadVideo: (url: string) => void;
}

export const MusicPlayerSearch: React.FC<MusicPlayerSearchProps> = ({
  onLoadVideo,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const csrfTokenRef = useRef<string | null>(null);

  // Fetch CSRF token on mount
  useEffect(() => {
    fetch('/api/csrf-token', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        csrfTokenRef.current = data.data?.token || null;
      })
      .catch(() => {});
  }, []);

  // Handle click outside to close results
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle input submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    // Check if it's a direct video ID or URL
    const videoId = extractVideoId(trimmed);
    if (videoId) {
      onLoadVideo(videoId);
      setQuery('');
      setShowResults(false);
      return;
    }

    // Otherwise, trigger search
    performSearch(trimmed);
  }, [query, onLoadVideo]);

  // Perform YouTube search via backend
  const performSearch = useCallback(async (searchQuery: string) => {
    setIsSearching(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfTokenRef.current) {
        headers['x-csrf-token'] = csrfTokenRef.current;
      }

      const response = await fetch('/api/music/search', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ query: searchQuery }),
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.error?.code === 'SEARCH_UNAVAILABLE') {
          setError('Search unavailable. Paste a YouTube URL instead.');
        } else {
          setError('Search failed. Try again.');
        }
        setResults([]);
        return;
      }

      const data = await response.json();
      setResults(data.data || []);
      setShowResults(true);
    } catch (err) {
      setError('Search failed. Try pasting a URL.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle input change with debounced search
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Check if it's a URL - don't auto-search
    if (value.includes('youtube.com') || value.includes('youtu.be') || extractVideoId(value)) {
      setShowResults(false);
      setResults([]);
      return;
    }

    // Debounce search for regular queries
    if (value.trim().length >= 3) {
      debounceRef.current = setTimeout(() => {
        performSearch(value.trim());
      }, 500);
    } else {
      setShowResults(false);
      setResults([]);
    }
  }, [performSearch]);

  // Select a search result
  const handleSelectResult = useCallback((videoId: string) => {
    onLoadVideo(videoId);
    setQuery('');
    setResults([]);
    setShowResults(false);
  }, [onLoadVideo]);

  return (
    <div ref={containerRef} className="music-player-search">
      <form onSubmit={handleSubmit}>
        <div className="music-player-search-input-wrapper">
          <svg
            className="music-player-search-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="16"
            height="16"
          >
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Paste YouTube URL or search..."
            className="music-player-search-input"
            autoComplete="off"
          />
          {isSearching && (
            <div className="music-player-search-spinner">
              <div className="spinner-small" />
            </div>
          )}
        </div>
      </form>

      {/* Search results dropdown */}
      {showResults && (results.length > 0 || error) && (
        <div className="music-player-search-results">
          {error && (
            <div className="music-player-search-error">{error}</div>
          )}
          {results.map((result) => (
            <button
              key={result.videoId}
              className="music-player-search-result"
              onClick={() => handleSelectResult(result.videoId)}
            >
              <img
                src={result.thumbnail}
                alt=""
                className="music-player-search-result-thumb"
              />
              <div className="music-player-search-result-info">
                <div className="music-player-search-result-title">
                  {result.title}
                </div>
                <div className="music-player-search-result-channel">
                  {result.channelTitle}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MusicPlayerSearch;

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Artifact, CanvasState } from '../types/canvas';

const MAX_ARTIFACTS = 50;
const MAX_CONTENT_SIZE = 100 * 1024;

async function getCsrfToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/csrf-token', { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.token || null;
  } catch {
    return null;
  }
}

async function fetchStarredArtifacts(): Promise<Artifact[]> {
  try {
    const response = await fetch('/api/artifacts/starred', {
      credentials: 'include',
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function fetchTempArtifacts(): Promise<Artifact[]> {
  try {
    const response = await fetch('/api/artifacts/temp', {
      credentials: 'include',
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function starArtifactApi(artifact: Artifact, csrfToken: string | null): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    
    const response = await fetch('/api/artifacts/starred', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        id: artifact.id,
        type: artifact.type,
        content: artifact.content,
        language: artifact.language,
        title: artifact.title,
        sourceWindow: artifact.sourceWindow,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function unstarArtifactApi(id: string, csrfToken: string | null): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    
    const response = await fetch(`/api/artifacts/starred/${id}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function useCanvasArtifacts() {
  const [state, setState] = useState<CanvasState>({
    artifacts: [],
    activeArtifactId: null,
    viewMode: 'preview',
    unreadCount: 0,
  });
  const csrfTokenRef = useRef<string | null>(null);

  const refetchMissedArtifacts = useCallback(async () => {
    try {
      const temp = await fetchTempArtifacts();
      if (temp.length > 0) {
        setState(prev => {
          const existingIds = new Set(prev.artifacts.map(a => a.id));
          const newArtifacts = temp.filter(a => !existingIds.has(a.id));
          if (newArtifacts.length === 0) return prev;
          
          const combined = [...newArtifacts, ...prev.artifacts]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_ARTIFACTS);
          
          return {
            ...prev,
            artifacts: combined,
            unreadCount: prev.unreadCount + newArtifacts.length,
          };
        });
      }
    } catch (e) {
      console.warn('Failed to fetch missed artifacts:', e);
    }
  }, []);

  useEffect(() => {
    getCsrfToken().then(token => {
      csrfTokenRef.current = token;
    });
    
    Promise.all([fetchStarredArtifacts(), fetchTempArtifacts()]).then(([starred, temp]) => {
      const starredIds = new Set(starred.map(a => a.id));
      const combined = [
        ...starred,
        ...temp.filter(a => !starredIds.has(a.id)),
      ].sort((a, b) => b.timestamp - a.timestamp);
      
      if (combined.length > 0) {
        setState(prev => ({
          ...prev,
          artifacts: combined,
        }));
      }
    });
  }, []);

  const addArtifact = useCallback((artifact: Artifact) => {
    if (artifact.content.length > MAX_CONTENT_SIZE) {
      artifact = { ...artifact, content: artifact.content.slice(0, MAX_CONTENT_SIZE) };
    }

    setState(prev => {
      const existingIndex = prev.artifacts.findIndex(a => a.id === artifact.id);
      let newArtifacts: Artifact[];
      
      if (existingIndex >= 0) {
        newArtifacts = [...prev.artifacts];
        newArtifacts[existingIndex] = { ...artifact, starred: prev.artifacts[existingIndex].starred };
      } else {
        newArtifacts = [artifact, ...prev.artifacts];
        if (newArtifacts.length > MAX_ARTIFACTS) {
          newArtifacts = newArtifacts.slice(0, MAX_ARTIFACTS);
        }
      }
      
      return {
        ...prev,
        artifacts: newArtifacts,
        activeArtifactId: artifact.id,
        unreadCount: prev.unreadCount + 1,
      };
    });
  }, []);

  const removeArtifact = useCallback((id: string) => {
    setState(prev => {
      const artifact = prev.artifacts.find(a => a.id === id);
      if (artifact?.starred) {
        unstarArtifactApi(id, csrfTokenRef.current);
      }
      
      const newArtifacts = prev.artifacts.filter(a => a.id !== id);
      const newActiveId = prev.activeArtifactId === id
        ? (newArtifacts[0]?.id || null)
        : prev.activeArtifactId;
      return {
        ...prev,
        artifacts: newArtifacts,
        activeArtifactId: newActiveId,
      };
    });
  }, []);

  const toggleStar = useCallback((id: string) => {
    setState(prev => {
      const artifact = prev.artifacts.find(a => a.id === id);
      if (!artifact) return prev;

      const newStarred = !artifact.starred;
      
      const token = csrfTokenRef.current;
      if (newStarred) {
        starArtifactApi(artifact, token).then(success => {
          if (!success) {
            setState(p => ({
              ...p,
              artifacts: p.artifacts.map(a =>
                a.id === id ? { ...a, starred: false } : a
              ),
            }));
          }
        });
      } else {
        unstarArtifactApi(id, token).then(success => {
          if (!success) {
            setState(p => ({
              ...p,
              artifacts: p.artifacts.map(a =>
                a.id === id ? { ...a, starred: true } : a
              ),
            }));
          }
        });
      }

      return {
        ...prev,
        artifacts: prev.artifacts.map(a =>
          a.id === id ? { ...a, starred: newStarred } : a
        ),
      };
    });
  }, []);

  const clearArtifacts = useCallback(() => {
    setState(prev => {
      const starredArtifacts = prev.artifacts.filter(a => a.starred);
      return {
        ...prev,
        artifacts: starredArtifacts,
        activeArtifactId: starredArtifacts[0]?.id || null,
        unreadCount: 0,
      };
    });
  }, []);

  const setActiveArtifact = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      activeArtifactId: id,
    }));
  }, []);

  const toggleViewMode = useCallback(() => {
    setState(prev => ({
      ...prev,
      viewMode: prev.viewMode === 'code' ? 'preview' : 'code',
    }));
  }, []);

  const markAsRead = useCallback(() => {
    setState(prev => ({
      ...prev,
      unreadCount: 0,
    }));
  }, []);

  return {
    artifacts: state.artifacts,
    activeArtifactId: state.activeArtifactId,
    viewMode: state.viewMode,
    unreadCount: state.unreadCount,
    addArtifact,
    removeArtifact,
    clearArtifacts,
    setActiveArtifact,
    toggleViewMode,
    markAsRead,
    toggleStar,
    refetchMissedArtifacts,
  };
}

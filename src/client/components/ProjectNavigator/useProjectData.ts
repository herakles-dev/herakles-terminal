import { useState, useEffect, useCallback, useMemo } from 'react';

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  category?: string;
  description?: string;
  status?: string;
  hasDocker: boolean;
  hasPackageJson: boolean;
  hasRequirements: boolean;
  hasCargo: boolean;
  hasGoMod: boolean;
  lastModified: string;
  url?: string;
  port?: number;
  isFavorite?: boolean;
}

export type SortOption = 'name-asc' | 'name-desc' | 'modified' | 'favorites';

const FAVORITES_KEY = 'zeus-project-favorites';
const SORT_KEY = 'zeus-project-sort';
const CATEGORY_KEY = 'zeus-project-category';

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function loadSort(): SortOption {
  return (localStorage.getItem(SORT_KEY) as SortOption) || 'name-asc';
}

function loadCategory(): string {
  return localStorage.getItem(CATEGORY_KEY) || 'all';
}

export function useProjectData() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [search, setSearch] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>(() => loadSort());
  const [category, setCategory] = useState<string>(() => loadCategory());
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const json = await response.json();
      const projectList = json.data?.projects || [];
      
      setProjects(projectList.map((p: ProjectInfo) => ({
        ...p,
        isFavorite: favorites.has(p.id),
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [favorites]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/projects/categories');
      if (response.ok) {
        const json = await response.json();
        setCategories(json.data?.categories || []);
      }
    } catch {
      // Silently fail - categories are optional
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchCategories();
  }, [fetchProjects, fetchCategories]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites(next);
      return next;
    });
    
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, isFavorite: !p.isFavorite } : p
    ));
  }, []);

  const updateSort = useCallback((option: SortOption) => {
    setSortOption(option);
    localStorage.setItem(SORT_KEY, option);
  }, []);

  const updateCategory = useCallback((cat: string) => {
    setCategory(cat);
    localStorage.setItem(CATEGORY_KEY, cat);
  }, []);

  const filteredProjects = useMemo(() => {
    let filtered = [...projects];

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        p.path.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower) ||
        p.category?.toLowerCase().includes(searchLower)
      );
    }

    if (category !== 'all') {
      filtered = filtered.filter(p => p.category === category);
    }

    switch (sortOption) {
      case 'name-asc':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'modified':
        filtered.sort((a, b) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        );
        break;
      case 'favorites':
        filtered.sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return a.name.localeCompare(b.name);
        });
        break;
    }

    return filtered;
  }, [projects, search, category, sortOption]);

  const favoriteProjects = useMemo(() => 
    projects.filter(p => p.isFavorite).sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  return {
    projects: filteredProjects,
    favoriteProjects,
    allProjects: projects,
    loading,
    error,
    search,
    setSearch,
    sortOption,
    updateSort,
    category,
    updateCategory,
    categories,
    toggleFavorite,
    refresh: fetchProjects,
    totalCount: projects.length,
    filteredCount: filteredProjects.length,
  };
}

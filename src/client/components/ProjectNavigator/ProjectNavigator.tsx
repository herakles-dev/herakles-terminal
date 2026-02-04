import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectData, ProjectInfo, SortOption } from './useProjectData';

interface ProjectNavigatorProps {
  onSelectProject: (path: string) => void;
}

function ProjectTypeIcon({ project }: { project: ProjectInfo }) {
  if (project.hasDocker) {
    return (
      <svg className="w-5 h-5 text-[#2496ED]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186h-2.119a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
      </svg>
    );
  }
  if (project.hasPackageJson) {
    return (
      <svg className="w-5 h-5 text-[#68A063]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 21.985c-.275 0-.532-.074-.772-.202l-2.439-1.448c-.365-.203-.182-.277-.072-.314.496-.165.588-.201 1.101-.493.056-.037.129-.02.185.017l1.87 1.12c.074.036.166.036.221 0l7.319-4.237c.074-.036.11-.11.11-.202V7.768c0-.091-.036-.165-.11-.201l-7.319-4.219c-.073-.037-.165-.037-.221 0L4.552 7.566c-.073.036-.11.129-.11.201v8.457c0 .073.037.166.11.202l2 1.157c1.082.548 1.762-.095 1.762-.735V8.502c0-.11.091-.221.22-.221h.936c.108 0 .22.092.22.221v8.347c0 1.449-.788 2.294-2.164 2.294-.422 0-.752 0-1.688-.46l-1.925-1.099a1.55 1.55 0 01-.771-1.34V7.786c0-.55.293-1.064.771-1.339l7.316-4.237a1.637 1.637 0 011.544 0l7.317 4.237c.479.274.771.789.771 1.339v8.458c0 .549-.293 1.063-.771 1.34l-7.317 4.236c-.241.11-.516.165-.773.165zm2.256-5.816c-3.21 0-3.87-.738-3.87-2.478 0-.11.092-.221.22-.221h.954c.11 0 .201.073.201.184.147.971.568 1.449 2.514 1.449 1.54 0 2.202-.35 2.202-1.175 0-.477-.184-.825-2.587-1.063-1.999-.203-3.246-.643-3.246-2.238 0-1.485 1.247-2.366 3.339-2.366 2.347 0 3.503.809 3.649 2.568a.297.297 0 01-.056.165.22.22 0 01-.147.073h-.953a.212.212 0 01-.202-.164c-.221-1.012-.789-1.34-2.292-1.34-1.689 0-1.891.587-1.891 1.027 0 .531.238.696 2.514.99 2.256.293 3.32.715 3.32 2.294-.02 1.615-1.339 2.531-3.67 2.531z"/>
      </svg>
    );
  }
  if (project.hasRequirements) {
    return (
      <svg className="w-5 h-5 text-[#3776AB]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z"/>
      </svg>
    );
  }
  if (project.hasCargo) {
    return (
      <svg className="w-5 h-5 text-[#DEA584]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.8346 11.7033l-1.0073-.6236a13.7268 13.7268 0 00-.0283-.2936l.8656-.7636a.3483.3483 0 00.0632-.4175l-.9514-1.6445a.3442.3442 0 00-.3993-.1573l-1.0953.3566a8.4558 8.4558 0 00-.2485-.1461l-.0715-1.1581a.3462.3462 0 00-.276-.3144l-1.8752-.3311a.3441.3441 0 00-.3894.2178l-.4255 1.0756a7.7893 7.7893 0 00-.283.0416l-.6569-.9363a.3477.3477 0 00-.412-.1324l-1.7438.6713a.3474.3474 0 00-.2126.3697l.1605 1.1517a8.5628 8.5628 0 00-.2306.1626l-.9398-.5771a.3474.3474 0 00-.4197.0505l-1.3704 1.2893a.348.348 0 00-.0758.4169l.5243.9931a10.1051 10.1051 0 00-.1685.2287l-1.1095-.2172a.3474.3474 0 00-.3897.2083l-.6904 1.7016a.3474.3474 0 00.1238.4025l.9553.6208a10.0469 10.0469 0 00-.0273.2907l-.8656.7636a.3483.3483 0 00-.0632.4175l.9514 1.6445a.3442.3442 0 00.3993.1573l1.0953-.3566c.0819.0496.165.0973.2485.1461l.0715 1.1581a.3462.3462 0 00.276.3144l1.8752.3311a.3441.3441 0 00.3894-.2178l.4255-1.0756a7.7893 7.7893 0 00.283-.0416l.6569.9363a.3477.3477 0 00.412.1324l1.7438-.6713a.3474.3474 0 00.2126-.3697l-.1605-1.1517a8.5628 8.5628 0 00.2306-.1626l.9398.5771a.3474.3474 0 00.4197-.0505l1.3704-1.2893a.348.348 0 00.0758-.4169l-.5243-.9931a10.1051 10.1051 0 00.1685-.2287l1.1095.2172a.3474.3474 0 00.3897-.2083l.6904-1.7016a.3474.3474 0 00-.1238-.4025zm-6.7534 2.5673a3.6472 3.6472 0 11-2.6885-4.4024 3.6476 3.6476 0 012.6885 4.4024z"/>
      </svg>
    );
  }
  if (project.hasGoMod) {
    return (
      <svg className="w-5 h-5 text-[#00ADD8]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M1.811 10.231c-.047 0-.058-.023-.035-.059l.246-.315c.023-.035.081-.058.128-.058h4.172c.046 0 .058.035.035.07l-.199.303c-.023.036-.082.07-.117.07zM.047 11.306c-.047 0-.059-.023-.035-.058l.245-.316c.023-.035.082-.058.129-.058h5.328c.047 0 .07.035.058.07l-.093.28c-.012.047-.058.07-.105.07zm2.828 1.075c-.047 0-.059-.035-.035-.07l.163-.292c.023-.035.07-.07.117-.07h2.337c.047 0 .07.035.07.082l-.023.28c0 .047-.047.082-.082.082zm12.129-2.36c-.736.187-1.239.327-1.963.514-.176.046-.187.058-.34-.117-.174-.199-.303-.327-.548-.444-.737-.362-1.45-.257-2.115.175-.795.514-1.204 1.274-1.192 2.22.011.935.654 1.706 1.577 1.835.795.105 1.46-.175 1.987-.77.105-.13.198-.27.315-.434H10.47c-.245 0-.304-.152-.222-.35.152-.362.432-.97.596-1.274a.315.315 0 01.292-.187h4.253c-.023.316-.023.631-.07.947a4.983 4.983 0 01-.958 2.29c-.841 1.11-1.94 1.8-3.33 1.986-1.145.152-2.209-.07-3.143-.77-.865-.655-1.356-1.52-1.484-2.595-.152-1.274.222-2.419.993-3.424.83-1.086 1.928-1.776 3.272-2.02 1.098-.2 2.15-.07 3.096.571.62.41 1.063.97 1.356 1.648.07.105.023.164-.117.199z"/>
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-[#71717a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function ProjectCard({
  project,
  onSelect,
  onToggleFavorite
}: {
  project: ProjectInfo;
  onSelect: (path: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={() => onSelect(project.path)}
      className="group relative flex flex-col items-center justify-center p-3 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-[#00d4ff]/30 rounded-lg transition-all duration-150 h-[100px] min-w-[140px]"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(project.id);
        }}
        className={`absolute top-1.5 right-1.5 p-0.5 rounded transition-all z-10 ${
          project.isFavorite
            ? 'text-[#eab308] opacity-100'
            : 'text-[#8a8a92] opacity-0 group-hover:opacity-100'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill={project.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      {project.status === 'running' && (
        <div className="absolute top-1.5 left-1.5 w-2 h-2 bg-[#22c55e] rounded-full shadow-[0_0_6px_rgba(34,197,94,0.5)] z-10" />
      )}

      <div className="mb-1.5 w-10 h-10 flex items-center justify-center overflow-hidden rounded">
        {project.thumbnail && !imgError ? (
          <img
            src={project.thumbnail}
            alt={project.name}
            className="w-full h-full object-cover rounded"
            onError={() => setImgError(true)}
          />
        ) : (
          <ProjectTypeIcon project={project} />
        )}
      </div>

      <span className="text-[12px] text-[#d4d4d8] group-hover:text-white truncate w-full text-center font-medium leading-tight">
        {project.name}
      </span>

      {project.category && (
        <span className="text-[10px] text-[#8a8a92] truncate w-full text-center mt-0.5">
          {project.category}
        </span>
      )}
    </button>
  );
}

export default function ProjectNavigator({ onSelectProject }: ProjectNavigatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    projects,
    favoriteProjects,
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
    totalCount,
    filteredCount,
  } = useProjectData();

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  const handleSelect = useCallback((path: string) => {
    onSelectProject(path);
    setIsOpen(false);
  }, [onSelectProject]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        onMouseDown={(e) => e.stopPropagation()}
        className={`p-2 rounded-md transition-all duration-200 ${
          isOpen 
            ? 'bg-[#00d4ff]/15 text-[#00d4ff] ring-1 ring-[#00d4ff]/30 shadow-[0_0_8px_rgba(0,212,255,0.2)]' 
            : 'text-[#a1a1aa] hover:text-white hover:bg-white/5'
        }`}
        title="Project Navigator (⌘⇧P)"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </button>

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 px-6 pb-6">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          
          <div
            ref={dropdownRef}
            className="relative w-full max-w-[1400px] max-h-[calc(100vh-120px)] bg-[#0a0a0f] border border-[#27272a] rounded-xl shadow-2xl flex flex-col animate-scale-in overflow-hidden"
          >
            <div className="flex items-center gap-3 p-4 border-b border-[#27272a] bg-gradient-to-r from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8a8a92]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={`Search ${totalCount} projects...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-base text-white placeholder-[#52525b] focus:border-[#00d4ff]/50 focus:ring-1 focus:ring-[#00d4ff]/30 focus:outline-none"
                />
              </div>

              <select
                value={category}
                onChange={(e) => updateCategory(e.target.value)}
                className="px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-base text-[#a1a1aa] focus:border-[#00d4ff]/50 focus:outline-none"
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>

              <select
                value={sortOption}
                onChange={(e) => updateSort(e.target.value as SortOption)}
                className="px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-base text-[#a1a1aa] focus:border-[#00d4ff]/50 focus:outline-none"
              >
                <option value="name-asc">A-Z</option>
                <option value="name-desc">Z-A</option>
                <option value="modified">Recent</option>
                <option value="favorites">Favorites</option>
              </select>

              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-[#8a8a92] hover:text-white hover:bg-white/5 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-8 h-8 border-2 border-[#00d4ff]/30 border-t-[#00d4ff] rounded-full animate-spin" />
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-40 text-[#ef4444]">
                  {error}
                </div>
              ) : (
                <>
                  {favoriteProjects.length > 0 && !search && category === 'all' && (
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-[#00d4ff] mb-3 flex items-center gap-2">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                        Favorites ({favoriteProjects.length})
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                        {favoriteProjects.map(project => (
                          <ProjectCard
                            key={`fav-${project.id}`}
                            project={project}
                            onSelect={handleSelect}
                            onToggleFavorite={toggleFavorite}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-semibold text-[#a1a1aa] mb-3">
                      {search || category !== 'all' ? `Results (${filteredCount})` : `All Projects (${totalCount})`}
                    </h3>
                    {projects.length === 0 ? (
                      <div className="text-center py-12 text-[#8a8a92]">
                        No projects found matching your criteria
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                        {projects.map(project => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            onSelect={handleSelect}
                            onToggleFavorite={toggleFavorite}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2 border-t border-[#27272a] bg-[#0a0a0f] text-[11px] text-[#8a8a92]">
              <div className="flex items-center gap-4">
                <span>Click to cd • Star to favorite</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 bg-[#18181b] border border-[#27272a] rounded text-[10px]">Esc</kbd>
                <span>to close</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

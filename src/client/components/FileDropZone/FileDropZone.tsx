import { useState, useCallback, useRef, useEffect } from 'react';

interface FileDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  enabled?: boolean;
  children: React.ReactNode;
}

export function FileDropZone({ onFilesDropped, enabled = true, children }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!enabled) return;

    // Only respond to file drags
    if (!e.dataTransfer?.types.includes('Files')) return;

    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  }, [enabled]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!enabled) return;

    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, [enabled]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!enabled) return;

    // Set drop effect to copy
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [enabled]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
    dragCounterRef.current = 0;

    if (!enabled) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      onFilesDropped(fileArray);
    }
  }, [enabled, onFilesDropped]);

  useEffect(() => {
    const element = dropRef.current;
    if (!element) return;

    element.addEventListener('dragenter', handleDragEnter);
    element.addEventListener('dragleave', handleDragLeave);
    element.addEventListener('dragover', handleDragOver);
    element.addEventListener('drop', handleDrop);

    return () => {
      element.removeEventListener('dragenter', handleDragEnter);
      element.removeEventListener('dragleave', handleDragLeave);
      element.removeEventListener('dragover', handleDragOver);
      element.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  // Reset drag state when component unmounts or enabled changes
  useEffect(() => {
    if (!enabled) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  }, [enabled]);

  return (
    <div ref={dropRef} className="relative w-full h-full">
      {children}
      {isDragging && enabled && (
        <div className="file-drop-zone-overlay absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <svg 
              className="w-16 h-16 mx-auto mb-4 text-[#00d4ff]" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
              />
            </svg>
            <p className="text-[#00d4ff] font-semibold text-lg">Drop files to upload</p>
            <p className="text-[#71717a] text-sm mt-2">Files will be available for Claude</p>
          </div>
        </div>
      )}
    </div>
  );
}

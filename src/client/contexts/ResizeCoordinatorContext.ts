import { createContext, useContext } from 'react';
import type { useResizeCoordinator } from '../hooks/useResizeCoordinator';

type ResizeCoordinatorContextType = ReturnType<typeof useResizeCoordinator> | null;

export const ResizeCoordinatorContext = createContext<ResizeCoordinatorContextType>(null);

export function useResizeCoordinatorContext() {
  const context = useContext(ResizeCoordinatorContext);
  if (!context) {
    throw new Error('useResizeCoordinatorContext must be used within ResizeCoordinatorProvider');
  }
  return context;
}

export function useOptionalResizeCoordinator() {
  return useContext(ResizeCoordinatorContext);
}

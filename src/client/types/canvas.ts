export type ArtifactType = 'html' | 'markdown' | 'mermaid' | 'svg' | 'code' | 'json';

export interface Artifact {
  id: string;
  type: ArtifactType;
  content: string;
  language?: string;
  title?: string;
  sourceWindow: string;
  timestamp: number;
  starred?: boolean;
}

export interface CanvasState {
  artifacts: Artifact[];
  activeArtifactId: string | null;
  viewMode: 'code' | 'preview';
  unreadCount: number;
}

export interface DetectionResult {
  detected: boolean;
  artifacts: Artifact[];
}

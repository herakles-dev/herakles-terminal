import type { Artifact } from '../../types/canvas';
import {
  MarkdownRenderer,
  CodeRenderer,
  HTMLRenderer,
  SVGRenderer,
  MermaidRenderer,
  JSONRenderer,
} from './renderers';

interface ArtifactRendererProps {
  artifact: Artifact;
  viewMode: 'code' | 'preview';
}

export default function ArtifactRenderer({ artifact, viewMode }: ArtifactRendererProps) {
  if (viewMode === 'code') {
    return (
      <CodeRenderer
        content={artifact.content}
        language={artifact.language || artifact.type}
      />
    );
  }

  switch (artifact.type) {
    case 'markdown':
      return <MarkdownRenderer content={artifact.content} />;
    case 'code':
      return <CodeRenderer content={artifact.content} language={artifact.language} />;
    case 'html':
      return <HTMLRenderer content={artifact.content} />;
    case 'svg':
      return <SVGRenderer content={artifact.content} />;
    case 'mermaid':
      return <MermaidRenderer content={artifact.content} />;
    case 'json':
      return <JSONRenderer content={artifact.content} />;
    default:
      return <CodeRenderer content={artifact.content} language="text" />;
  }
}

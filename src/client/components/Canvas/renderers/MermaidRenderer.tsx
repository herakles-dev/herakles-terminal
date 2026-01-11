import { useEffect, useState, useRef } from 'react';

interface MermaidRendererProps {
  content: string;
}

let mermaidInitialized = false;

export default function MermaidRenderer({ content }: MermaidRendererProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setLoading(true);
      setError(null);

      try {
        const mermaid = (await import('mermaid')).default;
        
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
              primaryColor: '#00d4ff',
              primaryTextColor: '#fff',
              primaryBorderColor: '#1a1a1e',
              lineColor: '#00d4ff',
              secondaryColor: '#1a1a2e',
              tertiaryColor: '#0a0a0a',
              background: '#000',
              mainBkg: '#0a0a0f',
              textColor: '#e0e0e8',
            },
            flowchart: {
              curve: 'basis',
              padding: 20,
            },
            sequence: {
              actorMargin: 50,
              boxMargin: 10,
              boxTextMargin: 5,
            },
          });
          mermaidInitialized = true;
        }
        
        const { svg: renderedSvg } = await mermaid.render(idRef.current, content);
        if (!cancelled) {
          setSvg(renderedSvg);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (loading) {
    return (
      <div className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg flex items-center justify-center">
        <div className="flex items-center gap-2 text-[#71717a]">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Rendering diagram...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg p-4">
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-red-400 text-sm font-medium">Diagram Error</p>
            <p className="text-red-400/70 text-xs mt-1">{error}</p>
          </div>
        </div>
        <pre className="mt-4 p-3 bg-[#1a1a1e] rounded text-[11px] text-[#71717a] overflow-x-auto">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg p-4 flex items-center justify-center overflow-auto"
    >
      <div
        className="[&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

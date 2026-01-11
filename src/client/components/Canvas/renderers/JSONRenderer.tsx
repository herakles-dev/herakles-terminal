import { useState, useCallback, useMemo } from 'react';

interface JSONRendererProps {
  content: string;
}

interface TreeNodeProps {
  name: string;
  value: unknown;
  depth: number;
  path: string;
  defaultExpanded?: boolean;
}

function TreeNode({ name, value, depth, path, defaultExpanded = false }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || depth < 1);
  const [copied, setCopied] = useState(false);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [path]);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const isEmpty = isObject && Object.keys(value as object).length === 0;

  const renderValue = () => {
    if (value === null) {
      return <span className="text-[#71717a] italic">null</span>;
    }
    if (typeof value === 'boolean') {
      return <span className="text-[#eab308]">{value.toString()}</span>;
    }
    if (typeof value === 'number') {
      return <span className="text-[#00d4ff]">{value}</span>;
    }
    if (typeof value === 'string') {
      const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
      return <span className="text-[#22c55e]">"{displayValue}"</span>;
    }
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-center gap-2 py-0.5 group" style={{ paddingLeft: depth * 16 }}>
        <span className="text-[#a1a1aa]">{name}:</span>
        {renderValue()}
        <button
          onClick={handleCopyPath}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-[#52525b] hover:text-[#00d4ff] transition-all"
          title={`Copy path: ${path}`}
        >
          {copied ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
    );
  }

  const entries = Object.entries(value as object);
  const bracket = isArray ? ['[', ']'] : ['{', '}'];

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-1 py-0.5 group">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-4 h-4 flex items-center justify-center text-[#52525b] hover:text-[#00d4ff] transition-colors"
          disabled={isEmpty}
        >
          {!isEmpty && (
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
        <span className="text-[#a1a1aa]">{name}:</span>
        <span className="text-[#52525b]">
          {bracket[0]}
          {!expanded && !isEmpty && <span className="text-[#3a3a42] mx-1">...</span>}
          {(isEmpty || !expanded) && bracket[1]}
        </span>
        <span className="text-[#3a3a42] text-[10px]">
          {isArray ? `${entries.length} items` : `${entries.length} keys`}
        </span>
        <button
          onClick={handleCopyPath}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-[#52525b] hover:text-[#00d4ff] transition-all"
          title={`Copy path: ${path}`}
        >
          {copied ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
      {expanded && !isEmpty && (
        <>
          {entries.map(([key, val]) => (
            <TreeNode
              key={key}
              name={isArray ? `[${key}]` : key}
              value={val}
              depth={depth + 1}
              path={isArray ? `${path}[${key}]` : `${path}.${key}`}
              defaultExpanded={depth < 0}
            />
          ))}
          <div style={{ paddingLeft: 16 }} className="text-[#52525b]">{bracket[1]}</div>
        </>
      )}
    </div>
  );
}

export default function JSONRenderer({ content }: JSONRendererProps) {
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return JSON.parse(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
      return null;
    }
  }, [content]);

  if (error) {
    return (
      <div className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg p-4">
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-red-400 text-sm font-medium">JSON Parse Error</p>
            <p className="text-red-400/70 text-xs mt-1">{error}</p>
          </div>
        </div>
        <pre className="mt-4 p-3 bg-[#1a1a1e] rounded text-[11px] text-[#71717a] overflow-x-auto whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#0a0a0f] rounded-lg p-4 overflow-auto font-mono text-[12px]">
      <TreeNode name="root" value={parsed} depth={0} path="$" defaultExpanded />
    </div>
  );
}

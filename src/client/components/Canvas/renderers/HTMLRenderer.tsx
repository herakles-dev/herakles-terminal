import { useMemo } from 'react';
import { sanitizeHtml } from '../utils/sanitize';

interface HTMLRendererProps {
  content: string;
}

const IFRAME_STYLES = `
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #e0e0e8;
      background: #0a0a0f;
    }
    a { color: #00d4ff; }
    code {
      font-family: 'SF Mono', Consolas, monospace;
      background: #1a1a1e;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    pre {
      background: #1a1a1e;
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #27272a;
      padding: 8px 12px;
      text-align: left;
    }
    th { background: #1a1a1e; }
    img { max-width: 100%; height: auto; }
    button, input, select {
      font-family: inherit;
      font-size: inherit;
    }
  </style>
`;

export default function HTMLRenderer({ content }: HTMLRendererProps) {
  const sanitizedContent = useMemo(() => {
    const sanitized = sanitizeHtml(content);
    return IFRAME_STYLES + sanitized;
  }, [content]);

  return (
    <div className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg overflow-hidden">
      <iframe
        srcDoc={sanitizedContent}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
        style={{ minHeight: '300px' }}
        title="HTML Preview"
      />
    </div>
  );
}

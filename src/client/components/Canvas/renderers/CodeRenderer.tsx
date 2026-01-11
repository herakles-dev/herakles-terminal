import { useState, useCallback } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

interface CodeRendererProps {
  content: string;
  language?: string;
}

export default function CodeRenderer({ content, language = 'text' }: CodeRendererProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div className="relative group">
      {language && language !== 'text' && (
        <div className="absolute top-2 right-12 px-2 py-0.5 text-[9px] font-mono text-[#71717a] bg-[#1a1a1e] rounded border border-[#27272a]">
          {language}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-[#1a1a1e] border border-[#27272a] text-[#71717a] hover:text-[#00d4ff] hover:border-[#00d4ff]/30 transition-all opacity-0 group-hover:opacity-100"
        title="Copy code"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <Highlight theme={themes.vsDark} code={content} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto p-4 rounded-lg text-[13px] leading-relaxed`}
            style={{ ...style, backgroundColor: '#0a0a0f', margin: 0 }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className="inline-block w-8 text-right mr-4 text-[#3a3a42] select-none text-[11px]">
                  {i + 1}
                </span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeRenderer from './CodeRenderer';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none p-4 
      prose-headings:text-[#e0e0e8] prose-headings:font-semibold prose-headings:border-b prose-headings:border-[#27272a] prose-headings:pb-2
      prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
      prose-p:text-[#a1a1aa] prose-p:leading-relaxed
      prose-a:text-[#00d4ff] prose-a:no-underline hover:prose-a:underline
      prose-strong:text-[#e0e0e8]
      prose-code:text-[#00d4ff] prose-code:bg-[#1a1a1e] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-transparent prose-pre:p-0
      prose-ul:text-[#a1a1aa] prose-ol:text-[#a1a1aa]
      prose-li:marker:text-[#00d4ff]
      prose-blockquote:border-l-[#00d4ff] prose-blockquote:text-[#71717a] prose-blockquote:bg-[#0a0a0f] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r
      prose-hr:border-[#27272a]
      prose-table:text-[#a1a1aa]
      prose-th:text-[#e0e0e8] prose-th:border-[#27272a] prose-th:bg-[#0a0a0f]
      prose-td:border-[#27272a]
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !className;
            
            if (isInline) {
              return <code {...props}>{children}</code>;
            }
            
            return (
              <CodeRenderer
                content={String(children).replace(/\n$/, '')}
                language={match ? match[1] : undefined}
              />
            );
          },
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

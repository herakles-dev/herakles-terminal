import { useMemo } from 'react';
import { sanitizeSvg } from '../utils/sanitize';

interface SVGRendererProps {
  content: string;
}

export default function SVGRenderer({ content }: SVGRendererProps) {
  const sanitizedSvg = useMemo(() => sanitizeSvg(content), [content]);

  return (
    <div className="w-full h-full min-h-[200px] bg-[#0a0a0f] rounded-lg p-4 flex items-center justify-center overflow-auto">
      <div
        className="max-w-full max-h-full [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
    </div>
  );
}

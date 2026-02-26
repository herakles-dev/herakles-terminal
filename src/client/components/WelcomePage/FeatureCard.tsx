import { useCallback, useState } from 'react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative bg-gradient-to-b from-[#0c0c14]/80 to-[#07070c]/80 backdrop-blur-xl rounded-xl p-5 border border-white/[0.06] transition-all duration-300 group overflow-hidden"
      style={{
        boxShadow: hovered
          ? '0 0 24px rgba(0,212,255,0.08), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)'
          : '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)',
        borderColor: hovered ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.06)',
      }}
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 rounded-xl transition-opacity duration-500 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.06) 0%, transparent 70%)',
          opacity: hovered ? 1 : 0,
        }}
      />

      <div className="relative z-10 flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-[#00d4ff]/15 to-[#8b5cf6]/10 border border-[#00d4ff]/10 flex items-center justify-center text-[#00d4ff] transition-all duration-300 group-hover:shadow-[0_0_12px_rgba(0,212,255,0.2)] group-hover:border-[#00d4ff]/25">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[#e4e4e7] mb-1 group-hover:text-white transition-colors">
            {title}
          </h3>
          <p className="text-[12px] text-[#71717a] leading-relaxed group-hover:text-[#a1a1aa] transition-colors">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

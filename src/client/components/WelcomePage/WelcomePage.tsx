import { useState, useCallback } from 'react';
import { LightningCanvas } from '../LightningOverlay/LightningCanvas';
import { FeatureCard } from './FeatureCard';

interface WelcomePageProps {
  onStart: () => void;
}

const FEATURES = [
  {
    title: 'tmux Sessions',
    description: 'Persistent terminal sessions survive disconnects. Up to 6 tile windows per session.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  {
    title: 'Claude Code Integration',
    description: 'Live task sync, context tracking, and artifact rendering built into every session.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
  {
    title: 'Hot Reload Dev',
    description: 'WebSocket-powered real-time output. Atomic resize, WebGL rendering, 60fps smooth.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: 'Mobile Ready',
    description: 'Touch-optimized interface with quick keys, swipe gestures, and responsive layouts.',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
  },
];

const SHORTCUTS = [
  { keys: 'Ctrl+Shift+T', action: 'New window' },
  { keys: 'Ctrl+B', action: 'Toggle tools panel' },
  { keys: 'Ctrl+Shift+W', action: 'Close window' },
  { keys: 'Ctrl+M', action: 'Minimize window' },
  { keys: 'Ctrl+Shift+L', action: 'Cycle layouts' },
  { keys: 'Ctrl+Shift+I', action: 'Toggle minimap' },
  { keys: 'Ctrl+1-6', action: 'Switch to window' },
  { keys: 'Ctrl+Shift+Arrow', action: 'Navigate windows' },
  { keys: 'Ctrl+C', action: 'Copy selection' },
  { keys: 'Ctrl+V', action: 'Paste clipboard' },
];

export function WelcomePage({ onStart }: WelcomePageProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleToggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#050510] to-black flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      {/* Lightning background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <LightningCanvas intensity={0.2} />
      </div>

      {/* Radial gradient overlays */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,212,255,0.08)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.06)_0%,transparent_50%)]" />
      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.4)_100%)]" />

      <div className="max-w-3xl w-full relative z-10">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-block mb-5 sm:mb-6">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-[#111118] to-[#0c0c14] border border-white/[0.08] flex items-center justify-center shadow-[0_0_60px_rgba(0,212,255,0.15),0_20px_40px_rgba(0,0,0,0.4)] group">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#00d4ff]/10 to-[#8b5cf6]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <svg className="w-10 h-10 sm:w-12 sm:h-12 text-[#00d4ff] drop-shadow-[0_0_12px_rgba(0,212,255,0.5)] relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2 sm:mb-3 tracking-tight">
            <span className="bg-gradient-to-r from-white via-white to-[#a1a1aa] bg-clip-text text-transparent">Zeus Terminal</span>
          </h1>
          <p className="text-base sm:text-lg text-[#a1a1aa]">Claude Code CLI with orchestration superpowers</p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 sm:mb-8">
          {FEATURES.map(feature => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>

        {/* CTA Button */}
        <button
          onClick={onStart}
          className="relative w-full py-4 sm:py-5 px-6 sm:px-8 bg-gradient-to-r from-[#0c0c14] to-[#111118] text-[#00d4ff] font-semibold rounded-xl border border-[#00d4ff]/25 hover:border-[#00d4ff]/50 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_40px_rgba(0,212,255,0.15)] transition-all duration-300 active:scale-[0.98] text-lg sm:text-xl group overflow-hidden mb-5"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#00d4ff]/0 via-[#00d4ff]/10 to-[#8b5cf6]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <span className="relative z-10 flex items-center justify-center gap-2">
            Create Session
            <svg className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </span>
        </button>

        {/* Keyboard Shortcuts Toggle */}
        <div className="mb-4">
          <button
            onClick={handleToggleShortcuts}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-[12px] text-[#71717a] hover:text-[#a1a1aa] font-medium tracking-wide transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform duration-200 ${showShortcuts ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Keyboard Shortcuts
          </button>

          {showShortcuts && (
            <div className="bg-gradient-to-b from-[#0c0c14]/80 to-[#07070c]/80 backdrop-blur-xl rounded-xl border border-white/[0.06] overflow-hidden animate-scale-in">
              <table className="w-full">
                <tbody>
                  {SHORTCUTS.map((shortcut, i) => (
                    <tr
                      key={shortcut.keys}
                      className={`${i % 2 === 0 ? 'bg-white/[0.01]' : ''} hover:bg-[#00d4ff]/[0.03] transition-colors`}
                    >
                      <td className="py-2 px-4 text-right">
                        <kbd className="inline-block px-2 py-0.5 bg-[#111118] border border-white/[0.08] rounded text-[11px] text-[#a1a1aa] font-mono shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                          {shortcut.keys}
                        </kbd>
                      </td>
                      <td className="py-2 px-4 text-[12px] text-[#71717a]">{shortcut.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-[#52525b] text-xs sm:text-sm font-medium tracking-wide">terminal.herakles.dev</p>
      </div>
    </div>
  );
}

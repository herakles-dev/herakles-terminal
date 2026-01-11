interface LoadingOverlayProps {
  message?: string;
  fullScreen?: boolean;
}

export default function LoadingOverlay({ message = 'Loading...', fullScreen = false }: LoadingOverlayProps) {
  return (
    <div className={`${fullScreen ? 'fixed inset-0' : 'absolute inset-0'} bg-black/80 backdrop-blur-sm flex items-center justify-center z-50`}>
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <div className="w-14 h-14 border-2 border-[#27272a] rounded-full" />
          <div className="absolute inset-0 w-14 h-14 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        </div>
        <span className="text-lg text-[#a1a1aa] animate-pulse">{message}</span>
      </div>
    </div>
  );
}

export function TerminalSkeleton() {
  return (
    <div className="h-full w-full bg-black p-4 overflow-hidden">
      <div className="space-y-2 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-[#22c55e] rounded-full" />
          <div className="h-4 bg-[#27272a] rounded w-48" />
        </div>
        <div className="h-4 bg-[#27272a]/50 rounded w-64 ml-4" />
        <div className="h-4 bg-[#27272a]/50 rounded w-56 ml-4" />
        <div className="h-4 bg-[#27272a]/30 rounded w-72 ml-4" />
        <div className="flex items-center gap-2 mt-4">
          <div className="w-2 h-2 bg-[#00d4ff] rounded-full animate-pulse" />
          <div className="h-4 bg-[#27272a] rounded w-32" />
          <div className="w-2 h-4 bg-[#00d4ff] animate-blink" />
        </div>
      </div>
    </div>
  );
}

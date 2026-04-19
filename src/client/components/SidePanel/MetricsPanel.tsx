import { useEffect, useMemo, useState } from 'react';
import { useMetricsSync } from '../../hooks/useMetricsSync';
import type { AgentSession, ContextUsage, WindowMetrics } from '@shared/contextProtocol';
import { HANDOFF_THRESHOLDS, tokenColorBand } from '@shared/contextProtocol';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ContextBar({
  percent,
  usedTokens,
  height = 6,
}: {
  percent: number;
  usedTokens: number;
  height?: number;
}) {
  const band = tokenColorBand(usedTokens);
  const color = band === 'green' ? '#22c55e' : band === 'yellow' ? '#eab308' : '#ef4444';
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, backgroundColor: '#27272a' }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(100, percent)}%`,
          backgroundColor: color,
          transition: 'width 0.3s ease-in-out, background-color 0.3s ease-in-out',
        }}
      />
    </div>
  );
}

function cacheColor(rate: number): string {
  if (rate >= 0.95) return 'text-[#22c55e]';
  if (rate >= 0.70) return 'text-[#eab308]';
  return 'text-[#f97316]';
}

function formatDuration(spawnedAt: number): string {
  const secs = Math.floor((Date.now() - spawnedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function shortModel(model: string): string {
  // e.g. claude-opus-4-6 → opus-4-6
  return model.replace(/^claude-/, '');
}

// ─── Session Overview Card ─────────────────────────────────────────────────────

function OverviewCard({ metrics }: { metrics: WindowMetrics }) {
  const main = metrics.mainSession;
  if (!main) {
    return (
      <div className="bg-[#0f0f18] border border-white/[0.06] rounded-lg p-3 mb-3">
        <p className="text-[#71717a] text-xs">No active main session</p>
      </div>
    );
  }
  const band = tokenColorBand(main.usedTokens);
  const zoneLabel =
    band === 'green'
      ? `Zone: safe (<${formatTokens(HANDOFF_THRESHOLDS.yellow)})`
      : band === 'yellow'
        ? `Zone: handoff soon (${formatTokens(HANDOFF_THRESHOLDS.yellow)}–${formatTokens(HANDOFF_THRESHOLDS.red)})`
        : `Zone: handoff NOW (>${formatTokens(HANDOFF_THRESHOLDS.red)})`;
  const zoneColor =
    band === 'green' ? 'text-[#22c55e]' : band === 'yellow' ? 'text-[#eab308]' : 'text-[#ef4444]';

  return (
    <div className="bg-[#0f0f18] border border-white/[0.06] rounded-lg p-3 mb-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[#71717a] text-xs">Model</span>
        <span className="text-[#00d4ff] text-xs font-mono">{shortModel(main.model)}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-[#71717a] text-xs">Context</span>
        <span
          className="text-[#a1a1aa] text-xs"
          title={`${main.usedTokens.toLocaleString()} of ${main.maxTokens.toLocaleString()} hard limit`}
        >
          {main.usedTokens.toLocaleString()} / {formatTokens(main.maxTokens)}{' '}
          <span className="text-[#e4e4e7]">({(Math.round(main.percentage * 10) / 10).toFixed(1)}%)</span>
        </span>
      </div>
      <ContextBar percent={main.percentage} usedTokens={main.usedTokens} height={7} />
      <div className={`text-[10px] pt-0.5 font-medium ${zoneColor}`}>{zoneLabel}</div>
      <div className="flex justify-between items-center pt-0.5">
        <span className="text-[#71717a] text-xs">Session</span>
        <span className="text-[#52525b] text-xs font-mono">{main.sessionId.slice(0, 8)}…</span>
      </div>
    </div>
  );
}

// ─── Token Breakdown Card ──────────────────────────────────────────────────────

function TokenRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[#71717a] text-xs">{label}</span>
      <span className="text-[#a1a1aa] text-xs font-mono tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function TokenBreakdownCard({ metrics }: { metrics: WindowMetrics }) {
  const main = metrics.mainSession;
  const agg = metrics.aggregated;

  // Main-session breakdown (primary data — these are the numbers users want to see)
  const mainInput = main?.inputTokens ?? 0;
  const mainCacheCreation = main?.cacheCreationTokens ?? 0;
  const mainCacheRead = main?.cacheReadTokens ?? 0;
  const mainOutput = main?.outputTokens ?? 0;
  const mainRate = main?.cacheHitRate ?? 0;
  const mainRatePercent = Math.round(mainRate * 100 * 10) / 10;
  const mainFilled = Math.round(mainRate * 5);
  const mainTurns = main?.turnCount ?? 0;

  const hasAgents = agg.agentCount > 0;

  return (
    <div className="bg-[#0f0f18] border border-white/[0.06] rounded-lg p-3 mb-3">
      <p className="text-[#e4e4e7] text-xs font-medium mb-2">
        Token Breakdown
        <span className="text-[#71717a] font-normal ml-1.5">(main session)</span>
      </p>
      {!main ? (
        <p className="text-[#71717a] text-xs">No main session data.</p>
      ) : (
        <>
          <TokenRow label="Input Tokens" value={mainInput} />
          <TokenRow label="Cache Creation" value={mainCacheCreation} />
          <TokenRow label="Cache Read" value={mainCacheRead} />
          <TokenRow label="Output Tokens" value={mainOutput} />
          <div className="border-t border-white/[0.06] mt-2 pt-2 flex justify-between items-center">
            <span className="text-[#71717a] text-xs">Cache Hit Rate</span>
            <span className={`text-xs font-mono ${cacheColor(mainRate)}`}>
              {mainRatePercent}%{' '}
              <span className="text-[#52525b]">
                {'█'.repeat(mainFilled)}{'░'.repeat(5 - mainFilled)}
              </span>
            </span>
          </div>
          {mainTurns > 0 && (
            <div className="flex justify-between items-center pt-0.5">
              <span className="text-[#71717a] text-xs">Turns</span>
              <span className="text-[#a1a1aa] text-xs font-mono tabular-nums">{mainTurns}</span>
            </div>
          )}
        </>
      )}
      {hasAgents && (
        <div className="mt-3 pt-2 border-t border-white/[0.06]">
          <p className="text-[#71717a] text-[10px] uppercase tracking-wide mb-1">
            + Subagents ({agg.agentCount})
          </p>
          <TokenRow label="Input" value={agg.totalInputTokens} />
          <TokenRow label="Cache Read" value={agg.totalCacheReadTokens} />
          <TokenRow label="Output" value={agg.totalOutputTokens} />
        </div>
      )}
    </div>
  );
}

// ─── Subagent Row ──────────────────────────────────────────────────────────────

function SubagentRow({ session }: { session: AgentSession }) {
  const statusColor =
    session.status === 'active'
      ? 'bg-[#00d4ff]'
      : session.status === 'completed'
        ? 'bg-[#22c55e]'
        : 'bg-[#71717a]';

  const totalTokens =
    session.usage.inputTokens +
    session.usage.cacheCreationTokens +
    session.usage.cacheReadTokens +
    session.usage.outputTokens;

  const rate = session.usage.cacheHitRate;
  const ratePercent = Math.round(rate * 100 * 10) / 10;

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
      <span className="text-[#a1a1aa] font-mono w-20 truncate flex-shrink-0">
        {session.agentType ?? session.sessionId.slice(0, 8)}
      </span>
      <span className="text-[#71717a] w-16 truncate flex-shrink-0">{shortModel(session.model)}</span>
      <span className="text-[#a1a1aa] font-mono tabular-nums flex-shrink-0 w-16 text-right">
        {totalTokens.toLocaleString()}
      </span>
      <span className={`font-mono flex-shrink-0 w-12 text-right ${cacheColor(rate)}`}>
        {ratePercent}%
      </span>
      <span className="text-[#52525b] flex-shrink-0 w-10 text-right">{formatDuration(session.spawnedAt)}</span>
    </div>
  );
}

function SubagentsCard({ sessions }: { sessions: AgentSession[] }) {
  return (
    <div className="bg-[#0f0f18] border border-white/[0.06] rounded-lg p-3 mb-3">
      <p className="text-[#e4e4e7] text-xs font-medium mb-2">
        Subagent Sessions
        {sessions.length > 0 && (
          <span className="text-[#71717a] font-normal ml-1">({sessions.length})</span>
        )}
      </p>
      {sessions.length === 0 ? (
        <p className="text-[#71717a] text-xs">No subagents spawned</p>
      ) : (
        <div>
          <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06] text-[10px] text-[#52525b]">
            <span className="w-1.5 flex-shrink-0" />
            <span className="w-20 flex-shrink-0">Agent</span>
            <span className="w-16 flex-shrink-0">Model</span>
            <span className="w-16 flex-shrink-0 text-right">Tokens</span>
            <span className="w-12 flex-shrink-0 text-right">Cache%</span>
            <span className="w-10 flex-shrink-0 text-right">Age</span>
          </div>
          {sessions.map((s) => (
            <SubagentRow key={s.sessionId} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Aggregate Stats Card ──────────────────────────────────────────────────────

function AggregateCard({ metrics }: { metrics: WindowMetrics }) {
  const agg = metrics.aggregated;
  const totalTokens =
    agg.totalInputTokens +
    agg.totalOutputTokens +
    agg.totalCacheCreationTokens +
    agg.totalCacheReadTokens;
  const completedAgents = agg.agentCount - agg.activeAgents;

  return (
    <div className="bg-[#0f0f18] border border-white/[0.06] rounded-lg p-3 mb-3">
      <p className="text-[#e4e4e7] text-xs font-medium mb-2">Aggregate</p>
      <div className="flex justify-between items-center py-0.5">
        <span className="text-[#71717a] text-xs">Total Tokens</span>
        <span className="text-[#a1a1aa] text-xs font-mono tabular-nums">
          {totalTokens.toLocaleString()}
          {agg.agentCount > 0 && (
            <span className="text-[#52525b]"> (+{agg.agentCount} agents)</span>
          )}
        </span>
      </div>
      {agg.agentCount > 0 && (
        <div className="flex justify-between items-center py-0.5">
          <span className="text-[#71717a] text-xs">Agents</span>
          <span className="text-[#a1a1aa] text-xs">
            {agg.agentCount} total,{' '}
            <span className="text-[#00d4ff]">{agg.activeAgents} active</span>,{' '}
            {completedAgents} done
          </span>
        </div>
      )}
      <div className="flex justify-between items-center py-0.5">
        <span className="text-[#71717a] text-xs">Cache Hit Rate</span>
        <span className={`text-xs font-mono ${cacheColor(agg.aggregateCacheHitRate)}`}>
          {Math.round(agg.aggregateCacheHitRate * 100 * 10) / 10}% aggregate
        </span>
      </div>
    </div>
  );
}

// ─── Window Picker ────────────────────────────────────────────────────────────

interface PickerWindow {
  id: string;
  name: string;
  isMain: boolean;
}

function WindowPicker({
  windows,
  selectedId,
  onSelect,
  contextUsage,
}: {
  windows: PickerWindow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  contextUsage?: Map<string, ContextUsage>;
}) {
  if (windows.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-white/[0.04] bg-[#08080d]"
         style={{ scrollbarWidth: 'thin' }}>
      {windows.map((w) => {
        const isSelected = selectedId === w.id;
        const usage = contextUsage?.get(w.id) ?? null;
        const band = usage ? tokenColorBand(usage.usedTokens) : null;
        const dot =
          band === 'green' ? 'bg-[#22c55e]' :
          band === 'yellow' ? 'bg-[#eab308]' :
          band === 'red' ? 'bg-[#ef4444]' :
          w.isMain ? 'bg-[#00d4ff]' : 'bg-[#71717a]';
        const pct = usage ? Math.round(usage.percentage) : null;
        return (
          <button
            key={w.id}
            onClick={() => onSelect(w.id)}
            title={w.name}
            className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all ${
              isSelected
                ? 'bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff]'
                : 'bg-transparent border border-white/[0.06] text-[#a1a1aa] hover:text-white hover:border-white/[0.12]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
            <span className="truncate max-w-[80px]">{w.name}</span>
            {pct !== null && (
              <span className="text-[10px] text-[#71717a] tabular-nums flex-shrink-0">{pct}%</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── MetricsPanel ─────────────────────────────────────────────────────────────

export interface MetricsPanelProps {
  ws: WebSocket | null;
  activeWindowId: string | null;
  activeWindowName: string | null;
  /** Full window list for the per-window picker. Defaults to empty = single-window mode. */
  windows?: PickerWindow[];
  /** Per-window context usage map for picker badges (windowId → ContextUsage). */
  contextUsage?: Map<string, ContextUsage>;
}

export function MetricsPanel({
  ws,
  activeWindowId,
  activeWindowName,
  windows,
  contextUsage,
}: MetricsPanelProps) {
  const pickerWindows = windows ?? [];
  // selectedWindowId: internal focus for the panel. Initialised to the active
  // window, but the user can pick any other window without losing terminal focus.
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(activeWindowId);

  // Re-sync when active window changes ONLY if the user hasn't manually picked
  // a different window. We detect "manual pick" by tracking whether the current
  // selection still exists — if it was closed, fall back to active.
  useEffect(() => {
    if (!selectedWindowId) {
      setSelectedWindowId(activeWindowId);
      return;
    }
    if (!pickerWindows.some((w) => w.id === selectedWindowId)) {
      setSelectedWindowId(activeWindowId);
    }
  }, [activeWindowId, pickerWindows, selectedWindowId]);

  const effectiveWindowId = selectedWindowId ?? activeWindowId;
  const effectiveWindowName =
    pickerWindows.find((w) => w.id === effectiveWindowId)?.name ?? activeWindowName;

  const { metrics, isLoading, error } = useMetricsSync(ws, effectiveWindowId);

  const content = useMemo(() => {
    if (!effectiveWindowId) {
      return (
        <p className="text-[#71717a] text-xs">No active window selected.</p>
      );
    }
    if (isLoading && !metrics) {
      return <p className="text-[#71717a] text-xs">Loading metrics…</p>;
    }
    if (error) {
      return <p className="text-[#f87171] text-xs">{error}</p>;
    }
    if (!metrics) {
      return <p className="text-[#71717a] text-xs">No metrics available yet.</p>;
    }
    return (
      <>
        <OverviewCard metrics={metrics} />
        <TokenBreakdownCard metrics={metrics} />
        <SubagentsCard sessions={metrics.agentSessions} />
        <AggregateCard metrics={metrics} />
      </>
    );
  }, [effectiveWindowId, isLoading, metrics, error]);

  return (
    <div
      className="h-full w-full overflow-y-auto overflow-x-hidden"
      style={{
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
      }}
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-white/[0.04] bg-[#07070c]">
        <div className="px-4 py-3">
          <p className="text-[#e4e4e7] text-sm font-medium">Session Metrics</p>
          {effectiveWindowName && (
            <p className="text-[#71717a] text-xs mt-0.5 truncate">{effectiveWindowName}</p>
          )}
        </div>
        {pickerWindows.length > 1 && (
          <WindowPicker
            windows={pickerWindows}
            selectedId={effectiveWindowId}
            onSelect={setSelectedWindowId}
            contextUsage={contextUsage}
          />
        )}
      </div>

      {/* Content */}
      <div className="p-3 pb-20">
        {content}
      </div>
    </div>
  );
}

export default MetricsPanel;

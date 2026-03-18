/**
 * Team Protocol - WebSocket messages for Claude Code Team Cockpit
 *
 * Enables real-time team state synchronization between server (TeamFileWatcher)
 * and client (TeamBar with accordion overlay).
 */

/** A member of a Claude Code team */
export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
  /** Derived status from task state */
  status: 'idle' | 'working' | 'completed' | 'error';
  /** Current task subject if working */
  currentTask?: string;
  /** Color for UI identification */
  color: string;
}

/** A detected Claude Code team */
export interface TeamInfo {
  name: string;
  description?: string;
  members: TeamMember[];
  taskCounts: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
  };
  /** Timestamp of last config file modification */
  lastModified: number;
}

// Agent color palette — distinct, accessible colors for team members
export const AGENT_COLORS = [
  '#00d4ff', // cyan (team lead)
  '#ff6b6b', // coral
  '#51cf66', // green
  '#ffd43b', // yellow
  '#cc5de8', // purple
  '#ff922b', // orange
  '#20c997', // teal
  '#748ffc', // indigo
  '#f06595', // pink
  '#adb5bd', // gray
] as const;

/** Get a deterministic color for a team member by index */
export function getAgentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

// --- Log Events ---

/** A team activity log event */
export interface TeamLogEvent {
  timestamp: number;
  agentName: string;
  eventType: 'task_started' | 'task_completed' | 'task_error' | 'status_changed';
  message: string;
}

// --- WebSocket Messages ---

/** Client subscribes to team updates */
export interface TeamSubscribeMessage {
  type: 'team:subscribe';
}

/** Server sends full team state */
export interface TeamSyncMessage {
  type: 'team:sync';
  teams: TeamInfo[];
  recentLogs?: TeamLogEvent[];
}

/** Server sends incremental team member status update */
export interface TeamMemberUpdateMessage {
  type: 'team:member:update';
  teamName: string;
  member: TeamMember;
}

/** Server notifies team detected/dissolved */
export interface TeamLifecycleMessage {
  type: 'team:detected' | 'team:dissolved';
  team: TeamInfo;
}

/** Server sends log events for team activity */
export interface TeamLogMessage {
  type: 'team:log';
  teamName: string;
  events: TeamLogEvent[];
}

export type TeamServerMessage =
  | TeamSyncMessage
  | TeamMemberUpdateMessage
  | TeamLifecycleMessage
  | TeamLogMessage;

export type TeamClientMessage = TeamSubscribeMessage;

/**
 * TeamManager - Central team state management with WebSocket broadcasting
 *
 * Follows TodoManager pattern:
 * - EventEmitter-based
 * - WebSocket subscriber set
 * - Cached state for new subscribers
 * - Listens to TeamFileWatcher events
 * - Diffs task states to generate log events
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import type {
  TeamInfo,
  TeamSyncMessage,
  TeamLogMessage,
  TeamLogEvent,
} from '../../shared/teamProtocol.js';
import { logger } from '../utils/logger.js';
import { teamFileWatcher, type TeamFileEvent } from './TeamFileWatcher.js';

const MAX_LOG_EVENTS = 200;

export class TeamManager extends EventEmitter {
  private subscribers: Set<WebSocket> = new Set();
  private cachedTeams: TeamInfo[] = [];
  /** Track previous task states per team for log event diffing: teamName → Map<agentId, status> */
  private previousTaskStates: Map<string, Map<string, string>> = new Map();
  /** Recent log events for new subscribers */
  private recentLogs: TeamLogEvent[] = [];

  constructor() {
    super();
    logger.info('TeamManager initialized');
    this.setupWatcherListener();
  }

  private setupWatcherListener(): void {
    teamFileWatcher.on('teams', (event: TeamFileEvent) => {
      this.handleTeamsUpdate(event.teams);
    });
  }

  /**
   * Handle team updates from file watcher.
   * Diffs task states to generate log events, then broadcasts.
   */
  private handleTeamsUpdate(teams: TeamInfo[]): void {
    // Generate log events by diffing member states
    const logEvents: TeamLogEvent[] = [];
    const now = Date.now();

    for (const team of teams) {
      const prevStates = this.previousTaskStates.get(team.name) || new Map();
      const newStates = new Map<string, string>();

      for (const member of team.members) {
        newStates.set(member.agentId, member.status);
        const prevStatus = prevStates.get(member.agentId);

        if (prevStatus && prevStatus !== member.status) {
          const eventType = member.status === 'working' ? 'task_started'
            : member.status === 'completed' ? 'task_completed'
            : member.status === 'error' ? 'task_error'
            : 'status_changed';

          logEvents.push({
            timestamp: now,
            agentName: member.name,
            eventType,
            message: member.status === 'working' && member.currentTask
              ? `Started: ${member.currentTask}`
              : member.status === 'completed'
              ? 'Task completed'
              : member.status === 'error'
              ? 'Task failed'
              : `Status: ${member.status}`,
          });
        } else if (!prevStatus && member.status === 'working') {
          logEvents.push({
            timestamp: now,
            agentName: member.name,
            eventType: 'task_started',
            message: member.currentTask ? `Started: ${member.currentTask}` : 'Started working',
          });
        }
      }

      this.previousTaskStates.set(team.name, newStates);
    }

    // Clean up dissolved teams
    const currentTeamNames = new Set(teams.map(t => t.name));
    for (const prevName of this.previousTaskStates.keys()) {
      if (!currentTeamNames.has(prevName)) {
        this.previousTaskStates.delete(prevName);
      }
    }

    // Append log events (bounded)
    if (logEvents.length > 0) {
      this.recentLogs = [...logEvents, ...this.recentLogs].slice(0, MAX_LOG_EVENTS);
    }

    // Only broadcast if team state actually changed (prevents 10s poll spam)
    const teamsJson = JSON.stringify(teams);
    const cachedJson = JSON.stringify(this.cachedTeams);
    this.cachedTeams = teams;

    if (teamsJson !== cachedJson) {
      this.broadcastTeams(teams);
      this.emit('teams', teams);
    }

    // Broadcast log events separately (even if team structure unchanged)
    if (logEvents.length > 0) {
      this.broadcastLogEvents(teams, logEvents);
    }
  }

  /**
   * Subscribe a WebSocket to team updates.
   * Immediately sends current state + recent logs.
   */
  subscribe(ws: WebSocket): void {
    if (this.subscribers.has(ws)) return;

    this.subscribers.add(ws);
    logger.info(`TeamManager: Added subscriber (total: ${this.subscribers.size})`);

    // Start file watcher if not running
    teamFileWatcher.start();

    // Send cached state
    if (this.cachedTeams.length === 0) {
      const current = teamFileWatcher.getCurrentTeams();
      if (current.length > 0) {
        this.cachedTeams = current;
      }
    }

    this.sendTeams(ws, this.cachedTeams);

    // Trigger refresh for latest data
    teamFileWatcher.refresh();

    // Cleanup on close
    const handleClose = () => {
      this.unsubscribe(ws);
      ws.removeListener('close', handleClose);
    };
    ws.on('close', handleClose);
  }

  unsubscribe(ws: WebSocket): void {
    const removed = this.subscribers.delete(ws);
    if (removed) {
      logger.debug(`TeamManager: Removed subscriber (remaining: ${this.subscribers.size})`);
    }
  }

  private broadcastTeams(teams: TeamInfo[]): void {
    if (this.subscribers.size === 0) return;

    const memberCount = teams.reduce((sum, t) => sum + t.members.length, 0);
    logger.info(`TeamManager: Broadcasting ${teams.length} teams (${memberCount} members) to ${this.subscribers.size} subscribers`);

    const message: TeamSyncMessage = {
      type: 'team:sync',
      teams,
    };
    const messageStr = JSON.stringify(message);

    for (const ws of this.subscribers) {
      this.sendToWebSocket(ws, messageStr);
    }
  }

  private broadcastLogEvents(teams: TeamInfo[], events: TeamLogEvent[]): void {
    if (this.subscribers.size === 0) return;

    // Group events by team
    const teamNames = new Set(teams.map(t => t.name));
    for (const teamName of teamNames) {
      const teamEvents = events.filter(e => {
        const team = teams.find(t => t.name === teamName);
        return team?.members.some(m => m.name === e.agentName);
      });
      if (teamEvents.length === 0) continue;

      const message: TeamLogMessage = {
        type: 'team:log',
        teamName,
        events: teamEvents,
      };
      const messageStr = JSON.stringify(message);

      for (const ws of this.subscribers) {
        this.sendToWebSocket(ws, messageStr);
      }
    }
  }

  private sendTeams(ws: WebSocket, teams: TeamInfo[]): void {
    const message: TeamSyncMessage = {
      type: 'team:sync',
      teams,
      recentLogs: this.recentLogs.length > 0 ? this.recentLogs : undefined,
    };
    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  private sendToWebSocket(ws: WebSocket, message: string): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      logger.error('TeamManager: Error sending message:', err);
    }
  }

  getTeams(): TeamInfo[] {
    return this.cachedTeams;
  }

  getStats(): {
    teamsCount: number;
    totalMembers: number;
    subscriberCount: number;
  } {
    return {
      teamsCount: this.cachedTeams.length,
      totalMembers: this.cachedTeams.reduce((sum, t) => sum + t.members.length, 0),
      subscriberCount: this.subscribers.size,
    };
  }
}

/** Singleton instance */
export const teamManager = new TeamManager();

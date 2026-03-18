/**
 * useTeamCockpit - Manages Claude Code Team Cockpit state
 *
 * Subscribes to team:sync WebSocket messages and provides:
 * - Active team info
 * - Team member list with live status
 * - Cockpit mode toggle (auto-detect + dismiss)
 * - Log event stream for accordion display
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TeamInfo,
  TeamSyncMessage,
  TeamServerMessage,
  TeamLogEvent,
  TeamLogMessage,
} from '@shared/teamProtocol';

const MAX_LOG_EVENTS = 200;

interface UseTeamCockpitOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  isConnected: boolean;
}

interface UseTeamCockpitReturn {
  teams: TeamInfo[];
  activeTeam: TeamInfo | null;
  cockpitEnabled: boolean;
  setCockpitEnabled: (enabled: boolean) => void;
  handleTeamMessage: (msg: TeamServerMessage) => void;
  /** Whether the user has dismissed the team bar */
  dismissed: boolean;
  setDismissed: (dismissed: boolean) => void;
  /** Bounded log event stream */
  logEvents: TeamLogEvent[];
  /** Currently expanded agent name in accordion (null = collapsed) */
  expandedAgent: string | null;
  setExpandedAgent: (agent: string | null) => void;
}

export function useTeamCockpit({
  sendMessage,
  isConnected,
}: UseTeamCockpitOptions): UseTeamCockpitReturn {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [cockpitEnabled, setCockpitEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [logEvents, setLogEvents] = useState<TeamLogEvent[]>([]);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const subscribedRef = useRef(false);

  // Subscribe to team updates when connected
  useEffect(() => {
    if (isConnected && !subscribedRef.current) {
      sendMessage({ type: 'team:subscribe' });
      subscribedRef.current = true;
    }

    if (!isConnected) {
      subscribedRef.current = false;
    }

    return () => {
      if (isConnected && subscribedRef.current) {
        sendMessage({ type: 'team:unsubscribe' });
        subscribedRef.current = false;
      }
    };
  }, [isConnected, sendMessage]);

  const handleTeamMessage = useCallback((msg: TeamServerMessage) => {
    switch (msg.type) {
      case 'team:sync': {
        const syncMsg = msg as TeamSyncMessage;
        setTeams(prev => {
          if (JSON.stringify(prev) === JSON.stringify(syncMsg.teams)) return prev;
          return syncMsg.teams;
        });
        // Load recent logs from initial sync
        if (syncMsg.recentLogs && syncMsg.recentLogs.length > 0) {
          setLogEvents(prev => {
            const combined = [...syncMsg.recentLogs!, ...prev];
            return combined.slice(0, MAX_LOG_EVENTS);
          });
        }
        break;
      }

      case 'team:member:update': {
        setTeams(prev => prev.map(team => {
          if (team.name !== msg.teamName) return team;
          return {
            ...team,
            members: team.members.map(m =>
              m.name === msg.member.name ? msg.member : m
            ),
          };
        }));
        break;
      }

      case 'team:detected':
        setTeams(prev => {
          const existing = prev.findIndex(t => t.name === msg.team.name);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = msg.team;
            return updated;
          }
          return [...prev, msg.team];
        });
        // Auto-enable cockpit and reset dismissed state when team detected
        setCockpitEnabled(true);
        setDismissed(false);
        break;

      case 'team:dissolved':
        setTeams(prev => prev.filter(t => t.name !== msg.team.name));
        break;

      case 'team:log': {
        const logMsg = msg as TeamLogMessage;
        setLogEvents(prev => {
          const combined = [...logMsg.events, ...prev];
          return combined.slice(0, MAX_LOG_EVENTS);
        });
        break;
      }
    }
  }, []);

  // Active team = most recently modified
  const activeTeam = teams.length > 0
    ? teams.reduce((best, t) => t.lastModified > best.lastModified ? t : best, teams[0])
    : null;

  // Auto-disable cockpit when no teams
  useEffect(() => {
    if (teams.length === 0 && cockpitEnabled) {
      setCockpitEnabled(false);
    }
  }, [teams, cockpitEnabled]);

  return {
    teams,
    activeTeam,
    cockpitEnabled,
    setCockpitEnabled,
    handleTeamMessage,
    dismissed,
    setDismissed,
    logEvents,
    expandedAgent,
    setExpandedAgent,
  };
}

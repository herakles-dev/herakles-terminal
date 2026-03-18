import { describe, it, expect } from 'vitest';
import {
  AGENT_COLORS,
  getAgentColor,
  type TeamInfo,
  type TeamMember,
  type TeamSyncMessage,
  type TeamLogEvent,
  type TeamLogMessage,
} from '../teamProtocol';

describe('teamProtocol', () => {
  describe('AGENT_COLORS', () => {
    it('should have at least 10 colors', () => {
      expect(AGENT_COLORS.length).toBeGreaterThanOrEqual(10);
    });

    it('should all be valid hex colors', () => {
      AGENT_COLORS.forEach(color => {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });

    it('should have unique colors', () => {
      const unique = new Set(AGENT_COLORS);
      expect(unique.size).toBe(AGENT_COLORS.length);
    });
  });

  describe('getAgentColor', () => {
    it('should return first color for index 0', () => {
      expect(getAgentColor(0)).toBe(AGENT_COLORS[0]);
    });

    it('should wrap around for large indices', () => {
      expect(getAgentColor(AGENT_COLORS.length)).toBe(AGENT_COLORS[0]);
      expect(getAgentColor(AGENT_COLORS.length + 1)).toBe(AGENT_COLORS[1]);
    });

    it('should be deterministic', () => {
      expect(getAgentColor(3)).toBe(getAgentColor(3));
    });
  });

  describe('TeamInfo type', () => {
    it('should have valid structure', () => {
      const team: TeamInfo = {
        name: 'test-team',
        description: 'A test team',
        members: [
          {
            name: 'researcher',
            agentId: 'abc-123',
            agentType: 'frontend-specialist',
            status: 'working',
            currentTask: 'Task #1',
            color: '#00d4ff',
          },
        ],
        taskCounts: {
          total: 5,
          completed: 2,
          inProgress: 1,
          pending: 2,
        },
        lastModified: Date.now(),
      };

      expect(team.name).toBe('test-team');
      expect(team.members).toHaveLength(1);
      expect(team.members[0].status).toBe('working');
      expect(team.taskCounts.total).toBe(5);
    });
  });

  describe('TeamSyncMessage type', () => {
    it('should serialize correctly', () => {
      const msg: TeamSyncMessage = {
        type: 'team:sync',
        teams: [{
          name: 'my-team',
          members: [],
          taskCounts: { total: 0, completed: 0, inProgress: 0, pending: 0 },
          lastModified: 0,
        }],
      };

      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe('team:sync');
      expect(parsed.teams).toHaveLength(1);
    });

    it('should support recentLogs field', () => {
      const msg: TeamSyncMessage = {
        type: 'team:sync',
        teams: [],
        recentLogs: [
          {
            timestamp: Date.now(),
            agentName: 'researcher',
            eventType: 'task_started',
            message: 'Started: Fix the bug',
          },
        ],
      };

      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json);
      expect(parsed.recentLogs).toHaveLength(1);
      expect(parsed.recentLogs[0].eventType).toBe('task_started');
    });
  });

  describe('TeamMember statuses', () => {
    const statuses: TeamMember['status'][] = ['idle', 'working', 'completed', 'error'];

    it('should accept all valid statuses', () => {
      statuses.forEach(status => {
        const member: TeamMember = {
          name: 'test',
          agentId: '123',
          agentType: 'general-purpose',
          status,
          color: '#fff',
        };
        expect(member.status).toBe(status);
      });
    });
  });

  describe('TeamLogEvent', () => {
    it('should have valid structure', () => {
      const event: TeamLogEvent = {
        timestamp: Date.now(),
        agentName: 'researcher',
        eventType: 'task_completed',
        message: 'Task completed',
      };
      expect(event.eventType).toBe('task_completed');
      expect(event.agentName).toBe('researcher');
    });

    it('should accept all valid event types', () => {
      const types: TeamLogEvent['eventType'][] = [
        'task_started', 'task_completed', 'task_error', 'status_changed',
      ];
      types.forEach(eventType => {
        const event: TeamLogEvent = {
          timestamp: Date.now(),
          agentName: 'test',
          eventType,
          message: 'test message',
        };
        expect(event.eventType).toBe(eventType);
      });
    });
  });

  describe('TeamLogMessage', () => {
    it('should serialize correctly', () => {
      const msg: TeamLogMessage = {
        type: 'team:log',
        teamName: 'my-team',
        events: [
          {
            timestamp: Date.now(),
            agentName: 'researcher',
            eventType: 'task_started',
            message: 'Started: Implement feature',
          },
          {
            timestamp: Date.now(),
            agentName: 'researcher',
            eventType: 'task_completed',
            message: 'Task completed',
          },
        ],
      };

      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe('team:log');
      expect(parsed.teamName).toBe('my-team');
      expect(parsed.events).toHaveLength(2);
    });
  });
});

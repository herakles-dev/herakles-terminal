/**
 * TeamBar - Compact bottom bar with accordion overlay for team status
 *
 * Self-contained — never touches terminal layout state.
 * Click agent chip to expand accordion with status + log stream.
 */

import React, { useRef, useEffect } from 'react';
import type { TeamInfo, TeamMember, TeamLogEvent } from '../../../shared/teamProtocol';

interface TeamBarProps {
  team: TeamInfo;
  onAgentClick: (memberName: string) => void;
  expandedAgent: string | null;
  logEvents: TeamLogEvent[];
  onDismiss: () => void;
}

export const TeamBar: React.FC<TeamBarProps> = ({
  team,
  onAgentClick,
  expandedAgent,
  logEvents,
  onDismiss,
}) => {
  const completedCount = team.taskCounts.completed;
  const totalCount = team.taskCounts.total;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const expandedMember = expandedAgent
    ? team.members.find(m => m.name === expandedAgent)
    : null;

  const agentLogs = expandedAgent
    ? logEvents.filter(e => e.agentName === expandedAgent).slice(0, 20)
    : [];

  return (
    <div className="team-bar-container" style={{ position: 'relative' }}>
      {/* Progress bar — thin line above the bar */}
      {totalCount > 0 && (
        <div style={{
          height: '2px',
          backgroundColor: 'rgba(255,255,255,0.05)',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: progressPct === 100 ? '#51cf66' : '#00d4ff',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {/* Main bar */}
      <div className="team-bar" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        minHeight: '28px',
        overflow: 'hidden',
      }}>
        {/* Team name */}
        <span style={{
          color: '#00d4ff',
          fontWeight: 600,
          marginRight: '4px',
          whiteSpace: 'nowrap',
        }}>
          {team.name}
        </span>

        {/* Progress */}
        <span style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: '10px',
          marginRight: '8px',
          whiteSpace: 'nowrap',
        }}>
          {completedCount}/{totalCount} ({progressPct}%)
        </span>

        {/* Divider */}
        <div style={{
          width: '1px',
          height: '16px',
          backgroundColor: 'rgba(255,255,255,0.15)',
          marginRight: '4px',
        }} />

        {/* Agent chips */}
        {team.members.map((member) => (
          <AgentChip
            key={member.name}
            member={member}
            isExpanded={expandedAgent === member.name}
            onClick={() => onAgentClick(member.name)}
          />
        ))}

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          title="Dismiss team bar"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
            border: 'none',
            borderRadius: '3px',
            backgroundColor: 'transparent',
            color: 'rgba(255,255,255,0.3)',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'inherit',
            padding: 0,
            transition: 'color 0.15s, background-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.3)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          ✕
        </button>
      </div>

      {/* Accordion panel */}
      {expandedMember && (
        <AccordionPanel
          member={expandedMember}
          team={team}
          logEvents={agentLogs}
        />
      )}
    </div>
  );
};

interface AgentChipProps {
  member: TeamMember;
  isExpanded: boolean;
  onClick: () => void;
}

const AgentChip: React.FC<AgentChipProps> = ({ member, isExpanded, onClick }) => {
  return (
    <button
      className={`team-bar-chip ${isExpanded ? 'team-bar-chip--active' : ''}`}
      onClick={onClick}
      title={`${member.name} (${member.agentType})${member.currentTask ? `: ${member.currentTask}` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 6px',
        border: isExpanded ? `1px solid ${member.color}` : '1px solid rgba(255,255,255,0.1)',
        borderRadius: '4px',
        backgroundColor: isExpanded ? `${member.color}15` : 'transparent',
        color: member.color,
        fontSize: '10px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
    >
      {/* Status dot */}
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: member.status === 'working' ? member.color : 'transparent',
        border: `1.5px solid ${member.color}`,
        flexShrink: 0,
        animation: member.status === 'working' ? 'pulse 2s ease-in-out infinite' : 'none',
      }} />

      {/* Name */}
      <span>{member.name}</span>
    </button>
  );
};

const STATUS_LABELS: Record<TeamMember['status'], string> = {
  idle: 'Idle',
  working: 'Working',
  completed: 'Done',
  error: 'Error',
};

interface AccordionPanelProps {
  member: TeamMember;
  team: TeamInfo;
  logEvents: TeamLogEvent[];
}

const AccordionPanel: React.FC<AccordionPanelProps> = ({ member, team, logEvents }) => {
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [logEvents.length]);

  const memberTaskCount = team.taskCounts;

  return (
    <div className="team-accordion" style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      zIndex: 100,
      backgroundColor: 'rgba(10, 10, 15, 0.95)',
      backdropFilter: 'blur(8px)',
      borderTop: `2px solid ${member.color}`,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '11px',
      animation: 'accordionSlideUp 0.15s ease-out',
    }}>
      {/* Agent header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Color badge */}
        <span style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: member.status === 'working' ? member.color : 'transparent',
          border: `2px solid ${member.color}`,
          flexShrink: 0,
          animation: member.status === 'working' ? 'pulse 2s ease-in-out infinite' : 'none',
        }} />

        <span style={{ color: member.color, fontWeight: 600 }}>
          {member.name}
        </span>

        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>
          ({member.agentType})
        </span>

        <span style={{ flex: 1 }} />

        {/* Status label */}
        <span style={{
          padding: '1px 6px',
          borderRadius: '3px',
          backgroundColor: member.status === 'working' ? `${member.color}20`
            : member.status === 'error' ? 'rgba(255,107,107,0.15)'
            : member.status === 'completed' ? 'rgba(81,207,102,0.15)'
            : 'rgba(255,255,255,0.06)',
          color: member.status === 'working' ? member.color
            : member.status === 'error' ? '#ff6b6b'
            : member.status === 'completed' ? '#51cf66'
            : 'rgba(255,255,255,0.5)',
          fontSize: '10px',
        }}>
          {STATUS_LABELS[member.status]}
        </span>

        {/* Task progress */}
        <span style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: '10px',
        }}>
          {memberTaskCount.completed}/{memberTaskCount.total} tasks
        </span>
      </div>

      {/* Current task */}
      {member.currentTask && (
        <div style={{
          padding: '6px 12px',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '10px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: '6px' }}>Task:</span>
          {member.currentTask}
        </div>
      )}

      {/* Log stream */}
      <div
        ref={logRef}
        style={{
          maxHeight: '200px',
          overflowY: 'auto',
          padding: logEvents.length > 0 ? '4px 0' : '0',
        }}
      >
        {logEvents.length === 0 ? (
          <div style={{
            padding: '8px 12px',
            color: 'rgba(255,255,255,0.2)',
            fontSize: '10px',
            fontStyle: 'italic',
          }}>
            No activity logged yet
          </div>
        ) : (
          logEvents.map((event, i) => (
            <div
              key={`${event.timestamp}-${i}`}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '2px 12px',
                fontSize: '10px',
                lineHeight: '16px',
              }}
            >
              <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
                {formatTime(event.timestamp)}
              </span>
              <span style={{
                color: event.eventType === 'task_error' ? '#ff6b6b'
                  : event.eventType === 'task_completed' ? '#51cf66'
                  : 'rgba(255,255,255,0.5)',
              }}>
                {event.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default TeamBar;

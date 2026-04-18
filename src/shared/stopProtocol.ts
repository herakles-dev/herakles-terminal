// Riz Stop Protocol — Partner-enforced bedtime system
// State machine: IDLE → GRACE (10 min) → LOCKOUT (2 hr) → IDLE

export type StopProtocolPhase = 'idle' | 'grace' | 'lockout';

export const GRACE_DURATION_MS = 15 * 60 * 1000;       // 15 minutes to wrap up
export const LOCKOUT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hour pause

// Authorized username that can trigger the protocol
export const STOP_PROTOCOL_USER = 'riz';

// Auto-activation schedule — lockout begins at 11:00 PM Chicago, so grace fires 15 min earlier.
export const AUTO_ACTIVATE_TIMEZONE = 'America/Chicago';
export const AUTO_ACTIVATE_HOUR = 22; // 10 PM local
export const AUTO_ACTIVATE_MINUTE = 45; // :45 → lockout begins at 23:00

// Default video if no link provided
export const DEFAULT_STOP_VIDEO = 'https://www.youtube.com/watch?v=azjeQUt5rT0&list=RDazjeQUt5rT0&start_radio=1';

// --- Client → Server ---

export interface StopActivateMessage {
  type: 'stop:activate';
  youtubeUrl?: string;
  message?: string;
}

export interface StopSubscribeMessage {
  type: 'stop:subscribe';
}

export interface StopUnsubscribeMessage {
  type: 'stop:unsubscribe';
}

export type StopClientMessage =
  | StopActivateMessage
  | StopSubscribeMessage
  | StopUnsubscribeMessage;

// --- Server → Client ---

export interface StopWarningMessage {
  type: 'stop:warning';
  youtubeUrl?: string;
  message?: string;
  graceEndsAt: number;
}

export interface StopLockoutMessage {
  type: 'stop:lockout';
  lockoutEndsAt: number;
}

export interface StopClearMessage {
  type: 'stop:clear';
}

export interface StopSyncMessage {
  type: 'stop:sync';
  phase: StopProtocolPhase;
  youtubeUrl?: string;
  message?: string;
  graceEndsAt?: number;
  lockoutEndsAt?: number;
}

export interface StopAckMessage {
  type: 'stop:ack';
  phase: StopProtocolPhase;
}

export type StopServerMessage =
  | StopWarningMessage
  | StopLockoutMessage
  | StopClearMessage
  | StopSyncMessage
  | StopAckMessage;

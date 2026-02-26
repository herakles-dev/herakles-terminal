export type SessionState = 'active' | 'dormant' | 'terminated';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type TriggerType = 'on_connect' | 'on_disconnect' | 'on_resume' | 'on_idle' | 'on_output_match' | 'scheduled';

export type WindowType = 'terminal' | 'media';

export interface Session {
  id: string;
  name: string;
  userEmail: string;
  autoName?: string;
  tmuxSession: string;
  createdAt: Date;
  lastActiveAt: Date;
  state: SessionState;
  timeoutHours: number;
  workingDirectory: string;
  activeConnections: number;
  env: Record<string, string>;
  watchToken?: string;  // Z.2.8.1: Token for read-only session watching
}

export interface Window {
  id: string;
  sessionId: string;
  type: WindowType;
  name?: string;
  autoName?: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  isMain: boolean;
  createdAt: Date;
}

export interface ReconnectToken {
  sessionId: string;
  token: string;
  expiresAt: number;
  deviceId: string;
}

export interface UserPreferences {
  userEmail: string;
  fontSize: number;
  sessionTimeoutHours: number;
  timezone: string;
  quickKeyBarVisible: boolean;
  sidePanelDefaultTab: string;
}

export interface Device {
  id: string;
  userEmail: string;
  name?: string;
  userAgent?: string;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface Automation {
  id: string;
  userEmail: string;
  name: string;
  triggerType: TriggerType;
  triggerConfig?: {
    idleMinutes?: number;
    pattern?: string;
    cronExpression?: string;
    timezone?: string;
  };
  command: string;
  targetWindow?: string;
  enabled: boolean;
  createdAt: Date;
  lastRunAt?: Date;
}

export interface AutomationLog {
  id: number;
  automationId: string;
  triggeredAt: Date;
  triggerReason?: string;
  command: string;
  output?: string;
  success: boolean;
}

export interface Template {
  id: string;
  userEmail: string;
  name: string;
  category?: string;
  content: TemplateContent;
  createdAt: Date;
  updatedAt: Date;
  useCount: number;
}

export interface TemplateContent {
  text: string;
  variables?: TemplateVariable[];
}

export interface TemplateVariable {
  id: string;
  label: string;
  type: 'text' | 'select' | 'file' | 'dynamic';
  options?: string[];
  command?: string;
}

export interface ConnectionConfig {
  url: string;
  reconnectAttempts: number;
  reconnectBackoff: {
    initial: number;
    multiplier: number;
    max: number;
  };
  heartbeatInterval: number;
  heartbeatTimeout: number;
}

export type ClientMessageType =
  | 'auth'
  | 'input'
  | 'resize'
  | 'ping'
  | 'take-control'
  | 'session:resume'
  | 'session:create'
  | 'window:create'
  | 'window:close'
  | 'window:focus'
  | 'window:send'
  | 'window:resize'
  | 'window:layout'
  | 'window:subscribe'
  | 'window:rename'
  | 'window:replay';

export type ClientMessage =
  | { type: 'auth'; token: string; sessionId?: string }
  | { type: 'input'; data: string; windowId?: string }
  | { type: 'ping' }
  | { type: 'take-control' }
  | { type: 'session:resume'; sessionId: string }
  | { type: 'session:create'; name?: string }
  | { type: 'window:create'; sessionId: string; windowType?: WindowType }
  | { type: 'window:close'; windowId: string }
  | { type: 'window:focus'; windowId: string }
  | { type: 'window:send'; windowId: string; data: string }
  | { type: 'window:resize'; windowId: string; cols: number; rows: number; seq?: number }
  | { type: 'window:layout'; windowId: string; x: number; y: number; width: number; height: number }
  | { type: 'window:subscribe'; windowId: string }
  | { type: 'window:rename'; windowId: string; name: string }
  | { type: 'window:replay'; windowId: string; afterSeq: number };

export type ServerMessageType =
  | 'auth-success'
  | 'auth-error'
  | 'output'
  | 'ping'
  | 'pong'
  | 'session-end'
  | 'control-changed'
  | 'viewer-joined'
  | 'viewer-left'
  | 'session:created'
  | 'session:resumed'
  | 'window:created'
  | 'window:closed'
  | 'window:output'
  | 'window:clear'
  | 'window:restore'
  | 'window:resized'
  | 'window:list'
  | 'window:renamed'
  | 'device:lock-acquired'
  | 'device:lock-released'
  | 'device:connected'
  | 'device:disconnected'
  | 'automation:triggered'
  | 'automation:completed'
  | 'window:replay-response'
  | 'file:uploaded'
  | 'file:deleted'
  | 'artifact:history'
  | 'error';

export interface ArtifactMetadata {
  id: string;
  title: string;
  type: string;
  language?: string;
  timestamp: number;
  thumbnail?: string;  // First 200 chars as preview
  tags?: string[];
}

export type ServerMessage =
  | { type: 'auth-success'; sessionId: string; token: string; sessions?: Session[] }
  | { type: 'auth-error'; error: string }
  | { type: 'output'; data: string; windowId?: string }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'session-end'; reason: string }
  | { type: 'control-changed'; activeDevice: string }
  | { type: 'viewer-joined'; deviceId: string }
  | { type: 'viewer-left'; deviceId: string }
  | { type: 'session:created'; session: Session }
  | { type: 'session:resumed'; session: Session; windows: Window[] }
  | { type: 'window:created'; window: Window }
  | { type: 'window:closed'; windowId: string }
  | { type: 'window:output'; windowId: string; data: string; seq?: number }
  | { type: 'window:clear'; windowId: string }
  | { type: 'window:restore'; windowId: string; data: string }
  | { type: 'window:resized'; windowId: string; cols: number; rows: number; seq?: number; recapture?: string }
  | { type: 'window:list'; windows: Window[] }
  | { type: 'window:replay-response'; windowId: string; data: string; fromSeq: number; toSeq: number }
  | { type: 'window:renamed'; windowId: string; name: string; autoName?: string }
  | { type: 'device:lock-acquired'; windowId: string; deviceId: string; expiresAt: number }
  | { type: 'device:lock-released'; windowId: string }
  | { type: 'device:connected'; deviceId: string; deviceName: string }
  | { type: 'device:disconnected'; deviceId: string }
  | { type: 'automation:triggered'; automationId: string; name: string }
  | { type: 'automation:completed'; automationId: string; success: boolean; output?: string }
  | { type: 'file:uploaded'; file: UploadedFile }
  | { type: 'file:deleted'; fileId: string; filename: string }
  | { type: 'artifact:history'; artifacts: ArtifactMetadata[] }
  | { type: 'error'; code: string; message: string };

export interface OptimizationStats {
  originalSize: number;
  optimizedSize: number;
  wasResized: boolean;
  wasConverted: boolean;
}

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  path: string;
  size: number;
  mimeType: string;
  hasThumbnail: boolean;
  hasOptimized: boolean;
  optimizedPath?: string;
  optimizationStats?: OptimizationStats;
  uploadedAt: string;
}

export interface QuickKey {
  id: string;
  label: string;
  value: string;
  icon?: string;
  longPress?: string;
  category: 'control' | 'symbol' | 'navigation' | 'claude';
}

export interface Command {
  id: string;
  label: string;
  description?: string;
  keywords: string[];
  action: string | (() => void);
  category: 'claude' | 'git' | 'docker' | 'system' | 'custom';
  frequency?: number;
}

export interface TerminalTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface AuditLogEntry {
  timestamp: Date;
  level: 'info' | 'warning' | 'error';
  event: string;
  sessionId?: string;
  userId: string;
  deviceId?: string;
  ip: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  connections: number;
  sessions: number;
  version: string;
  database?: { connected: boolean; latencyMs?: number };
  tmux?: { healthy: boolean; activeSessions: number };
  websocket?: { connections: number };
}

export interface SoftLock {
  windowId: string;
  deviceId: string;
  expiresAt: number;
}

export const BINARY_MESSAGE_TYPES = {
  OUTPUT: 0x00,
  INPUT: 0x01,
} as const;

export const MAX_MESSAGE_SIZE = 1024 * 1024;
export const WINDOW_ID_LENGTH = 36;

export type BinaryMessageType = (typeof BINARY_MESSAGE_TYPES)[keyof typeof BINARY_MESSAGE_TYPES];

export interface BinaryFrame {
  type: BinaryMessageType;
  windowId: string;
  data: Buffer;
}

export type ClientMessageType =
  | 'auth'
  | 'session:resume'
  | 'session:create'
  | 'window:create'
  | 'window:close'
  | 'window:focus'
  | 'window:send'
  | 'window:resize'
  | 'window:layout'
  | 'input'
  | 'ping';

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface SessionResumeMessage {
  type: 'session:resume';
  sessionId: string;
}

export interface SessionCreateMessage {
  type: 'session:create';
  name?: string;
}

export interface WindowCreateMessage {
  type: 'window:create';
  sessionId: string;
}

export interface WindowCloseMessage {
  type: 'window:close';
  windowId: string;
}

export interface WindowFocusMessage {
  type: 'window:focus';
  windowId: string;
}

export interface WindowSendMessage {
  type: 'window:send';
  windowId: string;
  data: string;
}

export interface WindowResizeMessage {
  type: 'window:resize';
  windowId: string;
  cols: number;
  rows: number;
}

export interface WindowLayoutMessage {
  type: 'window:layout';
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InputMessage {
  type: 'input';
  windowId: string;
  data: string;
}

export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | AuthMessage
  | SessionResumeMessage
  | SessionCreateMessage
  | WindowCreateMessage
  | WindowCloseMessage
  | WindowFocusMessage
  | WindowSendMessage
  | WindowResizeMessage
  | WindowLayoutMessage
  | InputMessage
  | PingMessage;

export type ServerMessageType =
  | 'auth:success'
  | 'auth:failure'
  | 'session:created'
  | 'session:resumed'
  | 'window:created'
  | 'window:closed'
  | 'window:output'
  | 'window:list'
  | 'window:renamed'
  | 'device:lock-acquired'
  | 'device:lock-released'
  | 'device:connected'
  | 'device:disconnected'
  | 'automation:triggered'
  | 'automation:completed'
  | 'session:state_changed'
  | 'file:uploaded'
  | 'file:deleted'
  | 'error'
  | 'pong';

export interface Session {
  id: string;
  name: string;
  autoName?: string;
  state: 'active' | 'dormant' | 'terminated';
  createdAt: number;
  lastActiveAt: number;
}

export interface Window {
  id: string;
  sessionId: string;
  name?: string;
  autoName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMain: boolean;
}

export interface AuthSuccessMessage {
  type: 'auth:success';
  userId: string;
  sessions: Session[];
}

export interface AuthFailureMessage {
  type: 'auth:failure';
  reason: string;
}

export interface SessionCreatedMessage {
  type: 'session:created';
  session: Session;
}

export interface SessionResumedMessage {
  type: 'session:resumed';
  session: Session;
  windows: Window[];
}

export interface WindowCreatedMessage {
  type: 'window:created';
  window: Window;
}

export interface WindowClosedMessage {
  type: 'window:closed';
  windowId: string;
}

export interface WindowOutputMessage {
  type: 'window:output';
  windowId: string;
  data: string;
}

export interface WindowListMessage {
  type: 'window:list';
  windows: Window[];
}

export interface WindowRenamedMessage {
  type: 'window:renamed';
  windowId: string;
  name: string;
  autoName?: string;
}

export interface DeviceLockAcquiredMessage {
  type: 'device:lock-acquired';
  windowId: string;
  deviceId: string;
  expiresAt: number;
}

export interface DeviceLockReleasedMessage {
  type: 'device:lock-released';
  windowId: string;
}

export interface DeviceConnectedMessage {
  type: 'device:connected';
  deviceId: string;
  deviceName: string;
}

export interface DeviceDisconnectedMessage {
  type: 'device:disconnected';
  deviceId: string;
}

export interface AutomationTriggeredMessage {
  type: 'automation:triggered';
  automationId: string;
  name: string;
}

export interface AutomationCompletedMessage {
  type: 'automation:completed';
  automationId: string;
  success: boolean;
  output?: string;
}

export interface SessionStateChangedMessage {
  type: 'session:state_changed';
  sessionId: string;
  state: 'active' | 'dormant' | 'terminated';
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface PongMessage {
  type: 'pong';
}

export interface FileUploadedMessage {
  type: 'file:uploaded';
  file: {
    id: string;
    filename: string;
    originalName: string;
    path: string;
    size: number;
    mimeType: string;
    hasThumbnail: boolean;
    hasOptimized: boolean;
    optimizedPath?: string;
    uploadedAt: string;
  };
}

export interface FileDeletedMessage {
  type: 'file:deleted';
  fileId: string;
  filename: string;
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthFailureMessage
  | SessionCreatedMessage
  | SessionResumedMessage
  | WindowCreatedMessage
  | WindowClosedMessage
  | WindowOutputMessage
  | WindowListMessage
  | WindowRenamedMessage
  | DeviceLockAcquiredMessage
  | DeviceLockReleasedMessage
  | DeviceConnectedMessage
  | DeviceDisconnectedMessage
  | AutomationTriggeredMessage
  | AutomationCompletedMessage
  | SessionStateChangedMessage
  | FileUploadedMessage
  | FileDeletedMessage
  | ErrorMessage
  | PongMessage;

export function encodeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(data: string): ClientMessage | null {
  try {
    return JSON.parse(data) as ClientMessage;
  } catch {
    return null;
  }
}

export function isValidClientMessage(message: unknown): message is ClientMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const msg = message as Record<string, unknown>;
  const validTypes: ClientMessageType[] = [
    'auth',
    'session:resume',
    'session:create',
    'window:create',
    'window:close',
    'window:focus',
    'window:send',
    'window:resize',
    'window:layout',
    'input',
    'ping',
  ];

  return typeof msg.type === 'string' && validTypes.includes(msg.type as ClientMessageType);
}

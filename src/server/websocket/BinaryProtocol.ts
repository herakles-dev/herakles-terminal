const MESSAGE_TYPES = {
  OUTPUT: 0x00,
  INPUT: 0x01,
} as const;

type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

const MAX_MESSAGE_SIZE = 1024 * 1024;
const WINDOW_ID_LENGTH = 36;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BinaryFrame {
  type: MessageType;
  windowId: string;
  data: Buffer;
}

export class BinaryProtocol {
  static readonly MESSAGE_TYPES = MESSAGE_TYPES;
  static readonly MAX_MESSAGE_SIZE = MAX_MESSAGE_SIZE;

  static encodeOutput(windowId: string, data: Buffer | string): Buffer {
    return this.encode(MESSAGE_TYPES.OUTPUT, windowId, data);
  }

  static encodeInput(windowId: string, data: Buffer | string): Buffer {
    return this.encode(MESSAGE_TYPES.INPUT, windowId, data);
  }

  private static encode(type: MessageType, windowId: string, data: Buffer | string): Buffer {
    if (!UUID_REGEX.test(windowId)) {
      throw new Error(`Invalid window ID: ${windowId}`);
    }

    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const totalSize = 1 + WINDOW_ID_LENGTH + dataBuffer.length;

    if (totalSize > MAX_MESSAGE_SIZE) {
      throw new Error(`Message size ${totalSize} exceeds maximum ${MAX_MESSAGE_SIZE}`);
    }

    const frame = Buffer.alloc(totalSize);
    frame[0] = type;
    frame.write(windowId, 1, WINDOW_ID_LENGTH, 'utf8');
    dataBuffer.copy(frame, 1 + WINDOW_ID_LENGTH);

    return frame;
  }

  static decode(buffer: Buffer): BinaryFrame {
    if (buffer.length < 1 + WINDOW_ID_LENGTH) {
      throw new Error(`Buffer too small: ${buffer.length} bytes`);
    }

    if (buffer.length > MAX_MESSAGE_SIZE) {
      throw new Error(`Message size ${buffer.length} exceeds maximum ${MAX_MESSAGE_SIZE}`);
    }

    const type = buffer[0] as MessageType;
    if (type !== MESSAGE_TYPES.OUTPUT && type !== MESSAGE_TYPES.INPUT) {
      throw new Error(`Unknown message type: ${type}`);
    }

    const windowId = buffer.toString('utf8', 1, 1 + WINDOW_ID_LENGTH);
    if (!UUID_REGEX.test(windowId)) {
      throw new Error(`Invalid window ID in frame: ${windowId}`);
    }

    const data = buffer.subarray(1 + WINDOW_ID_LENGTH);

    return { type, windowId, data };
  }

  static isOutput(frame: BinaryFrame): boolean {
    return frame.type === MESSAGE_TYPES.OUTPUT;
  }

  static isInput(frame: BinaryFrame): boolean {
    return frame.type === MESSAGE_TYPES.INPUT;
  }

  static validateWindowId(windowId: string): boolean {
    return UUID_REGEX.test(windowId);
  }
}

export default BinaryProtocol;

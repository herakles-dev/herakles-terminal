/**
 * Binary WebSocket protocol constants.
 *
 * These are the only unique values in this file — all JSON message types
 * live in types.ts (type definitions) and messageSchema.ts (Zod validation).
 */

export const BINARY_MESSAGE_TYPES = {
  OUTPUT: 0x00,
  INPUT: 0x01,
} as const;

export const WINDOW_ID_LENGTH = 36;

export type BinaryMessageType = (typeof BINARY_MESSAGE_TYPES)[keyof typeof BINARY_MESSAGE_TYPES];

export interface BinaryFrame {
  type: BinaryMessageType;
  windowId: string;
  data: Buffer;
}

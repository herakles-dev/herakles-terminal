import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string().min(1).max(500),
    sessionId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('input'),
    data: z.string().max(65536),
    windowId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
  z.object({
    type: z.literal('pong'),
  }),
  z.object({
    type: z.literal('take-control'),
  }),
  z.object({
    type: z.literal('session:resume'),
    sessionId: uuidSchema,
  }),
  z.object({
    type: z.literal('session:create'),
    name: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal('window:create'),
    sessionId: uuidSchema,
  }),
  z.object({
    type: z.literal('window:close'),
    windowId: uuidSchema,
  }),
  z.object({
    type: z.literal('window:focus'),
    windowId: uuidSchema,
  }),
  z.object({
    type: z.literal('window:send'),
    windowId: uuidSchema,
    data: z.string().max(65536),
  }),
  z.object({
    type: z.literal('window:resize'),
    windowId: uuidSchema,
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(500),
    seq: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('window:layout'),
    windowId: uuidSchema,
    x: z.number().int().min(0).max(10000),
    y: z.number().int().min(0).max(10000),
    width: z.number().int().min(50).max(10000),
    height: z.number().int().min(50).max(10000),
  }),
  z.object({
    type: z.literal('window:subscribe'),
    windowId: uuidSchema,
    cols: z.number().int().min(1).max(500).optional(),
    rows: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    type: z.literal('window:rename'),
    windowId: uuidSchema,
    name: z.string().min(1).max(100),
  }),
]);

export type ValidatedClientMessage = z.infer<typeof ClientMessageSchema>;

export function validateClientMessage(data: unknown): { success: true; data: ValidatedClientMessage } | { success: false; error: string } {
  const result = ClientMessageSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errorMessage = result.error.issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join(', ');
  
  return { success: false, error: errorMessage };
}

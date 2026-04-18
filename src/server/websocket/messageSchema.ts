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
    windowType: z.enum(['terminal', 'media', 'agent']).optional(),
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
    cols: z.number().int().min(10).max(500),
    rows: z.number().int().min(3).max(500),
    seq: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('window:layout'),
    windowId: uuidSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.01).max(1),
    height: z.number().min(0.01).max(1),
  }),
  z.object({
    type: z.literal('window:subscribe'),
    windowId: uuidSchema,
    cols: z.number().int().min(10).max(500).optional(),
    rows: z.number().int().min(3).max(500).optional(),
  }),
  z.object({
    type: z.literal('window:rename'),
    windowId: uuidSchema,
    name: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('window:replay'),
    windowId: uuidSchema,
    afterSeq: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('todo:subscribe'),
    windowId: z.string().min(1), // Accepts 'global' or any string (session-based, not window-based)
  }),
  z.object({
    type: z.literal('todo:unsubscribe'),
    windowId: z.string().min(1), // Accepts 'global' or any string
  }),
  z.object({
    type: z.literal('context:subscribe'),
    windowId: uuidSchema,
    projectPath: z.string().optional(),
  }),
  z.object({
    type: z.literal('context:unsubscribe'),
    windowId: uuidSchema,
  }),
  z.object({
    type: z.literal('music:subscribe'),
  }),
  z.object({
    type: z.literal('music:unsubscribe'),
  }),
  z.object({
    type: z.literal('music:sync'),
    state: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('music:load'),
    videoId: z.string().min(1).max(20),
    videoTitle: z.string().max(500).optional(),
    thumbnailUrl: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal('music:dock:update'),
    state: z.object({
      position: z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right', 'floating']),
      size: z.object({
        width: z.number().min(100).max(1920),
        height: z.number().min(60).max(1080),
      }),
      collapsed: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('artifact:subscribe'),
  }),
  z.object({
    type: z.literal('artifact:unsubscribe'),
  }),
  z.object({
    type: z.literal('window:backpressure'),
    windowId: uuidSchema,
    throttle: z.boolean(),
  }),
  z.object({
    type: z.literal('team:subscribe'),
  }),
  z.object({
    type: z.literal('team:unsubscribe'),
  }),
  z.object({
    type: z.literal('stop:activate'),
    youtubeUrl: z.string().url().max(2000).optional(),
    message: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('stop:subscribe'),
  }),
  z.object({
    type: z.literal('stop:unsubscribe'),
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

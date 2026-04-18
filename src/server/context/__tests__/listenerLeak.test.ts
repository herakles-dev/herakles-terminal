/**
 * Regression: subscribing N windows on a single WebSocket must attach at most
 * one `close` listener to that socket. Previously each subscribe() call added
 * a fresh close handler, so a ws hosting 5 windows hit the 10-listener
 * `MaxListenersExceededWarning` purely from ContextManager + siblings.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

type StubWs = EventEmitter & { send: ReturnType<typeof vi.fn> };

function makeStubWs(): StubWs {
  const emitter = new EventEmitter() as StubWs;
  emitter.send = vi.fn();
  return emitter;
}

// Cast helper: ContextManager only uses `on` / `removeListener` / `send` on the
// ws — our EventEmitter stub satisfies that contract at runtime.
const asWs = (ws: StubWs): WebSocket => ws as unknown as WebSocket;

describe('ContextManager — ws close listener leak', () => {
  it('attaches exactly one close listener per ws regardless of window count', async () => {
    const { ContextManager } = await import('../ContextManager.js');
    const cm = new ContextManager();

    const ws = makeStubWs();

    // Five windows subscribing on the same ws. No project path → avoids
    // hitting the file watcher cache for the assertion.
    await cm.subscribe('w1', null, asWs(ws));
    await cm.subscribe('w2', null, asWs(ws));
    await cm.subscribe('w3', null, asWs(ws));
    await cm.subscribe('w4', null, asWs(ws));
    await cm.subscribe('w5', null, asWs(ws));

    expect(ws.listenerCount('close')).toBe(1);

    // After close fires, handler should self-remove and weak-map entry clear,
    // so a fresh subscribe attaches a new single listener (count stays at 1).
    ws.emit('close');
    await cm.subscribe('w6', null, asWs(ws));
    expect(ws.listenerCount('close')).toBe(1);
  });

  it('survives subscribe → unsubscribe → subscribe without accumulating listeners', async () => {
    const { ContextManager } = await import('../ContextManager.js');
    const cm = new ContextManager();

    const ws = makeStubWs();
    await cm.subscribe('w1', null, asWs(ws));
    cm.unsubscribe('w1');
    await cm.subscribe('w1', null, asWs(ws));
    await cm.subscribe('w2', null, asWs(ws));

    expect(ws.listenerCount('close')).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicManager } from './MusicManager';
import type { MusicPlayerStore } from './MusicPlayerStore';
import type { MusicDockState } from '../../shared/musicProtocol';

// Minimal WebSocket mock
function makeWs(readyState = 1) {
  return {
    readyState,
    OPEN: 1,
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as import('ws').WebSocket;
}

function makeStore(dockState?: MusicDockState): MusicPlayerStore {
  return {
    getDockState: vi.fn().mockReturnValue(
      dockState ?? { position: 'bottom-right', size: { width: 320, height: 180 }, collapsed: false }
    ),
    saveDockState: vi.fn(),
  } as unknown as MusicPlayerStore;
}

describe('MusicManager', () => {
  let manager: MusicManager;
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    manager = new MusicManager(store);
  });

  describe('subscribe', () => {
    it('sends music:dock:restore with persisted state on subscribe', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');

      expect(store.getDockState).toHaveBeenCalledWith('user@test.com');
      expect(ws.send).toHaveBeenCalledTimes(1);

      const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.type).toBe('music:dock:restore');
      expect(sent.state.position).toBe('bottom-right');
    });

    it('registers close listener for cleanup', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');
      expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('increments subscriber count', () => {
      const ws1 = makeWs();
      const ws2 = makeWs();
      manager.subscribe(ws1, 'a@test.com');
      manager.subscribe(ws2, 'b@test.com');
      expect(manager.getStats().subscriberCount).toBe(2);
    });
  });

  describe('unsubscribe', () => {
    it('removes subscriber', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');
      expect(manager.getStats().subscriberCount).toBe(1);
      manager.unsubscribe(ws);
      expect(manager.getStats().subscriberCount).toBe(0);
    });
  });

  describe('handleDockUpdate', () => {
    it('persists dock state to store', () => {
      const ws = makeWs();
      const state: MusicDockState = { position: 'top-left', size: { width: 400, height: 300 }, collapsed: true };

      manager.handleDockUpdate(ws, 'user@test.com', state);

      expect(store.saveDockState).toHaveBeenCalledWith('user@test.com', state);
    });

    it('broadcasts to other connections of same user', () => {
      const ws1 = makeWs();
      const ws2 = makeWs();
      const ws3 = makeWs();

      manager.subscribe(ws1, 'user@test.com');
      manager.subscribe(ws2, 'user@test.com');
      manager.subscribe(ws3, 'other@test.com');

      // Clear subscribe sends
      (ws1.send as ReturnType<typeof vi.fn>).mockClear();
      (ws2.send as ReturnType<typeof vi.fn>).mockClear();
      (ws3.send as ReturnType<typeof vi.fn>).mockClear();

      const state: MusicDockState = { position: 'bottom-left', size: { width: 320, height: 180 }, collapsed: false };
      manager.handleDockUpdate(ws1, 'user@test.com', state);

      // ws1 is the sender — should NOT receive broadcast
      expect(ws1.send).not.toHaveBeenCalled();
      // ws2 is same user — SHOULD receive broadcast
      expect(ws2.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse((ws2.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.type).toBe('music:dock:restore');
      expect(sent.state.position).toBe('bottom-left');
      // ws3 is different user — should NOT receive
      expect(ws3.send).not.toHaveBeenCalled();
    });

    it('does not broadcast when only one connection for user', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');
      (ws.send as ReturnType<typeof vi.fn>).mockClear();

      const state: MusicDockState = { position: 'bottom-right', size: { width: 320, height: 180 }, collapsed: false };
      manager.handleDockUpdate(ws, 'user@test.com', state);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('sendToWebSocket safety', () => {
    it('skips send when WebSocket is not OPEN', () => {
      const ws = makeWs(3); // CLOSED
      manager.subscribe(ws, 'user@test.com');
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeAll', () => {
    it('removes all subscriptions for a WebSocket', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');
      manager.unsubscribeAll(ws);
      expect(manager.getStats().subscriberCount).toBe(0);
    });
  });
});

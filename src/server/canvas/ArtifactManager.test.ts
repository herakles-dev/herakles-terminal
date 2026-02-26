import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactManager } from './ArtifactManager';
import type { CanvasArtifact } from './ArtifactWatcher';

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

function makeArtifact(overrides: Partial<CanvasArtifact> = {}): CanvasArtifact {
  return {
    id: `art-${Date.now()}`,
    type: 'code',
    content: 'console.log("hello")',
    language: 'javascript',
    title: 'Test Artifact',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ArtifactManager', () => {
  let manager: ArtifactManager;

  beforeEach(() => {
    manager = new ArtifactManager();
  });

  describe('subscribe', () => {
    it('sends artifact:history immediately on subscribe', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.type).toBe('artifact:history');
      expect(sent.artifacts).toEqual([]);
    });

    it('sends existing history on subscribe', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', title: 'First' }));
      manager.recordArtifact(makeArtifact({ id: 'art-2', title: 'Second' }));

      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');

      const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.artifacts).toHaveLength(2);
      // Most recent first (unshift)
      expect(sent.artifacts[0].id).toBe('art-2');
      expect(sent.artifacts[1].id).toBe('art-1');
    });

    it('registers close listener for cleanup', () => {
      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');
      expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('recordArtifact', () => {
    it('generates thumbnail from first 200 chars', () => {
      const longContent = 'x'.repeat(500);
      manager.recordArtifact(makeArtifact({ id: 'art-1', content: longContent }));

      const history = manager.getHistory();
      expect(history[0].thumbnail).toBe('x'.repeat(200));
    });

    it('preserves short content as full thumbnail', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', content: 'short' }));
      expect(manager.getHistory()[0].thumbnail).toBe('short');
    });

    it('uses "Untitled" when no title provided', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', title: undefined }));
      expect(manager.getHistory()[0].title).toBe('Untitled');
    });

    it('limits history to 50 artifacts', () => {
      for (let i = 0; i < 60; i++) {
        manager.recordArtifact(makeArtifact({ id: `art-${i}` }));
      }
      expect(manager.getHistory()).toHaveLength(50);
      // Most recent should be first
      expect(manager.getHistory()[0].id).toBe('art-59');
    });

    it('trims oldest when over 50', () => {
      for (let i = 0; i < 55; i++) {
        manager.recordArtifact(makeArtifact({ id: `art-${i}` }));
      }
      const history = manager.getHistory();
      // art-0 through art-4 should be trimmed
      const ids = history.map(h => h.id);
      expect(ids).not.toContain('art-0');
      expect(ids).not.toContain('art-4');
      expect(ids).toContain('art-5');
      expect(ids).toContain('art-54');
    });
  });

  describe('generateTags', () => {
    it('tags with artifact type', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', type: 'html' }));
      expect(manager.getHistory()[0].tags).toContain('html');
    });

    it('includes language tag when present', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', type: 'code', language: 'python' }));
      const tags = manager.getHistory()[0].tags!;
      expect(tags).toContain('code');
      expect(tags).toContain('python');
    });

    it('auto-tags mermaid graph diagrams', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', type: 'mermaid', content: 'graph TD\n  A-->B' }));
      expect(manager.getHistory()[0].tags).toContain('diagram');
    });

    it('auto-tags mermaid sequence diagrams', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', type: 'mermaid', content: 'sequenceDiagram\n  A->>B: Hello' }));
      expect(manager.getHistory()[0].tags).toContain('sequence');
    });

    it('auto-tags mermaid gantt charts', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1', type: 'mermaid', content: 'gantt\n  title Schedule' }));
      expect(manager.getHistory()[0].tags).toContain('gantt');
    });

    it('tags large code artifacts (>500 chars)', () => {
      manager.recordArtifact(makeArtifact({
        id: 'art-1',
        type: 'code',
        content: 'x'.repeat(501),
      }));
      expect(manager.getHistory()[0].tags).toContain('large');
    });

    it('does not tag small code as large', () => {
      manager.recordArtifact(makeArtifact({
        id: 'art-1',
        type: 'code',
        content: 'x'.repeat(100),
      }));
      expect(manager.getHistory()[0].tags).not.toContain('large');
    });
  });

  describe('broadcastHistory', () => {
    it('sends history to all subscribers', () => {
      const ws1 = makeWs();
      const ws2 = makeWs();
      manager.subscribe(ws1, 'a@test.com');
      manager.subscribe(ws2, 'b@test.com');

      (ws1.send as ReturnType<typeof vi.fn>).mockClear();
      (ws2.send as ReturnType<typeof vi.fn>).mockClear();

      manager.recordArtifact(makeArtifact({ id: 'art-1' }));
      manager.broadcastHistory();

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      const sent = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.type).toBe('artifact:history');
      expect(sent.artifacts).toHaveLength(1);
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

  describe('sendHistory safety', () => {
    it('skips send when WebSocket is not OPEN', () => {
      const ws = makeWs(3); // CLOSED
      manager.subscribe(ws, 'user@test.com');
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('returns correct history size and subscriber count', () => {
      manager.recordArtifact(makeArtifact({ id: 'art-1' }));
      manager.recordArtifact(makeArtifact({ id: 'art-2' }));

      const ws = makeWs();
      manager.subscribe(ws, 'user@test.com');

      const stats = manager.getStats();
      expect(stats.historySize).toBe(2);
      expect(stats.subscriberCount).toBe(1);
    });
  });
});

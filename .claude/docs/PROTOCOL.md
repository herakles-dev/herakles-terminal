# Herakles Terminal - WebSocket Protocol Summary

## Client -> Server
```typescript
{ type: 'input', windowId, data }
{ type: 'window:create', sessionId, windowType? }  // 'terminal' | 'media' | 'agent'
{ type: 'window:resize', windowId, cols, rows }    // Server dedupes (50ms)
{ type: 'session:create', name? }
{ type: 'todo:subscribe', windowId }
{ type: 'context:subscribe', windowId }
{ type: 'music:subscribe' }
{ type: 'music:dock:update', state }
{ type: 'artifact:subscribe' }
{ type: 'team:subscribe' }
{ type: 'team:unsubscribe' }
```

## Server -> Client
```typescript
{ type: 'window:created', window: { ..., type } }
{ type: 'window:output', windowId, data }
{ type: 'window:restore', windowId, content }
{ type: 'todo:sync', windowId, todos }
{ type: 'context:update', windowId, usage }
{ type: 'context:warning', windowId, message, threshold }
{ type: 'canvas:artifact', artifact }
{ type: 'music:dock:restore', state }
{ type: 'artifact:history', artifacts }
{ type: 'team:sync', teams }
{ type: 'team:member:update', teamName, member }
{ type: 'team:detected', team }
{ type: 'team:dissolved', team }
```

## Canonical Sources
- `src/shared/protocol.ts` — Core protocol types
- `src/shared/teamProtocol.ts` — Team cockpit protocol
- `src/shared/todoProtocol.ts` — Todo sync protocol
- `src/shared/musicProtocol.ts` — Music player protocol
- `src/shared/contextProtocol.ts` — Context tracking protocol

<!-- Extracted from CLAUDE.md by v11-drift on 2026-03-31 -->

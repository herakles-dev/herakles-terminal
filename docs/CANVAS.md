# Canvas Artifact System

Real-time rich content delivery to the Zeus Terminal side panel.

## Quick Start

```bash
# Send markdown
send-artifact markdown '# Hello World'

# Send mermaid diagram
send-artifact mermaid 'graph TD; A-->B'

# Send code with syntax highlighting
send-artifact code 'console.log("hi")' javascript
```

## Supported Types

| Type | Renderer | Use Case |
|------|----------|----------|
| `markdown` | react-markdown + GFM | Documentation, reports |
| `mermaid` | mermaid.js | Diagrams, flowcharts |
| `code` | Syntax highlighting | Source code display |
| `html` | Sandboxed iframe | Rich HTML content |
| `svg` | Sanitized inline | Vector graphics |
| `json` | Collapsible tree | Data inspection |

## Architecture

```
~/.canvas/artifacts/*.json
         │
         ▼
┌─────────────────────┐
│  ArtifactWatcher    │  (fs.watch)
│  src/server/canvas/ │
└──────────┬──────────┘
           │ emit('artifact')
           ▼
┌─────────────────────┐
│  WebSocket Broadcast │
│  canvas:artifact     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  useCanvasArtifacts │  (React hook)
│  addArtifact()      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  CanvasPanel        │
│  ArtifactRenderer   │
│  FullscreenViewer   │
└─────────────────────┘
```

## JSON Schema

```json
{
  "type": "markdown|mermaid|code|html|svg|json",
  "content": "The content to render",
  "title": "Optional display title",
  "language": "For code type: javascript, python, etc."
}
```

## API

### Helper Script
```bash
send-artifact <type> <content> [language]
```

### Direct File Write
```bash
cat > ~/.canvas/artifacts/my-artifact.json << 'EOF'
{"type": "markdown", "content": "# Title"}
EOF
```

### Pipe Content
```bash
cat README.md | send-artifact markdown
docker inspect nginx | send-artifact json
```

## Frontend Integration

### Hook: useCanvasArtifacts
```typescript
const {
  artifacts,           // Artifact[]
  activeArtifactId,    // string | null
  viewMode,            // 'code' | 'preview'
  unreadCount,         // number
  addArtifact,         // (artifact: Artifact) => void
  setActiveArtifact,   // (id: string) => void
  toggleViewMode,      // () => void
  clearArtifacts,      // () => void
  removeArtifact,      // (id: string) => void
  toggleStar,          // (id: string) => void
  markAsRead,          // () => void
} = useCanvasArtifacts();
```

### WebSocket Message
```typescript
// Server → Client
{
  type: 'canvas:artifact',
  artifact: {
    id: string,
    type: ArtifactType,
    content: string,
    title?: string,
    language?: string,
    timestamp: number,
    sourceWindow?: string
  }
}
```

## Features

- **Real-time delivery** - Artifacts appear instantly via WebSocket
- **Auto-cleanup** - Files deleted after 1 hour
- **Starring** - Persist important artifacts to database
- **Fullscreen viewer** - Expand artifacts for detailed view
- **Type filtering** - Filter by markdown, code, mermaid, etc.
- **Code/Preview toggle** - View source or rendered output
- **Copy/Export** - Copy content or download as file

## Common Patterns

### Architecture Diagram
```bash
send-artifact mermaid 'graph TB
    subgraph Frontend
        A[React] --> B[WebSocket]
    end
    subgraph Backend
        C[Express] --> D[PTY]
    end
    B <--> C'
```

### Status Report
```bash
send-artifact markdown '## Status
| Service | Status |
|---------|--------|
| API | OK |
| DB | OK |'
```

### Code Review
```bash
send-artifact code "$(cat src/client/App.tsx | head -50)" typescript
```

## File Locations

| Path | Purpose |
|------|---------|
| `~/.canvas/artifacts/` | Artifact drop directory |
| `~/.canvas/send-artifact.sh` | Helper script |
| `src/server/canvas/ArtifactWatcher.ts` | File watcher |
| `src/client/hooks/useCanvasArtifacts.ts` | State management |
| `src/client/components/Canvas/` | Renderers |
| `src/client/components/SidePanel/CanvasPanel.tsx` | Panel UI |

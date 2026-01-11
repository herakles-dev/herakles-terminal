import type { Artifact, ArtifactType, DetectionResult } from '../../../types/canvas';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

function generateId(): string {
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const EXPLICIT_MARKER_REGEX = /<!-- CANVAS:(\w+) -->([\s\S]*?)<!-- \/CANVAS -->/g;

const FENCED_PATTERNS: { regex: RegExp; type: ArtifactType; language?: string }[] = [
  { regex: /```mermaid\n([\s\S]*?)```/g, type: 'mermaid' },
  { regex: /```html\n([\s\S]*?)```/g, type: 'html' },
  { regex: /```svg\n([\s\S]*?)```/g, type: 'svg' },
  { regex: /```json\n([\s\S]*?)```/g, type: 'json' },
  { regex: /```markdown\n([\s\S]*?)```/g, type: 'markdown' },
  { regex: /```md\n([\s\S]*?)```/g, type: 'markdown' },
  { regex: /```typescript\n([\s\S]*?)```/g, type: 'code', language: 'typescript' },
  { regex: /```javascript\n([\s\S]*?)```/g, type: 'code', language: 'javascript' },
  { regex: /```python\n([\s\S]*?)```/g, type: 'code', language: 'python' },
  { regex: /```bash\n([\s\S]*?)```/g, type: 'code', language: 'bash' },
  { regex: /```sh\n([\s\S]*?)```/g, type: 'code', language: 'bash' },
  { regex: /```css\n([\s\S]*?)```/g, type: 'code', language: 'css' },
  { regex: /```sql\n([\s\S]*?)```/g, type: 'code', language: 'sql' },
  { regex: /```yaml\n([\s\S]*?)```/g, type: 'code', language: 'yaml' },
  { regex: /```yml\n([\s\S]*?)```/g, type: 'code', language: 'yaml' },
  { regex: /```go\n([\s\S]*?)```/g, type: 'code', language: 'go' },
  { regex: /```rust\n([\s\S]*?)```/g, type: 'code', language: 'rust' },
  { regex: /```tsx\n([\s\S]*?)```/g, type: 'code', language: 'tsx' },
  { regex: /```jsx\n([\s\S]*?)```/g, type: 'code', language: 'jsx' },
];

function detectLargeJson(content: string): Artifact | null {
  const lines = content.split('\n');
  let jsonStart = -1;
  let braceCount = 0;
  let jsonContent = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (jsonStart === -1 && (line.startsWith('{') || line.startsWith('['))) {
      jsonStart = i;
      braceCount = 0;
    }
    
    if (jsonStart !== -1) {
      jsonContent += lines[i] + '\n';
      for (const char of line) {
        if (char === '{' || char === '[') braceCount++;
        if (char === '}' || char === ']') braceCount--;
      }
      
      if (braceCount === 0 && jsonContent.trim().length > 0) {
        const lineCount = i - jsonStart + 1;
        if (lineCount >= 50) {
          try {
            JSON.parse(jsonContent.trim());
            return {
              id: generateId(),
              type: 'json',
              content: jsonContent.trim(),
              sourceWindow: '',
              timestamp: Date.now(),
            };
          } catch {
            jsonStart = -1;
            jsonContent = '';
          }
        }
        jsonStart = -1;
        jsonContent = '';
      }
    }
  }
  
  return null;
}

export function detectArtifact(output: string, windowId: string): DetectionResult {
  const cleanOutput = stripAnsi(output);
  const artifacts: Artifact[] = [];
  
  let match;
  while ((match = EXPLICIT_MARKER_REGEX.exec(cleanOutput)) !== null) {
    const type = match[1].toLowerCase() as ArtifactType;
    const content = match[2].trim();
    if (content) {
      artifacts.push({
        id: generateId(),
        type,
        content,
        sourceWindow: windowId,
        timestamp: Date.now(),
      });
    }
  }
  
  for (const pattern of FENCED_PATTERNS) {
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(cleanOutput)) !== null) {
      const content = match[1].trim();
      if (content) {
        artifacts.push({
          id: generateId(),
          type: pattern.type,
          content,
          language: pattern.language,
          sourceWindow: windowId,
          timestamp: Date.now(),
        });
      }
    }
  }
  
  const largeJson = detectLargeJson(cleanOutput);
  if (largeJson) {
    largeJson.sourceWindow = windowId;
    artifacts.push(largeJson);
  }
  
  return {
    detected: artifacts.length > 0,
    artifacts,
  };
}

import { SessionStore } from './SessionStore.js';
import { config } from '../config.js';

export class SessionNamer {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  async extractName(conversationSnippet: string): Promise<string> {
    const snippet = conversationSnippet.slice(0, 500);

    if (config.gemini.apiKey) {
      try {
        const name = await this.callGeminiAPI(snippet);
        if (name) return name;
      } catch (error) {
        console.error('Gemini API error:', error);
      }
    }

    return this.heuristicName(snippet);
  }

  async updateSessionName(sessionId: string, snippet: string, userEmail: string): Promise<string> {
    const name = await this.extractName(snippet);
    this.store.updateAutoName(sessionId, name, userEmail);
    return name;
  }

  private async callGeminiAPI(snippet: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Generate a 3-5 word descriptive name for this Claude Code session based on the conversation. Just the name, no quotes or explanation:\n\n${snippet}`
              }]
            }],
            generationConfig: {
              maxOutputTokens: 20,
              temperature: 0.7,
            }
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (text) {
        return text.trim().replace(/^["']|["']$/g, '').slice(0, 50);
      }

      return null;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private heuristicName(snippet: string): string {
    const projectPatterns = [
      /(?:working on|project[:\s]+|repo[:\s]+)([a-zA-Z0-9_-]+)/i,
      /(?:cd|git clone)[^\n]*\/([a-zA-Z0-9_-]+)/i,
      /package\.json.*"name":\s*"([^"]+)"/i,
    ];

    for (const pattern of projectPatterns) {
      const match = snippet.match(pattern);
      if (match?.[1]) {
        return `${match[1]} Session`;
      }
    }

    const filePatterns = [
      /(?:edit|create|modify|update)[^\n]*([a-zA-Z0-9_-]+\.[a-zA-Z]+)/i,
      /src\/([a-zA-Z0-9_/-]+)/i,
    ];

    for (const pattern of filePatterns) {
      const match = snippet.match(pattern);
      if (match?.[1]) {
        const name = match[1].split('/').pop() || match[1];
        return `Editing ${name}`;
      }
    }

    const taskPatterns = [
      /(?:help me|want to|need to|please)\s+([a-z]+(?:\s+[a-z]+){0,3})/i,
      /(?:implement|create|build|fix|debug)\s+([a-z]+(?:\s+[a-z]+){0,3})/i,
    ];

    for (const pattern of taskPatterns) {
      const match = snippet.match(pattern);
      if (match?.[1]) {
        const task = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        return task.slice(0, 40);
      }
    }

    const date = new Date();
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `Session ${timeStr}`;
  }

  shouldUpdateName(messageCount: number, hasAutoName: boolean, autoNameIsPlaceholder: boolean): boolean {
    if (!hasAutoName && messageCount >= 5) {
      return true;
    }

    if (autoNameIsPlaceholder && messageCount >= 10) {
      return true;
    }

    return false;
  }

  isPlaceholderName(name: string): boolean {
    return /^Session\s+\d{1,2}:\d{2}/.test(name) || /^Session\s+\d+$/.test(name);
  }
}

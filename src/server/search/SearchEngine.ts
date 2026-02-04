import { SearchResult, CommandTemplate, SearchOptions, SearchContext } from './types.js';

export class SearchEngine {
  private templates: CommandTemplate[] = [];
  private commandCache: Map<string, SearchResult[]> = new Map();

  setTemplates(templates: CommandTemplate[]): void {
    this.templates = templates;
    this.clearCache();
  }

  search(
    query: string,
    historyResults: { command: string; count: number; lastUsed: string }[],
    options: SearchOptions = {},
    context?: SearchContext
  ): SearchResult[] {
    const {
      limit = 15,
      includeTemplates = true,
      includeHistory = true,
      fuzzyThreshold = 0.4,
      contextBoost = true,
    } = options;

    if (!query || query.length < 2) {
      return [];
    }

    const queryLower = query.toLowerCase().trim();
    const results: SearchResult[] = [];

    if (includeTemplates) {
      const templateResults = this.searchTemplates(queryLower, fuzzyThreshold, context);
      results.push(...templateResults);
    }

    if (includeHistory && historyResults.length > 0) {
      const historySearchResults = this.searchHistory(queryLower, historyResults, fuzzyThreshold);
      results.push(...historySearchResults);
    }

    const deduped = this.deduplicateResults(results);
    
    if (contextBoost && context) {
      this.applyContextBoosts(deduped, context);
    }

    deduped.sort((a, b) => b.score - a.score);

    return deduped.slice(0, limit);
  }

  private searchTemplates(query: string, threshold: number, context?: SearchContext): SearchResult[] {
    const results: SearchResult[] = [];

    for (const template of this.templates) {
      const scores = [
        this.calculateScore(query, template.command.toLowerCase()),
        this.calculateScore(query, template.name.toLowerCase()) * 0.9,
        this.calculateScore(query, template.description.toLowerCase()) * 0.7,
        this.calculateScore(query, template.category.toLowerCase()) * 0.6,
      ];

      const bestScore = Math.max(...scores);

      if (bestScore >= threshold) {
        const contextBoosts: string[] = [];
        
        if (context) {
          if (template.category === 'git' && context.gitContext?.isGitRepo) {
            contextBoosts.push('git-repo');
          }
          if (template.category === 'docker' && context.dockerContext?.hasDockerCompose) {
            contextBoosts.push('docker-compose');
          }
          if (template.category === 'npm' && context.nodeContext?.hasPackageJson) {
            contextBoosts.push('node-project');
          }
        }

        results.push({
          command: template.command,
          description: template.description,
          category: template.category,
          score: bestScore,
          source: 'template',
          templateId: template.id,
          variables: template.variables,
          contextBoosts,
        });
      }
    }

    return results;
  }

  private searchHistory(
    query: string,
    history: { command: string; count: number; lastUsed: string }[],
    threshold: number
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of history) {
      const score = this.calculateScore(query, entry.command.toLowerCase());

      if (score >= threshold) {
        const usageBoost = Math.min(entry.count / 10, 0.2);
        const recencyBoost = this.calculateRecencyBoost(entry.lastUsed);

        results.push({
          command: entry.command,
          description: `Used ${entry.count} time${entry.count !== 1 ? 's' : ''}`,
          category: 'history',
          score: score + usageBoost + recencyBoost,
          source: 'history',
          usageCount: entry.count,
          lastUsed: entry.lastUsed,
        });
      }
    }

    return results;
  }

  private calculateScore(query: string, target: string): number {
    if (target.startsWith(query)) {
      return 1.0;
    }
    if (target.includes(query)) {
      return 0.85;
    }

    const words = target.split(/[\s\-_]+/);
    for (const word of words) {
      if (word.startsWith(query)) {
        return 0.8;
      }
    }

    const jaroWinkler = this.jaroWinklerSimilarity(query, target);
    
    if (jaroWinkler > 0.85) {
      return jaroWinkler * 0.9;
    }

    const fuzzyScore = this.fuzzyMatch(query, target);
    return Math.max(jaroWinkler * 0.7, fuzzyScore);
  }

  private jaroWinklerSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, s2.length);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro =
      (matches / s1.length +
        matches / s2.length +
        (matches - transpositions / 2) / matches) /
      3;

    let prefix = 0;
    for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  }

  private fuzzyMatch(query: string, target: string): number {
    let queryIndex = 0;
    let targetIndex = 0;
    let consecutiveMatches = 0;
    let totalMatches = 0;
    let score = 0;

    while (queryIndex < query.length && targetIndex < target.length) {
      if (query[queryIndex] === target[targetIndex]) {
        totalMatches++;
        consecutiveMatches++;
        score += consecutiveMatches * 0.1;
        queryIndex++;
      } else {
        consecutiveMatches = 0;
      }
      targetIndex++;
    }

    if (queryIndex < query.length) {
      return 0;
    }

    const matchRatio = totalMatches / query.length;
    const positionBonus = 1 - (targetIndex / target.length) * 0.5;

    return Math.min(matchRatio * positionBonus + score * 0.1, 1.0);
  }

  private calculateRecencyBoost(lastUsed: string): number {
    const lastUsedDate = new Date(lastUsed).getTime();
    const now = Date.now();
    const daysSince = (now - lastUsedDate) / (1000 * 60 * 60 * 24);

    if (daysSince < 1) return 0.15;
    if (daysSince < 7) return 0.1;
    if (daysSince < 30) return 0.05;
    return 0;
  }

  private applyContextBoosts(results: SearchResult[], context: SearchContext): void {
    for (const result of results) {
      let boost = 0;

      if (result.category === 'git' && context.gitContext?.isGitRepo) {
        boost += 0.15;
        result.contextBoosts = result.contextBoosts || [];
        result.contextBoosts.push('git-repo-detected');
      }

      if (result.category === 'docker' && context.dockerContext?.hasDockerCompose) {
        boost += 0.15;
        result.contextBoosts = result.contextBoosts || [];
        result.contextBoosts.push('docker-compose-detected');
      }

      if (result.category === 'npm' && context.nodeContext?.hasPackageJson) {
        boost += 0.15;
        result.contextBoosts = result.contextBoosts || [];
        result.contextBoosts.push('node-project-detected');
      }

      if (context.nodeContext?.scripts && result.command.includes('npm run')) {
        const scriptMatch = result.command.match(/npm run (\w+)/);
        if (scriptMatch && context.nodeContext.scripts.includes(scriptMatch[1])) {
          boost += 0.1;
          result.contextBoosts = result.contextBoosts || [];
          result.contextBoosts.push('script-exists');
        }
      }

      result.score += boost;
    }
  }

  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();

    for (const result of results) {
      const normalizedCommand = result.command.toLowerCase().replace(/\s+/g, ' ').trim();
      const existing = seen.get(normalizedCommand);

      if (!existing || result.score > existing.score) {
        seen.set(normalizedCommand, result);
      }
    }

    return Array.from(seen.values());
  }

  private clearCache(): void {
    this.commandCache.clear();
  }
}

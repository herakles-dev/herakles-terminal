export interface SearchResult {
  command: string;
  description: string;
  category: string;
  score: number;
  source: 'template' | 'history' | 'system';
  templateId?: string;
  variables?: TemplateVariable[];
  contextBoosts?: string[];
  usageCount?: number;
  lastUsed?: string;
}

export interface TemplateVariable {
  name: string;
  default?: string;
  required?: boolean;
  description?: string;
}

export interface CommandTemplate {
  id: string;
  name: string;
  category: string;
  command: string;
  description: string;
  variables?: TemplateVariable[];
  isBuiltIn: boolean;
}

export interface SearchContext {
  workingDirectory?: string;
  recentCommands?: string[];
  gitContext?: GitContext;
  dockerContext?: DockerContext;
  nodeContext?: NodeContext;
}

export interface GitContext {
  isGitRepo: boolean;
  branch?: string;
  hasChanges?: boolean;
  remotes?: string[];
}

export interface DockerContext {
  hasDockerCompose: boolean;
  runningContainers?: string[];
}

export interface NodeContext {
  hasPackageJson: boolean;
  scripts?: string[];
}

export interface SearchOptions {
  limit?: number;
  includeTemplates?: boolean;
  includeHistory?: boolean;
  fuzzyThreshold?: number;
  contextBoost?: boolean;
}

export interface CommandAnalytics {
  commandHash: string;
  selectionCount: number;
  successRate: number;
  avgContextScore: number;
  lastUpdated: number;
}

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SessionStore } from '../session/SessionStore.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

export const BUILT_IN_TEMPLATES = [
  // --- V9 Project Initialization ---
  {
    id: 'v9-start-simple',
    name: 'Quick Start',
    category: 'v9-start',
    command: 'I want to build a {{app_idea}}.',
    description: 'Start a new project with a simple prompt',
    variables: [{ name: 'app_idea', required: true, description: 'What do you want to build?' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-start-detailed',
    name: 'Detailed Start',
    category: 'v9-start',
    command: 'I want to build a {{app_name}}.\nStack: {{stack}}.\nPort: {{port}}. Domain: {{domain}}.\nMust have: {{requirements}}.',
    description: 'Start with full project specification',
    variables: [
      { name: 'app_name', required: true, description: 'Application name' },
      { name: 'stack', required: true, description: 'Tech stack (e.g., React + Node, Python Flask)' },
      { name: 'port', default: 'auto', description: 'Port number' },
      { name: 'domain', default: 'auto', description: 'Subdomain' },
      { name: 'requirements', required: true, description: 'Key requirements' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'v9-start-migrate',
    name: 'Migrate V8 to V9',
    category: 'v9-start',
    command: 'Migrate the V8 project {{project_name}} to V9 standards.',
    description: 'Upgrade a V8 project to V9 protocol',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-start-continue',
    name: 'Continue Project',
    category: 'v9-start',
    command: 'Continue {{project_name}}.',
    description: 'Resume work on an existing project',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  // --- V9 Agent Formations ---
  {
    id: 'v9-form-feature',
    name: 'Build Feature',
    category: 'v9-formation',
    command: 'Build the {{feature_name}} feature.',
    description: 'Build a feature using the feature-impl formation',
    variables: [{ name: 'feature_name', required: true, description: 'Feature to build' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-form-force',
    name: 'Force Formation',
    category: 'v9-formation',
    command: 'Use the {{formation}} formation to build {{feature_name}}.',
    description: 'Explicitly choose a V9 formation',
    variables: [
      { name: 'formation', required: true, description: 'Formation: feature-impl, new-project, bug-investigation, security-review, perf-optimization, code-review' },
      { name: 'feature_name', required: true, description: 'What to build' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'v9-form-newproject',
    name: 'New Project Team',
    category: 'v9-formation',
    command: 'Start a new project for {{project_description}}.',
    description: 'Spawn the new-project formation (architect + scaffolder + db-designer)',
    variables: [{ name: 'project_description', required: true, description: 'Project description' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-form-bug',
    name: 'Bug Investigation',
    category: 'v9-formation',
    command: 'Something is broken in {{module}}, investigate.',
    description: 'Spawn parallel hypothesis investigators',
    variables: [{ name: 'module', required: true, description: 'Module or area that is broken' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-form-security',
    name: 'Security Review',
    category: 'v9-formation',
    command: 'Run a security review on {{module}}.',
    description: 'Spawn threat-modeler + scanner + fixer',
    variables: [{ name: 'module', required: true, description: 'Module to review' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-form-review',
    name: 'Code Review',
    category: 'v9-formation',
    command: 'Review this PR: {{pr_context}}.',
    description: 'Spawn 3 reviewers: security, performance, coverage',
    variables: [{ name: 'pr_context', required: true, description: 'PR number or description' }],
    isBuiltIn: true,
  },
  // --- V9 Effort & Thinking ---
  {
    id: 'v9-effort-max',
    name: 'Max Effort (Architecture)',
    category: 'v9-effort',
    command: 'Use max effort to design the architecture for {{module}}.',
    description: 'Opus 4.6 extended thinking for architecture and security',
    variables: [{ name: 'module', required: true, description: 'Module to architect' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-effort-perf',
    name: 'Performance Optimization',
    category: 'v9-effort',
    command: 'The {{endpoint}} endpoint is slow, optimize it.',
    description: 'Trigger perf-optimization formation',
    variables: [{ name: 'endpoint', required: true, description: 'Slow endpoint or module' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-effort-plan',
    name: 'Force Plan Mode',
    category: 'v9-effort',
    command: 'Plan the refactoring of the {{module}} module.',
    description: 'Enter plan mode before implementation',
    variables: [{ name: 'module', required: true, description: 'Module to refactor' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-effort-review',
    name: 'Review Code',
    category: 'v9-effort',
    command: 'Review the code in {{path}}.',
    description: 'Focused code review on a path',
    variables: [{ name: 'path', required: true, description: 'File or directory path' }],
    isBuiltIn: true,
  },
  // --- V9 Risk & Permissions ---
  {
    id: 'v9-auto-grant',
    name: 'Grant Edit Access',
    category: 'v9-autonomy',
    command: 'Grant edit access to {{path}}.',
    description: 'Elevate autonomy for a file pattern',
    variables: [{ name: 'path', default: 'src/**', description: 'File glob pattern' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-auto-slow',
    name: 'Slow Down (A0)',
    category: 'v9-autonomy',
    command: 'Slow down.',
    description: 'Reset to A0 — confirm everything',
    isBuiltIn: true,
  },
  {
    id: 'v9-auto-status',
    name: 'Show Task Progress',
    category: 'v9-autonomy',
    command: 'Status',
    description: 'Show current task list and progress',
    isBuiltIn: true,
  },
  {
    id: 'v9-auto-handoff',
    name: 'Generate Handoff',
    category: 'v9-autonomy',
    command: 'Generate context for a new window for project {{project_name}}.',
    description: 'Create handoff context for session continuation',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  // --- V9 Deployment & Ops ---
  {
    id: 'v9-deploy-service',
    name: 'Deploy Service',
    category: 'v9-deploy',
    command: 'Deploy {{service_name}}.',
    description: 'Deploy a service with pre-flight checks',
    variables: [{ name: 'service_name', required: true, description: 'Service to deploy' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-deploy-scaffold',
    name: 'Scaffold Project',
    category: 'v9-deploy',
    command: 'cd /home/hercules/v9 && ./scripts/scaffold {{project_name}}',
    description: 'Scaffold a new V9 project',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-deploy-migrate-v8',
    name: 'Migrate V8 Project',
    category: 'v9-deploy',
    command: './scripts/migrate-v8 {{project_name}}',
    description: 'Run V8 to V9 migration script',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-deploy-hooks',
    name: 'Copy V9 Hooks',
    category: 'v9-deploy',
    command: 'mkdir -p /home/hercules/{{project_name}}/.claude && cp /home/hercules/v9/templates/project-settings.json /home/hercules/{{project_name}}/.claude/settings.json',
    description: 'Copy V9 hook configuration to a project',
    variables: [{ name: 'project_name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  // --- V9 CLI Scripts ---
  {
    id: 'v9-script-status',
    name: 'Project Status',
    category: 'v9-scripts',
    command: './scripts/status {{project_name}}',
    description: 'Check V9 project status',
    variables: [{ name: 'project_name', default: '', description: 'Project name (blank for current)' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-script-handoff',
    name: 'Generate Handoff File',
    category: 'v9-scripts',
    command: './scripts/handoff {{project_name}}',
    description: 'Generate handoff context file',
    variables: [{ name: 'project_name', default: '', description: 'Project name (blank for current)' }],
    isBuiltIn: true,
  },
  {
    id: 'v9-script-team',
    name: 'Team Status',
    category: 'v9-scripts',
    command: './scripts/team-status',
    description: 'Show active agent team status',
    isBuiltIn: true,
  },
  {
    id: 'v9-script-effort',
    name: 'Effort Advisor',
    category: 'v9-scripts',
    command: './scripts/effort-advisor "{{task_description}}"',
    description: 'Get effort level recommendation for a task',
    variables: [{ name: 'task_description', required: true, description: 'Task to analyze' }],
    isBuiltIn: true,
  },
  // --- V9 Quick Reference ---
  {
    id: 'v9-tip-activate',
    name: 'Activate V9',
    category: 'v9-tips',
    command: 'cd /home/hercules/v9 && claude',
    description: 'Enter the V9 directory and start Claude',
    isBuiltIn: true,
  },
  {
    id: 'v9-tip-effort-ref',
    name: 'Effort Level Reference',
    category: 'v9-tips',
    command: 'cat <<EOF\nV9 Effort Levels:\n  max    - Architecture, security, novel problems (Opus 4.6 extended thinking)\n  high   - Implementation, refactoring, reviews (Opus 4.6)\n  medium - Testing, validation, coordination (Sonnet 4.5)\n  low    - Formatting, linting, scanning (Haiku 4.5)\nUsage: "Use max effort to design the auth architecture"\nEOF',
    description: 'Quick reference: V9 effort levels and model routing',
    isBuiltIn: true,
  },
  {
    id: 'v9-tip-formations-ref',
    name: 'Formations Reference',
    category: 'v9-tips',
    command: 'cat <<EOF\nV9 Agent Formations:\n  feature-impl       - 4 teammates: backend, frontend, integrator, tester\n  new-project        - 3 teammates: architect, scaffolder, db-designer\n  bug-investigation  - 3 parallel hypothesis investigators\n  security-review    - threat-modeler + scanner + fixer\n  perf-optimization  - optimizer then tester (sequential)\n  code-review        - 3 reviewers: security, perf, coverage\nUsage: "Use the feature-impl formation to build search"\nEOF',
    description: 'Quick reference: V9 agent formations and team compositions',
    isBuiltIn: true,
  },
  {
    id: 'v9-tip-autonomy-ref',
    name: 'Autonomy Level Reference',
    category: 'v9-tips',
    command: 'cat <<EOF\nV9 Autonomy Levels:\n  A0 (start)         - Confirms everything\n  A1 (5 successes)   - Same-category repeats\n  A2 (10 successes)  - Files matching your grants\n  A3 (25 successes)  - All medium-risk\n  A4 (explicit)      - Everything except high-risk\nCommands: "Grant edit access to src/**" / "Slow down"\nEOF',
    description: 'Quick reference: V9 autonomy levels and escalation',
    isBuiltIn: true,
  },
  // --- Claude Code Model Configuration ---
  {
    id: 'cc-model-opus',
    name: 'Switch to Opus',
    category: 'cc-model',
    command: '/model opus',
    description: 'Switch to Opus 4.6 for complex reasoning tasks',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-sonnet',
    name: 'Switch to Sonnet',
    category: 'cc-model',
    command: '/model sonnet',
    description: 'Switch to Sonnet 4.5 for daily coding tasks',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-haiku',
    name: 'Switch to Haiku',
    category: 'cc-model',
    command: '/model haiku',
    description: 'Switch to Haiku 4.5 for fast, simple tasks',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-opusplan',
    name: 'Opus Plan Mode',
    category: 'cc-model',
    command: '/model opusplan',
    description: 'Opus for planning, Sonnet for execution (hybrid)',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-sonnet-1m',
    name: 'Sonnet 1M Context',
    category: 'cc-model',
    command: '/model sonnet[1m]',
    description: 'Sonnet with 1 million token context window for long sessions',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-effort-low',
    name: 'Effort: Low',
    category: 'cc-model',
    command: '/model opus\n# Then adjust effort slider to LOW\n# Or set: CLAUDE_CODE_EFFORT_LEVEL=low',
    description: 'Fast and cheap — straightforward tasks, less thinking',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-effort-high',
    name: 'Effort: High',
    category: 'cc-model',
    command: '/model opus\n# Then adjust effort slider to HIGH\n# Or set: CLAUDE_CODE_EFFORT_LEVEL=high',
    description: 'Deep reasoning — complex problems, max thinking (default)',
    isBuiltIn: true,
  },
  {
    id: 'cc-model-ref',
    name: 'Model Config Reference',
    category: 'cc-model',
    command: 'cat <<EOF\nClaude Code Model Configuration\n\nAliases:\n  default   - Opus 4.6 (Max/Teams/Pro)\n  opus      - Opus 4.6 (complex reasoning)\n  sonnet    - Sonnet 4.5 (daily coding)\n  haiku     - Haiku 4.5 (fast/simple)\n  opusplan  - Opus for plans, Sonnet for execution\n  sonnet[1m] - Sonnet with 1M token context\n\nEffort Levels (Opus 4.6):\n  low    - Fast, less thinking\n  medium - Balanced\n  high   - Deep reasoning (default)\n\nSwitch: /model <alias>  |  claude --model <alias>\nEnv:    ANTHROPIC_MODEL=<alias>\n        CLAUDE_CODE_EFFORT_LEVEL=low|medium|high\n\nSubagent model: CLAUDE_CODE_SUBAGENT_MODEL=<model>\nPin versions:   ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6\n                ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5-20250929\nEOF',
    description: 'Quick reference: all model aliases, effort levels, and env vars',
    isBuiltIn: true,
  },
  // --- Claude Meta-Prompts ---
  {
    id: 'claude-self-review',
    name: 'Self-Review Pattern',
    category: 'claude-meta',
    command: 'cat <<EOF\nReview your implementation:\n1. Security vulnerabilities?\n2. Edge cases missed?\n3. Test coverage gaps?\n4. Rate confidence 1-10\nEOF',
    description: 'Meta-prompt: Self-review after implementation',
    isBuiltIn: true,
  },
  {
    id: 'claude-assumptions',
    name: 'Assumptions Audit',
    category: 'claude-meta',
    command: 'cat <<EOF\nBefore implementing, list your assumptions:\n1. Technical assumptions\n2. Business logic assumptions\n3. Context assumptions\nFor each: confidence (1-10), how to verify, impact if wrong\nEOF',
    description: 'Meta-prompt: Audit assumptions before coding',
    isBuiltIn: true,
  },
  {
    id: 'claude-plan-feature',
    name: 'Feature Planning',
    category: 'claude-meta',
    command: 'cat <<EOF\nthink hard about implementing {{feature}}\nPhase 1: Understanding (what/why/success criteria)\nPhase 2: List 3 approaches (simple, robust, novel)\nPhase 3: Recommend approach with rationale\nPhase 4: Implementation plan with time estimates\nPresent plan BEFORE coding.\nEOF',
    description: 'Meta-prompt: Plan feature before implementation',
    variables: [{ name: 'feature', required: true, description: 'Feature to plan' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-root-cause',
    name: 'Root Cause Analysis',
    category: 'claude-meta',
    command: 'cat <<EOF\nI\'m seeing {{symptom}}. Find root cause:\n1. Gather evidence (errors, logs, timeline)\n2. Generate 5-10 hypotheses ranked by likelihood\n3. Test hypotheses systematically\n4. Propose fix with verification method\nEOF',
    description: 'Meta-prompt: Debug with systematic root cause analysis',
    variables: [{ name: 'symptom', required: true, description: 'Problem symptom' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-three-pass',
    name: 'Three-Pass Writing',
    category: 'claude-meta',
    command: 'cat <<EOF\nPass 1: Draft (30min, focus on functionality)\nPass 2: Self-Critique (10min, identify issues)\nPass 3: Refinement (20min, fix issues)\nFinal: Quality check (tests, readability, edge cases)\nEOF',
    description: 'Meta-prompt: Progressive refinement workflow',
    isBuiltIn: true,
  },
  {
    id: 'claude-confidence',
    name: 'Confidence Rating',
    category: 'claude-meta',
    command: 'cat <<EOF\nRate your confidence (1-10) on this implementation.\nIf <7: What\'s uncertain? What needs research? Alternatives?\nIf ≥7: Why confident? Biggest risk? What would you do differently?\nEOF',
    description: 'Meta-prompt: Rate confidence before presenting',
    isBuiltIn: true,
  },
  {
    id: 'claude-code-review',
    name: 'Code Review Checklist',
    category: 'claude-meta',
    command: 'cat <<EOF\nBefore submitting PR, rate 1-10:\n1. Readability (clear naming, single-purpose)\n2. Testability (pure functions, injectable deps)\n3. Error Handling (context, no silent failures)\n4. Security (input validation, no secrets)\n5. Performance (no N+1, proper caching)\nOverall confidence: __/10\nEOF',
    description: 'Meta-prompt: Self-review checklist before PR',
    isBuiltIn: true,
  },
  {
    id: 'claude-decision-matrix',
    name: 'Decision Matrix',
    category: 'claude-meta',
    command: 'cat <<EOF\nCompare {{option_a}} vs {{option_b}} vs {{option_c}}\nCreate weighted criteria matrix:\n- Performance, DX, Cost, Maintainability, Security\n- Score 1-10 for each option\n- Calculate weighted total\nRecommend with rationale and risks\nEOF',
    description: 'Meta-prompt: Data-driven decision making',
    variables: [
      { name: 'option_a', required: true, description: 'First option' },
      { name: 'option_b', required: true, description: 'Second option' },
      { name: 'option_c', default: '', description: 'Third option (optional)' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-pre-mortem',
    name: 'Pre-Mortem Analysis',
    category: 'claude-meta',
    command: 'cat <<EOF\nBefore implementing {{feature}}, assume it failed catastrophically.\nWhy did it fail? List 10 reasons.\nFor top 5:\n- Probability (L/M/H)\n- Impact (L/M/H)\n- Prevention (what can we do now?)\n- Detection (how will we know?)\n- Mitigation (how can we recover?)\nEOF',
    description: 'Meta-prompt: Identify failure modes before implementation',
    variables: [{ name: 'feature', required: true, description: 'Feature to analyze' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-prod-ready',
    name: 'Production Readiness',
    category: 'claude-meta',
    command: 'cat <<EOF\nIs {{feature}} production-ready? Score 1-10:\n- Functionality (0.25): Requirements met, edge cases\n- Reliability (0.25): Tests pass, handles failures\n- Performance (0.15): Meets SLAs, no leaks\n- Security (0.20): Input validation, auth/authz\n- Observability (0.15): Logging, metrics, alerts\nWeighted score ≥8.0 to ship\nEOF',
    description: 'Meta-prompt: Pre-deployment readiness check',
    variables: [{ name: 'feature', required: true, description: 'Feature to check' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-tdd',
    name: 'TDD Workflow',
    category: 'claude-meta',
    command: 'cat <<EOF\nBuild {{feature}} using TDD:\n1. Write failing tests (describe desired behavior)\n2. Confirm tests fail\n3. Write minimum code to pass\n4. Refactor while keeping tests green\n5. Add edge case tests, repeat\nShow all passes with explanations.\nEOF',
    description: 'Meta-prompt: Test-driven development workflow',
    variables: [{ name: 'feature', required: true, description: 'Feature to build' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-context-minimal',
    name: 'Minimal Context Query',
    category: 'claude-meta',
    command: 'cat <<EOF\n{{question}} - provide minimal context\nRules:\n1. Focus ONLY on answering the question\n2. Don\'t read entire codebase\n3. Don\'t suggest improvements unless asked\n4. Identify minimal info needed, read only those files, answer, stop\nEOF',
    description: 'Meta-prompt: Quick factual queries with minimal context',
    variables: [{ name: 'question', required: true, description: 'Specific question' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-progressive-context',
    name: 'Progressive Context Loading',
    category: 'claude-meta',
    command: 'cat <<EOF\nImplement {{feature}} with progressive context:\nPhase 1: High-level plan (no code reading)\nPhase 2: Targeted reading (minimal files)\nPhase 3: Implementation (focused changes)\nPhase 4: Validation (test only what changed)\nUse /clear between phases if needed\nEOF',
    description: 'Meta-prompt: Large codebases with minimal token usage',
    variables: [{ name: 'feature', required: true, description: 'Feature to implement' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-five-whys',
    name: 'Five Whys',
    category: 'claude-meta',
    command: 'cat <<EOF\nApply Five Whys to: {{problem}}\nWhy 1: Why did {{problem}} occur?\nWhy 2: Why did that happen?\nWhy 3: Why did that happen?\nWhy 4: Why did that happen?\nWhy 5: Why did that happen? (usually process/culture)\nRoot Cause: [Answer 5]\nSolutions: Immediate fix, prevent recurrence, systemic improvement\nEOF',
    description: 'Meta-prompt: Find systemic root causes',
    variables: [{ name: 'problem', required: true, description: 'Problem to analyze' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-performance-debug',
    name: 'Performance Investigation',
    category: 'claude-meta',
    command: 'cat <<EOF\n{{service}} is slow. Diagnose:\n1. Baseline metrics (response time, throughput, CPU, memory)\n2. Identify bottlenecks (profiler, slow operations, N+1 queries)\n3. List optimizations with impact/effort/risk\n4. Prioritize by ROI (high impact, low effort first)\nTarget: {{target_ms}}ms response time\nEOF',
    description: 'Meta-prompt: Systematic performance debugging',
    variables: [
      { name: 'service', required: true, description: 'Service name' },
      { name: 'target_ms', default: '100', description: 'Target response time (ms)' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-refactor-safety',
    name: 'Refactoring Safety Check',
    category: 'claude-meta',
    command: 'cat <<EOF\nI want to refactor {{code}}. Is this safe?\n1. Understand current behavior (purpose, callers, side effects)\n2. Test coverage (what exists, what\'s missing)\n3. Refactoring plan in 3 phases:\n   Phase 1: Add tests (no behavior change)\n   Phase 2: Refactor (tests passing)\n   Phase 3: Polish (optimize, cleanup)\n4. Risk assessment (blast radius, rollback plan)\nEOF',
    description: 'Meta-prompt: Safe refactoring workflow',
    variables: [{ name: 'code', required: true, description: 'Code to refactor' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-tech-eval',
    name: 'Technology Evaluation',
    category: 'claude-meta',
    command: 'cat <<EOF\nCompare {{tech_a}} vs {{tech_b}} for {{use_case}}\nCriteria (score 1-10):\n- Performance (benchmarks, latency)\n- Developer Experience (learning curve, docs)\n- Ecosystem (libraries, integrations)\n- Maturity (stability, LTS)\n- Cost (licensing, hosting, dev time)\n- Migration (effort to adopt/leave)\nDecision matrix with weighted scores\nRecommendation with rationale\nEOF',
    description: 'Meta-prompt: Evaluate technologies systematically',
    variables: [
      { name: 'tech_a', required: true, description: 'First technology' },
      { name: 'tech_b', required: true, description: 'Second technology' },
      { name: 'use_case', required: true, description: 'Use case' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-codebase-explore',
    name: 'Codebase Exploration',
    category: 'claude-meta',
    command: 'cat <<EOF\nI\'m new to {{codebase}}. Help me understand it:\n1. High-Level Overview (purpose, tech stack, architecture)\n2. Key Components (core logic, data layer, API, integrations)\n3. Code Patterns (conventions, design patterns, anti-patterns)\n4. Quick Wins (3 easy improvements with effort estimates)\nOutput: A mental map I can reference\nEOF',
    description: 'Meta-prompt: Systematic codebase onboarding',
    variables: [{ name: 'codebase', required: true, description: 'Codebase/project name' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-tech-deep-dive',
    name: 'Technology Deep Dive',
    category: 'claude-meta',
    command: 'cat <<EOF\nTeach me {{technology}} by building {{project}}:\n1. Explain: What is it and why does it exist?\n2. Compare: How does it differ from {{alternative}}?\n3. Build: Guide me through implementing a feature\n4. Review: Critique my code, suggest improvements\n5. Challenge: Give me a harder task to try solo\nFor each concept: ELI5 explanation, code example, common mistake, when to use\nEOF',
    description: 'Meta-prompt: Learn technology through practical building',
    variables: [
      { name: 'technology', required: true, description: 'Technology to learn' },
      { name: 'project', required: true, description: 'Small project idea' },
      { name: 'alternative', default: 'similar tech', description: 'Alternative to compare' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-design-patterns',
    name: 'Design Pattern Application',
    category: 'claude-meta',
    command: 'cat <<EOF\nExplain {{pattern}} in context of my codebase:\n1. Pattern Overview (problem, structure, UML)\n2. Real-World Example (where is it used in my code?)\n3. When to Use (good use cases, bad use cases, alternatives)\n4. Refactoring Exercise (find code that SHOULD use this pattern)\nOutput: Practice task requiring this pattern\nEOF',
    description: 'Meta-prompt: Learn and apply design patterns',
    variables: [{ name: 'pattern', required: true, description: 'Design pattern name' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-doc-driven-dev',
    name: 'Documentation-Driven Development',
    category: 'claude-meta',
    command: 'cat <<EOF\nBuild {{feature}} starting with documentation:\n1. Write README (as if feature exists: usage, options, returns, errors)\n2. Review Documentation (is it clear, complete, intuitive API?)\n3. Implement to Spec (build exactly what docs promise)\n4. Update Documentation (fix mismatches discovered)\nBenefit: Forces API design before implementation\nEOF',
    description: 'Meta-prompt: Design API through documentation first',
    variables: [{ name: 'feature', required: true, description: 'Feature to build' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-iterative-solving',
    name: 'Iterative Problem Solving',
    category: 'claude-meta',
    command: 'cat <<EOF\nSolve {{problem}} iteratively:\nIteration 1 (10min): Simplest solution (minimal code, obvious approach)\nIteration 2 (10min): Handle edge cases (null, boundaries, errors)\nIteration 3 (15min): Optimize (reduce complexity, cache, eliminate redundancy)\nIteration 4 (10min): Polish (better naming, comments, extract helpers)\nPresent all 4 iterations with rationale for each change\nEOF',
    description: 'Meta-prompt: Progressive problem solving workflow',
    variables: [{ name: 'problem', required: true, description: 'Problem to solve' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-hypothesis-testing',
    name: 'Hypothesis Testing Framework',
    category: 'claude-meta',
    command: 'cat <<EOF\nDebug {{issue}} using scientific method:\n1. Observe: Collect symptoms, logs, metrics, timeline\n2. Hypothesize: Generate 5-10 possible causes (rank by likelihood)\n3. Predict: For each hypothesis, what evidence would prove/disprove it?\n4. Test: Design minimal experiments to test top 3 hypotheses\n5. Conclude: Which hypothesis is supported? What\'s the fix?\nDocument: What we learned, how to prevent recurrence\nEOF',
    description: 'Meta-prompt: Scientific debugging methodology',
    variables: [{ name: 'issue', required: true, description: 'Issue to debug' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-deployment-risk',
    name: 'Deployment Risk Assessment',
    category: 'claude-meta',
    command: 'cat <<EOF\nAssess deployment risk for {{change}}:\nChange Characteristics: LOC changed, files modified, services affected\nRisk Factors (1-10):\n- Blast radius (users affected if fails)\n- Complexity (how complex is change)\n- Test coverage (10=100%, 1=no tests)\n- Rollback ease (10=instant, 1=data loss)\n- Team familiarity (10=weekly, 1=first time)\nStrategy: LOW (<3.0) = business hours | MEDIUM (3-6) = low-traffic + feature flag | HIGH (>6) = staged rollout + war room\nEOF',
    description: 'Meta-prompt: Calculate deployment risk and strategy',
    variables: [{ name: 'change', required: true, description: 'Change being deployed' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-post-deploy',
    name: 'Post-Deployment Validation',
    category: 'claude-meta',
    command: 'cat <<EOF\nValidate {{deployment}}:\nT+2min: Smoke tests (service started, health 200, no crashes, critical endpoints)\nT+15min: Metrics (error rate vs baseline, latency p95, throughput, resources)\nT+1hr: Deep validation (no new errors, user features work, background jobs, DB queries)\nT+24hr: Success criteria (no rollbacks, error ≤ baseline, performance ≥ baseline, no complaints)\nDecision: ✅ Success | ⚠️ Monitor (issues: list) | ❌ Rollback (reason: why)\nEOF',
    description: 'Meta-prompt: Systematic post-deployment validation',
    variables: [{ name: 'deployment', required: true, description: 'What was deployed' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-tech-debt',
    name: 'Technical Debt Evaluation',
    category: 'claude-meta',
    command: 'cat <<EOF\nEvaluate technical debt in {{module}}:\nDebt Inventory (for each item: description, why it exists, impact, effort, risk)\nPrioritization Matrix:\n| Item | Impact | Effort | Risk | Priority |\nRecommendation:\n- Fix now (P0 items)\n- Next sprint (P1 items)\n- Backlog (P2 items)\n- Accept debt (P3 - explain why)\nPreventive Measures: What pattern caused this? How to prevent similar debt?\nEOF',
    description: 'Meta-prompt: Prioritize technical debt systematically',
    variables: [{ name: 'module', required: true, description: 'Module to evaluate' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-api-review',
    name: 'API Design Review',
    category: 'claude-meta',
    command: 'cat <<EOF\nReview API design for {{api}}:\n1. Consistency (naming, error handling, response format)\n2. Usability (intuitive, discoverable, good defaults)\n3. Documentation (examples, edge cases, common mistakes)\n4. Security (authentication, rate limits, input validation)\n5. Performance (pagination, caching, N+1 prevention)\nScore each 1-10. Overall ≥8 to approve.\nEOF',
    description: 'Meta-prompt: Comprehensive API design checklist',
    variables: [{ name: 'api', required: true, description: 'API to review' }],
    isBuiltIn: true,
  },
];

export function templateRoutes(store: SessionStore): Router {
  const router = Router();

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const userTemplates = store.getTemplates(req.user.email);
    const hiddenIds = new Set(store.getHiddenTemplateIds(req.user.email));

    res.json({
      data: {
        builtIn: BUILT_IN_TEMPLATES.filter(t => !hiddenIds.has(t.id)),
        hidden: BUILT_IN_TEMPLATES.filter(t => hiddenIds.has(t.id)).map(t => ({ id: t.id, name: t.name, category: t.category })),
        custom: userTemplates.map(t => ({
          id: t.id,
          name: t.name,
          category: t.category,
          command: t.command,
          description: t.description,
          variables: JSON.parse(t.variables || '[]'),
          isBuiltIn: false,
          createdAt: new Date(t.created_at).toISOString(),
        })),
      },
    });
  });

  router.get('/categories', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const builtInCategories = [...new Set(BUILT_IN_TEMPLATES.map(t => t.category))];
    const userTemplates = store.getTemplates(req.user.email);
    const userCategories = [...new Set(userTemplates.map(t => t.category))];
    const allCategories = [...new Set([...builtInCategories, ...userCategories])];

    res.json({
      data: allCategories.sort(),
    });
  });

  router.post('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { name, category, command, description, variables } = req.body || {};

    if (!name || !command) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'name and command are required' }
      });
    }

    const existingTemplates = store.getTemplates(req.user.email);
    if (existingTemplates.length >= 100) {
      return res.status(400).json({
        error: { code: 'MAX_TEMPLATES', message: 'Maximum 100 custom templates' }
      });
    }

    const template = store.createTemplate({
      id: randomUUID(),
      user_email: req.user.email,
      name,
      category: category || 'custom',
      command,
      description: description || '',
      variables: JSON.stringify(variables || []),
    });

    res.status(201).json({
      data: {
        id: template.id,
        name: template.name,
        category: template.category,
        command: template.command,
        description: template.description,
        variables: JSON.parse(template.variables || '[]'),
        isBuiltIn: false,
        createdAt: new Date(template.created_at).toISOString(),
      },
    });
  });

  router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const template = store.getTemplate(req.params.id, req.user.email);
    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    const { name, category, command, description, variables } = req.body || {};

    store.updateTemplate(req.params.id, req.user.email, {
      name: name ?? template.name,
      category: category ?? template.category,
      command: command ?? template.command,
      description: description ?? template.description,
      variables: variables ? JSON.stringify(variables) : template.variables,
    });

    const updated = store.getTemplate(req.params.id, req.user.email);

    res.json({
      data: {
        id: updated!.id,
        name: updated!.name,
        category: updated!.category,
        command: updated!.command,
        description: updated!.description,
        variables: JSON.parse(updated!.variables || '[]'),
        isBuiltIn: false,
      },
    });
  });

  router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const template = store.getTemplate(req.params.id, req.user.email);
    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    store.deleteTemplate(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  // --- Group Management ---

  router.get('/groups', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const builtInGroups = new Map<string, number>();
    for (const t of BUILT_IN_TEMPLATES) {
      builtInGroups.set(t.category, (builtInGroups.get(t.category) || 0) + 1);
    }

    const userGroups = store.getTemplateCategories(req.user.email);
    const groups: { name: string; count: number; isBuiltIn: boolean }[] = [];

    for (const [name, count] of builtInGroups) {
      const userCount = userGroups.find(g => g.category === name)?.count || 0;
      groups.push({ name, count: count + userCount, isBuiltIn: true });
    }

    for (const g of userGroups) {
      if (!builtInGroups.has(g.category)) {
        groups.push({ name: g.category, count: g.count, isBuiltIn: false });
      }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: groups });
  });

  router.put('/groups/:name', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const oldName = req.params.name;
    const { newName } = req.body || {};

    if (!newName || typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'newName is required' } });
    }

    const builtInCategories = new Set(BUILT_IN_TEMPLATES.map(t => t.category));
    if (builtInCategories.has(oldName)) {
      return res.status(400).json({ error: { code: 'CANNOT_RENAME_BUILTIN', message: 'Cannot rename built-in categories' } });
    }

    const changed = store.renameTemplateCategory(req.user.email, oldName, newName.trim());
    res.json({ data: { changed, oldName, newName: newName.trim() } });
  });

  router.delete('/groups/:name', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const category = req.params.name;
    const { action } = req.query;

    const builtInCategories = new Set(BUILT_IN_TEMPLATES.map(t => t.category));
    if (builtInCategories.has(category)) {
      return res.status(400).json({ error: { code: 'CANNOT_DELETE_BUILTIN', message: 'Cannot delete built-in categories' } });
    }

    if (action === 'move') {
      const changed = store.renameTemplateCategory(req.user.email, category, 'custom');
      return res.json({ data: { action: 'moved', changed } });
    }

    const deleted = store.deleteTemplatesByCategory(req.user.email, category);
    res.json({ data: { action: 'deleted', deleted } });
  });

  // --- Batch Operations ---

  router.post('/batch-delete', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateIds } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }

    const deleted = store.deleteTemplates(req.user.email, templateIds);
    res.json({ data: { deleted } });
  });

  router.post('/batch-move', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateIds, category } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'category is required' } });
    }

    const moved = store.moveTemplatesToCategory(req.user.email, templateIds, category);
    res.json({ data: { moved, category } });
  });

  // --- Hide/Unhide Built-in Templates ---

  router.post('/hide/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    store.hideTemplate(req.user.email, req.params.id);
    res.json({ data: { hidden: true, templateId: req.params.id } });
  });

  router.post('/unhide/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    store.unhideTemplate(req.user.email, req.params.id);
    res.json({ data: { hidden: false, templateId: req.params.id } });
  });

  router.post('/batch-hide', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    const { templateIds } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }
    let count = 0;
    for (const id of templateIds) {
      if (typeof id === 'string') {
        store.hideTemplate(req.user.email, id);
        count++;
      }
    }
    res.json({ data: { hidden: count } });
  });

  router.post('/unhide-all', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    const count = store.unhideAllTemplates(req.user.email);
    res.json({ data: { restored: count } });
  });

  router.post('/execute', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateId, variables } = req.body || {};

    if (!templateId) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'templateId is required' }
      });
    }

    let template = BUILT_IN_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      const userTemplate = store.getTemplate(templateId, req.user.email);
      if (userTemplate) {
        template = {
          id: userTemplate.id,
          name: userTemplate.name,
          category: userTemplate.category,
          command: userTemplate.command,
          description: userTemplate.description || '',
          variables: JSON.parse(userTemplate.variables || '[]'),
          isBuiltIn: false,
        };
      }
    }

    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    let command = template.command;
    const templateVars = template.variables || [];

    for (const varDef of templateVars) {
      const value = variables?.[varDef.name] ?? varDef.default;
      if (varDef.required && !value) {
        return res.status(400).json({
          error: { code: 'MISSING_VARIABLE', message: `Variable '${varDef.name}' is required` }
        });
      }
      command = command.replace(new RegExp(`{{${varDef.name}}}`, 'g'), value || '');
    }

    res.json({
      data: {
        command,
        templateId: template.id,
        templateName: template.name,
      },
    });
  });

  return router;
}

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SessionStore } from '../session/SessionStore.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

export const BUILT_IN_TEMPLATES = [
  {
    id: 'git-status',
    name: 'Git Status',
    category: 'git',
    command: 'git status',
    description: 'Show working tree status',
    isBuiltIn: true,
  },
  {
    id: 'git-pull',
    name: 'Git Pull',
    category: 'git',
    command: 'git pull origin {{branch}}',
    description: 'Pull changes from remote',
    variables: [{ name: 'branch', default: 'main', description: 'Branch name' }],
    isBuiltIn: true,
  },
  {
    id: 'git-commit',
    name: 'Git Commit',
    category: 'git',
    command: 'git add -A && git commit -m "{{message}}"',
    description: 'Stage all and commit',
    variables: [{ name: 'message', required: true, description: 'Commit message' }],
    isBuiltIn: true,
  },
  {
    id: 'git-diff',
    name: 'Git Diff',
    category: 'git',
    command: 'git diff',
    description: 'Show unstaged changes',
    isBuiltIn: true,
  },
  {
    id: 'git-log',
    name: 'Git Log',
    category: 'git',
    command: 'git log --oneline -{{count}}',
    description: 'Show recent commits',
    variables: [{ name: 'count', default: '10', description: 'Number of commits' }],
    isBuiltIn: true,
  },
  {
    id: 'git-branch',
    name: 'Git Branch',
    category: 'git',
    command: 'git branch -a',
    description: 'List all branches',
    isBuiltIn: true,
  },
  {
    id: 'git-checkout',
    name: 'Git Checkout',
    category: 'git',
    command: 'git checkout {{branch}}',
    description: 'Switch branches',
    variables: [{ name: 'branch', required: true, description: 'Branch name' }],
    isBuiltIn: true,
  },
  {
    id: 'docker-ps',
    name: 'Docker List',
    category: 'docker',
    command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    description: 'List running containers',
    isBuiltIn: true,
  },
  {
    id: 'docker-logs',
    name: 'Docker Logs',
    category: 'docker',
    command: 'docker logs {{container}} --tail {{lines}}',
    description: 'View container logs',
    variables: [
      { name: 'container', required: true, description: 'Container name' },
      { name: 'lines', default: '100', description: 'Number of lines' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'docker-restart',
    name: 'Docker Restart',
    category: 'docker',
    command: 'docker restart {{container}}',
    description: 'Restart a container',
    variables: [{ name: 'container', required: true, description: 'Container name' }],
    isBuiltIn: true,
  },
  {
    id: 'docker-exec',
    name: 'Docker Exec',
    category: 'docker',
    command: 'docker exec -it {{container}} {{command}}',
    description: 'Execute command in container',
    variables: [
      { name: 'container', required: true, description: 'Container name' },
      { name: 'command', default: '/bin/sh', description: 'Command to run' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'docker-compose-up',
    name: 'Docker Compose Up',
    category: 'docker',
    command: 'docker-compose up -d',
    description: 'Start services in background',
    isBuiltIn: true,
  },
  {
    id: 'docker-compose-down',
    name: 'Docker Compose Down',
    category: 'docker',
    command: 'docker-compose down',
    description: 'Stop services',
    isBuiltIn: true,
  },
  {
    id: 'npm-install',
    name: 'NPM Install',
    category: 'npm',
    command: 'npm install',
    description: 'Install dependencies',
    isBuiltIn: true,
  },
  {
    id: 'npm-dev',
    name: 'NPM Dev',
    category: 'npm',
    command: 'npm run dev',
    description: 'Start development server',
    isBuiltIn: true,
  },
  {
    id: 'npm-build',
    name: 'NPM Build',
    category: 'npm',
    command: 'npm run build',
    description: 'Build for production',
    isBuiltIn: true,
  },
  {
    id: 'npm-test',
    name: 'NPM Test',
    category: 'npm',
    command: 'npm test',
    description: 'Run test suite',
    isBuiltIn: true,
  },
  {
    id: 'npm-add',
    name: 'NPM Add Package',
    category: 'npm',
    command: 'npm install {{package}}',
    description: 'Add a dependency',
    variables: [{ name: 'package', required: true, description: 'Package name' }],
    isBuiltIn: true,
  },
  {
    id: 'find-port',
    name: 'Find Port',
    category: 'system',
    command: 'lsof -i :{{port}}',
    description: 'Find process using port',
    variables: [{ name: 'port', required: true, description: 'Port number' }],
    isBuiltIn: true,
  },
  {
    id: 'kill-port',
    name: 'Kill Port',
    category: 'system',
    command: 'kill -9 $(lsof -ti :{{port}})',
    description: 'Kill process on port',
    variables: [{ name: 'port', required: true, description: 'Port number' }],
    isBuiltIn: true,
  },
  {
    id: 'disk-usage',
    name: 'Disk Usage',
    category: 'system',
    command: 'df -h',
    description: 'Show disk usage',
    isBuiltIn: true,
  },
  {
    id: 'memory-usage',
    name: 'Memory Usage',
    category: 'system',
    command: 'free -h',
    description: 'Show memory usage',
    isBuiltIn: true,
  },
  {
    id: 'top-processes',
    name: 'Top Processes',
    category: 'system',
    command: 'ps aux --sort=-%mem | head -{{count}}',
    description: 'Top processes by memory',
    variables: [{ name: 'count', default: '10', description: 'Number of processes' }],
    isBuiltIn: true,
  },
  {
    id: 'watch-logs',
    name: 'Watch Logs',
    category: 'system',
    command: 'tail -f {{file}}',
    description: 'Follow log file',
    variables: [{ name: 'file', required: true, description: 'Log file path' }],
    isBuiltIn: true,
  },
  {
    id: 'find-files',
    name: 'Find Files',
    category: 'system',
    command: 'find . -name "{{pattern}}" -type f',
    description: 'Find files by pattern',
    variables: [{ name: 'pattern', required: true, description: 'File pattern (e.g., *.ts)' }],
    isBuiltIn: true,
  },
  {
    id: 'grep-search',
    name: 'Search in Files',
    category: 'system',
    command: 'grep -rn "{{pattern}}" {{path}}',
    description: 'Search for pattern in files',
    variables: [
      { name: 'pattern', required: true, description: 'Search pattern' },
      { name: 'path', default: '.', description: 'Search path' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'ssh-connect',
    name: 'SSH Connect',
    category: 'ssh',
    command: 'ssh {{user}}@{{host}}',
    description: 'SSH to remote host',
    variables: [
      { name: 'user', default: 'hercules', description: 'SSH user' },
      { name: 'host', required: true, description: 'Remote host' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    category: 'claude',
    command: 'claude',
    description: 'Start Claude Code CLI',
    isBuiltIn: true,
  },
  {
    id: 'claude-resume',
    name: 'Claude Resume',
    category: 'claude',
    command: 'claude --resume',
    description: 'Resume previous Claude session',
    isBuiltIn: true,
  },
  {
    id: 'claude-project',
    name: 'Claude in Project',
    category: 'claude',
    command: 'cd {{path}} && claude',
    description: 'Start Claude in project directory',
    variables: [{ name: 'path', required: true, description: 'Project path' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-think',
    name: 'Extended Thinking',
    category: 'claude',
    command: 'echo "think {{mode}} about {{topic}}" | claude',
    description: 'Use extended thinking (think/hard/harder/ultra)',
    variables: [
      { name: 'mode', default: '', description: 'Thinking mode (blank/hard/harder/ultrathink)' },
      { name: 'topic', required: true, description: 'What to think about' },
    ],
    isBuiltIn: true,
  },
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
  {
    id: 'claude-create-hook',
    name: 'Hooks Creation Wizard',
    category: 'claude-automation',
    command: 'cat <<EOF\nCreate hook for {{trigger}} event:\n1. Hook Type: {{hook_type}} (PreToolUse, PostToolUse, Stop, Notification)\n2. Matcher: What tools/events trigger this? (e.g., "Edit|Write")\n3. Action: What command to run? (with {file}, {tool}, {message} variables)\n4. Error Handling: Should failures block Claude? (true/false)\n5. Testing: Test command manually, then add to config\nOutput: JSON config for ~/.claude/hooks/config.json\nValidation: Show example trigger scenario\nEOF',
    description: 'Meta-prompt: Create and test Claude Code hooks',
    variables: [
      { name: 'trigger', required: true, description: 'When should hook run? (e.g., "after editing files")' },
      { name: 'hook_type', default: 'PostToolUse', description: 'Hook type (PreToolUse, PostToolUse, Stop)' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-mcp-setup',
    name: 'MCP Server Configuration',
    category: 'claude-automation',
    command: 'cat <<EOF\nSet up MCP server for {{service}}:\n1. Install: npm install -g @modelcontextprotocol/server-{{service}}\n2. Configure: Add to ~/.claude/mcp.json or .claude/mcp.json\n3. Scope: User-level or project-level?\n4. Permissions: What scopes needed? (read, write, admin)\n5. Test: Verify server accessible with mcp__{{service}}__* tools\n6. Usage Example: Show 3 common operations\nOutput: Complete mcp.json config + usage examples\nEOF',
    description: 'Meta-prompt: Configure MCP server integration',
    variables: [{ name: 'service', required: true, description: 'Service name (github, database, browser, etc.)' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-generate-config',
    name: 'CLAUDE.md Generator',
    category: 'claude-automation',
    command: 'cat <<EOF\nGenerate CLAUDE.md for {{project}}:\n1. Project Type: {{project_type}} (web app, library, microservice, CLI tool)\n2. Tech Stack: Detect from package.json, requirements.txt, go.mod\n3. Essential Sections:\n   - Commands (dev, test, build, lint, typecheck)\n   - Architecture (components, data flow, key patterns)\n   - Quality Gates (DoD checklist)\n   - Anti-Patterns (what NOT to do)\n4. Template Level: minimal (10 lines), standard (50 lines), comprehensive (150 lines)\n5. Output: Complete CLAUDE.md ready to save\nInclude: thinking directives, cost optimization, progressive disclosure\nEOF',
    description: 'Meta-prompt: Generate project-specific CLAUDE.md',
    variables: [
      { name: 'project', required: true, description: 'Project name/path' },
      { name: 'project_type', default: 'web app', description: 'Project type' },
    ],
    isBuiltIn: true,
  },
  {
    id: 'claude-session-resume',
    name: 'Session Continuation Briefing',
    category: 'claude-session',
    command: 'cat <<EOF\nResume work on {{task}}:\n1. Last Session Recap:\n   - What was accomplished?\n   - What was the next planned step?\n   - What blockers existed?\n2. Current State Verification:\n   - What files changed since last session?\n   - What tests pass/fail?\n   - What\'s deployed?\n3. Context Bridge:\n   - What happened since last session? (git log, changelog)\n   - What context is now outdated?\n   - What new information exists?\n4. Re-establish Direction:\n   - What\'s still relevant?\n   - What needs updating?\n   - What\'s the immediate next action?\nOutput: Refreshed context + clear next step\nEOF',
    description: 'Meta-prompt: Resume multi-session work efficiently',
    variables: [{ name: 'task', required: true, description: 'Task being resumed' }],
    isBuiltIn: true,
  },
  {
    id: 'claude-cost-audit',
    name: 'Token Cost Audit',
    category: 'claude-session',
    command: 'cat <<EOF\nAudit session for cost optimization:\n1. Current Usage:\n   - Run !tokens and !cost commands\n   - Identify top token consumers (files read, context carried)\n2. Inefficiencies:\n   - Are you re-reading same files?\n   - Is context from previous tasks still loaded?\n   - Are you using wrong model tier? (Opus when Sonnet sufficient)\n3. Optimization Opportunities:\n   - Where can you use /clear?\n   - Which operations could use minimal context?\n   - What could be progressive disclosure?\n4. Recommendations:\n   - Immediate fixes (use /clear now)\n   - CLAUDE.md improvements\n   - Workflow changes\nGoal: Reduce costs by {{target}}%\nEOF',
    description: 'Meta-prompt: Analyze and reduce token costs',
    variables: [{ name: 'target', default: '50', description: 'Target cost reduction %' }],
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
    
    res.json({
      data: {
        builtIn: BUILT_IN_TEMPLATES,
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

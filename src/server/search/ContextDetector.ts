import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SearchContext, GitContext, DockerContext, NodeContext } from './types.js';

export class ContextDetector {
  async detectContext(workingDirectory: string): Promise<SearchContext> {
    const context: SearchContext = {
      workingDirectory,
    };

    const [gitContext, dockerContext, nodeContext] = await Promise.all([
      this.detectGitContext(workingDirectory),
      this.detectDockerContext(workingDirectory),
      this.detectNodeContext(workingDirectory),
    ]);

    context.gitContext = gitContext;
    context.dockerContext = dockerContext;
    context.nodeContext = nodeContext;

    return context;
  }

  private async detectGitContext(dir: string): Promise<GitContext> {
    const gitDir = join(dir, '.git');
    const isGitRepo = existsSync(gitDir);

    if (!isGitRepo) {
      return { isGitRepo: false };
    }

    const context: GitContext = {
      isGitRepo: true,
    };

    try {
      const headFile = join(gitDir, 'HEAD');
      if (existsSync(headFile)) {
        const headContent = readFileSync(headFile, 'utf-8').trim();
        const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
        if (branchMatch) {
          context.branch = branchMatch[1];
        }
      }

      const configFile = join(gitDir, 'config');
      if (existsSync(configFile)) {
        const configContent = readFileSync(configFile, 'utf-8');
        const remotes = configContent.match(/\[remote "([^"]+)"\]/g);
        if (remotes) {
          context.remotes = remotes.map(r => r.match(/\[remote "([^"]+)"\]/)![1]);
        }
      }
    } catch {
    }

    return context;
  }

  private async detectDockerContext(dir: string): Promise<DockerContext> {
    const composeFiles = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
      'docker-compose.dev.yml',
      'docker-compose.prod.yml',
    ];

    const hasDockerCompose = composeFiles.some(file => existsSync(join(dir, file)));
    const hasDockerfile = existsSync(join(dir, 'Dockerfile'));

    return {
      hasDockerCompose: hasDockerCompose || hasDockerfile,
    };
  }

  private async detectNodeContext(dir: string): Promise<NodeContext> {
    const packageJsonPath = join(dir, 'package.json');
    const hasPackageJson = existsSync(packageJsonPath);

    if (!hasPackageJson) {
      return { hasPackageJson: false };
    }

    const context: NodeContext = {
      hasPackageJson: true,
      scripts: [],
    };

    try {
      const packageContent = readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.scripts) {
        context.scripts = Object.keys(packageJson.scripts);
      }
    } catch {
    }

    return context;
  }
}

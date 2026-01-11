import type { LightningPath } from './lightning-paths';

interface LightningBoltProps {
  path: LightningPath;
  layer: 'glow' | 'core' | 'branch';
  className?: string;
}

export function LightningBolt({ path, layer, className = '' }: LightningBoltProps) {
  const getStrokeWidth = () => {
    switch (layer) {
      case 'glow':
        return path.strokeWidth.main * 3;
      case 'core':
        return path.strokeWidth.main;
      case 'branch':
        return path.strokeWidth.branch;
    }
  };

  const getStrokeClass = () => {
    switch (layer) {
      case 'glow':
        return 'lightning-stroke-glow';
      case 'core':
        return 'lightning-stroke-core';
      case 'branch':
        return 'lightning-stroke-branch';
    }
  };

  return (
    <g className={className}>
      <path
        d={path.main}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={getStrokeWidth()}
        className={getStrokeClass()}
      />
      {layer !== 'glow' && path.branches.map((branch, i) => (
        <path
          key={`${path.id}-branch-${i}`}
          d={branch}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={path.strokeWidth.branch}
          className="lightning-stroke-branch"
        />
      ))}
    </g>
  );
}

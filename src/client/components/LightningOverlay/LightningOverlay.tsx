import { LightningCanvas } from './LightningCanvas';
import '../../styles/lightning.css';

export interface LightningOverlayProps {
  intensity?: number;
  disabled?: boolean;
}

export function LightningOverlay({
  intensity = 0.5,
  disabled = false,
}: LightningOverlayProps) {
  if (disabled) return null;

  return (
    <div className="lightning-overlay" aria-hidden="true">
      <LightningCanvas intensity={intensity} />
    </div>
  );
}

import { useEffect, useRef, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface Segment {
  points: Point[];
  startWidth: number;
  endWidth: number;
  brightness: number;
  isMain?: boolean;
}

interface LightningBolt {
  segments: Segment[];
  alpha: number;
  maxAlpha: number;
  fadeSpeed: number;
  birthTime: number;
  flickerPhase: number;
  flickerSpeed: number;
  intensity: number;
}

interface StormCell {
  x: number;
  drift: number;
  activity: number;
  nextBurst: number;
  burstRemaining: number;
}

interface CloudBlob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface Cloud {
  x: number;
  y: number;
  width: number;
  blobs: CloudBlob[];
  alpha: number;
  targetAlpha: number;
}

interface Props {
  intensity?: number;
  disabled?: boolean;
}

const BASE_ROUGHNESS = 0.55;

function jitter(value: number, amount: number): number {
  return value + (Math.random() - 0.5) * amount;
}

function generateBoltPath(
  x1: number, y1: number,
  x2: number, y2: number,
  displacement: number,
  minSegment: number,
  roughnessDecay: number = 0
): Point[] {
  const points: Point[] = [{ x: x1, y: y1 }];
  const totalDist = Math.hypot(x2 - x1, y2 - y1);
  
  function subdivide(
    ax: number, ay: number,
    bx: number, by: number,
    disp: number,
    depth: number
  ): void {
    const dist = Math.hypot(bx - ax, by - ay);
    if (dist < minSegment || disp < 0.8) {
      points.push({ x: bx, y: by });
      return;
    }
    
    const progress = 1 - (Math.hypot(bx - x1, by - y1) / totalDist);
    const localRoughness = BASE_ROUGHNESS + roughnessDecay * progress;
    
    const dx = bx - ax;
    const dy = by - ay;
    const perpX = -dy;
    const perpY = dx;
    const len = Math.hypot(perpX, perpY) || 1;
    
    const downwardBias = 0.1;
    const offset = (Math.random() - 0.5 + downwardBias) * disp;
    const midX = (ax + bx) / 2 + (perpX / len) * offset;
    const midY = (ay + by) / 2 + (perpY / len) * offset * 0.65;
    
    const newDisp = disp * Math.pow(0.5, localRoughness);
    subdivide(ax, ay, midX, midY, newDisp, depth + 1);
    subdivide(midX, midY, bx, by, newDisp, depth + 1);
  }
  
  subdivide(x1, y1, x2, y2, displacement || totalDist * 0.4, 0);
  return points;
}

function createBolt(w: number, h: number, cellX?: number, isDistant?: boolean): LightningBolt {
  const segments: Segment[] = [];
  const margin = 4;
  
  const intensityMod = isDistant ? 0.4 + Math.random() * 0.2 : 0.85 + Math.random() * 0.15;
  const widthMod = isDistant ? 0.5 : 1.0;
  
  let startX: number;
  if (cellX !== undefined) {
    startX = cellX + (Math.random() - 0.5) * w * 0.15;
    startX = Math.max(margin, Math.min(w - margin, startX));
  } else {
    startX = margin + Math.random() * (w - margin * 2);
  }
  const startY = margin;
  const endX = jitter(startX, w * (isDistant ? 0.15 : 0.3));
  const endY = h - margin;
  
  const mainPath = generateBoltPath(startX, startY, endX, endY, Math.min(w, h) * 0.45, 2.5, 0.15);
  
  segments.push({
    points: mainPath,
    startWidth: 1.5 * widthMod,
    endWidth: 0.7 * widthMod,
    brightness: 1.0,
    isMain: true,
  });
  
  const branchCount = 4 + Math.floor(Math.random() * 4);
  const branchPoints: Point[] = [];
  
  for (let b = 0; b < branchCount; b++) {
    const rawT = Math.random();
    const t = 0.1 + Math.pow(rawT, 1.5) * 0.75;
    const idx = Math.floor(t * (mainPath.length - 1));
    const origin = mainPath[idx];
    if (!origin) continue;
    
    const nextPt = mainPath[idx + 1] || mainPath[idx];
    const mainAngle = Math.atan2(nextPt.y - origin.y, nextPt.x - origin.x);
    
    const side = Math.random() > 0.5 ? 1 : -1;
    const branchAngle = mainAngle + side * (0.25 + Math.random() * 0.35);
    
    branchPoints.push(origin);
    
    const remainingDist = Math.hypot(endX - origin.x, endY - origin.y);
    const branchLen = remainingDist * (0.2 + Math.random() * 0.3);
    
    const branchEndX = origin.x + Math.cos(branchAngle) * branchLen;
    const branchEndY = origin.y + Math.sin(branchAngle) * branchLen;
    
    const clampedEndX = Math.max(margin, Math.min(w - margin, branchEndX));
    const clampedEndY = Math.max(margin, Math.min(h - margin, branchEndY));
    
    const branchPath = generateBoltPath(
      origin.x, origin.y,
      clampedEndX, clampedEndY,
      branchLen * 0.35,
      2,
      0.1
    );
    
    const depthFade = 1 - t * 0.3;
    const branchWidth = 0.9 * depthFade * widthMod;
    segments.push({
      points: branchPath,
      startWidth: branchWidth,
      endWidth: branchWidth * 0.5,
      brightness: 0.75 * depthFade,
    });
    
    if (Math.random() > 0.5 && branchPath.length > 3) {
      const subT = 0.3 + Math.random() * 0.4;
      const subIdx = Math.floor(subT * (branchPath.length - 1));
      const subOrigin = branchPath[subIdx];
      if (subOrigin) {
        const subAngle = branchAngle + (Math.random() - 0.5) * 0.8;
        const subLen = branchLen * 0.3;
        const subEndX = Math.max(margin, Math.min(w - margin, subOrigin.x + Math.cos(subAngle) * subLen));
        const subEndY = Math.max(margin, Math.min(h - margin, subOrigin.y + Math.sin(subAngle) * subLen));
        
        const subPath = generateBoltPath(subOrigin.x, subOrigin.y, subEndX, subEndY, subLen * 0.3, 2, 0.05);
        const subWidth = 0.55 * depthFade * widthMod;
        segments.push({
          points: subPath,
          startWidth: subWidth,
          endWidth: subWidth * 0.4,
          brightness: 0.55 * depthFade,
        });
      }
    }
  }
  
  return {
    segments,
    alpha: 0,
    maxAlpha: (0.75 + Math.random() * 0.25) * intensityMod,
    fadeSpeed: isDistant ? 0.03 + Math.random() * 0.02 : 0.018 + Math.random() * 0.012,
    birthTime: performance.now(),
    flickerPhase: Math.random() * Math.PI * 2,
    flickerSpeed: 15 + Math.random() * 10,
    intensity: intensityMod,
  };
}

function createStormCell(w: number): StormCell {
  return {
    x: Math.random() * w,
    drift: (Math.random() - 0.5) * 0.02,
    activity: 0.5 + Math.random() * 0.5,
    nextBurst: performance.now() + 1000 + Math.random() * 3000,
    burstRemaining: 0,
  };
}

function createCloud(x: number, y: number, w: number, h: number): Cloud {
  const width = w * (0.04 + Math.random() * 0.04);
  const blobCount = 3 + Math.floor(Math.random() * 2);
  const blobs: CloudBlob[] = [];
  
  for (let i = 0; i < blobCount; i++) {
    const t = i / Math.max(1, blobCount - 1);
    const cx = x - width / 2 + t * width + (Math.random() - 0.5) * width * 0.4;
    const cy = y + (Math.random() - 0.5) * h * 0.1;
    const rx = width * (0.25 + Math.random() * 0.15);
    const ry = h * (0.08 + Math.random() * 0.06);
    blobs.push({ cx, cy, rx, ry });
  }
  
  return { x, y, width, blobs, alpha: 0, targetAlpha: 0 };
}

function createClouds(w: number, h: number): Cloud[] {
  const count = 6 + Math.floor(Math.random() * 4);
  const clouds: Cloud[] = [];
  
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = h * (0.15 + Math.random() * 0.35);
    clouds.push(createCloud(x, y, w, h));
  }
  
  return clouds;
}

function drawClouds(ctx: CanvasRenderingContext2D, clouds: Cloud[]): void {
  for (const cloud of clouds) {
    if (cloud.alpha < 0.01) continue;
    
    ctx.save();
    ctx.globalAlpha = cloud.alpha * 0.35;
    ctx.fillStyle = '#1e1e2e';
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 8;
    
    for (const blob of cloud.blobs) {
      ctx.beginPath();
      ctx.ellipse(blob.cx, blob.cy, blob.rx, blob.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

function updateCloudIllumination(clouds: Cloud[], bolts: LightningBolt[]): void {
  for (const cloud of clouds) {
    let maxIllumination = 0;
    
    for (const bolt of bolts) {
      if (bolt.alpha < 0.1) continue;
      
      const mainSeg = bolt.segments[0];
      if (!mainSeg || mainSeg.points.length === 0) continue;
      
      const boltX = mainSeg.points[0].x;
      const dist = Math.abs(boltX - cloud.x);
      const influence = Math.max(0, 1 - dist / (cloud.width * 2));
      const illumination = influence * bolt.alpha * bolt.intensity;
      maxIllumination = Math.max(maxIllumination, illumination);
    }
    
    cloud.targetAlpha = maxIllumination * 0.7;
    
    const lerpSpeed = cloud.targetAlpha > cloud.alpha ? 0.3 : 0.08;
    cloud.alpha += (cloud.targetAlpha - cloud.alpha) * lerpSpeed;
  }
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  startWidth: number,
  endWidth: number,
  brightness: number,
  alpha: number,
  flicker: number
): void {
  if (points.length < 2 || alpha <= 0) return;
  
  const flickerMod = 0.85 + flicker * 0.15;
  const effectiveAlpha = alpha * flickerMod * brightness;
  const avgWidth = (startWidth + endWidth) / 2;
  
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  
  ctx.globalAlpha = effectiveAlpha * 0.25;
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = avgWidth * 8;
  ctx.shadowColor = '#7c3aed';
  ctx.shadowBlur = avgWidth * 10;
  ctx.stroke();
  
  ctx.globalAlpha = effectiveAlpha * 0.4;
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = avgWidth * 3.5;
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = avgWidth * 5;
  ctx.stroke();
  
  ctx.shadowBlur = 0;
  
  ctx.globalAlpha = effectiveAlpha * 0.7;
  ctx.strokeStyle = '#a5f3fc';
  ctx.lineWidth = avgWidth * 1.8;
  ctx.stroke();
  
  ctx.globalAlpha = effectiveAlpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = avgWidth * 0.8;
  ctx.stroke();
  
  ctx.restore();
}

export function LightningCanvas({ intensity = 0.5, disabled = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boltsRef = useRef<LightningBolt[]>([]);
  const cellsRef = useRef<StormCell[]>([]);
  const cloudsRef = useRef<Cloud[]>([]);
  const animRef = useRef(0);
  const reducedRef = useRef(false);
  const lastDistantRef = useRef(0);

  const spawnRestrike = useCallback((w: number, h: number, cellX: number, count: number, delay: number) => {
    if (count <= 0) return;
    setTimeout(() => {
      boltsRef.current.push(createBolt(w, h, cellX + (Math.random() - 0.5) * 20));
      spawnRestrike(w, h, cellX, count - 1, 40 + Math.random() * 80);
    }, delay);
  }, []);

  const spawnFromCell = useCallback((w: number, h: number, cell: StormCell) => {
    const cellX = cell.x;
    boltsRef.current.push(createBolt(w, h, cellX));
    
    const restrikeCount = Math.random() > 0.6 ? 1 + Math.floor(Math.random() * 3) : 0;
    if (restrikeCount > 0) {
      spawnRestrike(w, h, cellX, restrikeCount, 30 + Math.random() * 50);
    }
  }, [spawnRestrike]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedRef.current = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0, h = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    addEventListener('resize', resize);

    const loop = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      
      updateCloudIllumination(cloudsRef.current, boltsRef.current);
      drawClouds(ctx, cloudsRef.current);

      if (!reducedRef.current && w > 0 && h > 0) {
        for (const cell of cellsRef.current) {
          cell.x += cell.drift * w * 0.016;
          if (cell.x < 0) cell.x = w;
          if (cell.x > w) cell.x = 0;
          
          if (t > cell.nextBurst) {
            if (cell.burstRemaining <= 0) {
              cell.burstRemaining = 1 + Math.floor(Math.random() * 3 * cell.activity * intensity);
            }
            
            if (cell.burstRemaining > 0) {
              spawnFromCell(w, h, cell);
              cell.burstRemaining--;
              
              if (cell.burstRemaining > 0) {
                cell.nextBurst = t + 150 + Math.random() * 400;
              } else {
                cell.nextBurst = t + 2000 + Math.random() * 4000 / intensity;
              }
            }
          }
        }
        
        if (t - lastDistantRef.current > 3000 + Math.random() * 5000) {
          if (Math.random() > 0.5) {
            const edgeX = Math.random() > 0.5 ? w * 0.1 : w * 0.9;
            boltsRef.current.push(createBolt(w, h, edgeX, true));
          }
          lastDistantRef.current = t;
        }
      }

      boltsRef.current = boltsRef.current.filter(bolt => {
        const age = t - bolt.birthTime;
        if (age < 50) {
          bolt.alpha = (age / 50) * bolt.maxAlpha;
        } else {
          bolt.alpha = Math.max(0, bolt.alpha - bolt.fadeSpeed);
        }
        if (bolt.alpha < 0.01) return false;

        const flicker = Math.sin(t / bolt.flickerSpeed + bolt.flickerPhase);
        for (const seg of bolt.segments) {
          drawSegment(ctx, seg.points, seg.startWidth, seg.endWidth, seg.brightness, bolt.alpha, flicker);
        }

        return true;
      });

      animRef.current = requestAnimationFrame(loop);
    };

    if (cellsRef.current.length === 0) {
      cellsRef.current = [
        createStormCell(w),
        createStormCell(w),
      ];
    }
    
    if (cloudsRef.current.length === 0 && w > 0 && h > 0) {
      cloudsRef.current = createClouds(w, h);
    }
    
    setTimeout(() => {
      if (w > 0 && h > 0 && cellsRef.current[0]) {
        spawnFromCell(w, h, cellsRef.current[0]);
      }
    }, 100);
    
    animRef.current = requestAnimationFrame(loop);

    return () => {
      removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [disabled, intensity, spawnFromCell]);

  if (disabled) return null;
  return <canvas ref={canvasRef} className="lightning-canvas" aria-hidden="true" />;
}

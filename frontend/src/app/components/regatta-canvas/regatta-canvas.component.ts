import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveRacerMetric } from '../../services/socket.service';

interface BoatRenderState {
  userId: string;
  name: string;
  lane: number;
  currentDisplayDist: number;
  targetPacketDist: number;
  splitSec: number;
  watts: number;
  spm: number;
  lastPacketTime: number;
  color: string;
}

@Component({
  selector: 'app-regatta-canvas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #wrapperEl class="canvas-wrapper">
      <canvas #raceCanvas></canvas>
    </div>
  `,
  styles: [`
    .canvas-wrapper {
      inline-size: 100%;
      block-size: clamp(230px, 42dvh, 380px);
      position: relative;
      border-radius: 12px;
      overflow: clip;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.2), inset 0 0 15px rgba(0, 0, 0, 0.8);
      border: 1px solid rgba(0, 240, 255, 0.3);
      background: #081226;
    }
    canvas {
      display: block;
      inline-size: 100%;
      block-size: 100%;
    }
    @media (max-height: 500px) and (orientation: landscape) {
      .canvas-wrapper {
        block-size: 165px;
      }
    }
  `]
})
export class RegattaCanvasComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('wrapperEl', { static: true }) wrapperRef!: ElementRef<HTMLDivElement>;
  @ViewChild('raceCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() racers: LiveRacerMetric[] = [];
  @Input() targetDistance = 2000;
  @Input() activeUserId = '';

  private ctx: CanvasRenderingContext2D | null = null;
  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastFrameTimestamp: number = performance.now();
  private boatsMap: Map<string, BoatRenderState> = new Map();
  private cssWidth = 900;
  private cssHeight = 260;

  private readonly boatColors = [
    '#FF0055', '#00F0FF', '#39FF14', '#FFE600',
    '#FF6600', '#B026FF', '#00FF9D', '#FF3366'
  ];

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.wrapperRef.nativeElement);
    }
    window.addEventListener('resize', this.onResize);
    this.startRenderLoop();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['racers'] && this.racers) {
      this.syncRacersData();
    }
  }

  ngOnDestroy(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const wrapper = this.wrapperRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    const width = Math.max(260, wrapper?.clientWidth || 900);
    const height = Math.max(150, wrapper?.clientHeight || 240);

    this.cssWidth = width;
    this.cssHeight = height;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  private syncRacersData(): void {
    const now = performance.now();
    const activeIds = new Set<string>();

    this.racers.forEach((r, idx) => {
      activeIds.add(r.userId);
      let boat = this.boatsMap.get(r.userId);
      if (!boat) {
        boat = {
          userId: r.userId,
          name: r.name,
          lane: r.lane || idx + 1,
          currentDisplayDist: r.dist || 0,
          targetPacketDist: r.dist || 0,
          splitSec: r.split || 120,
          watts: r.watts || 0,
          spm: r.spm || 0,
          lastPacketTime: now,
          color: this.boatColors[idx % this.boatColors.length]
        };
        this.boatsMap.set(r.userId, boat);
      } else {
        boat.name = r.name;
        boat.targetPacketDist = r.dist;
        boat.splitSec = r.split > 0 ? r.split : boat.splitSec;
        boat.watts = r.watts;
        boat.spm = r.spm;
        boat.lastPacketTime = now;
        boat.color = this.boatColors[idx % this.boatColors.length];
      }
    });

    // Prune boats that left or belonged to a previous race/salon
    for (const existingId of Array.from(this.boatsMap.keys())) {
      if (!activeIds.has(existingId)) {
        this.boatsMap.delete(existingId);
      }
    }
  }

  private startRenderLoop = () => {
    const render = (timestamp: number) => {
      const deltaT = Math.min(0.1, Math.max(0, (timestamp - this.lastFrameTimestamp) / 1000));
      this.lastFrameTimestamp = timestamp;

      this.updateBoatsPhysics(deltaT);
      this.drawCanvasScene();

      this.animFrameId = requestAnimationFrame(render);
    };
    this.animFrameId = requestAnimationFrame(render);
  };

  private updateBoatsPhysics(deltaT: number): void {
    this.boatsMap.forEach((boat) => {
      const vInst = boat.splitSec > 0 && boat.spm > 0 ? 500 / boat.splitSec : 0;
      const predictedDist = boat.targetPacketDist + vInst * deltaT;
      boat.targetPacketDist = predictedDist;

      const diff = boat.targetPacketDist - boat.currentDisplayDist;
      boat.currentDisplayDist += diff * 0.12;

      if (boat.currentDisplayDist > this.targetDistance) {
        boat.currentDisplayDist = this.targetDistance;
      }
    });
  }

  private drawCanvasScene(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const isCompact = w < 520;

    // 1. Clear background water
    ctx.fillStyle = '#081226';
    ctx.fillRect(0, 0, w, h);

    // 2. River lines & distance marks adapted to mobile/tablet width
    const marginX = isCompact ? 22 : 52;
    const rightPad = isCompact ? 20 : 34;
    const trackW = Math.max(120, w - marginX - rightPad);
    const boatCount = Math.max(1, this.boatsMap.size);
    const laneH = Math.min(44, (h - 36) / Math.max(1, Math.min(8, boatCount)));

    const markers = w < 380 ? [0, 0.5, 1.0] : [0, 0.25, 0.5, 0.75, 1.0];
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.font = isCompact ? '600 10px monospace' : '600 11px monospace';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.72)';

    markers.forEach((pct) => {
      const x = marginX + trackW * pct;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, h - 8);
      ctx.stroke();

      const label = `${Math.round(pct * this.targetDistance)}m`;
      const tw = ctx.measureText(label).width;
      const tx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
      ctx.fillText(label, tx, 15);
    });

    // Finish line
    const finishX = marginX + trackW;
    ctx.strokeStyle = '#ffe600';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(finishX, 22);
    ctx.lineTo(finishX, h - 8);
    ctx.stroke();

    if (this.boatsMap.size === 0) {
      ctx.font = isCompact ? '600 12px sans-serif' : '600 13px sans-serif';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
      const emptyMsg = '🛶 Ligne d’eau prête — en attente des rameurs...';
      const msgW = ctx.measureText(emptyMsg).width;
      ctx.fillText(emptyMsg, Math.max(10, (w - msgW) / 2), h / 2 + 6);
      return;
    }

    // 3. Draw Kayaks / Boats with non-clipping labels
    let laneIdx = 0;
    const hullRx = isCompact ? 14 : 18;
    const hullRy = isCompact ? 4.5 : 5;

    this.boatsMap.forEach((boat) => {
      const y = 36 + laneIdx * laneH;
      const progress = Math.min(1.0, Math.max(0, boat.currentDisplayDist / (this.targetDistance || 2000)));
      const x = marginX + trackW * progress;

      // Lane separator
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marginX, y + laneH / 2);
      ctx.lineTo(finishX, y + laneH / 2);
      ctx.stroke();

      // Wake ripple
      ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
      ctx.beginPath();
      ctx.ellipse(Math.max(marginX, x - hullRx + 2), y, isCompact ? 9 : 12, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Kayak hull
      ctx.fillStyle = boat.color;
      ctx.beginPath();
      ctx.ellipse(x, y, hullRx, hullRy, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cockpit
      ctx.fillStyle = '#060913';
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Paddle blades
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 7);
      ctx.lineTo(x + 4, y + 7);
      ctx.stroke();

      // Clamped Name & Distance label
      const shortName = isCompact && boat.name.length > 10 ? `${boat.name.slice(0, 9)}…` : boat.name;
      const text = `${shortName} · ${Math.round(boat.currentDisplayDist)}m`;
      ctx.font = isCompact ? 'bold 10.5px sans-serif' : 'bold 11.5px sans-serif';
      ctx.fillStyle = boat.userId === this.activeUserId ? '#ffe600' : '#ffffff';
      const tw = ctx.measureText(text).width;
      const lx = Math.max(6, Math.min(w - tw - 6, x - tw / 2));
      ctx.fillText(text, lx, y - 9);

      laneIdx++;
    });
  }
}

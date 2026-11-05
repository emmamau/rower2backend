import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveRacerMetric } from '../../services/socket.service';

interface BoatRenderState {
  userId: string;
  name: string;
  lane: number;
  currentDisplayDist: number; // Position affichée interpolée
  targetPacketDist: number;   // Position réelle reçue
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
    <div class="canvas-wrapper">
      <canvas #raceCanvas></canvas>
    </div>
  `,
  styles: [`
    .canvas-wrapper {
      width: 100%;
      height: 280px;
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 0 20px rgba(0, 240, 255, 0.2), inset 0 0 15px rgba(0, 0, 0, 0.8);
      border: 1px solid rgba(0, 240, 255, 0.3);
      background: #081226;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `]
})
export class RegattaCanvasComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('raceCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() racers: LiveRacerMetric[] = [];
  @Input() targetDistance: number = 2000;
  @Input() activeUserId: string = '';

  private ctx: CanvasRenderingContext2D | null = null;
  private animFrameId: number | null = null;
  private lastFrameTimestamp: number = performance.now();
  private boatsMap: Map<string, BoatRenderState> = new Map();

  private readonly boatColors = [
    '#FF0055', '#00F0FF', '#39FF14', '#FFE600',
    '#FF6600', '#B026FF', '#00FF9D', '#FF3366'
  ];

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
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
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    canvas.width = canvas.parentElement?.clientWidth || 900;
    canvas.height = canvas.parentElement?.clientHeight || 280;
  }

  private syncRacersData(): void {
    const now = performance.now();
    this.racers.forEach((r, idx) => {
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
      }
    });
  }

  /**
   * Main 60 FPS Render Loop with Dead Reckoning (Sec. 8 of Specification)
   * Vinst = 500 / splitSec
   * Pos(t) = Pos(packet) + Vinst * deltaT
   * Lerp réconciliation 10% par frame
   */
  private startRenderLoop = () => {
    const render = (timestamp: number) => {
      const deltaT = (timestamp - this.lastFrameTimestamp) / 1000;
      this.lastFrameTimestamp = timestamp;

      this.updateBoatsPhysics(deltaT);
      this.drawCanvasScene();

      this.animFrameId = requestAnimationFrame(render);
    };
    this.animFrameId = requestAnimationFrame(render);
  };

  private updateBoatsPhysics(deltaT: number): void {
    this.boatsMap.forEach(boat => {
      // 1. Dead Reckoning speed calculation
      const vInst = boat.splitSec > 0 ? 500 / boat.splitSec : 0;

      // 2. Extrapolate predicted target
      const predictedDist = boat.targetPacketDist + vInst * deltaT;
      boat.targetPacketDist = predictedDist;

      // 3. Smooth Lerp reconciliation (10% per frame toward predicted position)
      const diff = boat.targetPacketDist - boat.currentDisplayDist;
      boat.currentDisplayDist += diff * 0.1;

      // Clamp to finish
      if (boat.currentDisplayDist > this.targetDistance) {
        boat.currentDisplayDist = this.targetDistance;
      }
    });
  }

  private drawCanvasScene(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvasRef.nativeElement.width;
    const h = this.canvasRef.nativeElement.height;

    // 1. Clear background water
    ctx.fillStyle = '#081226';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw river lines & distance marks
    const marginX = 70;
    const trackW = w - marginX - 40;
    const boatCount = Math.max(1, this.boatsMap.size);
    const laneH = Math.min(45, (h - 40) / Math.max(1, Math.min(8, boatCount)));

    // Vertical Distance grids
    const markers = [0, 0.25, 0.5, 0.75, 1.0];
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.6)';

    markers.forEach(pct => {
      const x = marginX + trackW * pct;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, h - 10);
      ctx.stroke();
      const distM = Math.round(pct * this.targetDistance);
      ctx.fillText(`${distM}m`, x - 12, 16);
    });

    // Finish line checkered effect
    const finishX = marginX + trackW;
    ctx.strokeStyle = '#ffe600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(finishX, 20);
    ctx.lineTo(finishX, h - 10);
    ctx.stroke();

    // 3. Draw Kayaks / Boats
    let laneIdx = 0;
    this.boatsMap.forEach(boat => {
      const y = 35 + laneIdx * laneH;
      const progress = Math.min(1.0, Math.max(0, boat.currentDisplayDist / (this.targetDistance || 2000)));
      const x = marginX + trackW * progress;

      // Lane boundary line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(marginX, y + laneH / 2);
      ctx.lineTo(finishX, y + laneH / 2);
      ctx.stroke();

      // Boat Wake ripple
      ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
      ctx.beginPath();
      ctx.ellipse(x - 16, y, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Kayak hull
      ctx.fillStyle = boat.color;
      ctx.beginPath();
      ctx.ellipse(x, y, 18, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cockpit & Paddler
      ctx.fillStyle = '#060913';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Paddle blades
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 8);
      ctx.lineTo(x + 5, y + 8);
      ctx.stroke();

      // Name & distance badge
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = boat.userId === this.activeUserId ? '#ffe600' : '#ffffff';
      ctx.fillText(`${boat.name} (${Math.round(boat.currentDisplayDist)}m)`, x - 25, y - 9);

      laneIdx++;
    });
  }
}


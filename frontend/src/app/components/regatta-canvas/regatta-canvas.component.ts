import {
  Component,
  Input,
  Output,
  EventEmitter,
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

      <!-- Mini-leaderboard rétractable avec classements et écarts temps réel -->
      <div
        #leaderboardBoxEl
        class="mini-leaderboard"
        [class.collapsed]="isLeaderboardCollapsed"
        [class.is-dragging]="isDraggingLeaderboard"
        [style.left.px]="leaderboardPosition ? leaderboardPosition.x : null"
        [style.top.px]="leaderboardPosition ? leaderboardPosition.y : null"
        [style.right]="leaderboardPosition ? 'auto' : null"
        (pointerdown)="onLeaderboardPointerDown($event)"
        (pointermove)="onLeaderboardPointerMove($event)"
        (pointerup)="onLeaderboardPointerUp($event)"
        (pointercancel)="onLeaderboardPointerUp($event)"
        *ngIf="sortedLeaderboard.length > 0">
        <button
          type="button"
          class="mini-lead-header"
          (click)="onLeaderboardHeaderClick($event)"
          title="Afficher/Masquer le classement des écarts">
          <span class="mini-lead-title">
            🏆 {{ isLeaderboardCollapsed ? myRankBadgeText : 'Classement en direct' }}
          </span>
          <span class="mini-lead-toggle">{{ isLeaderboardCollapsed ? '◀' : '▼' }}</span>
        </button>
        <div class="mini-lead-body" *ngIf="!isLeaderboardCollapsed">
          <div
            *ngFor="let racer of sortedLeaderboard; let rank = index"
            class="mini-lead-row"
            [class.active-player]="racer.userId === activeUserId"
            [class.focused-racer]="racer.userId === effectiveFocusedUserId"
            (click)="selectRacerToFollow(racer.userId)">
            <span class="mini-lead-rank">{{ rank + 1 }}</span>
            <span class="mini-lead-name">{{ racer.name }}</span>
            <span class="mini-lead-dist">{{ Math.round(racer.dist) }}m</span>
            <span class="mini-lead-gap" [class.leader]="rank === 0">
              {{ formatGap(racer, sortedLeaderboard[0]) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .canvas-wrapper {
      inline-size: 100%;
      block-size: clamp(240px, 44dvh, 400px);
      position: relative;
      border-radius: 14px;
      overflow: clip;
      box-shadow: 0 0 24px rgba(0, 240, 255, 0.25), inset 0 0 20px rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(0, 240, 255, 0.35);
      background: radial-gradient(ellipse at 50% 20%, #0d1e3d 0%, #060d1d 75%, #03070f 100%);
    }
    canvas {
      display: block;
      inline-size: 100%;
      block-size: 100%;
    }
    @media (max-height: 500px) and (orientation: landscape) {
      .canvas-wrapper {
        block-size: 175px;
      }
    }
    .mini-leaderboard {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 20;
      background: rgba(6, 13, 29, 0.94);
      border: 1px solid rgba(0, 240, 255, 0.45);
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.65), 0 0 12px rgba(0, 240, 255, 0.2);
      backdrop-filter: blur(8px);
      max-width: 250px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: box-shadow 0.2s ease, opacity 0.2s ease;
      overflow: hidden;
      touch-action: none;
      user-select: none;
    }
    .mini-leaderboard.is-dragging {
      cursor: grabbing;
      opacity: 0.92;
      box-shadow: 0 8px 25px rgba(0, 240, 255, 0.45);
      z-index: 50;
    }
    .mini-leaderboard.collapsed {
      max-width: fit-content;
      border-radius: 20px;
    }
    .mini-leaderboard.collapsed .mini-lead-header {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 800;
      background: rgba(0, 240, 255, 0.2);
    }
    .mini-lead-header {
      width: 100%;
      border: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(0, 240, 255, 0.14);
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      color: #00f0ff;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      gap: 6px;
    }
    .mini-lead-header:hover {
      background: rgba(0, 240, 255, 0.22);
    }
    .mini-lead-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mini-lead-toggle {
      font-size: 10px;
      color: #00f0ff;
    }
    .mini-lead-body {
      max-height: 160px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .mini-lead-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      font-size: 10.5px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      transition: background 0.15s ease;
    }
    .mini-lead-row:hover {
      background: rgba(0, 240, 255, 0.18);
    }
    .mini-lead-row.active-player {
      background: rgba(0, 240, 255, 0.25);
      font-weight: bold;
      color: #00f0ff;
    }
    .mini-lead-row.focused-racer {
      border-left: 3px solid #ffe600;
    }
    .mini-lead-rank {
      font-weight: 800;
      color: #ffe600;
      min-width: 14px;
      text-align: center;
    }
    .mini-lead-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #e2e8f0;
    }
    .mini-lead-dist {
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      font-size: 10px;
    }
    .mini-lead-gap {
      font-variant-numeric: tabular-nums;
      font-size: 9.5px;
      color: #f87171;
      min-width: 38px;
      text-align: right;
    }
    .mini-lead-gap.leader {
      color: #4ade80;
      font-weight: 700;
    }
  `]
})
export class RegattaCanvasComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('wrapperEl', { static: true }) wrapperRef!: ElementRef<HTMLDivElement>;
  @ViewChild('raceCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('leaderboardBoxEl') leaderboardBoxRef?: ElementRef<HTMLDivElement>;
  @Input() racers: LiveRacerMetric[] = [];
  @Input() targetDistance = 2000;
  @Input() activeUserId = '';
  @Input() focusedUserId = '';
  @Output() racerSelected = new EventEmitter<string>();

  protected Math = Math;
  public isLeaderboardCollapsed = true;
  public sortedLeaderboard: LiveRacerMetric[] = [];
  public leaderboardPosition: { x: number; y: number } | null = null;
  public isDraggingLeaderboard = false;
  private dragStartPointer = { x: 0, y: 0 };
  private dragStartLeaderboardPos = { x: 0, y: 0 };
  private hasMovedWhileDragging = false;
  private lastToggleTimestamp = 0;

  private ctx: CanvasRenderingContext2D | null = null;
  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastFrameTimestamp: number = performance.now();
  private boatsMap: Map<string, BoatRenderState> = new Map();
  private cssWidth = 900;
  private cssHeight = 260;

  // Caméra fluide centrée sur le kayak du joueur actif ou suivi spectateur
  private cameraX = 0;

  private readonly boatColors = [
    '#FF0055', '#00F0FF', '#39FF14', '#FFE600',
    '#FF6600', '#B026FF', '#00FF9D', '#FF3366'
  ];

  get effectiveFocusedUserId(): string {
    return this.focusedUserId || this.activeUserId || '';
  }

  get myPlayerRank(): number | null {
    if (!this.activeUserId) return null;
    const index = this.sortedLeaderboard.findIndex((r) => r.userId === this.activeUserId);
    return index >= 0 ? index + 1 : null;
  }

  get myRankBadgeText(): string {
    const rank = this.myPlayerRank;
    const total = this.sortedLeaderboard.length;
    if (!rank) {
      return total > 0 ? `-- / ${total}` : '--';
    }
    const suffix = rank === 1 ? 'er' : 'e';
    return `${rank}${suffix} / ${total}`;
  }

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

    if (typeof localStorage !== 'undefined') {
      try {
        const sx = localStorage.getItem('rower_canvas_lb_pos_x');
        const sy = localStorage.getItem('rower_canvas_lb_pos_y');
        if (sx && sy) {
          this.leaderboardPosition = { x: Number(sx), y: Number(sy) };
        }
      } catch {}
    }
    setTimeout(() => this.clampCurrentPosition(), 60);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['racers'] && this.racers) {
      this.syncRacersData();
      this.updateLeaderboard();
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

  public toggleLeaderboard(): void {
    const now = Date.now();
    if (now - this.lastToggleTimestamp < 250) return;
    this.lastToggleTimestamp = now;
    this.isLeaderboardCollapsed = !this.isLeaderboardCollapsed;
    setTimeout(() => this.clampCurrentPosition(), 50);
  }

  public onLeaderboardHeaderClick(event: MouseEvent): void {
    if (this.hasMovedWhileDragging) {
      event.preventDefault();
      event.stopPropagation();
      this.hasMovedWhileDragging = false;
      return;
    }
    this.toggleLeaderboard();
  }

  public onLeaderboardPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement;
    if (target?.closest('.mini-lead-body')) return;

    const box = this.leaderboardBoxRef?.nativeElement;
    if (!box) return;

    this.isDraggingLeaderboard = true;
    this.hasMovedWhileDragging = false;
    this.dragStartPointer = { x: event.clientX, y: event.clientY };

    const wrapper = this.wrapperRef.nativeElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    if (!this.leaderboardPosition) {
      this.leaderboardPosition = {
        x: Math.round(boxRect.left - wrapperRect.left),
        y: Math.round(boxRect.top - wrapperRect.top),
      };
    }
    this.dragStartLeaderboardPos = { ...this.leaderboardPosition };

    try {
      box.setPointerCapture(event.pointerId);
    } catch {}
  }

  public onLeaderboardPointerMove(event: PointerEvent): void {
    if (!this.isDraggingLeaderboard) return;
    const dx = event.clientX - this.dragStartPointer.x;
    const dy = event.clientY - this.dragStartPointer.y;

    if (Math.hypot(dx, dy) > 5) {
      this.hasMovedWhileDragging = true;
    }
    if (!this.hasMovedWhileDragging) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    const wrapper = this.wrapperRef.nativeElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    const box = this.leaderboardBoxRef?.nativeElement;
    const boxWidth = box ? box.offsetWidth : (this.isLeaderboardCollapsed ? 120 : 180);
    const boxHeight = box ? box.offsetHeight : (this.isLeaderboardCollapsed ? 32 : 160);

    this.leaderboardPosition = this.clampLeaderboardPosition(
      this.dragStartLeaderboardPos,
      { dx, dy },
      wrapperRect.width,
      wrapperRect.height,
      boxWidth,
      boxHeight
    );
  }

  public onLeaderboardPointerUp(event: PointerEvent): void {
    if (!this.isDraggingLeaderboard) return;
    this.isDraggingLeaderboard = false;
    const box = this.leaderboardBoxRef?.nativeElement;
    try {
      if (box && box.hasPointerCapture(event.pointerId)) {
        box.releasePointerCapture(event.pointerId);
      }
    } catch {}

    if (!this.hasMovedWhileDragging) {
      const target = event.target as HTMLElement;
      if (target?.closest('.mini-lead-header') || this.isLeaderboardCollapsed) {
        this.toggleLeaderboard();
      }
    }

    if (this.leaderboardPosition && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('rower_canvas_lb_pos_x', String(this.leaderboardPosition.x));
        localStorage.setItem('rower_canvas_lb_pos_y', String(this.leaderboardPosition.y));
      } catch {}
    }
  }

  public clampCurrentPosition(): void {
    if (!this.leaderboardPosition) return;
    const wrapper = this.wrapperRef?.nativeElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const box = this.leaderboardBoxRef?.nativeElement;
    const boxWidth = box ? box.offsetWidth : (this.isLeaderboardCollapsed ? 120 : 180);
    const boxHeight = box ? box.offsetHeight : (this.isLeaderboardCollapsed ? 32 : 160);
    this.leaderboardPosition = this.clampLeaderboardPosition(
      this.leaderboardPosition,
      { dx: 0, dy: 0 },
      wrapperRect.width,
      wrapperRect.height,
      boxWidth,
      boxHeight
    );
  }

  public formatGap(racer: LiveRacerMetric, leader: LiveRacerMetric): string {
    if (!leader || racer.userId === leader.userId) return 'Leader';
    const distDiff = Math.round((leader.dist || 0) - (racer.dist || 0));
    if (distDiff <= 0) return 'Leader';
    let text = `-${distDiff}m`;
    if (racer.split && racer.split > 0 && racer.split < 600) {
      const secDiff = ((distDiff * racer.split) / 500).toFixed(1);
      text += ` (+${secDiff}s)`;
    }
    return text;
  }

  public clampLeaderboardPosition(
    pos: { x: number; y: number },
    delta: { dx: number; dy: number },
    containerWidth: number = 900,
    containerHeight: number = 260,
    boxWidth: number = 160,
    boxHeight: number = 40
  ): { x: number; y: number } {
    const maxX = Math.max(5, containerWidth - boxWidth - 5);
    const maxY = Math.max(5, containerHeight - boxHeight - 5);
    const nextX = Math.min(Math.max(5, pos.x + delta.dx), maxX);
    const nextY = Math.min(Math.max(5, pos.y + delta.dy), maxY);
    return { x: Math.round(nextX), y: Math.round(nextY) };
  }

  public selectRacerToFollow(userId: string): void {
    this.racerSelected.emit(userId);
  }

  private onResize = () => {
    this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const wrapper = this.wrapperRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const boatCount = Math.max(1, this.boatsMap.size);
    const dynamicMinHeight = Math.max(240, Math.min(600, 48 + boatCount * 38));
    if (wrapper) {
      wrapper.style.minHeight = `${dynamicMinHeight}px`;
    }

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    const width = Math.max(260, wrapper?.clientWidth || 900);
    const height = Math.max(dynamicMinHeight, wrapper?.clientHeight || dynamicMinHeight);

    this.cssWidth = width;
    this.cssHeight = height;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.clampCurrentPosition();
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

    for (const existingId of Array.from(this.boatsMap.keys())) {
      if (!activeIds.has(existingId)) {
        this.boatsMap.delete(existingId);
      }
    }
  }

  private updateLeaderboard(): void {
    this.sortedLeaderboard = [...this.racers].sort((a, b) => (b.dist || 0) - (a.dist || 0));
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
    const nowSec = performance.now() / 1000;

    // 1. Fond plan d'eau dynamique
    ctx.fillStyle = '#060d1d';
    ctx.fillRect(0, 0, w, h);

    const marginX = isCompact ? 32 : 64;
    const rightPad = isCompact ? 24 : 40;
    const trackW = Math.max(120, w - marginX - rightPad);
    const boatCount = Math.max(1, this.boatsMap.size);
    const laneH = Math.min(46, Math.max(28, (h - 44) / boatCount));

    // Calcul de la caméra pour centrage sur le joueur actif ou le bateau suivi
    const targetUserId = this.effectiveFocusedUserId;
    const targetBoat = this.boatsMap.get(targetUserId);

    if (targetBoat && isCompact) {
      const targetBoatX = marginX + trackW * Math.min(1.0, Math.max(0, targetBoat.currentDisplayDist / (this.targetDistance || 2000)));
      const desiredCamX = targetBoatX - (w * 0.42);
      const clampedCamX = Math.max(0, Math.min(trackW * 0.4, desiredCamX));
      this.cameraX += (clampedCamX - this.cameraX) * 0.08;
    } else {
      this.cameraX += (0 - this.cameraX) * 0.08;
    }

    const camOffset = this.cameraX;

    // 2. Lignes d'eau et repères de distance
    const markers = w < 380 ? [0, 0.5, 1.0] : [0, 0.25, 0.5, 0.75, 1.0];
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.font = isCompact ? '600 10px monospace' : '600 11px monospace';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.75)';

    markers.forEach((pct) => {
      const x = marginX + trackW * pct - camOffset;
      if (x < -20 || x > w + 20) return;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, h - 8);
      ctx.stroke();

      const label = `${Math.round(pct * this.targetDistance)}m`;
      const tw = ctx.measureText(label).width;
      const tx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
      ctx.fillText(label, tx, 15);
    });

    // Ligne d'arrivée
    const finishX = marginX + trackW - camOffset;
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

    // 3. Dessin des kayaks avec mise en valeur avancée
    let laneIdx = 0;
    const hullRx = isCompact ? 14 : 18;
    const hullRy = isCompact ? 4.5 : 5;

    this.boatsMap.forEach((boat) => {
      const y = 38 + laneIdx * laneH;
      const progress = Math.min(1.0, Math.max(0, boat.currentDisplayDist / (this.targetDistance || 2000)));
      const rawX = marginX + trackW * progress;
      const x = rawX - camOffset;

      const isUser = boat.userId === this.activeUserId;
      const isFocused = boat.userId === this.effectiveFocusedUserId;

      // Numéro de ligne d'eau
      const laneNum = boat.lane || (laneIdx + 1);
      ctx.font = isCompact ? 'bold 9.5px monospace' : 'bold 11px monospace';
      ctx.fillStyle = isUser ? '#00f0ff' : (isFocused ? '#ffe600' : 'rgba(0, 240, 255, 0.85)');
      const laneLabel = isCompact ? `L${laneNum}` : `Ligne ${laneNum}`;
      ctx.fillText(laneLabel, 4, y + 4);

      // Séparateur de ligne
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marginX, y + laneH / 2);
      ctx.lineTo(finishX + camOffset, y + laneH / 2);
      ctx.stroke();

      const isMoving = (boat.spm > 0 || (boat.splitSec > 0 && boat.currentDisplayDist > 0)) &&
        boat.currentDisplayDist < (this.targetDistance || 2000);
      const effectiveSpm = boat.spm > 0 ? boat.spm : (isMoving ? 26 : 0);
      const strokeFreq = effectiveSpm > 0 ? effectiveSpm / 60 : 0;
      const laneOffset = (boat.lane || laneIdx) * 1.1;
      const strokeAngle = isMoving
        ? Math.sin(nowSec * strokeFreq * Math.PI * 2 + laneOffset) * 0.58
        : 0;

      const oarLen = isCompact ? 7 : 9;
      const dxOar = Math.sin(strokeAngle) * oarLen;
      const dyOar = Math.cos(strokeAngle) * oarLen;
      const x1 = x - dxOar;
      const y1 = y - dyOar;
      const x2 = x + dxOar;
      const y2 = y + dyOar;

      // =========================================================================
      // MISE EN VALEUR JOUEUR CONNECTÉ : Sillage accentué & Traînée d'eau
      // =========================================================================
      if (isUser || isFocused) {
        // Multiples sillages lumineux pour le joueur connecté
        ctx.fillStyle = 'rgba(0, 240, 255, 0.40)';
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 6), y, isCompact ? 16 : 24, isCompact ? 4.5 : 6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 240, 255, 0.20)';
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 16), y, isCompact ? 24 : 36, isCompact ? 6 : 8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Sillage standard
        ctx.fillStyle = 'rgba(0, 240, 255, 0.18)';
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx + 2), y, isCompact ? 9 : 13, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Éclaboussures d'attaque
      if (isMoving && Math.abs(strokeAngle) > 0.25) {
        ctx.fillStyle = isUser ? 'rgba(0, 240, 255, 0.6)' : 'rgba(0, 240, 255, 0.38)';
        ctx.beginPath();
        ctx.arc(x1, y1, isCompact ? 1.8 : 2.4, 0, Math.PI * 2);
        ctx.arc(x2, y2, isCompact ? 1.8 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // =========================================================================
      // MISE EN VALEUR JOUEUR CONNECTÉ : Halo lumineux / Contour fluo (Glow)
      // =========================================================================
      if (isUser || isFocused) {
        ctx.save();
        ctx.shadowColor = isUser ? '#00f0ff' : '#ffe600';
        ctx.shadowBlur = 14 + Math.sin(nowSec * 5) * 5;
        ctx.strokeStyle = isUser ? 'rgba(0, 240, 255, 0.95)' : 'rgba(255, 230, 0, 0.95)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(x, y, hullRx + 4, hullRy + 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Rames
      ctx.strokeStyle = isUser ? '#00f0ff' : '#e2e8f0';
      ctx.lineWidth = isCompact ? 1.4 : 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Pelles
      ctx.fillStyle = isUser ? '#00f0ff' : boat.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;

      // Pelle bâbord
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(-strokeAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, isCompact ? 2.5 : 3.2, isCompact ? 1.5 : 2.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Pelle tribord
      ctx.save();
      ctx.translate(x2, y2);
      ctx.rotate(-strokeAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, isCompact ? 2.5 : 3.2, isCompact ? 1.5 : 2.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Coque profilée
      ctx.fillStyle = isUser ? '#00e5ff' : boat.color;
      ctx.beginPath();
      ctx.moveTo(x + hullRx, y);
      ctx.quadraticCurveTo(x, y - hullRy, x - hullRx, y);
      ctx.quadraticCurveTo(x, y + hullRy, x + hullRx, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isUser ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = isUser ? 1.5 : 1;
      ctx.stroke();

      // Cockpit
      ctx.fillStyle = '#060913';
      ctx.beginPath();
      ctx.ellipse(x - 1, y, hullRx * 0.36, hullRy * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rameur
      ctx.fillStyle = isUser ? '#ffe600' : '#fcd34d';
      ctx.beginPath();
      ctx.arc(x - hullRx * 0.12, y, isCompact ? 2.2 : 2.8, 0, Math.PI * 2);
      ctx.fill();

      // =========================================================================
      // MISE EN VALEUR : Flèche animée et bannière avec pseudo en surbrillance
      // =========================================================================
      const shortName = isCompact && boat.name.length > 10 ? `${boat.name.slice(0, 9)}…` : boat.name;

      if (isUser || isFocused) {
        // Flèche animée qui flotte au-dessus du bateau
        const arrowBounce = Math.sin(nowSec * 5.5) * 3;
        const arrowY = y - 18 + arrowBounce;
        ctx.fillStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.beginPath();
        ctx.moveTo(x, arrowY + 4);
        ctx.lineTo(x - 4.5, arrowY - 3);
        ctx.lineTo(x + 4.5, arrowY - 3);
        ctx.closePath();
        ctx.fill();

        // Bannière avec pseudo en surbrillance
        const bannerLabel = `${isUser ? '★ VOUS' : '👁 SUIVI'} : ${shortName} · ${Math.round(boat.currentDisplayDist)}m`;
        ctx.font = isCompact ? 'bold 10px sans-serif' : 'bold 11px sans-serif';
        const btw = ctx.measureText(bannerLabel).width;
        const bx = Math.max(6, Math.min(w - btw - 14, x - btw / 2));
        const by = arrowY - 14;

        // Fond bannière
        ctx.fillStyle = 'rgba(6, 15, 33, 0.88)';
        ctx.fillRect(bx - 4, by - 10, btw + 8, 14);
        ctx.strokeStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(bx - 4, by - 10, btw + 8, 14);

        ctx.fillStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.fillText(bannerLabel, bx, by);
      } else {
        // Label standard
        const text = `${shortName} · ${Math.round(boat.currentDisplayDist)}m`;
        ctx.font = isCompact ? 'bold 10px sans-serif' : 'bold 11px sans-serif';
        ctx.fillStyle = '#ffffff';
        const tw = ctx.measureText(text).width;
        const lx = Math.max(6, Math.min(w - tw - 6, x - tw / 2));
        ctx.fillText(text, lx, y - 9);
      }

      laneIdx++;
    });
  }
}

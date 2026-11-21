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
  SimpleChanges,
  ChangeDetectorRef,
  Optional
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveRacerMetric } from '../../services/socket.service';
import { KayakCustomization, sanitizeKayakCustomization, hexToRgba } from '../../models/user.model';
import { I18nService } from '../../services/i18n.service';

export { sanitizeKayakCustomization };

interface BoatRenderState {
  userId: string;
  name: string;
  lane: number;
  assignedLane: number;
  dynamicLaneIndex: number;
  currentLaneIndex: number;
  currentDisplayDist: number;
  targetPacketDist: number;
  splitSec: number;
  watts: number;
  spm: number;
  lastPacketTime: number;
  color: string;
  status?: string;
  ready?: boolean;
  connectionState?: 'CONNECTED' | 'READY';
  isBot?: boolean;
  isPaired?: boolean;
  kayak?: KayakCustomization;
}

@Component({
  selector: 'app-regatta-canvas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #wrapperEl class="canvas-wrapper">
      <canvas
        #raceCanvas
        (pointerdown)="onCanvasPointerDown($event)"
        (pointermove)="onCanvasPointerMove($event)"
        (pointerup)="onCanvasPointerUp($event)"
        (pointercancel)="onCanvasPointerCancel($event)"
        (click)="onCanvasClick($event)"></canvas>

      <!-- Barre d'outils en haut à gauche : Mode Dynamique/Fixe -->
      <div class="canvas-top-left-controls">
        <button
          type="button"
          class="lane-mode-toggle"
          [class.is-collapsed]="isLaneModeCollapsed"
          (click)="toggleLaneMode()"
          [title]="dynamicLaneMode ? (i18n.getCurrentLang() === 'fr' ? 'Mode dynamique actif : les kayaks changent de ligne selon le classement (seuil 10m). Cliquer pour passer en mode fixe.' : 'Dynamic mode active: kayaks change lanes based on ranking. Click to switch to fixed mode.') : (i18n.getCurrentLang() === 'fr' ? 'Mode fixe actif : les couloirs assignés restent fixes. Cliquer pour passer en mode dynamique.' : 'Fixed mode active: assigned lanes stay fixed. Click to switch to dynamic mode.')">
          <span class="mode-icon">{{ dynamicLaneMode ? '⚡' : '⚓' }}</span>
          <span class="mode-label">{{ dynamicLaneMode ? (i18n.getCurrentLang() === 'fr' ? 'Lignes dynamiques' : 'Dynamic lanes') : (i18n.getCurrentLang() === 'fr' ? 'Lignes fixes' : 'Fixed lanes') }}</span>
        </button>
      </div>

      <!-- Panneau contextuel de sélection de kayak -->
      <div
        class="kayak-claim-popup"
        *ngIf="selectedKayakForClaim"
        [style.left.px]="claimPopupPos.x"
        [style.top.px]="claimPopupPos.y">
        <div class="popup-title">🛶 {{ i18n.t('CANVAS_LANE') }} L{{ selectedKayakForClaim.lane }} : {{ selectedKayakForClaim.name }}</div>
        <div class="popup-actions">
          <button
            type="button"
            class="btn-claim-me"
            *ngIf="canClaimBoat(selectedKayakForClaim)"
            (click)="claimSelectedKayak(selectedKayakForClaim.userId)">
            ★ C'est mon kayak
          </button>
          <button
            type="button"
            class="btn-spectate"
            (click)="selectRacerToFollow(selectedKayakForClaim.userId); selectedKayakForClaim = null;">
            👁 Suivre
          </button>
          <button
            type="button"
            class="btn-close-popup"
            (click)="selectedKayakForClaim = null">
            ✕
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      height: 100%;
      inline-size: 100%;
    }
    .canvas-wrapper {
      inline-size: 100%;
      block-size: clamp(240px, 50dvh, 520px);
      flex: 1 1 auto;
      min-height: 220px;
      position: relative;
      border-radius: 14px;
      overflow: clip;
      box-shadow: 0 0 24px rgba(0, 240, 255, 0.25), inset 0 0 20px rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(0, 240, 255, 0.35);
      background: radial-gradient(ellipse at 50% 20%, #0d1e3d 0%, #060d1d 75%, #03070f 100%);
    }
    .canvas-top-left-controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 15;
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .lane-mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid rgba(0, 240, 255, 0.4);
      background: rgba(6, 15, 33, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #00f0ff;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.4px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }
    .lane-mode-toggle:hover {
      background: rgba(0, 240, 255, 0.2);
      border-color: #00f0ff;
      box-shadow: 0 0 12px rgba(0, 240, 255, 0.45);
      transform: translateY(-1px);
    }
    .lane-mode-toggle .mode-icon {
      font-size: 0.82rem;
    }
    .lane-mode-toggle.is-collapsed {
      gap: 0;
      padding: 4px 8px;
      justify-content: center;
    }
    .lane-mode-toggle.is-collapsed .mode-label {
      display: none;
    }
    @media (max-width: 520px) {
      .canvas-top-left-controls {
        top: 6px;
        left: 6px;
        gap: 4px;
      }
      .lane-mode-toggle {
        padding: 3px 8px;
        font-size: 0.65rem;
      }
      .lane-mode-toggle.is-collapsed {
        padding: 3px 6px;
      }
    }
    canvas {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      touch-action: none;
      user-select: none;
      cursor: grab;
    }
    canvas:active {
      cursor: grabbing;
    }
    @media (max-width: 768px), (max-height: 600px) and (orientation: landscape) {
      .canvas-wrapper {
        block-size: 100% !important;
        height: 100% !important;
        flex: 1 1 0 !important;
        min-height: 180px !important;
        border-radius: 8px;
        margin: 0 !important;
      }
    }
    .kayak-claim-popup {
      position: absolute;
      z-index: 60;
      background: rgba(6, 15, 33, 0.96);
      border: 1px solid #00f0ff;
      border-radius: 8px;
      padding: 8px 12px;
      box-shadow: 0 4px 20px rgba(0, 240, 255, 0.4);
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
      backdrop-filter: blur(8px);
    }
    .popup-title {
      font-weight: 700;
      color: #e2e8f0;
      white-space: nowrap;
    }
    .popup-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .btn-claim-me {
      background: #00f0ff;
      color: #060d1d;
      border: none;
      border-radius: 4px;
      padding: 4px 8px;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-claim-me:hover {
      background: #ffe600;
    }
    .btn-spectate {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .btn-close-popup {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 2px 4px;
    }
  `]
})
export class RegattaCanvasComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('wrapperEl', { static: true }) wrapperRef!: ElementRef<HTMLDivElement>;
  @ViewChild('raceCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() racers: LiveRacerMetric[] = [];
  @Input() targetDistance = 2000;
  @Input() activeUserId = '';
  @Input() focusedUserId = '';
  @Input() canSelectKayak = false;
  @Input() myKayakCustomization?: KayakCustomization;
  @Input() isRaceActive = false;
  @Input() zoomLevel = 1;
  @Output() zoomLevelChange = new EventEmitter<number>();
  @Output() racerSelected = new EventEmitter<string>();
  @Output() kayakClaimed = new EventEmitter<string>();

  public selectedKayakForClaim: BoatRenderState | null = null;
  public claimPopupPos = { x: 50, y: 50 };
  public visibleBoatsCount = 0;
  public totalBoatsCount = 0;

  // Défilement vertical du plan d'eau (Vertical Scroll / Drag)
  public scrollY: number = 0;
  public maxScrollY: number = 0;
  private isPointerDragging = false;
  private pointerStartY = 0;
  private startScrollY = 0;
  private hasScrolledWhileDragging = false;
  private ignoreNextClick = false;
  private lastUserScrollTime = 0;

  get effectiveZoomLevel(): number {
    const raw = Number(this.zoomLevel);
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(4, Math.max(1, Math.round(raw * 2) / 2));
  }

  /**
   * Calcule la liste ordonnée des kayaks du plan d'eau.
   * L'ensemble des kayaks est conservé et rendu accessible par défilement vertical.
   */
  public getVisibleBoatsWindow(): {
    visibleBoats: BoatRenderState[];
    startIndex: number;
    totalCount: number;
    visibleCount: number;
  } {
    const allBoats = Array.from(this.boatsMap.values());
    const totalCount = allBoats.length;
    this.totalBoatsCount = totalCount;
    if (totalCount === 0) {
      this.visibleBoatsCount = 0;
      return { visibleBoats: [], startIndex: 0, totalCount: 0, visibleCount: 0 };
    }

    const zoom = this.effectiveZoomLevel;

    // Tri par classement en direct (ou par dynamicLaneIndex si mode dynamique, ou par classement quand zoom > 1)
    const sorted = [...allBoats].sort((a, b) => {
      if (this.dynamicLaneMode && zoom <= 1) {
        return (a.dynamicLaneIndex ?? 0) - (b.dynamicLaneIndex ?? 0);
      }
      if (!this.dynamicLaneMode && zoom <= 1) {
        return (a.assignedLane || a.lane || 1) - (b.assignedLane || b.lane || 1);
      }
      // En zoom (> 1) ou classement : ordre de course du 1er au dernier
      const isFinA = a.status === 'finished' ? 1 : 0;
      const isFinB = b.status === 'finished' ? 1 : 0;
      if (isFinA !== isFinB) return isFinB - isFinA;
      if (Math.abs(b.currentDisplayDist - a.currentDisplayDist) > 0.1) {
        return b.currentDisplayDist - a.currentDisplayDist;
      }
      return (a.assignedLane || a.lane || 1) - (b.assignedLane || b.lane || 1);
    });

    this.visibleBoatsCount = totalCount;
    return {
      visibleBoats: sorted,
      startIndex: 0,
      totalCount,
      visibleCount: totalCount,
    };
  }

  /** Mode d'attribution des lignes d'eau : true = dynamique par classement (seuil 10m), false = fixe par ligne assignée */
  dynamicLaneMode: boolean = true;

  /** État de repli automatique du bouton Lignes dynamiques / fixes après 5s (icône seule) */
  isLaneModeCollapsed: boolean = false;
  readonly LANE_MODE_COLLAPSE_DELAY_MS = 5000;
  private laneModeCollapseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public i18n: I18nService,
    @Optional() private cdr?: ChangeDetectorRef
  ) {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('regatta_lane_mode');
      if (saved === 'fixed') {
        this.dynamicLaneMode = false;
      } else if (saved === 'dynamic') {
        this.dynamicLaneMode = true;
      }
    }
    this.scheduleLaneModeCollapse();
  }

  scheduleLaneModeCollapse(): void {
    this.clearLaneModeCollapseTimer();
    this.isLaneModeCollapsed = false;
    this.cdr?.markForCheck();
    this.laneModeCollapseTimer = setTimeout(() => {
      this.isLaneModeCollapsed = true;
      this.laneModeCollapseTimer = null;
      this.cdr?.markForCheck();
    }, this.LANE_MODE_COLLAPSE_DELAY_MS);
  }

  clearLaneModeCollapseTimer(): void {
    if (this.laneModeCollapseTimer !== null) {
      clearTimeout(this.laneModeCollapseTimer);
      this.laneModeCollapseTimer = null;
    }
  }

  toggleLaneMode(): void {
    this.dynamicLaneMode = !this.dynamicLaneMode;
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('regatta_lane_mode', this.dynamicLaneMode ? 'dynamic' : 'fixed');
    }
    this.scheduleLaneModeCollapse();
  }

  protected Math = Math;
  public sortedLeaderboard: LiveRacerMetric[] = [];

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

  public getRacerRank(userId: string): { rank: number; medal: string | null; label: string; color: string } | null {
    if (!userId) return null;
    let rankIndex = this.sortedLeaderboard.findIndex((r) => r.userId === userId);

    if (rankIndex < 0 && this.boatsMap.has(userId)) {
      const myBoat = this.boatsMap.get(userId)!;
      let aheadCount = 0;
      this.boatsMap.forEach((b) => {
        if (b.userId !== userId && b.currentDisplayDist > myBoat.currentDisplayDist) {
          aheadCount++;
        }
      });
      rankIndex = aheadCount;
    }

    if (rankIndex < 0) return null;
    const rank = rankIndex + 1;
    let medal: string | null = null;
    let label = `${rank}e`;
    let color = '#00f0ff';

    if (rank === 1) {
      medal = '🥇';
      label = '1er';
      color = '#ffd700';
    } else if (rank === 2) {
      medal = '🥈';
      label = '2e';
      color = '#e2e8f0';
    } else if (rank === 3) {
      medal = '🥉';
      label = '3e';
      color = '#cd7f32';
    }

    return { rank, medal, label, color };
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
    canvas.addEventListener('wheel', this.onCanvasWheel, { passive: false });
    this.startRenderLoop();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['racers'] && this.racers) {
      this.syncRacersData();
      this.updateLeaderboard();
    }
    if (changes['myKayakCustomization'] && this.activeUserId) {
      const myBoat = this.boatsMap.get(this.activeUserId);
      if (myBoat && this.myKayakCustomization) {
        myBoat.kayak = this.myKayakCustomization;
      }
    }
    if (changes['zoomLevel']) {
      this.resizeCanvas();
    }
  }

  ngOnDestroy(): void {
    this.clearLaneModeCollapseTimer();
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.onResize);
    const canvas = this.canvasRef?.nativeElement;
    if (canvas) {
      canvas.removeEventListener('wheel', this.onCanvasWheel);
    }
  }

  public onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.pointerStartY = event.clientY;
    this.startScrollY = this.scrollY;
    this.isPointerDragging = true;
    this.hasScrolledWhileDragging = false;
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {}
  }

  public onCanvasPointerMove(event: PointerEvent): void {
    if (!this.isPointerDragging) return;
    const dy = event.clientY - this.pointerStartY;
    if (Math.abs(dy) > 4) {
      this.hasScrolledWhileDragging = true;
      this.lastUserScrollTime = Date.now();
      if (this.maxScrollY > 0) {
        this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.startScrollY - dy));
      }
    }
  }

  public onCanvasPointerUp(event: PointerEvent): void {
    if (!this.isPointerDragging) return;
    this.isPointerDragging = false;
    try {
      const el = event.target as HTMLElement;
      if (el && el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
    } catch {}
    if (this.hasScrolledWhileDragging) {
      this.ignoreNextClick = true;
      setTimeout(() => {
        this.ignoreNextClick = false;
      }, 120);
    }
  }

  public onCanvasPointerCancel(event: PointerEvent): void {
    this.isPointerDragging = false;
    this.hasScrolledWhileDragging = false;
  }

  private onCanvasWheel = (event: WheelEvent): void => {
    if (this.maxScrollY <= 0) return;
    event.preventDefault();
    this.lastUserScrollTime = Date.now();
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + event.deltaY));
  };

  public formatGap(racer: LiveRacerMetric, leader: LiveRacerMetric): string {
    if (!racer || !leader || racer.userId === leader.userId) return 'Leader';
    const leaderDist = Number(leader.dist);
    const racerDist = Number(racer.dist);
    if (!Number.isFinite(leaderDist) || !Number.isFinite(racerDist)) return '--';
    const distDiff = Math.round(leaderDist - racerDist);
    if (distDiff <= 0) return 'Leader';
    let text = `-${distDiff}m`;
    const split = Number(racer.split);
    if (Number.isFinite(split) && split > 0 && split < 600) {
      const secDiff = (distDiff * split) / 500;
      if (Number.isFinite(secDiff) && secDiff > 0) {
        text += ` (+${secDiff.toFixed(1)}s)`;
      }
    }
    return text;
  }

  public selectRacerToFollow(userId: string): void {
    this.racerSelected.emit(userId);
  }

  public isBotBoat(boat: BoatRenderState | null | undefined): boolean {
    if (!boat) return false;
    return Boolean(
      boat.isBot ||
      String(boat.userId || '').toLowerCase().startsWith('bot_') ||
      /\(bot\)/i.test(String(boat.name || ''))
    );
  }

  public canClaimBoat(boat: BoatRenderState | null | undefined): boolean {
    if (!this.canSelectKayak || !boat) return false;
    if (this.isBotBoat(boat)) return false;
    if (boat.isPaired || (boat as any).deviceToken) return false;
    return true;
  }

  public claimSelectedKayak(userId: string): void {
    const boat = this.boatsMap.get(userId) || this.selectedKayakForClaim;
    if (!this.canClaimBoat(boat)) {
      this.selectedKayakForClaim = null;
      return;
    }
    this.kayakClaimed.emit(userId);
    this.selectedKayakForClaim = null;
  }

  public onCanvasClick(event: MouseEvent): void {
    if (this.ignoreNextClick) {
      this.ignoreNextClick = false;
      return;
    }
    const canvas = this.canvasRef?.nativeElement;
    const wrapper = this.wrapperRef?.nativeElement;
    if (!canvas || !wrapper || this.boatsMap.size === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const zoom = this.effectiveZoomLevel;
    const { visibleBoats } = this.getVisibleBoatsWindow();
    const boatCount = Math.max(1, visibleBoats.length);

    const isCompact = this.cssWidth < 520;
    const baseMarginX = isCompact ? 36 : 64;
    const marginX = Math.round(baseMarginX + (zoom - 1) * (isCompact ? 12 : 18));
    const rightPad = isCompact ? 24 : 40;
    const trackW = Math.max(120, this.cssWidth - marginX - rightPad);

    const isSmallLandscape = (typeof window !== 'undefined' && window.innerHeight <= 500) || this.cssHeight <= 320;
    const topOffset = isSmallLandscape ? 24 : (isCompact ? 38 : 46);
    const bottomPad = isSmallLandscape ? 8 : (isCompact ? 12 : 20);
    const availableLaneH = Math.max(20, this.cssHeight - topOffset - bottomPad);
    const minLaneH = isSmallLandscape ? 26 : 34;
    const baseMaxLaneH = isSmallLandscape ? 38 : 48;
    const baseLaneH = Math.max(minLaneH, Math.min(baseMaxLaneH, availableLaneH / boatCount));
    const laneH = zoom > 1
      ? Math.max(baseLaneH * zoom * 0.95, baseLaneH + (zoom - 1) * (isSmallLandscape ? 16 : 22))
      : baseLaneH;

    let foundBoat: BoatRenderState | null = null;

    for (let idx = 0; idx < visibleBoats.length; idx++) {
      const boat = visibleBoats[idx];
      const y = topOffset + (idx + 0.5) * laneH - this.scrollY;
      const progress = Math.min(1.0, Math.max(0, boat.currentDisplayDist / (this.targetDistance || 2000)));
      const rawX = marginX + trackW * progress;
      const x = rawX - this.cameraX;

      if (Math.abs(clickY - y) <= laneH * 0.75 && Math.abs(clickX - x) <= 60 * Math.min(1.8, zoom)) {
        foundBoat = boat;
        break;
      }
    }

    if (foundBoat) {
      this.selectedKayakForClaim = foundBoat;
      this.claimPopupPos = {
        x: Math.max(10, Math.min(this.cssWidth - 220, clickX - 80)),
        y: Math.max(10, Math.min(this.cssHeight - 80, clickY - 45))
      };
    } else {
      this.selectedKayakForClaim = null;
    }
  }

  private onResize = () => {
    this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const wrapper = this.wrapperRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const maxAssigned = Array.from(this.boatsMap.values()).reduce((max, b) => Math.max(max, b.assignedLane || b.lane || 1), this.boatsMap.size);
    const boatCount = Math.max(1, Math.max(this.boatsMap.size, maxAssigned));
    const isSmallLandscape = typeof window !== 'undefined' && window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
    if (wrapper) {
      if (isSmallLandscape) {
        wrapper.style.minHeight = '0px';
      } else {
        const dynamicMinHeight = Math.max(200, Math.min(600, 40 + boatCount * 32));
        wrapper.style.minHeight = `${dynamicMinHeight}px`;
      }
    }

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    const width = Math.max(260, wrapper?.clientWidth || 900);
    const height = Math.max(isSmallLandscape ? 80 : 200, wrapper?.clientHeight || (isSmallLandscape ? 120 : 260));

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
      const clampedDist = this.targetDistance > 0
        ? Math.min(this.targetDistance, Math.round(r.dist || 0))
        : Math.round(r.dist || 0);
      const isFinished = r.status === 'finished' || (r.status as string) === 'completed' || (this.targetDistance > 0 && clampedDist >= this.targetDistance);
      const effectiveDist = isFinished && this.targetDistance > 0 ? this.targetDistance : clampedDist;

      let boat = this.boatsMap.get(r.userId);
      const racerKayak = (r.userId === this.activeUserId && this.myKayakCustomization)
        ? this.myKayakCustomization
        : r.kayak;
      const assignedLane = Number(r.lane) || (idx + 1);
      const initialLaneIdx = Math.max(0, assignedLane - 1);

      if (!boat) {
        boat = {
          userId: r.userId,
          name: r.name,
          lane: assignedLane,
          assignedLane: assignedLane,
          dynamicLaneIndex: initialLaneIdx,
          currentLaneIndex: initialLaneIdx,
          currentDisplayDist: effectiveDist,
          targetPacketDist: effectiveDist,
          splitSec: r.split || 120,
          watts: r.watts || 0,
          spm: r.spm || 0,
          lastPacketTime: now,
          color: this.boatColors[idx % this.boatColors.length],
          status: isFinished ? 'finished' : r.status,
          ready: r.ready !== undefined ? r.ready : (r.connectionState !== 'CONNECTED'),
          connectionState: r.connectionState || (r.ready === false ? 'CONNECTED' : 'READY'),
          isBot: Boolean(r.isBot || String(r.userId || '').toLowerCase().startsWith('bot_') || /\(bot\)/i.test(String(r.name || ''))),
          isPaired: Boolean(r.isPaired),
          kayak: racerKayak
        };
        this.boatsMap.set(r.userId, boat);
      } else {
        const isGarminTech = (n: string) => n.startsWith('Garmin_') || n.startsWith('fenix') || n.startsWith('forerunner');
        if (r.name && (!boat.name || !isGarminTech(r.name) || isGarminTech(boat.name))) {
          boat.name = r.name;
        }
        if (r.lane && Number(r.lane) > 0) {
          boat.lane = Number(r.lane);
          boat.assignedLane = Number(r.lane);
        }
        boat.isBot = Boolean(r.isBot || String(r.userId || '').toLowerCase().startsWith('bot_') || /\(bot\)/i.test(String(r.name || '')));
        boat.isPaired = Boolean(r.isPaired);
        boat.status = isFinished ? 'finished' : r.status;
        boat.kayak = racerKayak;
        // Protection anti-recul : la distance cible ne régresse jamais, sauf réinitialisation de course (r.dist === 0)
        if ((r.dist || 0) === 0 && boat.targetPacketDist > 50 && !isFinished) {
          boat.targetPacketDist = 0;
          boat.currentDisplayDist = 0;
        } else if (isFinished && this.targetDistance > 0) {
          boat.targetPacketDist = this.targetDistance;
          boat.currentDisplayDist = this.targetDistance;
        } else {
          boat.targetPacketDist = this.targetDistance > 0
            ? Math.min(this.targetDistance, Math.max(boat.targetPacketDist, effectiveDist))
            : Math.max(boat.targetPacketDist, effectiveDist);
        }
        boat.splitSec = r.split > 0 ? r.split : boat.splitSec;
        boat.watts = r.watts;
        boat.spm = r.spm;
        boat.lastPacketTime = now;
        boat.color = this.boatColors[idx % this.boatColors.length];
        boat.ready = r.ready !== undefined ? r.ready : (r.connectionState !== 'CONNECTED');
        boat.connectionState = r.connectionState || (r.ready === false ? 'CONNECTED' : 'READY');
      }
    });

    for (const existingId of Array.from(this.boatsMap.keys())) {
      if (!activeIds.has(existingId)) {
        this.boatsMap.delete(existingId);
      }
    }
  }

  private updateLeaderboard(): void {
    this.sortedLeaderboard = [...this.racers].sort((a, b) => {
      const isFinA = a.status === 'finished' || (this.targetDistance > 0 && (a.dist || 0) >= this.targetDistance) ? 1 : 0;
      const isFinB = b.status === 'finished' || (this.targetDistance > 0 && (b.dist || 0) >= this.targetDistance) ? 1 : 0;
      if (isFinA !== isFinB) return isFinB - isFinA;
      return (b.dist || 0) - (a.dist || 0);
    });
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

  private updateDynamicLanes(): void {
    if (this.boatsMap.size <= 1) return;

    const boatsList = Array.from(this.boatsMap.values());
    const laneIndexSet = new Set(boatsList.map((b) => b.dynamicLaneIndex));

    // Si les indices dynamiques ne sont pas encore tous uniques
    if (laneIndexSet.size !== boatsList.length) {
      boatsList.sort((a, b) => {
        const isFinA = a.status === 'finished' ? 1 : 0;
        const isFinB = b.status === 'finished' ? 1 : 0;
        if (isFinA !== isFinB) return isFinB - isFinA;
        if (Math.abs(b.currentDisplayDist - a.currentDisplayDist) > 0.1) {
          return b.currentDisplayDist - a.currentDisplayDist;
        }
        return (a.assignedLane || 1) - (b.assignedLane || 1);
      });
      boatsList.forEach((b, i) => {
        b.dynamicLaneIndex = i;
        if (b.currentLaneIndex === undefined) {
          b.currentLaneIndex = i;
        }
      });
      return;
    }

    // Classer par couloir actuel (0 = L1 en tête, 1 = L2, etc.)
    boatsList.sort((a, b) => a.dynamicLaneIndex - b.dynamicLaneIndex);

    // Seuil de dépassement net (environ 10m / une longueur de coup de rame)
    const OVERTAKE_THRESHOLD_M = 10;

    for (let i = boatsList.length - 2; i >= 0; i--) {
      const topBoat = boatsList[i];
      const botBoat = boatsList[i + 1];

      const topFinished = topBoat.status === 'finished';
      const botFinished = botBoat.status === 'finished';

      let shouldSwap = false;
      if (botFinished && !topFinished) {
        shouldSwap = true;
      } else if (!topFinished || !botFinished) {
        if (botBoat.currentDisplayDist >= topBoat.currentDisplayDist + OVERTAKE_THRESHOLD_M) {
          shouldSwap = true;
        }
      }

      if (shouldSwap) {
        const tempLane = topBoat.dynamicLaneIndex;
        topBoat.dynamicLaneIndex = botBoat.dynamicLaneIndex;
        botBoat.dynamicLaneIndex = tempLane;

        boatsList[i] = botBoat;
        boatsList[i + 1] = topBoat;
      }
    }
  }

  private updateBoatsPhysics(deltaT: number): void {
    if (this.dynamicLaneMode) {
      this.updateDynamicLanes();
    }

    this.boatsMap.forEach((boat) => {
      const targetLaneIdx = this.dynamicLaneMode
        ? (boat.dynamicLaneIndex !== undefined ? boat.dynamicLaneIndex : Math.max(0, (boat.assignedLane || boat.lane || 1) - 1))
        : Math.max(0, (boat.assignedLane || boat.lane || 1) - 1);

      if (boat.currentLaneIndex === undefined) {
        boat.currentLaneIndex = targetLaneIdx;
      } else {
        const diffY = targetLaneIdx - boat.currentLaneIndex;
        if (Math.abs(diffY) < 0.005) {
          boat.currentLaneIndex = targetLaneIdx;
        } else {
          // Glisse verticale fluide : lerp avec amortissement
          boat.currentLaneIndex += diffY * Math.min(1.0, deltaT * 3.5);
        }
      }

      if (boat.status === 'finished' || (this.targetDistance > 0 && boat.targetPacketDist >= this.targetDistance)) {
        if (this.targetDistance > 0) {
          boat.targetPacketDist = this.targetDistance;
          boat.currentDisplayDist = this.targetDistance;
        }
        return;
      }

      const prevDisplay = boat.currentDisplayDist;
      const diff = boat.targetPacketDist - boat.currentDisplayDist;
      if (diff > 0) {
        if (diff < 0.8) {
          boat.currentDisplayDist = boat.targetPacketDist;
        } else {
          boat.currentDisplayDist = Math.min(boat.targetPacketDist, boat.currentDisplayDist + Math.max(0.15, diff * 0.30));
        }
      }
      // Règle d'or : le kayak ne recule jamais sur l'eau (monotonie absolue)
      boat.currentDisplayDist = Math.max(prevDisplay, boat.currentDisplayDist);

      if (this.targetDistance > 0 && boat.currentDisplayDist > this.targetDistance) {
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
    const zoom = this.effectiveZoomLevel;

    // 1. Fond plan d'eau dynamique
    ctx.fillStyle = '#060d1d';
    ctx.fillRect(0, 0, w, h);

    const { visibleBoats, startIndex } = this.getVisibleBoatsWindow();
    const maxAssigned = visibleBoats.reduce((max, b) => Math.max(max, b.assignedLane || b.lane || 1), visibleBoats.length);
    const boatCount = Math.max(1, Math.max(visibleBoats.length, maxAssigned));

    const isSmallLandscape = (typeof window !== 'undefined' && window.innerHeight <= 500) || h <= 320;
    const baseMarginX = isCompact ? 36 : 64;
    const marginX = Math.round(baseMarginX + (zoom - 1) * (isCompact ? 12 : 18));
    const rightPad = isCompact ? 24 : 40;
    const trackW = Math.max(120, w - marginX - rightPad);

    const baseTopOffset = isSmallLandscape ? 24 : (isCompact ? 38 : 46);
    const topOffset = isSmallLandscape ? 24 : (isCompact ? 38 : 46);
    const bottomPad = isSmallLandscape ? 8 : (isCompact ? 12 : 20);
    const availableLaneH = Math.max(20, h - topOffset - bottomPad);

    const minLaneH = isSmallLandscape ? 26 : 34;
    const baseMaxLaneH = isSmallLandscape ? 38 : 48;
    const baseLaneH = Math.max(minLaneH, Math.min(baseMaxLaneH, availableLaneH / boatCount));
    const laneH = zoom > 1
      ? Math.max(baseLaneH * zoom * 0.95, baseLaneH + (zoom - 1) * (isSmallLandscape ? 16 : 22))
      : baseLaneH;

    const totalTrackH = topOffset + boatCount * laneH + bottomPad;
    this.maxScrollY = Math.max(0, Math.round(totalTrackH - h));
    if (this.scrollY > this.maxScrollY) {
      this.scrollY = this.maxScrollY;
    }
    if (this.scrollY < 0) {
      this.scrollY = 0;
    }

    // Centrage automatique intelligent sur le joueur lorsqu'il ne fait pas défiler manuellement
    if (this.maxScrollY > 0 && Date.now() - this.lastUserScrollTime > 3500) {
      const targetUserId = this.effectiveFocusedUserId;
      const targetIdx = targetUserId ? visibleBoats.findIndex((b) => b.userId === targetUserId) : -1;
      if (targetIdx >= 0) {
        const targetCenterY = topOffset + (targetIdx + 0.5) * laneH;
        const desiredScrollY = Math.max(0, Math.min(this.maxScrollY, targetCenterY - h / 2));
        this.scrollY += (desiredScrollY - this.scrollY) * 0.06;
      }
    }

    // Facteur d'échelle typographique maximisant la taille de la police selon le zoom et la hauteur de couloir
    const laneRatio = Math.max(1, laneH / (isSmallLandscape ? 26 : 36));
    const fontScale = zoom > 1
      ? Math.min(zoom * 1.05, Math.max(1 + (zoom - 1) * 0.65, Math.min(2.8, laneRatio * 0.92)))
      : 1;
    const boatScale = zoom > 1
      ? Math.min(2.1, 1 + (zoom - 1) * 0.42)
      : 1;

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

    // 2. Zone scrollable du plan d'eau (lignes, bouées, couloirs et kayaks)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topOffset, w, h - topOffset);
    ctx.clip();

    const markers = w < 380 ? [0, 0.5, 1.0] : [0, 0.25, 0.5, 0.75, 1.0];
    const markerFontPx = Math.round((isCompact ? 10 : 11) * Math.min(1.85, 1 + (zoom - 1) * 0.4));
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.lineWidth = 1;

    markers.forEach((pct) => {
      const x = marginX + trackW * pct - camOffset;
      if (x < -20 || x > w + 20) return;
      ctx.beginPath();
      ctx.moveTo(x, topOffset - this.scrollY);
      ctx.lineTo(x, topOffset + boatCount * laneH - this.scrollY);
      ctx.stroke();
    });

    // Ligne d'arrivée
    const finishX = marginX + trackW - camOffset;
    ctx.strokeStyle = '#ffe600';
    ctx.lineWidth = 2.5 * Math.min(1.5, boatScale);
    ctx.beginPath();
    ctx.moveTo(finishX, topOffset - this.scrollY);
    ctx.lineTo(finishX, topOffset + boatCount * laneH - this.scrollY);
    ctx.stroke();

    // Bouées de balisage le long des couloirs et de la ligne d'arrivée
    const buoyRadius = (isSmallLandscape ? 1.5 : 2.5) * Math.min(1.6, boatScale);
    const finishBuoyRadius = (isSmallLandscape ? 2.0 : 3.0) * Math.min(1.6, boatScale);
    for (let l = 0; l <= boatCount; l++) {
      const buoyY = topOffset + l * laneH - this.scrollY;
      if (buoyY < topOffset - 20 || buoyY > h + 20) continue;
      markers.forEach((pct) => {
        const bx = marginX + trackW * pct - camOffset;
        if (bx >= -10 && bx <= w + 10) {
          ctx.fillStyle = '#ff0055';
          ctx.beginPath();
          ctx.arc(bx, buoyY, buoyRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      if (finishX >= -10 && finishX <= w + 10) {
        ctx.fillStyle = '#ffe600';
        ctx.beginPath();
        ctx.arc(finishX, buoyY, finishBuoyRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (visibleBoats.length === 0) {
      const emptyFontPx = Math.round((isCompact ? 12 : 14) * fontScale);
      ctx.font = `600 ${emptyFontPx}px sans-serif`;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
      const emptyMsg = this.i18n.t('CANVAS_WAITING');
      const msgW = ctx.measureText(emptyMsg).width;
      ctx.fillText(emptyMsg, Math.max(10, (w - msgW) / 2), h / 2 + 6);
      ctx.restore();
      return;
    }

    // 3. Couloirs visibles du plan d'eau (police maximisée avec le zoom)
    const laneFontPx = Math.min(Math.floor(laneH * 0.45), Math.round((isCompact ? 10 : 11.5) * fontScale));
    for (let l = 0; l < boatCount; l++) {
      const laneY = topOffset + (l + 0.5) * laneH - this.scrollY;
      if (laneY < topOffset - laneH || laneY > h + laneH) continue;
      const boatInLane = this.dynamicLaneMode ? visibleBoats[l] : visibleBoats.find(b => (b.assignedLane || b.lane || 1) === (l + 1));
      const displayLaneNum = (zoom > 1 || this.dynamicLaneMode)
        ? (startIndex + l + 1)
        : (l + 1);
      const laneLabel = isCompact ? `L${displayLaneNum}` : `${this.i18n.t('CANVAS_LANE')} ${displayLaneNum}`;
      ctx.font = `bold ${Math.max(9, laneFontPx)}px monospace`;
      ctx.fillStyle = boatInLane?.userId === this.activeUserId ? '#00f0ff' : 'rgba(0, 240, 255, 0.72)';
      ctx.fillText(laneLabel, Math.round(12 + 4 * boatScale), laneY + Math.round(laneFontPx * 0.35));

      // Séparateur de couloir
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = zoom > 1 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(marginX, topOffset + (l + 1) * laneH - this.scrollY);
      ctx.lineTo(finishX + camOffset, topOffset + (l + 1) * laneH - this.scrollY);
      ctx.stroke();
    }

    // 4. Dessin des kayaks visibles avec texte agrandi au maximum selon le zoom
    const hullRx = (isCompact ? 14 : 18) * boatScale;
    const hullRy = Math.min(laneH * 0.24, (isCompact ? 4.5 : 5) * boatScale);

    visibleBoats.forEach((boat, visibleIdx) => {
      // Si zoom actif (> 1), positionner chaque kayak visible dans son couloir zoomé (0..visibleCount-1)
      const effectiveLaneIdx = zoom > 1
        ? visibleIdx
        : (this.dynamicLaneMode
            ? (boat.currentLaneIndex !== undefined ? Math.min(boatCount - 1, Math.max(0, boat.currentLaneIndex)) : visibleIdx)
            : Math.max(0, (boat.assignedLane || boat.lane || 1) - 1));
      const y = topOffset + (effectiveLaneIdx + 0.5) * laneH - this.scrollY;
      if (y < topOffset - laneH * 1.5 || y > h + laneH * 1.5) return;
      const progress = Math.min(1.0, Math.max(0, boat.currentDisplayDist / (this.targetDistance || 2000)));
      const rawX = marginX + trackW * progress;
      const x = rawX - camOffset;

      const isUser = boat.userId === this.activeUserId;
      const isFocused = boat.userId === this.effectiveFocusedUserId;
      const rawCustom = boat.kayak || (isUser ? this.myKayakCustomization : undefined);
      const custom = rawCustom ? sanitizeKayakCustomization(rawCustom) : undefined;
      const effectiveHullColor = custom?.hullColor || (isUser ? '#00e5ff' : boat.color);
      const effectiveBladeColor = custom?.bladeColor || (isUser ? '#00f0ff' : boat.color);
      const effectiveGlowColor = custom?.glowColor || (isUser ? '#00f0ff' : '#ffe600');
      const effectivePattern = custom?.pattern || (isUser ? 'racing-stripe' : 'solid');

      // Voyant BLE (Orange = CONNECTED / En attente du rameur, Vert = READY / Rameur prêt)
      const isBoatReady = boat.ready !== false && boat.connectionState !== 'CONNECTED';
      ctx.fillStyle = isBoatReady ? '#22c55e' : '#f97316';
      ctx.beginPath();
      ctx.arc(7, y, (isCompact ? 3 : 3.8) * Math.min(1.6, boatScale), 0, Math.PI * 2);
      ctx.fill();

      const isMoving = (boat.spm > 0 || (boat.splitSec > 0 && boat.currentDisplayDist > 0)) &&
        boat.currentDisplayDist < (this.targetDistance || 2000);
      const effectiveSpm = boat.spm > 0 ? boat.spm : (isMoving ? 26 : 0);
      const strokeFreq = effectiveSpm > 0 ? effectiveSpm / 60 : 0;
      const laneOffset = (boat.lane || visibleIdx) * 1.1;
      const strokeAngle = isMoving
        ? Math.sin(nowSec * strokeFreq * Math.PI * 2 + laneOffset) * 0.58
        : 0;

      const oarLen = Math.min(laneH * 0.42, (isCompact ? 7 : 9) * boatScale);
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
        ctx.fillStyle = hexToRgba(effectiveGlowColor, 0.40);
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 6 * boatScale), y, (isCompact ? 16 : 24) * boatScale, (isCompact ? 4.5 : 6) * boatScale, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexToRgba(effectiveGlowColor, 0.20);
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 16 * boatScale), y, (isCompact ? 24 : 36) * boatScale, (isCompact ? 6 : 8) * boatScale, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const wakeColor = custom ? hexToRgba(effectiveGlowColor, 0.25) : 'rgba(0, 240, 255, 0.18)';
        ctx.fillStyle = wakeColor;
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx + 2), y, (isCompact ? 9 : 13) * boatScale, 3.5 * boatScale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Éclaboussures d'attaque
      if (isMoving && Math.abs(strokeAngle) > 0.25) {
        ctx.fillStyle = isUser ? 'rgba(0, 240, 255, 0.6)' : 'rgba(0, 240, 255, 0.38)';
        ctx.beginPath();
        ctx.arc(x1, y1, (isCompact ? 1.8 : 2.4) * boatScale, 0, Math.PI * 2);
        ctx.arc(x2, y2, (isCompact ? 1.8 : 2.4) * boatScale, 0, Math.PI * 2);
        ctx.fill();
      }

      // =========================================================================
      // MISE EN VALEUR JOUEUR CONNECTÉ : Halo lumineux / Contour fluo (Glow)
      // =========================================================================
      if (isUser || isFocused || custom) {
        ctx.save();
        ctx.shadowColor = effectiveGlowColor;
        ctx.shadowBlur = (isUser || isFocused) ? (14 + Math.sin(nowSec * 5) * 5) : 8;
        ctx.strokeStyle = effectiveGlowColor;
        ctx.lineWidth = ((isUser || isFocused) ? 2.5 : 1.5) * Math.min(1.5, boatScale);
        ctx.beginPath();
        ctx.ellipse(x, y, hullRx + 4 * boatScale, hullRy + 3 * boatScale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Rames
      ctx.strokeStyle = isUser ? '#00f0ff' : '#e2e8f0';
      ctx.lineWidth = (isCompact ? 1.4 : 1.8) * Math.min(1.6, boatScale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Pelles
      ctx.fillStyle = effectiveBladeColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;

      // Pelle bâbord
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(-strokeAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, (isCompact ? 2.5 : 3.2) * boatScale, (isCompact ? 1.5 : 2.0) * boatScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Pelle tribord
      ctx.save();
      ctx.translate(x2, y2);
      ctx.rotate(-strokeAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, (isCompact ? 2.5 : 3.2) * boatScale, (isCompact ? 1.5 : 2.0) * boatScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Coque de base
      ctx.save();
      const traceHull = () => {
        ctx.beginPath();
        ctx.moveTo(x + hullRx, y);
        ctx.quadraticCurveTo(x, y - hullRy, x - hullRx, y);
        ctx.quadraticCurveTo(x, y + hullRy, x + hullRx, y);
        ctx.closePath();
      };

      traceHull();

      if (effectivePattern === 'gradient') {
        const grad = ctx.createLinearGradient(x - hullRx, y, x + hullRx, y);
        grad.addColorStop(0, effectiveBladeColor);
        grad.addColorStop(1, effectiveHullColor);
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (effectivePattern === 'dual-tone') {
        ctx.fillStyle = effectiveHullColor;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = effectiveBladeColor;
        ctx.fillRect(x - hullRx, y - hullRy * 2, hullRx, hullRy * 4);
        ctx.restore();
      } else {
        ctx.fillStyle = effectiveHullColor;
        ctx.fill();
      }

      // Racing stripes pattern
      if (effectivePattern === 'racing-stripe') {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = (isCompact ? 1.0 : 1.4) * Math.min(1.5, boatScale);
        ctx.beginPath();
        ctx.moveTo(x - hullRx + 2, y - 1.2 * boatScale);
        ctx.lineTo(x + hullRx - 2, y - 1.2 * boatScale);
        ctx.moveTo(x - hullRx + 2, y + 1.2 * boatScale);
        ctx.lineTo(x + hullRx - 2, y + 1.2 * boatScale);
        ctx.stroke();
        ctx.restore();
      }

      traceHull();
      ctx.strokeStyle = isUser ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = isUser ? 1.5 * Math.min(1.5, boatScale) : 1;
      ctx.stroke();
      ctx.restore();

      // Cockpit
      ctx.fillStyle = '#060913';
      ctx.beginPath();
      ctx.ellipse(x - 1, y, hullRx * 0.36, hullRy * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rameur
      ctx.fillStyle = isUser ? '#ffe600' : '#fcd34d';
      ctx.beginPath();
      ctx.arc(x - hullRx * 0.12, y, (isCompact ? 2.2 : 2.8) * boatScale, 0, Math.PI * 2);
      ctx.fill();

      // =========================================================================
      // MISE EN VALEUR : Flèche animée et bannière avec pseudo en surbrillance
      // Taille de police maximisée au fur et à mesure que le zoom augmente
      // =========================================================================
      const shortName = isCompact && boat.name.length > 10 ? `${boat.name.slice(0, 9)}…` : boat.name;
      const baseLabelPx = isCompact ? 10 : 11.5;
      const labelFontPx = Math.min(Math.floor(laneH * 0.38), Math.max(10, Math.round(baseLabelPx * fontScale)));

      if (isUser || isFocused) {
        // Flèche animée qui flotte au-dessus du bateau
        const arrowBounce = Math.sin(nowSec * 5.5) * 3;
        const rawArrowY = y - (hullRy + 12 * boatScale) + arrowBounce;
        const arrowY = Math.max(22, rawArrowY);
        ctx.fillStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.beginPath();
        ctx.moveTo(x, arrowY + 4 * boatScale);
        ctx.lineTo(x - 4.5 * boatScale, arrowY - 3 * boatScale);
        ctx.lineTo(x + 4.5 * boatScale, arrowY - 3 * boatScale);
        ctx.closePath();
        ctx.fill();

        // Bannière avec pseudo en surbrillance (affiche la distance officielle exacte targetPacketDist)
        const bannerLabel = `${isUser ? '★ VOUS' : '👁 SUIVI'} : ${shortName} · ${Math.round(boat.targetPacketDist)}m`;
        ctx.font = `bold ${labelFontPx}px sans-serif`;
        const btw = ctx.measureText(bannerLabel).width;
        const boxPadX = Math.round(5 * Math.min(1.8, fontScale));
        const boxH = Math.round(labelFontPx + 6 * Math.min(1.6, fontScale));
        const bx = Math.max(6, Math.min(w - btw - boxPadX * 2 - 4, x - btw / 2));
        const by = Math.max(14, arrowY - 14);

        // Fond bannière
        ctx.fillStyle = 'rgba(6, 15, 33, 0.92)';
        ctx.fillRect(bx - boxPadX, by - Math.round(labelFontPx * 0.88), btw + boxPadX * 2, boxH);
        ctx.strokeStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.lineWidth = 1.4 * Math.min(1.5, boatScale);
        ctx.strokeRect(bx - boxPadX, by - Math.round(labelFontPx * 0.88), btw + boxPadX * 2, boxH);

        ctx.fillStyle = isUser ? '#00f0ff' : '#ffe600';
        ctx.fillText(bannerLabel, bx, by);
      } else {
        // Label standard (affiche la distance officielle exacte targetPacketDist) avec fond semi-transparent en zoom pour lisibilité maximale
        const text = `${shortName} · ${Math.round(boat.targetPacketDist)}m`;
        ctx.font = `bold ${labelFontPx}px sans-serif`;
        const tw = ctx.measureText(text).width;
        const lx = Math.max(6, Math.min(w - tw - 8, x - tw / 2));
        const ly = Math.max(12, y - 9);
        if (zoom > 1) {
          const pad = Math.round(4 * Math.min(1.6, fontScale));
          ctx.fillStyle = 'rgba(6, 15, 33, 0.78)';
          ctx.fillRect(lx - pad, ly - Math.round(labelFontPx * 0.86), tw + pad * 2, Math.round(labelFontPx + 4));
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, lx, ly);
      }

      // =========================================================================
      // INDICATEUR DEVANT LE RAMEUR DU JOUEUR CONNECTÉ DANS SA LIGNE D'EAU
      // Classement avec médaille (Or, Argent, Bronze si 1er, 2e, 3e) + Distance restante
      // Police maximisée avec le zoom
      // =========================================================================
      if (isUser && (this.isRaceActive || (boat.currentDisplayDist > 0 && boat.status !== 'finished'))) {
        const rankInfo = this.getRacerRank(boat.userId);
        const remainingDist = Math.max(0, Math.round((this.targetDistance || 2000) - boat.targetPacketDist));
        const distLabel = remainingDist > 0 ? `${remainingDist}m` : 'Arrivé !';

        let badgeText = '';
        if (rankInfo) {
          if (rankInfo.medal) {
            badgeText = `${rankInfo.medal} ${rankInfo.label} · ${distLabel}`;
          } else {
            badgeText = `${rankInfo.label} · ${distLabel}`;
          }
        } else {
          badgeText = distLabel;
        }

        const badgeColor = rankInfo?.color || '#00f0ff';
        const badgeFontPx = Math.min(Math.floor(laneH * 0.42), Math.max(10, Math.round((isCompact ? 9.5 : 11.5) * fontScale)));
        ctx.font = `bold ${badgeFontPx}px sans-serif`;
        const badgeTextWidth = ctx.measureText(badgeText).width;
        const padX = Math.round((isCompact ? 6 : 8) * Math.min(1.8, fontScale));
        const badgeW = badgeTextWidth + padX * 2;
        const badgeH = Math.min(laneH * 0.78, Math.max(16, Math.round(badgeFontPx + 8 * Math.min(1.6, fontScale))));

        const gap = Math.round((isCompact ? 8 : 12) * boatScale);
        const frontBadgeX = x + hullRx + gap;
        let badgeX = frontBadgeX;

        if (frontBadgeX + badgeW > w - 6) {
          badgeX = x - hullRx - gap - badgeW;
          if (badgeX < 4) {
            badgeX = 4;
          }
        }
        const badgeY = y - badgeH / 2;

        ctx.save();
        ctx.fillStyle = 'rgba(6, 15, 33, 0.92)';
        ctx.strokeStyle = badgeColor;
        ctx.lineWidth = 1.4 * Math.min(1.5, boatScale);
        ctx.shadowColor = badgeColor;
        ctx.shadowBlur = (rankInfo?.rank && rankInfo.rank <= 3) ? 8 : 4;

        const radius = badgeH / 2;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${badgeFontPx}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX + padX, y);
        ctx.restore();
      }
    });
    ctx.restore();

    // 5. Repères de distance épinglés en haut du plan d'eau
    ctx.font = `700 ${markerFontPx}px monospace`;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
    markers.forEach((pct) => {
      const x = marginX + trackW * pct - camOffset;
      if (x < -20 || x > w + 20) return;
      const label = `${Math.round(pct * this.targetDistance)}m`;
      const tw = ctx.measureText(label).width;
      const tx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
      ctx.fillText(label, tx, Math.max(markerFontPx + 2, topOffset - 6));
    });

    // 6. Barre de défilement verticale élégante (si contenu scrollable)
    if (this.maxScrollY > 0) {
      const scrollbarW = 4;
      const scrollbarX = w - scrollbarW - 4;
      const trackTop = topOffset + 2;
      const trackH = Math.max(20, h - topOffset - bottomPad - 4);
      const thumbH = Math.max(20, Math.round((h / totalTrackH) * trackH));
      const thumbY = trackTop + Math.round((this.scrollY / this.maxScrollY) * (trackH - thumbH));

      ctx.save();
      ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
      ctx.fillRect(scrollbarX, trackTop, scrollbarW, trackH);

      ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 4;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(scrollbarX, thumbY, scrollbarW, thumbH, 2);
        ctx.fill();
      } else {
        ctx.fillRect(scrollbarX, thumbY, scrollbarW, thumbH);
      }
      ctx.restore();
    }
  }
}

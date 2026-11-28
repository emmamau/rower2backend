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
  Optional,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveRacerMetric } from '../../services/socket.service';
import {
  KayakCustomization,
  sanitizeKayakCustomization,
  hexToRgba,
  RegattaPreferences,
  RegattaMetricKey,
  KayakNamePosition,
  DEFAULT_REGATTA_PREFERENCES
} from '../../models/user.model';
import { I18nService } from '../../services/i18n.service';
import { RaceCanvasModeService, RaceCanvasMode, DEFAULT_RACE_CANVAS_MODE } from '../../services/race-canvas-mode.service';
import { RaceMinimapComponent, MinimapFrame } from './race-minimap.component';
import {
  PIXELS_PER_METER,
  BUOY_SPACING_M,
  DISTANCE_MARK_M,
  SIGN_MARK_M,
  BUOY_RED_END_M,
  computeFollowCameraTarget,
  smoothCameraX,
  boatScreenX,
  visibleRangeM,
  multiplesInRange,
  buoyColorAt,
  computeOffscreenBadges
} from './race-camera';

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
  currentSpeedMs: number;
  targetSpeedMs: number;
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
  imports: [CommonModule, RaceMinimapComponent],
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
      <!-- Mini-map tactique (mode follow_camera) -->
      <app-race-minimap
        #minimap
        *ngIf="isFollowMode"
        [heightPx]="minimapHeight"
        [style.height.px]="minimapHeight"
        (racerSelect)="onFollowSelect($event)"></app-race-minimap>

      <!-- Bouton de recentrage sur son propre kayak -->
      <button
        type="button"
        class="recenter-btn"
        *ngIf="showRecenterButton"
        (click)="recenterOnMyBoat()">
        🎯 Recentrer sur mon kayak
      </button>

      <div class="canvas-top-left-controls" [style.top.px]="isFollowMode ? minimapHeight + 8 : null">
        <button
          type="button"
          class="lane-mode-toggle"
          [class.is-collapsed]="isLaneModeCollapsed"
          (click)="toggleLaneMode()"
          [title]="dynamicLaneMode ? i18n.t('CANVAS_DYNAMIC_MODE_TIP') : i18n.t('CANVAS_FIXED_MODE_TIP')">
          <span class="mode-icon">{{ dynamicLaneMode ? '⚡' : '⚓' }}</span>
          <span class="mode-label">{{ dynamicLaneMode ? i18n.t('CANVAS_DYNAMIC_LANES') : i18n.t('CANVAS_FIXED_LANES') }}</span>
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
            {{ i18n.t('CANVAS_CLAIM_MY_KAYAK') }}
          </button>
          <button
            type="button"
            class="btn-spectate"
            (click)="selectRacerToFollow(selectedKayakForClaim.userId); selectedKayakForClaim = null;">
            {{ i18n.t('CANVAS_FOLLOW_KAYAK') }}
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
    .recenter-btn {
      position: absolute;
      inset-inline-start: 50%;
      bottom: 12px;
      transform: translateX(-50%);
      z-index: 8;
      min-block-size: 44px;
      padding: 0 18px;
      border-radius: 999px;
      border: 1.5px solid #00f0ff;
      background: rgba(6, 13, 29, 0.92);
      color: #00f0ff;
      font: 700 14px sans-serif;
      white-space: nowrap;
      box-shadow: 0 0 16px rgba(0, 240, 255, 0.45);
      cursor: pointer;
      touch-action: manipulation;
    }
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
      top: max(10px, env(safe-area-inset-top, 0px));
      left: max(10px, env(safe-area-inset-left, 0px));
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
        top: max(6px, env(safe-area-inset-top, 0px));
        left: max(6px, env(safe-area-inset-left, 0px));
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
    @media (max-width: 768px), (max-height: 650px) and (orientation: landscape), (max-width: 1150px) and (orientation: landscape) {
      .canvas-wrapper {
        block-size: 100% !important;
        height: 100% !important;
        flex: 1 1 0 !important;
        min-height: 0 !important;
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
  @Input() regattaPreferences?: RegattaPreferences;
  @Input() raceElapsedTimeSeconds = 0;
  @Input() overtakeThresholdM: number = 5;
  @Output() zoomLevelChange = new EventEmitter<number>();
  @Output() racerSelected = new EventEmitter<string>();
  @Output() kayakClaimed = new EventEmitter<string>();

  public selectedKayakForClaim: BoatRenderState | null = null;
  public claimPopupPos = { x: 50, y: 50 };
  public visibleBoatsCount = 0;
  public totalBoatsCount = 0;

  // --- Mode de rendu du canevas (global_fit | follow_camera) ---
  @ViewChild('minimap') minimapRef?: RaceMinimapComponent;
  /** Kayak explicitement suivi par la caméra ('' = cible par défaut : mon kayak, sinon le leader) */
  public readonly followedBoatId = signal('');
  public readonly isParticipant = signal(false);
  private cameraInit = false;
  private lastMode: RaceCanvasMode | null = null;
  private frameDeltaT = 0.016;
  private frameFollowedId = '';
  private offscreenHits: { x: number; y: number; w: number; h: number; userId: string }[] = [];

  get isFollowMode(): boolean {
    return (this.canvasModeService?.mode() ?? DEFAULT_RACE_CANVAS_MODE) === 'follow_camera';
  }

  get minimapHeight(): number {
    const small = (typeof window !== 'undefined' && window.innerHeight <= 500) || this.cssHeight <= 320;
    return small ? 32 : 44;
  }

  get showRecenterButton(): boolean {
    const followed = this.followedBoatId();
    return this.isFollowMode && this.isParticipant() && !!followed && followed !== this.activeUserId;
  }

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
    if (this.isFollowMode) return 1; // échelle fixe 16 px/m en caméra suiveuse
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
    @Optional() private cdr?: ChangeDetectorRef,
    @Optional() private canvasModeService?: RaceCanvasModeService
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
    if (this.isFollowMode) {
      return this.frameFollowedId || this.resolveFollowedId();
    }
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
    return `${this.i18n.formatRankOrdinal(rank)} / ${total}`;
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
    const label = this.i18n.formatRankOrdinal(rank);
    let color = '#00f0ff';

    if (rank === 1) {
      medal = '🥇';
      color = '#ffd700';
    } else if (rank === 2) {
      medal = '🥈';
      color = '#e2e8f0';
    } else if (rank === 3) {
      medal = '🥉';
      color = '#cd7f32';
    }

    return { rank, medal, label, color };
  }

  /** Cible par défaut : kayak choisi, sinon mon kayak (participant), sinon le leader (spectateur) */
  private resolveFollowedId(): string {
    const selected = this.followedBoatId();
    if (selected && this.boatsMap.has(selected)) return selected;
    if (this.activeUserId && this.boatsMap.has(this.activeUserId)) return this.activeUserId;
    let leader: BoatRenderState | null = null;
    for (const b of this.boatsMap.values()) {
      if (!leader || b.currentDisplayDist > leader.currentDisplayDist) leader = b;
    }
    return leader ? leader.userId : '';
  }

  private refreshParticipation(): void {
    this.isParticipant.set(!!this.activeUserId && this.boatsMap.has(this.activeUserId));
    const selected = this.followedBoatId();
    if (selected && !this.boatsMap.has(selected) && this.boatsMap.size > 0) {
      this.followedBoatId.set('');
    }
  }

  /** Changement de kayak suivi en 1 clic (canevas, mini-map, badge hors-champ) */
  public onFollowSelect(userId: string): void {
    if (!userId) return;
    this.followedBoatId.set(userId);
    this.racerSelected.emit(userId);
  }

  public recenterOnMyBoat(): void {
    if (!this.activeUserId) return;
    this.followedBoatId.set(this.activeUserId);
    this.racerSelected.emit(this.activeUserId);
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d');
    this.scheduleMultiStageResize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.wrapperRef.nativeElement);
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    canvas.addEventListener('wheel', this.onCanvasWheel, { passive: false });
    this.startRenderLoop();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['targetDistance'] && !changes['targetDistance'].firstChange) {
      this.clearAllBoats();
    }
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
    if (changes['focusedUserId']) {
      this.followedBoatId.set(this.focusedUserId || '');
    }
    if (changes['racers'] || changes['activeUserId']) {
      this.refreshParticipation();
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
    window.removeEventListener('orientationchange', this.onOrientationChange);
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
    if (!racer || !leader || racer.userId === leader.userId) return this.i18n.t('CANVAS_LEADER');
    const leaderDist = Number(leader.dist);
    const racerDist = Number(racer.dist);
    if (!Number.isFinite(leaderDist) || !Number.isFinite(racerDist)) return '--';
    const distDiff = Math.round(leaderDist - racerDist);
    if (distDiff <= 0) return this.i18n.t('CANVAS_LEADER');
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

  public formatMetricValue(key: RegattaMetricKey | undefined, boat: BoatRenderState): string {
    if (!key || key === 'none') return '';
    const target = this.targetDistance || 2000;
    switch (key) {
      case 'chrono': {
        const totalSec = Math.max(0, Math.floor(this.raceElapsedTimeSeconds || 0));
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }
      case 'power': {
        return `${Math.round(boat.watts || 0)}W`;
      }
      case 'spm': {
        return `${Math.round(boat.spm || 0)} spm`;
      }
      case 'speed': {
        if (boat.splitSec > 0 && boat.splitSec < 600) {
          const kmh = (500 / boat.splitSec) * 3.6;
          return `${kmh.toFixed(1)} km/h`;
        }
        return '0.0 km/h';
      }
      case 'pace': {
        if (boat.splitSec > 0 && boat.splitSec < 600) {
          const m = Math.floor(boat.splitSec / 60);
          const s = Math.floor(boat.splitSec % 60);
          return `${m}:${s < 10 ? '0' : ''}${s}/500m`;
        }
        return '--/500m';
      }
      case 'position': {
        const r = this.getRacerRank(boat.userId);
        if (!r) return '--';
        return r.medal ? `${r.medal} ${r.label}` : r.label;
      }
      case 'distRemaining': {
        const displayDist = Math.max(0, Math.min(target, boat.currentDisplayDist));
        const remainingDist = Math.max(0, Math.round(target - displayDist));
        return remainingDist > 0 ? `${remainingDist}m` : (this.i18n.t('FINISH_ARRIVED') || 'Arrivé !');
      }
      case 'distCovered': {
        const displayDist = Math.max(0, Math.min(target, boat.currentDisplayDist));
        return `${Math.round(displayDist)}m`;
      }
      case 'distToLeader': {
        const leader = this.sortedLeaderboard[0];
        if (!leader || leader.userId === boat.userId) return this.i18n.t('CANVAS_LEADER') || '1er';
        const leaderBoat = this.boatsMap.get(leader.userId);
        const leaderDist = leaderBoat ? leaderBoat.currentDisplayDist : (leader.dist || 0);
        const gapM = Math.max(0, Math.round(leaderDist - boat.currentDisplayDist));
        return gapM > 0 ? `-${gapM}m` : (this.i18n.t('CANVAS_LEADER') || '1er');
      }
      case 'distToPrev': {
        const rankIdx = this.sortedLeaderboard.findIndex((b) => b.userId === boat.userId);
        if (rankIdx <= 0) return 'Ldr';
        const prev = this.sortedLeaderboard[rankIdx - 1];
        const prevBoat = prev ? this.boatsMap.get(prev.userId) : undefined;
        const prevDist = prevBoat ? prevBoat.currentDisplayDist : (prev?.dist || 0);
        const gap = Math.max(0, Math.round(prevDist - boat.currentDisplayDist));
        return `-${gap}m`;
      }
      case 'distToNext': {
        const rankIdx = this.sortedLeaderboard.findIndex((b) => b.userId === boat.userId);
        if (rankIdx < 0 || rankIdx >= this.sortedLeaderboard.length - 1) return 'Fin';
        const next = this.sortedLeaderboard[rankIdx + 1];
        const nextBoat = next ? this.boatsMap.get(next.userId) : undefined;
        const nextDist = nextBoat ? nextBoat.currentDisplayDist : (next?.dist || 0);
        const gap = Math.max(0, Math.round(boat.currentDisplayDist - nextDist));
        return `+${gap}m`;
      }
      case 'force': {
        const forceN = Math.round((boat.watts || 0) * 1.5);
        return `${forceN}N`;
      }
      case 'work': {
        const workJ = Math.round((boat.watts || 0) * 2.2);
        return `${workJ}J`;
      }
      case 'avgPower': {
        return `${Math.round(boat.watts || 0)}W`;
      }
      case 'avgSpeed': {
        if (boat.splitSec > 0 && boat.splitSec < 600) {
          return `${((500 / boat.splitSec) * 3.6).toFixed(1)} km/h`;
        }
        return '0.0 km/h';
      }
      case 'avgPace': {
        if (boat.splitSec > 0 && boat.splitSec < 600) {
          const m = Math.floor(boat.splitSec / 60);
          const s = Math.floor(boat.splitSec % 60);
          return `${m}:${s < 10 ? '0' : ''}${s}`;
        }
        return '--';
      }
      default:
        return '';
    }
  }

  public selectRacerToFollow(userId: string): void {
    if (this.isFollowMode) this.followedBoatId.set(userId);
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
    const followMode = this.isFollowMode;

    if (followMode) {
      const hit = this.offscreenHits.find(
        (hb) => clickX >= hb.x && clickX <= hb.x + hb.w && clickY >= hb.y && clickY <= hb.y + hb.h
      );
      if (hit) {
        this.selectedKayakForClaim = null;
        this.onFollowSelect(hit.userId);
        return;
      }
    }

    const zoom = this.effectiveZoomLevel;
    const { visibleBoats } = this.getVisibleBoatsWindow();
    const boatCount = Math.max(1, visibleBoats.length);

    const isCompact = this.cssWidth < 520;
    const baseMarginX = isCompact ? 36 : 64;
    const marginX = followMode ? 0 : Math.round(baseMarginX + (zoom - 1) * (isCompact ? 12 : 18));
    const rightPad = isCompact ? 24 : 40;
    const trackW = followMode ? Math.max(1, this.targetDistance || 2000) * PIXELS_PER_METER : Math.max(120, this.cssWidth - marginX - rightPad);

    const isSmallLandscape = (typeof window !== 'undefined' && window.innerHeight <= 500) || this.cssHeight <= 320;
    const topOffset = (isSmallLandscape ? 24 : (isCompact ? 38 : 46)) + (followMode ? this.minimapHeight : 0);
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

      if (Math.abs(clickY - y) <= laneH * 0.75 && Math.abs(clickX - x) <= (followMode ? 80 : 60 * Math.min(1.8, zoom))) {
        foundBoat = boat;
        break;
      }
    }

    if (foundBoat && followMode && !this.canClaimBoat(foundBoat)) {
      this.selectedKayakForClaim = null;
      this.onFollowSelect(foundBoat.userId);
    } else if (foundBoat) {
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

  private onOrientationChange = () => {
    this.scheduleMultiStageResize();
  };

  private scheduleMultiStageResize(): void {
    this.resizeCanvas();
    if (typeof window !== 'undefined') {
      try { window.requestAnimationFrame(() => this.resizeCanvas()); } catch {}
      setTimeout(() => this.resizeCanvas(), 100);
      setTimeout(() => this.resizeCanvas(), 250);
      setTimeout(() => this.resizeCanvas(), 500);
    }
  }

  private resizeCanvas(): void {
    const wrapper = this.wrapperRef?.nativeElement;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const maxAssigned = Array.from(this.boatsMap.values()).reduce((max, b) => Math.max(max, b.assignedLane || b.lane || 1), this.boatsMap.size);
    const boatCount = Math.max(1, Math.max(this.boatsMap.size, maxAssigned));
    const isLandscape = typeof window !== 'undefined' && (
      window.innerWidth > window.innerHeight ||
      Boolean(window.screen?.orientation && String(window.screen.orientation.type).includes('landscape'))
    );
    const isConstrainedHeight = typeof window !== 'undefined' && (
      window.innerHeight <= 650 ||
      (typeof screen !== 'undefined' && Math.min(screen.width || 0, screen.height || 0) <= 650)
    );
    const isInPureRegattaMode = Boolean(wrapper?.closest?.('.game-container.pure-screen-active, .game-container.rigid-viewport, .game-container.mobile-fullscreen-view'));
    const isSmallLandscape = (isLandscape && isConstrainedHeight) || isInPureRegattaMode;

    if (wrapper) {
      if (isSmallLandscape) {
        wrapper.style.minHeight = '0px';
      } else {
        const dynamicMinHeight = Math.max(160, Math.min(600, 40 + boatCount * 32));
        wrapper.style.minHeight = `${dynamicMinHeight}px`;
      }
    }

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    const width = Math.max(260, wrapper?.clientWidth || 900);
    const height = Math.max(isSmallLandscape ? 60 : 160, wrapper?.clientHeight || (isSmallLandscape ? 100 : 260));

    this.cssWidth = width;
    this.cssHeight = height;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  public clearAllBoats(): void {
    this.boatsMap.clear();
    this.cameraInit = false;
    this.visibleBoatsCount = 0;
    this.totalBoatsCount = 0;
  }

  /**
   * Calcule la vitesse instantanée physique (m/s) à partir des données FTMS du rameur (Puissance Watts, Allure /500m, Cadence SPM).
   * Formule officielle Concept2 : v = (Watts / 2.80)^(1/3) = 500 / splitSec.
   */
  public computeFtmsTargetSpeedMs(r: {
    watts?: number;
    split?: number;
    spm?: number;
    speedMs?: number;
    status?: string;
    isBot?: boolean;
    dist?: number;
  }): number {
    if (!r || r.status === 'finished' || r.status === 'completed' || r.status === 'abandoned') {
      return 0;
    }
    if (typeof r.speedMs === 'number' && Number.isFinite(r.speedMs) && r.speedMs > 0) {
      return Math.min(8.33, Math.max(0, r.speedMs));
    }
    const watts = Number(r.watts || 0);
    if (watts > 0) {
      return Math.min(8.33, Math.cbrt(Math.min(1200, watts) / 2.80));
    }
    const split = Number(r.split || 0);
    const spm = Number(r.spm || 0);
    if ((r.isBot || spm > 0) && split >= 60 && split <= 360) {
      return Math.min(8.33, 500 / split);
    }
    return 0;
  }

  private syncRacersData(): void {
    if (!this.racers || this.racers.length === 0) {
      this.clearAllBoats();
      return;
    }
    const now = performance.now();
    const activeIds = new Set<string>();

    this.racers.forEach((r, idx) => {
      activeIds.add(r.userId);
      const rawDistVal = Number(r.exactDist ?? r.dist ?? 0);
      const safeRawDist = Number.isFinite(rawDistVal) ? Math.max(0, rawDistVal) : 0;
      const clampedDist = this.targetDistance > 0
        ? Math.min(this.targetDistance, safeRawDist)
        : safeRawDist;
      const isFinished = r.status === 'finished' || (r.status as string) === 'completed' || (this.targetDistance > 0 && clampedDist >= this.targetDistance);
      const effectiveDist = isFinished && this.targetDistance > 0 ? this.targetDistance : clampedDist;
      const isBot = Boolean(r.isBot || String(r.userId || '').toLowerCase().startsWith('bot_') || /\(bot\)/i.test(String(r.name || '')));
      const targetSpeedMs = isFinished
        ? 0
        : this.computeFtmsTargetSpeedMs({
            watts: r.watts,
            split: r.split,
            spm: r.spm,
            speedMs: r.speedMs,
            status: r.status,
            isBot,
            dist: effectiveDist,
          });

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
          currentSpeedMs: targetSpeedMs,
          targetSpeedMs: targetSpeedMs,
          splitSec: r.split || 120,
          watts: r.watts || 0,
          spm: r.spm || 0,
          lastPacketTime: now,
          color: this.boatColors[idx % this.boatColors.length],
          status: isFinished ? 'finished' : r.status,
          ready: r.ready !== undefined ? r.ready : (r.connectionState !== 'CONNECTED'),
          connectionState: r.connectionState || (r.ready === false ? 'CONNECTED' : 'READY'),
          isBot,
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
        boat.isBot = isBot;
        boat.isPaired = Boolean(r.isPaired);
        boat.status = isFinished ? 'finished' : r.status;
        boat.kayak = racerKayak;

        const prevTargetDist = boat.targetPacketDist;
        const dtPacketSec = Math.max(0.05, (now - (boat.lastPacketTime || now)) / 1000);

        // Protection anti-recul : la distance cible ne régresse jamais, sauf réinitialisation de course (r.dist === 0)
        if (safeRawDist === 0 && boat.targetPacketDist > 50 && !isFinished) {
          boat.targetPacketDist = 0;
          boat.currentDisplayDist = 0;
          boat.currentSpeedMs = 0;
          boat.targetSpeedMs = 0;
        } else if (isFinished && this.targetDistance > 0) {
          boat.targetPacketDist = this.targetDistance;
          boat.currentDisplayDist = this.targetDistance;
          boat.currentSpeedMs = 0;
          boat.targetSpeedMs = 0;
        } else {
          boat.targetPacketDist = this.targetDistance > 0
            ? Math.min(this.targetDistance, Math.max(boat.targetPacketDist, effectiveDist))
            : Math.max(boat.targetPacketDist, effectiveDist);
        }

        const packetDeltaM = Math.max(0, boat.targetPacketDist - prevTargetDist);
        const packetHasProgress = packetDeltaM > 0.01;
        const packetHasFtmsEffort = (r.watts || 0) > 0 || (r.spm || 0) > 0 || (typeof r.speedMs === 'number' && r.speedMs > 0);

        if (isFinished) {
          boat.targetSpeedMs = 0;
          boat.currentSpeedMs = 0;
        } else if (targetSpeedMs > 0) {
          boat.targetSpeedMs = targetSpeedMs;
        } else if (packetHasProgress && dtPacketSec <= 4.0) {
          // Si le paquet avance en distance sans Watts explicites, dériver la vitesse de l'écart
          boat.targetSpeedMs = Math.min(8.33, packetDeltaM / dtPacketSec);
        } else if (!packetHasFtmsEffort) {
          boat.targetSpeedMs = 0;
        }

        boat.splitSec = r.split > 0 ? r.split : boat.splitSec;
        boat.watts = r.watts;
        boat.spm = r.spm;
        if (packetHasProgress || packetHasFtmsEffort || !this.isRaceActive) {
          boat.lastPacketTime = now;
        }
        boat.color = this.boatColors[idx % this.boatColors.length];
        boat.ready = r.ready !== undefined ? r.ready : (r.connectionState !== 'CONNECTED');
        boat.connectionState = r.connectionState || (r.ready === false ? 'CONNECTED' : 'READY');
      }
    });

    // Maintien persistant des kayaks sur la ligne de départ et délai de grâce anti-clignotement (8s avant départ, 3s en course)
    const gracePeriodMs = this.isRaceActive ? 3000 : 8000;
    for (const [existingId, boat] of Array.from(this.boatsMap.entries())) {
      if (!activeIds.has(existingId)) {
        const timeSinceLastPacket = now - (boat.lastPacketTime || 0);
        if (timeSinceLastPacket > gracePeriodMs || !this.isRaceActive) {
          this.boatsMap.delete(existingId);
        }
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
      this.frameDeltaT = deltaT;

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

    // Seuil de dépassement net (5m d'écart par défaut, configurable dynamiquement par l'admin via overtakeThresholdM)
    const OVERTAKE_THRESHOLD_M = Math.max(1, this.overtakeThresholdM ?? 5); // OVERTAKE_THRESHOLD_M = 5;

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

    const now = performance.now();

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
          boat.currentSpeedMs = 0;
          boat.targetSpeedMs = 0;
        }
        return;
      }

      if (deltaT <= 0) {
        return;
      }

      const prevDisplay = boat.currentDisplayDist;
      const diff = boat.targetPacketDist - boat.currentDisplayDist;
      const timeSincePacketSec = Math.max(0, (now - (boat.lastPacketTime || now)) / 1000);

      // 1. Vitesse de base FTMS (m/s) issue des Watts / Allure du rameur
      let desiredSpeedMs = boat.targetSpeedMs > 0
        ? boat.targetSpeedMs
        : this.computeFtmsTargetSpeedMs({
            watts: boat.watts,
            split: boat.splitSec,
            spm: boat.spm,
            status: boat.status,
            isBot: boat.isBot,
          });

      // Si la course n'a pas encore démarré et que la distance cible est 0, rester immobile sur la ligne de départ
      if (!this.isRaceActive && boat.targetPacketDist <= 0) {
        boat.currentSpeedMs = 0;
        boat.currentDisplayDist = 0;
        return;
      }

      // 2. Décélération hydrodynamique douce si aucun nouveau paquet FTMS n'arrive après ~2.2s
      // ou si le rameur a arrêté son effort (desiredSpeedMs === 0)
      if (!boat.isBot && timeSincePacketSec > 2.2) {
        const silenceOverSec = timeSincePacketSec - 2.2;
        const decayFactor = Math.exp(-silenceOverSec * 1.4);
        desiredSpeedMs *= decayFactor;
      }

      // 3. Projection cinématique de référence depuis le dernier paquet FTMS (dead-reckoning) :
      // Entre deux paquets (~1 à 2s), la position attendue avance continûment à la vitesse FTMS.
      const projectedElapsedSec = Math.min(2.2, timeSincePacketSec);
      const projectedTargetDist = this.targetDistance > 0
        ? Math.min(this.targetDistance, boat.targetPacketDist + desiredSpeedMs * projectedElapsedSec)
        : boat.targetPacketDist + desiredSpeedMs * projectedElapsedSec;
      const trackingErrorM = projectedTargetDist - boat.currentDisplayDist;

      // Modulation continue de la vitesse pour suivre la trajectoire projetée FTMS sans à-coup :
      // - Si le kayak est en retard sur la trajectoire projetée (trackingErrorM > 0) : correction proportionnelle souple
      // - Si le kayak a légèrement dépassé la trajectoire projetée (trackingErrorM < 0) : ralentissement progressif (sans jamais reculer)
      const maxLeadOverProjectedM = Math.max(2.0, desiredSpeedMs * 0.8);
      let effectiveTargetSpeedMs = desiredSpeedMs;

      if (trackingErrorM > 0) {
        if (effectiveTargetSpeedMs > 0) {
          const catchupBoost = Math.min(effectiveTargetSpeedMs * 0.85 + 2.5, trackingErrorM * 1.35);
          effectiveTargetSpeedMs += catchupBoost;
        } else if (diff > 0) {
          // Même si Watts=0 sur le dernier paquet, glisser souplement jusqu'à targetPacketDist
          effectiveTargetSpeedMs = Math.max(0.35, Math.min(8.0, diff * 2.2));
        }
      } else if (trackingErrorM < 0) {
        const leadM = -trackingErrorM;
        if (leadM >= maxLeadOverProjectedM) {
          effectiveTargetSpeedMs = 0;
        } else {
          const leadRatio = leadM / maxLeadOverProjectedM;
          effectiveTargetSpeedMs *= Math.max(0.15, 1 - leadRatio * 0.85);
        }
      }

      // 4. Inertie hydrodynamique sur la vitesse du kayak (filtre passe-bas continu indépendant du framerate)
      const currentSpeed = Number.isFinite(boat.currentSpeedMs) ? boat.currentSpeedMs : effectiveTargetSpeedMs;
      const speedResponseRate = effectiveTargetSpeedMs >= currentSpeed ? 6.5 : 4.5;
      const alphaSpeed = 1 - Math.exp(-speedResponseRate * deltaT);
      boat.currentSpeedMs = Math.max(0, currentSpeed + (effectiveTargetSpeedMs - currentSpeed) * alphaSpeed);

      // 5. Intégration continue de la position à 60 FPS
      let nextDist = boat.currentDisplayDist + boat.currentSpeedMs * deltaT;

      // Si la vitesse résiduelle est quasi nulle et qu'on est très proche de la cible serveur, converger proprement
      if (diff > 0 && diff <= 0.02 && desiredSpeedMs <= 0.05) {
        nextDist = boat.targetPacketDist;
        boat.currentSpeedMs = 0;
      }

      // Plafond avant la ligne d'arrivée tant que le statut 'finished' n'est pas confirmé
      if (this.targetDistance > 0 && boat.targetPacketDist < this.targetDistance) {
        const preFinishCap = Math.max(boat.targetPacketDist, this.targetDistance - 0.2);
        nextDist = Math.min(nextDist, preFinishCap);
      }

      // Règle d'or : le kayak ne recule jamais sur l'eau (monotonie absolue)
      boat.currentDisplayDist = Math.max(prevDisplay, nextDist);

      if (this.targetDistance > 0 && boat.currentDisplayDist > this.targetDistance) {
        boat.currentDisplayDist = this.targetDistance;
      }
    });
  }

  /** Caméra suiveuse : kayak suivi à 25 % de l'écran, bornée au départ et à l'arrivée, avec lissage */
  private updateFollowCamera(followed: BoatRenderState | undefined, w: number): void {
    const raceDist = this.targetDistance || 2000;
    const target = followed ? computeFollowCameraTarget(followed.currentDisplayDist, raceDist, w) : 0;
    if (!this.cameraInit || !followed) {
      this.cameraX = target;
      this.cameraInit = !!followed;
    } else {
      this.cameraX = smoothCameraX(this.cameraX, target, this.frameDeltaT);
    }
  }

  /** Repères du bassin (culling sur [cameraX, cameraX + largeur]) */
  private drawFollowTrackDecor(
    ctx: CanvasRenderingContext2D,
    p: { w: number; h: number; topOffset: number; laneH: number; boatCount: number; camOffset: number; finishX: number; isSmallLandscape: boolean }
  ): void {
    const raceDist = this.targetDistance || 2000;
    const { startM, endM } = visibleRangeM(p.camOffset, p.w, 30);
    const yTop = p.topOffset - this.scrollY;
    const yBot = p.topOffset + p.boatCount * p.laneH - this.scrollY;

    // Lignes de distance tous les 100 m (accentuées tous les 500 m)
    for (const m of multiplesInRange(DISTANCE_MARK_M, startM, endM, raceDist)) {
      const x = boatScreenX(m, p.camOffset);
      const major = m % SIGN_MARK_M === 0;
      ctx.strokeStyle = major ? 'rgba(0, 240, 255, 0.38)' : 'rgba(0, 240, 255, 0.16)';
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
      ctx.stroke();
    }

    // Début des 250 derniers mètres
    const lastStretchM = raceDist - BUOY_RED_END_M;
    if (lastStretchM > 0 && lastStretchM >= startM && lastStretchM <= endM) {
      const x = boatScreenX(lastStretchM, p.camOffset);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255, 0, 85, 0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
      ctx.stroke();
      ctx.restore();
    }

    // Bouées de couloir tous les 25 m
    const buoyR = p.isSmallLandscape ? 2.2 : 3.2;
    const buoyMarks = multiplesInRange(BUOY_SPACING_M, startM, endM, raceDist);
    for (let l = 0; l <= p.boatCount; l++) {
      const by = p.topOffset + l * p.laneH - this.scrollY;
      if (by < p.topOffset - 20 || by > p.h + 20) continue;
      for (const m of buoyMarks) {
        const color = buoyColorAt(m, raceDist);
        ctx.fillStyle = color === 'red' ? '#ff0055' : color === 'yellow' ? '#ffe600' : '#f8fafc';
        ctx.beginPath();
        ctx.arc(boatScreenX(m, p.camOffset), by, buoyR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ponton de départ à 0 m
    const startX = boatScreenX(0, p.camOffset);
    if (startX > -60 && startX < p.w + 10) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(startX - 30, yTop, 30, yBot - yTop);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      for (let py = yTop; py < yBot; py += 10) {
        ctx.beginPath();
        ctx.moveTo(startX - 30, py);
        ctx.lineTo(startX, py);
        ctx.stroke();
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(startX - 1.5, yTop, 3, yBot - yTop);
    }

    // Ligne d'arrivée en damier
    if (p.finishX > -20 && p.finishX < p.w + 20) {
      const s = 8;
      const rows = Math.ceil((yBot - yTop) / s);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#0b1220';
          ctx.fillRect(p.finishX - s + c * s, yTop + r * s, s, s);
        }
      }
    }
  }

  /** Repères de distance épinglés en haut : 100 m et panneaux 500 m / 1000 m / 1500 m / Derniers 250m */
  private drawFollowTopMarkers(
    ctx: CanvasRenderingContext2D,
    p: { w: number; topOffset: number; camOffset: number; markerFontPx: number }
  ): void {
    const raceDist = this.targetDistance || 2000;
    const { startM, endM } = visibleRangeM(p.camOffset, p.w, 60);
    const baseY = Math.max(p.markerFontPx + 2, p.topOffset - 6);

    const drawSign = (x: number, label: string, color: string) => {
      ctx.font = `800 ${p.markerFontPx + 1}px monospace`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 14;
      const bh = p.markerFontPx + 8;
      const bx = x - bw / 2;
      const by = baseY - bh + 4;
      ctx.fillStyle = 'rgba(6, 13, 29, 0.92)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 5);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, baseY);
      ctx.textAlign = 'left';
    };

    ctx.font = `700 ${p.markerFontPx}px monospace`;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.textAlign = 'center';
    for (const m of multiplesInRange(DISTANCE_MARK_M, startM, endM, raceDist)) {
      if (m % SIGN_MARK_M === 0) continue;
      ctx.fillText(`${m}m`, boatScreenX(m, p.camOffset), baseY);
    }
    ctx.textAlign = 'left';

    for (const m of multiplesInRange(SIGN_MARK_M, startM, endM, raceDist)) {
      if (m === 0 || m >= raceDist) continue;
      drawSign(boatScreenX(m, p.camOffset), `${m}m`, '#00f0ff');
    }
    const lastStretchM = raceDist - BUOY_RED_END_M;
    if (lastStretchM > 0 && lastStretchM >= startM && lastStretchM <= endM) {
      drawSign(boatScreenX(lastStretchM, p.camOffset), 'Derniers 250m', '#ff3366');
    }
  }

  /** Sillage : chevrons animés derrière le kayak, proportionnels à la vitesse instantanée (m/s) */
  private drawFollowWake(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    boat: BoatRenderState,
    nowSec: number,
    hullRx: number,
    laneH: number
  ): void {
    const speed = Math.max(0, boat.currentSpeedMs || 0);
    if (speed < 0.3) return;
    const len = Math.min(150, 28 + speed * 16);
    const spread = Math.min(laneH * 0.42, 3 + speed * 0.9);
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const phase = (nowSec * (0.35 + speed * 0.12) + i / 4) % 1;
      const off = hullRx * 0.6 + phase * len;
      const alpha = (1 - phase) * 0.42;
      const sp = spread * (0.35 + phase * 0.65);
      ctx.strokeStyle = `rgba(190, 245, 255, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x - off + 5, y - sp);
      ctx.lineTo(x - off, y);
      ctx.lineTo(x - off + 5, y + sp);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Halo turquoise sous le kayak actuellement suivi par la caméra */
  private drawFollowHalo(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    hullRx: number,
    laneH: number,
    nowSec: number
  ): void {
    const radius = hullRx + 22;
    const pulse = 0.30 + Math.sin(nowSec * 3) * 0.06;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, Math.max(0.12, (laneH * 0.5) / radius));
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
    g.addColorStop(0, `rgba(0, 240, 255, ${pulse.toFixed(3)})`);
    g.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Mini-map tactique + badges cliquables des kayaks hors du champ de vision */
  private drawFollowOverlays(
    ctx: CanvasRenderingContext2D,
    p: { w: number; topOffset: number; camOffset: number }
  ): void {
    const raceDist = this.targetDistance || 2000;
    const followedId = this.frameFollowedId;
    const all = Array.from(this.boatsMap.values());

    if (this.minimapRef) {
      const range = visibleRangeM(p.camOffset, p.w, 0);
      const frame: MinimapFrame = {
        racers: all.map((b) => ({
          userId: b.userId,
          name: b.name,
          dist: b.currentDisplayDist,
          color: b.color,
          isSelf: b.userId === this.activeUserId
        })),
        targetDistance: raceDist,
        followedId,
        viewStartM: range.startM,
        viewEndM: range.endM
      };
      this.minimapRef.render(frame, p.w);
    }

    this.offscreenHits = [];
    const followed = this.boatsMap.get(followedId);
    if (!followed) return;

    const res = computeOffscreenBadges(
      all.map((b) => ({ userId: b.userId, name: b.name, dist: b.currentDisplayDist })),
      followedId,
      followed.currentDisplayDist,
      p.camOffset,
      p.w,
      3
    );

    const badgeH = 34;
    const gapY = 6;
    const maxBadgeW = Math.max(120, p.w * 0.46);
    ctx.save();
    ctx.font = '700 12px sans-serif';
    ctx.textBaseline = 'middle';

    const drawSide = (items: typeof res.left, hidden: number, side: 'left' | 'right') => {
      items.forEach((b, i) => {
        const textW = Math.min(maxBadgeW - 20, ctx.measureText(b.label).width);
        const bw = textW + 20;
        const bx = side === 'left' ? 6 : p.w - bw - 6;
        const by = p.topOffset + 6 + i * (badgeH + gapY);
        ctx.fillStyle = 'rgba(6, 13, 29, 0.9)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
        ctx.lineWidth = 1.5;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, badgeH, badgeH / 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(bx, by, bw, badgeH);
          ctx.strokeRect(bx, by, bw, badgeH);
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'left';
        ctx.fillText(b.label, bx + 10, by + badgeH / 2, textW);
        // Zone tactile légèrement élargie
        this.offscreenHits.push({ x: bx - 4, y: by - 2, w: bw + 8, h: badgeH + 4, userId: b.userId });
      });
      if (hidden > 0) {
        const label = `+${hidden}`;
        const bw = ctx.measureText(label).width + 16;
        const bx = side === 'left' ? 6 : p.w - bw - 6;
        const by = p.topOffset + 6 + items.length * (badgeH + gapY);
        ctx.fillStyle = 'rgba(6, 13, 29, 0.75)';
        ctx.fillRect(bx, by, bw, 24);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(label, bx + bw / 2, by + 12);
      }
    };
    drawSide(res.left, res.hiddenLeft, 'left');
    drawSide(res.right, res.hiddenRight, 'right');
    ctx.restore();
  }

  private drawCanvasScene(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const isCompact = w < 520;
    const nowSec = performance.now() / 1000;
    const followMode = this.isFollowMode;
    {
      const modeKey: RaceCanvasMode = followMode ? 'follow_camera' : 'global_fit';
      if (this.lastMode !== modeKey) {
        // Bascule de mode (admin) : retour à la cible par défaut et caméra réinitialisée
        if (this.lastMode !== null) this.followedBoatId.set('');
        this.lastMode = modeKey;
        this.cameraInit = false;
        this.cameraX = 0;
      }
    }
    this.frameFollowedId = followMode ? this.resolveFollowedId() : '';
    const zoom = this.effectiveZoomLevel;

    // 1. Fond plan d'eau dynamique
    ctx.fillStyle = '#060d1d';
    ctx.fillRect(0, 0, w, h);

    const { visibleBoats, startIndex } = this.getVisibleBoatsWindow();
    const maxAssigned = visibleBoats.reduce((max, b) => Math.max(max, b.assignedLane || b.lane || 1), visibleBoats.length);
    const boatCount = Math.max(1, Math.max(visibleBoats.length, maxAssigned));

    const isSmallLandscape = (typeof window !== 'undefined' && window.innerHeight <= 500) || h <= 320;
    const baseMarginX = isCompact ? 36 : 64;
    const marginX = followMode ? 0 : Math.round(baseMarginX + (zoom - 1) * (isCompact ? 12 : 18));
    const rightPad = isCompact ? 24 : 40;
    const trackW = followMode ? Math.max(1, this.targetDistance || 2000) * PIXELS_PER_METER : Math.max(120, w - marginX - rightPad);

    const baseTopOffset = isSmallLandscape ? 24 : (isCompact ? 38 : 46);
    const topOffset = (isSmallLandscape ? 24 : (isCompact ? 38 : 46)) + (followMode ? this.minimapHeight : 0);
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

    if (followMode) {
      this.updateFollowCamera(targetBoat, w);
    } else if (targetBoat && isCompact) {
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

    const markers: number[] = followMode ? [] : (w < 380 ? [0, 0.5, 1.0] : [0, 0.25, 0.5, 0.75, 1.0]);
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

    if (followMode) {
      this.drawFollowTrackDecor(ctx, { w, h, topOffset, laneH, boatCount, camOffset, finishX, isSmallLandscape });
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
      const laneLabel = isCompact
        ? (startIndex === 0 ? `L${l + 1}` : `L${displayLaneNum}`)
        : `${this.i18n.t('CANVAS_LANE')} ${displayLaneNum}`;
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

    // 3.5. Incrustation géante transparente (Watermark) sur la ligne d'eau du joueur
    // Au départ (< 50% de la distance), affichée à droite de la ligne pour rester visible ;
    // dès que le kayak du joueur franchit 50% de la distance, bascule à gauche au début de la ligne.
    const watermarkKey = this.regattaPreferences?.watermarkMetric || 'chrono';
    if (watermarkKey && watermarkKey !== 'none') {
      const activeBoat = this.boatsMap.get(this.activeUserId);
      if (activeBoat) {
        const activeIdx = visibleBoats.findIndex((b) => b.userId === this.activeUserId);
        if (activeIdx >= 0) {
          const effectiveLaneIdx = zoom > 1
            ? activeIdx
            : (this.dynamicLaneMode
                ? (activeBoat.currentLaneIndex !== undefined ? Math.min(boatCount - 1, Math.max(0, activeBoat.currentLaneIndex)) : activeIdx)
                : Math.max(0, (activeBoat.assignedLane || activeBoat.lane || 1) - 1));
          const watermarkY = topOffset + (effectiveLaneIdx + 0.5) * laneH - this.scrollY;
          if (watermarkY >= topOffset - laneH * 0.5 && watermarkY <= h + laneH * 0.5) {
            const val = this.formatMetricValue(watermarkKey, activeBoat);
            if (val) {
              ctx.save();
              // Taille réduite (~70% de la hauteur du couloir) pour ne jamais sortir de la ligne d'eau
              const baseFontPx = Math.max(16, Math.floor(laneH * 0.92));
              ctx.font = `900 ${baseFontPx}px "Exo 2", monospace, sans-serif`;
              const m = ctx.measureText(val);
              const glyphAscent = m.actualBoundingBoxAscent || (baseFontPx * 0.72);
              const glyphDescent = m.actualBoundingBoxDescent || 0;
              const actualGlyphH = Math.max(8, glyphAscent + glyphDescent);
              const textWidth = Math.max(10, m.width);

              // Occupe ~70% de la hauteur du couloir avec une marge verticale franche
              const scaleH = (laneH * 0.70) / actualGlyphH;
              const maxW = trackW * 0.44;
              const scaleW = textWidth * scaleH > maxW ? maxW / textWidth : scaleH;
              const finalScale = Math.min(scaleH, scaleW);
              const watermarkFontPx = Math.max(13, Math.round(baseFontPx * finalScale));

              ctx.font = `900 ${watermarkFontPx}px "Exo 2", monospace, sans-serif`;
              const finalTextW = ctx.measureText(val).width;
              ctx.textBaseline = 'middle';
              ctx.fillStyle = 'rgba(0, 240, 255, 0.28)';
              ctx.shadowColor = '#00f0ff';
              ctx.shadowBlur = 10;

              const activeProgress = Math.min(1.0, Math.max(0, activeBoat.currentDisplayDist / (this.targetDistance || 2000)));
              const isPastHalfway = activeProgress >= 0.5;
              const padSide = Math.round((isCompact ? 10 : 18) * Math.min(1.5, boatScale));
              const trackLeftScreen = Math.max(marginX - camOffset + padSide, marginX * 0.85);
              const trackRightScreen = Math.min(w - rightPad - padSide, finishX - padSide);

              const finalCenterY = Math.round(watermarkY);
              if (isPastHalfway) {
                // Kayak >= 50% : affiché à gauche au début de la ligne d'eau
                ctx.textAlign = 'left';
                const leftX = Math.max(marginX * 0.75, Math.min(w - finalTextW - 10, trackLeftScreen));
                ctx.fillText(val, Math.round(leftX), finalCenterY);
              } else {
                // Kayak < 50% (au départ) : affiché à droite de la ligne d'eau
                ctx.textAlign = 'right';
                const rightX = Math.min(w - 10, Math.max(marginX + finalTextW + 10, trackRightScreen));
                ctx.fillText(val, Math.round(rightX), finalCenterY);
              }
              ctx.restore();
            }
          }
        }
      }
    }

    // 4. Dessin des kayaks visibles : proportions harmonieuses K1 / Skiff (~4:1) sans étirement excessif
    const kScale = followMode ? (isCompact ? 1.32 : 1.55) : boatScale;
    const hullRx = (isCompact ? 17 : 21) * kScale;
    const hullRy = Math.min(laneH * 0.28, Math.max(4.5, hullRx * 0.26));

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
        ? Math.sin(nowSec * strokeFreq * Math.PI * 2 + laneOffset) * 0.54
        : 0;

      // Envergure des rames proportionnée à la coque et bornée au couloir
      const oarPivotX = x - hullRx * 0.04;
      const oarLen = Math.min(laneH * 0.45, Math.max(hullRy * 1.95, (isCompact ? 9.5 : 11.5) * kScale));
      const dxOar = Math.sin(strokeAngle) * oarLen * 0.85;
      const dyOar = Math.cos(strokeAngle) * oarLen;
      const x1 = oarPivotX - dxOar;
      const y1 = y - dyOar;
      const x2 = oarPivotX + dxOar;
      const y2 = y + dyOar;

      // =========================================================================
      // MISE EN VALEUR JOUEUR CONNECTÉ : Sillage accentué & Traînée d'eau
      // =========================================================================
      if (isUser || isFocused) {
        ctx.fillStyle = hexToRgba(effectiveGlowColor, 0.36);
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 5 * kScale), y, hullRx * 0.65, hullRy * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hexToRgba(effectiveGlowColor, 0.18);
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 13 * kScale), y, hullRx * 0.95, hullRy * 1.05, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const wakeColor = custom ? hexToRgba(effectiveGlowColor, 0.25) : 'rgba(0, 240, 255, 0.18)';
        ctx.fillStyle = wakeColor;
        ctx.beginPath();
        ctx.ellipse(Math.max(marginX - camOffset, x - hullRx - 2 * kScale), y, hullRx * 0.52, hullRy * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sillage dynamique en V & halo du kayak suivi en mode Caméra Suiveuse
      if (followMode) {
        this.drawFollowWake(ctx, x, y, boat, nowSec, hullRx, laneH);
        if (isFocused) {
          this.drawFollowHalo(ctx, x, y, hullRx, laneH, nowSec);
        }
      }

      // Éclaboussures d'attaque aux pelles
      if (isMoving && Math.abs(strokeAngle) > 0.22) {
        ctx.fillStyle = isUser ? 'rgba(0, 240, 255, 0.65)' : 'rgba(190, 245, 255, 0.42)';
        ctx.beginPath();
        ctx.arc(x1, y1, (isCompact ? 1.8 : 2.3) * Math.min(1.6, kScale), 0, Math.PI * 2);
        ctx.arc(x2, y2, (isCompact ? 1.8 : 2.3) * Math.min(1.6, kScale), 0, Math.PI * 2);
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
        ctx.lineWidth = ((isUser || isFocused) ? 2.2 : 1.4) * Math.min(1.5, kScale);
        ctx.beginPath();
        ctx.ellipse(x, y, hullRx + 3.5 * kScale, hullRy + 2.5 * kScale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Manche de la pagaie / rames (carbone sombre + reflets)
      ctx.save();
      ctx.strokeStyle = isUser ? '#00f0ff' : '#cbd5e1';
      ctx.lineWidth = (isCompact ? 1.5 : 1.9) * Math.min(1.5, kScale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();

      // Pelles profilées asymétriques (forme cuillère hydrodynamique)
      const bladeRx = (isCompact ? 3.2 : 4.1) * Math.min(1.55, kScale);
      const bladeRy = (isCompact ? 1.7 : 2.2) * Math.min(1.55, kScale);
      ctx.fillStyle = effectiveBladeColor;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 1;

      // Pelle bâbord
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(-strokeAngle * 0.85);
      ctx.beginPath();
      ctx.ellipse(0, 0, bladeRx, bladeRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Pelle tribord
      ctx.save();
      ctx.translate(x2, y2);
      ctx.rotate(-strokeAngle * 0.85);
      ctx.beginPath();
      ctx.ellipse(0, 0, bladeRx, bladeRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // =========================================================================
      // COQUE K1 / SKIFF PROFILÉE HAUT DE GAMME (Courbes de Bézier + Volume 3D)
      // - Proue (droite, x + hullRx) fine et fendante
      // - Maître-bau légèrement en avant du centre, poupe (gauche, x - hullRx) fuselée
      // =========================================================================
      ctx.save();
      const traceHull = () => {
        const bowX = x + hullRx;
        const sternX = x - hullRx;
        ctx.beginPath();
        ctx.moveTo(bowX, y);
        // Flanc supérieur (proue -> maître-bau -> poupe)
        ctx.bezierCurveTo(
          x + hullRx * 0.48, y - hullRy * 0.96,
          x - hullRx * 0.42, y - hullRy * 1.04,
          sternX, y
        );
        // Flanc inférieur (poupe -> maître-bau -> proue)
        ctx.bezierCurveTo(
          x - hullRx * 0.42, y + hullRy * 1.04,
          x + hullRx * 0.48, y + hullRy * 0.96,
          bowX, y
        );
        ctx.closePath();
      };

      // Légère ombre portée sous la coque pour la détacher de l'eau
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 1.5;
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
        ctx.fillRect(x - hullRx, y - hullRy * 2, hullRx * 1.05, hullRy * 4);
        ctx.restore();
      } else {
        ctx.fillStyle = effectiveHullColor;
        ctx.fill();
      }
      ctx.restore();

      // Volume 3D du pont + lignes de pont (deck lines) + motifs
      ctx.save();
      traceHull();
      ctx.clip();

      // Dégradé transversal (lumière zénithale sur le galbe du pont)
      const deckGrad = ctx.createLinearGradient(x, y - hullRy, x, y + hullRy);
      deckGrad.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
      deckGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
      deckGrad.addColorStop(1, 'rgba(0, 0, 0, 0.36)');
      ctx.fillStyle = deckGrad;
      ctx.fillRect(x - hullRx, y - hullRy * 1.2, hullRx * 2, hullRy * 2.4);

      // Racing stripes pattern
      if (effectivePattern === 'racing-stripe') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = (isCompact ? 1.0 : 1.35) * Math.min(1.4, kScale);
        const stripeOff = Math.max(1.2, hullRy * 0.28);
        ctx.beginPath();
        ctx.moveTo(x - hullRx + 3, y - stripeOff);
        ctx.lineTo(x + hullRx - 3, y - stripeOff);
        ctx.moveTo(x - hullRx + 3, y + stripeOff);
        ctx.lineTo(x + hullRx - 3, y + stripeOff);
        ctx.stroke();
      } else {
        // Nervure centrale de pont (arête hydrodynamique avant & arrière)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + hullRx * 0.32, y);
        ctx.lineTo(x + hullRx - 2, y);
        ctx.moveTo(x - hullRx + 2, y);
        ctx.lineTo(x - hullRx * 0.42, y);
        ctx.stroke();
      }

      // Pointe d'étrave (nose cap carbone/lumineux à la proue)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.fillRect(x + hullRx * 0.78, y - hullRy * 1.1, hullRx * 0.24, hullRy * 2.2);
      ctx.restore();

      // Contour extérieur net de la coque
      traceHull();
      ctx.strokeStyle = isUser ? '#ffffff' : 'rgba(255, 255, 255, 0.62)';
      ctx.lineWidth = isUser ? 1.6 * Math.min(1.4, kScale) : 1.1;
      ctx.stroke();
      ctx.restore();

      // Hiloire & Cockpit ergonomique (forme goutte d'eau entourée d'un rebord carbone)
      const cockpitX = x - hullRx * 0.06;
      const cockpitRx = hullRx * 0.34;
      const cockpitRy = hullRy * 0.56;
      ctx.save();
      ctx.fillStyle = '#050811';
      ctx.strokeStyle = isUser ? 'rgba(0, 240, 255, 0.75)' : 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cockpitX, y, cockpitRx, cockpitRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Rameur (épaules + tête qui accompagne légèrement la cadence du coup de rame)
      const bodyShiftX = Math.sin(strokeAngle) * Math.min(2.2, hullRx * 0.06);
      const rowerX = cockpitX - hullRx * 0.04 + bodyShiftX;
      ctx.save();
      // Épaules / gilet
      ctx.fillStyle = isUser ? '#00f0ff' : effectiveBladeColor;
      ctx.beginPath();
      ctx.ellipse(rowerX, y, hullRy * 0.38, hullRy * 0.50, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tête / casquette
      ctx.fillStyle = isUser ? '#ffe600' : '#fcd34d';
      ctx.strokeStyle = '#060913';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(rowerX + hullRx * 0.02, y, Math.max(2.2, hullRy * 0.36), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // =========================================================================
      // BULLE DU NOM DU KAYAK ET BULLE DE DONNÉES DE LIGNE D'EAU CONFIGURABLES
      // - Position du nom paramétrable : auto, above, below, front, back, none
      // - Bulle de données un peu réduite pour rester strictement dans la ligne d'eau
      // - Bascule automatique à 50% de la distance : à droite (devant) au départ (< 50%),
      //   puis à gauche (derrière) dès que le kayak franchit la moitié de la distance (>= 50%).
      // =========================================================================
      const isPastHalfway = progress >= 0.5;
      const gap = Math.round((isCompact ? 7 : 10) * boatScale);
      const minXBound = Math.max(4, Math.round(marginX * 0.55));
      const maxXBound = w - 6;

      // 1. Préparation de la bulle de données de ligne d'eau (Donnée 1 · Donnée 2)
      const shouldShowDataBadge = this.isRaceActive || (boat.currentDisplayDist > 0 && boat.status !== 'finished') || boat.status === 'finished';
      const mKeys = isUser
        ? (this.regattaPreferences?.myLaneMetrics || ['position', 'distRemaining'])
        : (this.regattaPreferences?.opponentLaneMetrics || ['distRemaining', 'pace']);
      const dataPosPref = isUser
        ? (this.regattaPreferences?.myLanePosition || 'auto')
        : (this.regattaPreferences?.opponentLanePosition || 'auto');

      const val1 = shouldShowDataBadge ? this.formatMetricValue(mKeys[0], boat) : '';
      const val2 = shouldShowDataBadge ? this.formatMetricValue(mKeys[1], boat) : '';
      const badgeItems = [val1, val2].filter(Boolean);
      const hasDataBadge = badgeItems.length > 0;

      // Dimensions légèrement réduites (~60% de la hauteur du couloir max) pour ne jamais déborder de la ligne d'eau
      const badgeFontPx = Math.min(Math.floor(laneH * 0.33), Math.max(8.5, Math.round((isCompact ? 8.5 : 10) * fontScale)));
      const badgePadX = Math.round((isCompact ? 5 : 6.5) * Math.min(1.5, fontScale));
      const badgeH = Math.min(Math.floor(laneH * 0.62), Math.max(14, Math.round(badgeFontPx + 5 * Math.min(1.4, fontScale))));
      let badgeText = '';
      let badgeW = 0;
      if (hasDataBadge) {
        badgeText = badgeItems.join(' · ');
        ctx.font = `bold ${badgeFontPx}px sans-serif`;
        badgeW = ctx.measureText(badgeText).width + badgePadX * 2;
      }

      // Côté résolu pour la bulle de données ('front' = à droite du kayak, 'back' = à gauche du kayak)
      let resolvedDataSide: 'front' | 'back' = 'front';
      if (dataPosPref === 'front') {
        resolvedDataSide = (x + hullRx + gap + badgeW > maxXBound && x - hullRx - gap - badgeW >= minXBound) ? 'back' : 'front';
      } else if (dataPosPref === 'back') {
        resolvedDataSide = (x - hullRx - gap - badgeW < minXBound && x + hullRx + gap + badgeW <= maxXBound) ? 'front' : 'back';
      } else {
        // 'auto' : à droite (devant) au départ (< 50% de la distance), bascule à gauche (derrière) dès 50% franchis
        resolvedDataSide = isPastHalfway ? 'back' : 'front';
        if (resolvedDataSide === 'front' && x + hullRx + gap + badgeW > maxXBound && x - hullRx - gap - badgeW >= minXBound) {
          resolvedDataSide = 'back';
        } else if (resolvedDataSide === 'back' && x - hullRx - gap - badgeW < minXBound && x + hullRx + gap + badgeW <= maxXBound) {
          resolvedDataSide = 'front';
        }
      }

      // 2. Préparation de la bulle du nom du kayak
      const rawNamePosPref: KayakNamePosition = (isUser || isFocused)
        ? (this.regattaPreferences?.myNamePosition || 'auto')
        : (this.regattaPreferences?.opponentNamePosition || 'auto');

      const shortName = isCompact && boat.name.length > 10 ? `${boat.name.slice(0, 9)}…` : boat.name;
      const baseLabelPx = isCompact ? 9 : 10.5;
      const labelFontPx = Math.min(Math.floor(laneH * 0.33), Math.max(8.5, Math.round(baseLabelPx * fontScale)));
      const namePadX = Math.round((isCompact ? 5 : 6.5) * Math.min(1.5, fontScale));
      const nameBoxH = Math.min(Math.floor(laneH * 0.62), Math.max(14, Math.round(labelFontPx + 5 * Math.min(1.4, fontScale))));

      let nameBannerLabel = '';
      if (isUser || isFocused) {
        const myHeaderKey = this.regattaPreferences?.myHeaderMetric || 'distCovered';
        const myHeaderVal = this.formatMetricValue(myHeaderKey, boat);
        nameBannerLabel = `${isUser ? this.i18n.t('CANVAS_BADGE_YOU') : this.i18n.t('CANVAS_BADGE_FOLLOWING')} : ${shortName}${myHeaderVal ? ' · ' + myHeaderVal : ''}`;
      } else {
        const oppHeaderKey = this.regattaPreferences?.opponentHeaderMetric || 'distCovered';
        const oppHeaderVal = this.formatMetricValue(oppHeaderKey, boat);
        nameBannerLabel = `${shortName}${oppHeaderVal ? ' · ' + oppHeaderVal : ''}`;
      }

      ctx.font = `bold ${labelFontPx}px sans-serif`;
      const nameTextW = ctx.measureText(nameBannerLabel).width;
      const nameBoxW = nameTextW + namePadX * 2;

      // Résolution de la position effective du nom : 'above' | 'below' | 'front' | 'back' | 'none'
      let resolvedNamePos: 'above' | 'below' | 'front' | 'back' | 'none' = 'front';
      if (rawNamePosPref === 'none') {
        resolvedNamePos = 'none';
      } else if (rawNamePosPref === 'above') {
        resolvedNamePos = (effectiveLaneIdx === 0 || (y - hullRy - nameBoxH - 4 < topOffset)) ? 'below' : 'above';
      } else if (rawNamePosPref === 'below') {
        resolvedNamePos = (y + hullRy + nameBoxH + 4 > h - 2) ? 'above' : 'below';
      } else if (rawNamePosPref === 'front') {
        resolvedNamePos = (x + hullRx + gap + nameBoxW > maxXBound && x - hullRx - gap - nameBoxW >= minXBound) ? 'back' : 'front';
      } else if (rawNamePosPref === 'back') {
        resolvedNamePos = (x - hullRx - gap - nameBoxW < minXBound && x + hullRx + gap + nameBoxW <= maxXBound) ? 'front' : 'back';
      } else {
        // 'auto' : Devant le kayak par défaut dans la ligne d'eau (et bascule derrière s'il n'y a plus de place près de l'arrivée)
        resolvedNamePos = (x + hullRx + gap + nameBoxW > maxXBound && x - hullRx - gap - nameBoxW >= minXBound) ? 'back' : 'front';
      }

      // 3. Dessin de la bulle du nom du kayak (si visible)
      let occupiedFrontOffset = 0;
      let occupiedBackOffset = 0;

      if (resolvedNamePos !== 'none' && nameBannerLabel) {
        const nameStrokeColor = isUser ? '#00f0ff' : (isFocused ? '#ffe600' : 'rgba(255, 255, 255, 0.45)');
        const nameTextColor = isUser ? '#00f0ff' : (isFocused ? '#ffe600' : '#ffffff');
        const nameBgColor = (isUser || isFocused) ? 'rgba(6, 15, 33, 0.92)' : 'rgba(6, 15, 33, 0.84)';

        let nameBoxX = 0;
        let nameBoxY = 0;

        if (resolvedNamePos === 'above' || resolvedNamePos === 'below') {
          const isBelow = resolvedNamePos === 'below';
          if (isUser || isFocused) {
            const arrowBounce = Math.sin(nowSec * 5.5) * 2;
            ctx.fillStyle = isUser ? '#00f0ff' : '#ffe600';
            ctx.beginPath();
            if (isBelow) {
              const arrowY = y + hullRy + 3 * boatScale + arrowBounce;
              ctx.moveTo(x, arrowY);
              ctx.lineTo(x - 3.8 * boatScale, arrowY + 5.5 * boatScale);
              ctx.lineTo(x + 3.8 * boatScale, arrowY + 5.5 * boatScale);
              ctx.closePath();
              ctx.fill();
              nameBoxY = Math.min(h - nameBoxH - 2, arrowY + 6.5 * boatScale);
            } else {
              const arrowY = Math.max(topOffset + nameBoxH + 5, y - hullRy - 3 * boatScale + arrowBounce);
              ctx.moveTo(x, arrowY);
              ctx.lineTo(x - 3.8 * boatScale, arrowY - 5.5 * boatScale);
              ctx.lineTo(x + 3.8 * boatScale, arrowY - 5.5 * boatScale);
              ctx.closePath();
              ctx.fill();
              nameBoxY = Math.max(topOffset + 2, arrowY - 6.5 * boatScale - nameBoxH);
            }
          } else {
            if (isBelow) {
              nameBoxY = Math.min(h - nameBoxH - 2, y + hullRy + 3 * boatScale);
            } else {
              nameBoxY = Math.max(topOffset + 2, y - hullRy - 3 * boatScale - nameBoxH);
            }
          }
          nameBoxX = Math.max(6, Math.min(w - nameBoxW - 6, x - nameBoxW / 2));
        } else if (resolvedNamePos === 'front') {
          nameBoxX = Math.min(maxXBound - nameBoxW, x + hullRx + gap);
          nameBoxY = y - nameBoxH / 2;
          occupiedFrontOffset = nameBoxW + Math.round(5 * boatScale);
        } else {
          // 'back'
          nameBoxX = Math.max(minXBound, x - hullRx - gap - nameBoxW);
          nameBoxY = y - nameBoxH / 2;
          occupiedBackOffset = nameBoxW + Math.round(5 * boatScale);
        }

        ctx.save();
        ctx.fillStyle = nameBgColor;
        ctx.strokeStyle = nameStrokeColor;
        ctx.lineWidth = ((isUser || isFocused) ? 1.3 : 0.9) * Math.min(1.4, boatScale);
        const nameRadius = Math.min(6, nameBoxH / 2);
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH, nameRadius);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);
          ctx.strokeRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);
        }
        ctx.fillStyle = nameTextColor;
        ctx.font = `bold ${labelFontPx}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(nameBannerLabel, nameBoxX + namePadX, nameBoxY + nameBoxH / 2);
        ctx.restore();
      }

      // 4. Dessin de la bulle de données sur la ligne d'eau (Donnée 1 · Donnée 2)
      if (hasDataBadge) {
        const rankInfo = this.getRacerRank(boat.userId);
        const badgeColor = isUser ? (rankInfo?.color || '#00f0ff') : 'rgba(0, 240, 255, 0.75)';

        let frontBadgeX = x + hullRx + gap + occupiedFrontOffset;
        let backBadgeX = x - hullRx - gap - occupiedBackOffset - badgeW;

        let badgeX = resolvedDataSide === 'front' ? frontBadgeX : backBadgeX;
        // Si la bulle du nom occupe déjà ce côté et qu'on manque de place, basculer de l'autre côté s'il est libre
        if (resolvedDataSide === 'front' && frontBadgeX + badgeW > maxXBound) {
          if (occupiedFrontOffset > 0 && backBadgeX >= minXBound) {
            badgeX = backBadgeX;
          } else {
            badgeX = Math.max(minXBound, maxXBound - badgeW);
          }
        } else if (resolvedDataSide === 'back' && backBadgeX < minXBound) {
          if (occupiedBackOffset > 0 && frontBadgeX + badgeW <= maxXBound) {
            badgeX = frontBadgeX;
          } else {
            badgeX = minXBound;
          }
        }

        const badgeY = y - badgeH / 2;

        ctx.save();
        ctx.fillStyle = isUser ? 'rgba(6, 15, 33, 0.92)' : 'rgba(6, 15, 33, 0.84)';
        ctx.strokeStyle = badgeColor;
        ctx.lineWidth = (isUser ? 1.3 : 1.0) * Math.min(1.4, boatScale);
        if (isUser) {
          ctx.shadowColor = badgeColor;
          ctx.shadowBlur = (rankInfo?.rank && rankInfo.rank <= 3) ? 6 : 3;
        }

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
        ctx.fillText(badgeText, badgeX + badgePadX, y);
        ctx.restore();
      }
    });
    ctx.restore();

    // 5. Repères de distance épinglés en haut du plan d'eau
    if (followMode) {
      this.drawFollowTopMarkers(ctx, { w, topOffset, camOffset, markerFontPx });
      this.drawFollowOverlays(ctx, { w, topOffset, camOffset });
    }
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

import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { LiveRacerMetric } from '../../services/socket.service';
import { RowerData, NextRaceInfo, PrivateRacePayload } from '../../models/rower-data.model';
import { UserProfile } from '../../models/user.model';

@Component({
  selector: 'app-cockpit-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cockpit-view.component.html',
  encapsulation: ViewEncapsulation.None
})
export class CockpitViewComponent {
  protected Math = Math;

  @Input() isCockpitLeaderboardCollapsed = true;
  @Input() isDraggingCockpitLeaderboard = false;
  @Input() cockpitLeaderboardPos: { x: number; y: number } | null = null;
  @Input() liveMetricsList: LiveRacerMetric[] = [];
  @Input() myCockpitRankBadgeText = '--';
  @Input() sortedLiveMetrics: LiveRacerMetric[] = [];
  @Input() activeUserId = '';
  @Input() isPostRaceDisplayActive = false;
  @Input() myRank: number | null = null;
  @Input() isRaceStoppedByOrganizer = false;
  @Input() myPodiumMedal: { icon: string; label: string; class: string } | null = null;
  @Input() focusedTelemetry: RowerData | null = null;
  @Input() myActivity: RowerData | null = null;
  @Input() activeTargetDistance = 2000;
  @Input() nextRaceInfo: NextRaceInfo | null = null;
  @Input() selectedRaceLeaderboard: any[] = [];
  @Input() isPaired = false;
  @Input() isGeneratingPairingCode = false;
  @Input() pairingCode = '';
  @Input() formattedPairingCountdown = '05:00';
  @Input() canManualSelectPublicKayak = false;
  @Input() claimedRacerUserId = '';
  @Input() selectablePublicKayaks: { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number }[] = [];
  @Input() currentUser!: UserProfile;
  @Input() selectedSpectatorUserId = '';
  @Input() racers: RowerData[] = [];
  @Input() selectedSpectatorRacerName = '';
  @Input() canStartOrStopRace = false;
  @Input() isRaceActive = false;
  @Input() canStartRace = false;
  @Input() myProgressPercent = 0;
  @Input() activeRacersCount = 0;
  @Input() activePrivateRoom: PrivateRacePayload | null = null;
  @Input() formattedPreRaceCountdown = '0m 00s';
  @Input() formattedGameRemaining = '55m 00s';
  @Input() totalActiveRacers = 0;
  @Input() distToLeader = 0;
  @Input() distToPrev = 0;
  @Input() distToNext = 0;
  @Input() fullscreenSupported = true;
  @Input() isFullscreen = false;
  @Input() isPseudoFullscreen = false;

  @Output() cockpitLeaderboardPointerDown = new EventEmitter<PointerEvent>();
  @Output() cockpitLeaderboardPointerMove = new EventEmitter<PointerEvent>();
  @Output() cockpitLeaderboardPointerUp = new EventEmitter<PointerEvent>();
  @Output() cockpitLeaderboardHeaderClick = new EventEmitter<MouseEvent>();
  @Output() spectatorSelect = new EventEmitter<string>();
  @Output() openCurrentRaceLeaderboardRequest = new EventEmitter<void>();
  @Output() returnToHomeAfterRaceRequest = new EventEmitter<void>();
  @Output() generateGarminPairingCodeRequest = new EventEmitter<void>();
  @Output() selectPublicKayak = new EventEmitter<string>();
  @Output() siteViewChange = new EventEmitter<'home' | 'regatta' | 'cockpit'>();
  @Output() stopActiveRaceRequest = new EventEmitter<void>();
  @Output() startActivePrivateRaceRequest = new EventEmitter<void>();
  @Output() toggleFullscreenRequest = new EventEmitter<void>();

  constructor(public i18n: I18nService) {}

  onCockpitLeaderboardPointerDown(event: PointerEvent): void {
    this.cockpitLeaderboardPointerDown.emit(event);
  }

  onCockpitLeaderboardPointerMove(event: PointerEvent): void {
    this.cockpitLeaderboardPointerMove.emit(event);
  }

  onCockpitLeaderboardPointerUp(event: PointerEvent): void {
    this.cockpitLeaderboardPointerUp.emit(event);
  }

  onCockpitLeaderboardHeaderClick(event: MouseEvent): void {
    this.cockpitLeaderboardHeaderClick.emit(event);
  }

  generateGarminPairingCode(): void {
    this.generateGarminPairingCodeRequest.emit();
  }

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteViewChange.emit(view);
  }

  formatPace(val?: any): string {
    if (val === null || val === undefined || val === '') return '--:--';
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === '--:--' || trimmed === '-' || trimmed === 'NaN:NaN' || trimmed === 'NaN') return '--:--';
      if (trimmed.includes(':') || trimmed.includes("'")) return trimmed;
      val = Number(trimmed);
    }
    const sec = Number(val);
    if (!Number.isFinite(sec) || sec <= 0) return '--:--';
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  formatTime(val?: any): string {
    if (val === null || val === undefined || val === '') return '00:00';
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === 'NaN' || trimmed === '--') return '00:00';
      if (trimmed.includes(':')) return trimmed;
      val = Number(trimmed);
    }
    const sec = Number(val);
    if (!Number.isFinite(sec) || sec <= 0) return '00:00';
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  formatDist(val?: any): string {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return '0 m';
    return `${Math.round(n)} m`;
  }

  formatPoints(val?: any): string {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return `+${Math.round(n)} pts`;
  }

  formatRacerGap(racer: LiveRacerMetric, leader: LiveRacerMetric): string {
    const leaderLabel = this.i18n.t('CANVAS_LEADER') || 'Leader';
    if (!leader || racer.userId === leader.userId) return leaderLabel;
    const distDiff = Math.round((leader.dist || 0) - (racer.dist || 0));
    if (distDiff <= 0) return leaderLabel;
    let label = `-${distDiff}m`;
    if (racer.split && racer.split > 0 && racer.split < 600) {
      const secDiff = ((distDiff * racer.split) / 500).toFixed(1);
      label += ` (+${secDiff}s)`;
    }
    return label;
  }
}

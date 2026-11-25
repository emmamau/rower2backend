import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { LiveRacerMetric } from '../../services/socket.service';
import { RowerData, NextRaceInfo, PrivateRacePayload } from '../../models/rower-data.model';
import {
  UserProfile,
  KayakCustomization,
  RegattaMetricKey,
  RegattaMetricOption,
  REGATTA_METRICS_CATALOG,
  RegattaPreferences
} from '../../models/user.model';
import { RegattaCanvasComponent } from '../regatta-canvas/regatta-canvas.component';

@Component({
  selector: 'app-regatta-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RegattaCanvasComponent],
  templateUrl: './regatta-view.component.html',
  encapsulation: ViewEncapsulation.None
})
export class RegattaViewComponent {
  protected Math = Math;
  readonly regattaMetricsCatalog: RegattaMetricOption[] = REGATTA_METRICS_CATALOG;

  @Input() isPostRaceDisplayActive = false;
  @Input() myRank: number | null = null;
  @Input() isRaceStoppedByOrganizer = false;
  @Input() myPodiumMedal: { icon: string; label: string; class: string } | null = null;
  @Input() myActivity: RowerData | null = null;
  @Input() focusedTelemetry: RowerData | null = null;
  @Input() activeTargetDistance = 2000;
  @Input() nextRaceInfo: NextRaceInfo | null = null;
  @Input() selectedRaceLeaderboard: any[] = [];
  @Input() liveMetricsList: LiveRacerMetric[] = [];
  @Input() activeUserId = '';
  @Input() canManualSelectPublicKayak = false;
  @Input() isUserAssociatedWithRace = false;
  @Input() selectablePublicKayaks: { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number }[] = [];
  @Input() activePrivateRoom: PrivateRacePayload | null = null;
  @Input() isPrivateBannerCollapsed = false;
  @Input() waitingStatusText = '';
  @Input() currentUser!: UserProfile;
  @Input() myAssignedLane = 1;
  @Input() selectedSpectatorUserId = '';
  @Input() racers: RowerData[] = [];
  @Input() selectedSpectatorRacerName = '';
  @Input() isRegattaLeaderboardOpen = false;
  @Input() canStartOrStopRace = false;
  @Input() isRaceActive = false;
  @Input() canStartRace = false;
  @Input() regattaZoomLevel = 1;
  @Input() regattaPreferences?: RegattaPreferences;
  @Input() raceElapsedTimeSeconds = 0;
  @Input() visibleRegattaMetrics: RegattaMetricKey[] = [];
  @Input() isPreStartCountdown = false;
  @Input() formattedGameRemaining = '55m 00s';
  @Input() formattedPreRaceCountdown = '0m 00s';
  @Input() currentKayakCustomization!: KayakCustomization;
  @Input() regattaLeaderboardPos: { x: number; y: number } = { x: 16, y: 16 };
  @Input() sortedLiveMetrics: LiveRacerMetric[] = [];
  @Input() totalActiveRacers = 0;
  @Input() distToLeader = 0;
  @Input() distToPrev = 0;
  @Input() distToNext = 0;
  @Input() myProgressPercent = 0;

  get effectiveOvertakeThresholdM(): number {
    return (this.nextRaceInfo as any)?.overtakeThresholdM ?? (this.nextRaceInfo as any)?.race?.overtakeThresholdM ?? (this.activePrivateRoom as any)?.overtakeThresholdM ?? (this.activePrivateRoom as any)?.race?.overtakeThresholdM ?? 5;
  }

  @Output() openCurrentRaceLeaderboardRequest = new EventEmitter<void>();
  @Output() returnToHomeAfterRaceRequest = new EventEmitter<void>();
  @Output() selectPublicKayak = new EventEmitter<string>();
  @Output() spectatorSelect = new EventEmitter<string>();
  @Output() siteViewChange = new EventEmitter<'home' | 'regatta' | 'cockpit'>();
  @Output() toggleRegattaLeaderboardRequest = new EventEmitter<void>();
  @Output() closeRegattaLeaderboardRequest = new EventEmitter<void>();
  @Output() stopActiveRaceRequest = new EventEmitter<void>();
  @Output() startActivePrivateRaceRequest = new EventEmitter<void>();
  @Output() stepRegattaZoomRequest = new EventEmitter<number>();
  @Output() setRegattaZoomRequest = new EventEmitter<number>();
  @Output() openRegattaSettingsRequest = new EventEmitter<void>();
  @Output() kayakClaimed = new EventEmitter<string>();
  @Output() regattaLeaderboardPointerDown = new EventEmitter<PointerEvent>();
  @Output() regattaLeaderboardPointerMove = new EventEmitter<PointerEvent>();
  @Output() regattaLeaderboardPointerUp = new EventEmitter<PointerEvent>();
  @Output() togglePrivateBannerCollapseRequest = new EventEmitter<void>();

  isPinCopied = false;
  private pinCopyTimeout?: any;

  constructor(public i18n: I18nService) {}

  copyPin(pin: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!pin || pin === '----') return;
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pin).then(() => {
        this.isPinCopied = true;
        clearTimeout(this.pinCopyTimeout);
        this.pinCopyTimeout = setTimeout(() => {
          this.isPinCopied = false;
        }, 2000);
      }).catch(() => {});
    }
  }

  toggleBannerCollapse(): void {
    this.togglePrivateBannerCollapseRequest.emit();
  }

  get activePrivateRoomPin(): string {
    return this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || '';
  }

  get activePrivateRoomCode(): string {
    return this.activePrivateRoom?.code || this.activePrivateRoom?.race?.code || '';
  }

  get activePrivateRoomScheduledStartTime(): string | undefined {
    if (!this.activePrivateRoom) return undefined;
    const race = this.activePrivateRoom.race || this.activePrivateRoom;
    const startMode = race?.startMode || (this.activePrivateRoom as any)?.startMode;
    if (startMode !== 'scheduled') return undefined;
    return race?.scheduledStartTime || (this.activePrivateRoom as any)?.scheduledStartTime;
  }

  get activePrivateRoomScheduledDateDisplay(): string {
    const time = this.activePrivateRoomScheduledStartTime;
    if (!time) return '';
    try {
      const d = new Date(time);
      if (!Number.isFinite(d.getTime())) return '';
      const tz = (this.currentUser as any)?.timezone || (this.activePrivateRoom?.race?.timezone) || 'Europe/Paris';
      const dtf = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tz
      });
      return dtf.format(d);
    } catch {
      return String(time);
    }
  }

  get activePrivateRoomCountdownDisplay(): string {
    if (this.activePrivateRoom?.formattedCountdown) {
      return this.activePrivateRoom.formattedCountdown;
    }
    if (this.isPreStartCountdown && this.formattedPreRaceCountdown) {
      return this.formattedPreRaceCountdown;
    }
    if (this.waitingStatusText) {
      return this.waitingStatusText;
    }
    return '0m 00s';
  }

  get myOfficialFinishTime(): string {
    const myEntry = this.selectedRaceLeaderboard.find(e => e.userId === this.activeUserId);
    if (myEntry?.formattedDuration) return myEntry.formattedDuration;
    if (myEntry?.chrono) return myEntry.chrono;
    if (myEntry?.elapsedTime) return this.formatTime(myEntry.elapsedTime);
    if ((this.myActivity as any)?.formattedDuration) return (this.myActivity as any).formattedDuration;
    if ((this.myActivity as any)?.chrono) return (this.myActivity as any).chrono;
    return this.formatTime(this.myActivity?.elapsedTime);
  }

  get isCountdownImminent(): boolean {
    const cd = this.activePrivateRoomCountdownDisplay;
    return cd.includes('s') && !cd.includes('h') && !cd.includes('m');
  }

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteViewChange.emit(view);
  }

  toggleRegattaLeaderboard(): void {
    this.toggleRegattaLeaderboardRequest.emit();
  }

  openRegattaSettings(): void {
    this.openRegattaSettingsRequest.emit();
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

  getRegattaMetricOption(key: RegattaMetricKey): RegattaMetricOption {
    return (
      this.regattaMetricsCatalog.find((m) => m.key === key) || {
        key,
        label: key,
        shortLabel: key.toUpperCase(),
        unit: '',
        icon: '📊',
        desc: '',
      }
    );
  }

  getRegattaMetricDisplay(key: RegattaMetricKey): {
    key: RegattaMetricKey;
    label: string;
    icon: string;
    value: string;
    unit: string;
    sub: string;
    isHighlight: boolean;
  } {
    const opt = this.getRegattaMetricOption(key);
    const telem = this.focusedTelemetry || this.myActivity;
    const watts = Math.round(Number(telem?.lastPower || 0));
    const avgWatts = Math.round(Number(telem?.avgPower || 0));
    const paceSec = Number(telem?.lastPace || 0);
    const avgPaceSec = Number(telem?.avgPace || 0);
    const spm = Number(telem?.lastStrokeRate || telem?.avgStrokeRate || 0);
    const netDist = Math.round(Number(telem?.netDistance || 0));
    const remDist = Math.max(0, Math.round(this.activeTargetDistance - netDist));

    let instSpeedKmh = 0;
    if (paceSec >= 60 && paceSec < 600) {
      instSpeedKmh = (500 / paceSec) * 3.6;
    } else if (watts > 0) {
      instSpeedKmh = Math.cbrt(watts / 2.80) * 3.6;
    }
    const avgSpeedKmh = Number(telem?.avgSpeedKmh || (avgPaceSec >= 60 && avgPaceSec < 600 ? (500 / avgPaceSec) * 3.6 : 0));

    const workJoules = spm > 0 && watts > 0 ? Math.round((watts * 60) / spm) : 0;
    const handleLengthM = Math.min(1.35, Math.max(0.80, (136 - 1.2 * spm) / 100));
    const forceNewtons = workJoules > 0 && handleLengthM > 0 ? Math.round(workJoules / handleLengthM) : 0;

    const shortLabelKeyMap: Record<RegattaMetricKey, string> = {
      speed: 'METRIC_SHORT_SPEED',
      pace: 'METRIC_SHORT_PACE',
      power: 'METRIC_SHORT_POWER',
      position: 'METRIC_SHORT_POSITION',
      distToPrev: 'METRIC_SHORT_DISTTOPREV',
      distToLeader: 'METRIC_SHORT_DISTTOLEADER',
      distToNext: 'METRIC_SHORT_DISTTONEXT',
      distRemaining: 'METRIC_SHORT_DISTREMAINING',
      distCovered: 'METRIC_SHORT_DISTCOVERED',
      force: 'METRIC_SHORT_FORCE',
      work: 'METRIC_SHORT_WORK',
      avgSpeed: 'METRIC_SHORT_AVGSPEED',
      avgPower: 'METRIC_SHORT_AVGPOWER',
      avgPace: 'METRIC_SHORT_AVGPACE',
      chrono: 'METRIC_SHORT_CHRONO',
      spm: 'METRIC_SHORT_SPM',
      none: '',
    };
    const localizedLabel = this.i18n.t(shortLabelKeyMap[key]) || opt.shortLabel;
    const avgPrefix = this.i18n.t('RACE_AVG_PREFIX');
    const instPrefix = this.i18n.t('RACE_INST_PREFIX');
    const leaderLabel = this.i18n.t('CANVAS_LEADER') || 'Leader';

    switch (key) {
      case 'speed':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: instSpeedKmh.toFixed(1),
          unit: 'km/h',
          sub: `${avgPrefix} ${avgSpeedKmh.toFixed(1)} km/h`,
          isHighlight: false,
        };
      case 'pace':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.formatPace(paceSec),
          unit: '/500m',
          sub: `${avgPrefix} ${this.formatPace(avgPaceSec)}`,
          isHighlight: false,
        };
      case 'power':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(watts),
          unit: 'W',
          sub: `${avgPrefix} ${avgWatts} W`,
          isHighlight: true,
        };
      case 'position':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.myRank ? `#${this.myRank}` : '--',
          unit: `/${this.totalActiveRacers || 1}`,
          sub: this.myRank === 1
            ? this.i18n.t('METRIC_IN_LEAD')
            : (this.myRank
              ? this.i18n.t('METRIC_GAP_FIRST_FMT', { dist: this.distToLeader })
              : this.i18n.t('METRIC_RANKING')),
          isHighlight: true,
        };
      case 'distToPrev':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.myRank === 1 ? leaderLabel : (this.myRank && this.myRank > 1 ? `-${this.distToPrev}` : '--'),
          unit: this.myRank && this.myRank > 1 ? 'm' : '',
          sub: this.i18n.t('GAP_PREV'),
          isHighlight: false,
        };
      case 'distToLeader':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.myRank === 1 ? leaderLabel : (this.myRank && this.myRank > 1 ? `-${this.distToLeader}` : '--'),
          unit: this.myRank && this.myRank > 1 ? 'm' : '',
          sub: this.i18n.t('GAP_FIRST'),
          isHighlight: false,
        };
      case 'distToNext':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.myRank && this.myRank < this.totalActiveRacers ? `+${this.distToNext}` : '--',
          unit: this.myRank && this.myRank < this.totalActiveRacers ? 'm' : '',
          sub: this.i18n.t('GAP_NEXT'),
          isHighlight: false,
        };
      case 'distRemaining':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(remDist),
          unit: 'm',
          sub: `${this.i18n.t('RACE_TARGET_PREFIX')} ${this.activeTargetDistance}m`,
          isHighlight: false,
        };
      case 'distCovered':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(netDist),
          unit: 'm',
          sub: this.i18n.t('METRIC_PCT_DONE', { pct: this.myProgressPercent }),
          isHighlight: false,
        };
      case 'force':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(forceNewtons),
          unit: 'N',
          sub: `${spm.toFixed(0)} SPM`,
          isHighlight: false,
        };
      case 'work':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(workJoules),
          unit: 'J',
          sub: this.i18n.t('METRIC_PER_STROKE'),
          isHighlight: false,
        };
      case 'avgSpeed':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: avgSpeedKmh.toFixed(1),
          unit: 'km/h',
          sub: `${instPrefix} ${instSpeedKmh.toFixed(1)} km/h`,
          isHighlight: false,
        };
      case 'avgPower':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(avgWatts),
          unit: 'W',
          sub: `${instPrefix} ${watts} W`,
          isHighlight: false,
        };
      case 'chrono': {
        const totalSec = Math.max(0, Math.floor(this.raceElapsedTimeSeconds || 0));
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
          unit: '',
          sub: this.i18n.t('REGATTA_METRIC_NAME_CHRONO') || 'Chrono',
          isHighlight: true,
        };
      }
      case 'spm':
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: String(Math.round(spm)),
          unit: 'spm',
          sub: this.i18n.t('REGATTA_METRIC_NAME_SPM') || 'Cadence',
          isHighlight: false,
        };
      case 'avgPace':
      default:
        return {
          key,
          label: localizedLabel,
          icon: opt.icon,
          value: this.formatPace(avgPaceSec),
          unit: '/500m',
          sub: `${instPrefix} ${this.formatPace(paceSec)}`,
          isHighlight: false,
        };
    }
  }
}

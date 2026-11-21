import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../../services/i18n.service';
import { PastRaceResult, PrivateRacePayload } from '../../../models/rower-data.model';

@Component({
  selector: 'app-race-history-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './race-history-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class RaceHistoryModalComponent {
  @Input() isHistoryOpen = false;
  @Input() raceHistory: PastRaceResult[] = [];
  @Input() isRaceLeaderboardModalOpen = false;
  @Input() selectedRaceInfo: any = null;
  @Input() isLoadingRaceLeaderboard = false;
  @Input() selectedRaceLeaderboard: any[] = [];
  @Input() activePrivateRoom: PrivateRacePayload | null = null;

  @Output() closeHistoryModalRequest = new EventEmitter<void>();
  @Output() openRaceLeaderboardRequest = new EventEmitter<string>();
  @Output() closeRaceLeaderboardModalRequest = new EventEmitter<void>();
  @Output() leaveCompletedPrivateRoomRequest = new EventEmitter<void>();

  constructor(public i18n: I18nService) {}

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
}

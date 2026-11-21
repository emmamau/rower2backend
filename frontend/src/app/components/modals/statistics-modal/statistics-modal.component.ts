import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../../services/i18n.service';

@Component({
  selector: 'app-statistics-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './statistics-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class StatisticsModalComponent {
  @Input() isStatisticsModalOpen = false;
  @Input() userStatisticsData: any = null;
  @Input() isLoadingStatistics = false;
  @Input() statisticsError = '';
  @Input() isRegisteredUser = false;

  @Output() closeStatisticsModalRequest = new EventEmitter<void>();
  @Output() openSubscriptionModalRequest = new EventEmitter<void>();
  @Output() openAccountLoginRequest = new EventEmitter<void>();

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
}

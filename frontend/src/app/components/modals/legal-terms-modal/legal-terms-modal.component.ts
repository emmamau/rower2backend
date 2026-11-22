import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../../services/i18n.service';
import { WeeklyLeagueHistoryItem } from '../../../models/user.model';
import { getLeagueByTier } from '../../../utils/league.util';

@Component({
  selector: 'app-legal-terms-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './legal-terms-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class LegalTermsModalComponent {
  @Input() isLegalTermsOpen = false;
  @Input() isWatchGuidanceModalOpen = false;
  @Input() pairingCode = '';
  @Input() formattedPairingCountdown = '05:00';
  @Input() isGeneratingPairingCode = false;
  @Input() isWeeklySummaryModalOpen = false;
  @Input() unseenWeeklySummary: WeeklyLeagueHistoryItem | null = null;

  @Output() closeLegalTermsRequest = new EventEmitter<void>();
  @Output() closeWatchGuidanceModalRequest = new EventEmitter<void>();
  @Output() generateGarminPairingCodeRequest = new EventEmitter<void>();
  @Output() closeWeeklySummaryModalRequest = new EventEmitter<void>();

  constructor(public i18n: I18nService) {}

  getLeagueLabel(tier?: string): string {
    const clean = String(tier || 'BRONZE').toUpperCase();
    if (clean === 'GOLD') return this.i18n.t('LEAGUE_GOLD_LABEL');
    if (clean === 'SILVER') return this.i18n.t('LEAGUE_SILVER_LABEL');
    return this.i18n.t('LEAGUE_BRONZE_LABEL');
  }

  getWeeklySummaryDetails(summary: WeeklyLeagueHistoryItem | null): { title: string; subtitle: string; icon: string; cls: string } {
    if (!summary) return { title: '', subtitle: '', icon: '', cls: '' };
    const newInfo = getLeagueByTier(summary.new_league);
    const leagueLabel = this.getLeagueLabel(newInfo.tier);

    switch (summary.outcome) {
      case 'PROMOTED':
        return {
          title: this.i18n.t('WEEKLY_PROMOTED_TITLE', { league: leagueLabel }),
          subtitle: this.i18n.t('WEEKLY_PROMOTED_SUB', { points: summary.final_points }),
          icon: '🚀',
          cls: 'outcome-promoted'
        };
      case 'RELEGATED':
        return {
          title: this.i18n.t('WEEKLY_RELEGATED_TITLE', { league: leagueLabel }),
          subtitle: this.i18n.t('WEEKLY_RELEGATED_SUB', { league: leagueLabel }),
          icon: '⚠️',
          cls: 'outcome-relegated'
        };
      case 'FROZEN':
        return {
          title: this.i18n.t('WEEKLY_FROZEN_TITLE', { league: leagueLabel }),
          subtitle: summary.final_points > 0
            ? this.i18n.t('WEEKLY_FROZEN_RESTING_SUB')
            : this.i18n.t('WEEKLY_FROZEN_IDLE_SUB', { league: leagueLabel }),
          icon: '🏖️',
          cls: 'outcome-frozen'
        };
      case 'MAINTAINED':
      default:
        return {
          title: this.i18n.t('WEEKLY_MAINTAINED_TITLE', { league: leagueLabel }),
          subtitle: this.i18n.t('WEEKLY_MAINTAINED_SUB', { league: leagueLabel, points: summary.final_points }),
          icon: '🛡️',
          cls: 'outcome-maintained'
        };
    }
  }
}

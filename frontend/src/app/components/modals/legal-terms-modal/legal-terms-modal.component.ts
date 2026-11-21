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

  getWeeklySummaryDetails(summary: WeeklyLeagueHistoryItem | null): { title: string; subtitle: string; icon: string; cls: string } {
    if (!summary) return { title: '', subtitle: '', icon: '', cls: '' };
    const newInfo = getLeagueByTier(summary.new_league);

    switch (summary.outcome) {
      case 'PROMOTED':
        return {
          title: `Félicitations ! Vous montez en Ligue ${newInfo.name} !`,
          subtitle: `Grâce à vos ${summary.final_points} points la semaine dernière, vous accédez à l'échelon supérieur.`,
          icon: '🚀',
          cls: 'outcome-promoted'
        };
      case 'RELEGATED':
        return {
          title: `Descente en Ligue ${newInfo.name}`,
          subtitle: `Vous évoluerez en Ligue ${newInfo.name} cette semaine. Donnez tout sur l'eau pour remonter !`,
          icon: '⚠️',
          cls: 'outcome-relegated'
        };
      case 'FROZEN':
        return {
          title: `Ligue ${newInfo.name} Gelée`,
          subtitle: summary.final_points > 0
            ? `Vous étiez en Mode Vacances : votre ligue a été conservée sans risque de relégation.`
            : `Aucune course enregistrée : votre statut en Ligue ${newInfo.name} reste inchangé.`,
          icon: '🏖️',
          cls: 'outcome-frozen'
        };
      case 'MAINTAINED':
      default:
        return {
          title: `Maintien en Ligue ${newInfo.name}`,
          subtitle: `Vous conservez votre place en Ligue ${newInfo.name} avec ${summary.final_points} points accumulés.`,
          icon: '🛡️',
          cls: 'outcome-maintained'
        };
    }
  }
}

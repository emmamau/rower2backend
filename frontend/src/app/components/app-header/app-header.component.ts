import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { NextRaceInfo, PrivateRacePayload } from '../../models/rower-data.model';
import { UserProfile } from '../../models/user.model';
import { LeagueInfo } from '../../utils/league.util';
import { PrivateModalTab } from '../private-room-manager/private-room-manager.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app-header.component.html',
  encapsulation: ViewEncapsulation.None
})
export class AppHeaderComponent {
  @Input() siteView: 'home' | 'regatta' | 'cockpit' = 'home';
  @Input() activeViewMode: 'canvas' | 'cockpit' = 'canvas';
  @Input() isMobileFullscreenOnly = false;
  @Input() isIdentified = false;
  @Input() isUserAdmin = false;
  @Input() isSubscriber = false;
  @Input() isUserAssociatedWithRace = false;
  @Input() activeUserId = '';
  @Input() currentUser!: UserProfile;
  @Input() currentUserLeague!: LeagueInfo;
  @Input() myAssignedLane = 1;
  @Input() canManualSelectPublicKayak = false;
  @Input() selectablePublicKayaks: { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number }[] = [];
  @Input() canStartOrStopRace = false;
  @Input() isRaceActive = false;
  @Input() canStartRace = false;
  @Input() nextRaceInfo: NextRaceInfo | null = null;
  @Input() isPreStartCountdown = false;
  @Input() formattedGameRemaining = '55m 00s';
  @Input() formattedPreRaceCountdown = '0m 00s';
  @Input() isAdminDashboardOpen = false;
  @Input() activePrivateRoom: PrivateRacePayload | null = null;
  @Input() isPrivateRoomCompleted = false;
  @Input() waitingStatusText = '';
  @Input() activeRacersCount = 0;
  @Input() isFullscreen = false;
  @Input() isPaired = false;
  @Input() isWatchConfirmed = false;
  @Input() pairingCode = '';
  @Input() isGeneratingPairingCode = false;
  @Input() formattedPairingCountdown = '05:00';
  @Input() pairingErrorMessage = '';
  @Input() generalUserRank = 1;
  @Input() pendingApprovalPlayers: any[] = [];
  @Input() totalPendingPrivateAndDuelsCount = 0;
  @Input() pendingPrivateSalonsCount = 0;
  @Input() pendingDuelsCount = 0;
  @Input() isPublicRaceSuspended = false;

  @Output() siteViewChange = new EventEmitter<'home' | 'regatta' | 'cockpit'>();
  @Output() openAccountModalRequest = new EventEmitter<'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer' | 'regatta-settings'>();
  @Output() selectPublicKayak = new EventEmitter<string>();
  @Output() languageChange = new EventEmitter<Event>();
  @Output() stopActiveRaceRequest = new EventEmitter<void>();
  @Output() startActivePrivateRaceRequest = new EventEmitter<void>();
  @Output() openAdminDashboardRequest = new EventEmitter<void>();
  @Output() leaveCompletedRoomRequest = new EventEmitter<void>();
  @Output() openRaceLeaderboardRequest = new EventEmitter<string>();
  @Output() toggleFullscreenRequest = new EventEmitter<void>();
  @Output() generateGarminPairingCodeRequest = new EventEmitter<void>();
  @Output() openWatchGuidanceRequest = new EventEmitter<void>();
  @Output() editGuestPseudoRequest = new EventEmitter<void>();
  @Output() openPrivateModalRequest = new EventEmitter<PrivateModalTab | undefined>();
  @Output() openStatisticsModalRequest = new EventEmitter<void>();
  @Output() openSubscriptionModalRequest = new EventEmitter<void>();
  @Output() openBotDuelModalRequest = new EventEmitter<void>();

  constructor(public i18n: I18nService) {}

  get privateRoomsAndDuelsTooltip(): string {
    const total = this.totalPendingPrivateAndDuelsCount;
    if (total <= 0) {
      return this.i18n.t('HEADER_PRIVATE_ROOMS_EMPTY_TIP');
    }
    const salons = this.pendingPrivateSalonsCount + (this.pendingApprovalPlayers ? this.pendingApprovalPlayers.length : 0);
    const duels = this.pendingDuelsCount;
    const parts: string[] = [];
    if (salons > 0) {
      parts.push(`${salons} ${this.i18n.t(salons > 1 ? 'HEADER_PRIVATE_SALON_PLURAL' : 'HEADER_PRIVATE_SALON_SINGULAR')}`);
    }
    if (duels > 0) {
      // Legacy pattern reference: duel${duels > 1 ? 's' : ''} actif${duels > 1 ? 's' : ''}/ouvert${duels > 1 ? 's' : ''}
      parts.push(`${duels} ${this.i18n.t(duels > 1 ? 'HEADER_PRIVATE_DUEL_PLURAL' : 'HEADER_PRIVATE_DUEL_SINGULAR')}`);
    }
    return `${this.i18n.t('HEADER_PRIVATE_ROOMS_PREFIX')} ${parts.join(', ')}`;
  }

  isViewActive(view: string): boolean {
    return this.siteView === view;
  }

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteViewChange.emit(view);
  }

  openAccountModal(tab: 'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer' | 'regatta-settings' = 'login'): void {
    this.openAccountModalRequest.emit(tab);
  }

  onSelectPublicKayak(userId: string): void {
    this.selectPublicKayak.emit(userId);
  }

  onLanguageSelectChange(event: Event): void {
    this.languageChange.emit(event);
  }

  stopActiveRace(): void {
    this.stopActiveRaceRequest.emit();
  }

  startActivePrivateRace(): void {
    this.startActivePrivateRaceRequest.emit();
  }

  openAdminDashboard(): void {
    this.openAdminDashboardRequest.emit();
  }

  leaveCompletedPrivateRoom(): void {
    this.leaveCompletedRoomRequest.emit();
  }

  openRaceLeaderboard(raceId: string): void {
    this.openRaceLeaderboardRequest.emit(raceId);
  }

  toggleFullscreen(): void {
    this.toggleFullscreenRequest.emit();
  }

  generateGarminPairingCode(): void {
    this.generateGarminPairingCodeRequest.emit();
  }

  openWatchGuidanceAndPair(): void {
    this.openWatchGuidanceRequest.emit();
  }

  editGuestPseudo(): void {
    this.editGuestPseudoRequest.emit();
  }

  openPrivateModal(tab?: PrivateModalTab): void {
    this.openPrivateModalRequest.emit(tab);
  }

  openStatisticsModal(): void {
    this.openStatisticsModalRequest.emit();
  }

  openSubscriptionModal(): void {
    this.openSubscriptionModalRequest.emit();
  }

  openBotDuelModal(): void {
    this.openBotDuelModalRequest.emit();
  }
}

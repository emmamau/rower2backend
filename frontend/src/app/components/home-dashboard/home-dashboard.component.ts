import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { LiveRacerMetric } from '../../services/socket.service';
import { NextRaceInfo, PastRaceResult } from '../../models/rower-data.model';
import { UserProfile, UserLastRaceSummary, KayakCustomization } from '../../models/user.model';
import { LeagueInfo, getLeagueByPoints } from '../../utils/league.util';
import { RegattaCanvasComponent } from '../regatta-canvas/regatta-canvas.component';
import { PrivateModalTab } from '../private-room-manager/private-room-manager.component';

@Component({
  selector: 'app-home-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RegattaCanvasComponent],
  templateUrl: './home-dashboard.component.html',
  encapsulation: ViewEncapsulation.None
})
export class HomeDashboardComponent {
  @Input() isMobileFullscreenOnly = false;
  @Input() isSmartphone = false;
  @Input() isRegisteredUser = false;
  @Input() isSubscriber = false;
  @Input() isUserAdmin = false;
  @Input() currentUser!: UserProfile;
  @Input() currentUserLeague!: LeagueInfo;
  @Input() lastRaceSummary!: UserLastRaceSummary;
  @Input() isPaired = false;
  @Input() isWatchConfirmed = false;
  @Input() isRaceActive = false;
  @Input() nextRaceInfo: NextRaceInfo | null = null;
  @Input() activeRacersCount = 0;
  @Input() isGeneratingPairingCode = false;
  @Input() pairingCode = '';
  @Input() formattedPairingCountdown = '05:00';
  @Input() pairingSuccessMessage = '';
  @Input() pairingErrorMessage = '';
  @Input() canManualSelectPublicKayak = false;
  @Input() selectablePublicKayaks: { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number }[] = [];
  @Input() claimedRacerUserId = '';
  @Input() liveMetricsList: LiveRacerMetric[] = [];
  @Input() formattedGameRemaining = '55m 00s';
  @Input() topThreeLiveRacers: { rank: number; name: string; dist: number }[] = [];
  @Input() activeUserId = '';
  @Input() currentKayakCustomization!: KayakCustomization;
  @Input() generalLeaderboard: UserProfile[] = [];
  @Input() filteredGeneralLeaderboard: UserProfile[] = [];
  @Input() availableLeaderboardCountries: string[] = [];
  @Input() raceHistory: PastRaceResult[] = [];
  @Input() lastHomeRefreshAt: Date | null = null;
  @Input() leaderboardCountryFilter = 'all';
  @Input() leaderboardGenderFilter = 'all';
  @Input() leaderboardAgeCategoryFilter = 'all';

  @Output() scrollToNextRaceRequest = new EventEmitter<void>();
  @Output() scrollToGarminPairingRequest = new EventEmitter<void>();
  @Output() siteViewChange = new EventEmitter<'home' | 'regatta' | 'cockpit'>();
  @Output() openPrivateModalRequest = new EventEmitter<PrivateModalTab | undefined>();
  @Output() generateGarminPairingCodeRequest = new EventEmitter<void>();
  @Output() selectPublicKayak = new EventEmitter<string>();
  @Output() spectatorSelect = new EventEmitter<string>();
  @Output() kayakClaimed = new EventEmitter<string>();
  @Output() openStandingsModalRequest = new EventEmitter<void>();
  @Output() openHistoryModalRequest = new EventEmitter<void>();
  @Output() openRaceLeaderboardRequest = new EventEmitter<string>();
  @Output() leaderboardCountryFilterChange = new EventEmitter<string>();
  @Output() leaderboardGenderFilterChange = new EventEmitter<string>();
  @Output() leaderboardAgeCategoryFilterChange = new EventEmitter<string>();
  @Output() applyLeaderboardFiltersRequest = new EventEmitter<void>();
  @Output() resetLeaderboardFiltersRequest = new EventEmitter<void>();
  @Output() challengePlayerRequest = new EventEmitter<string>();

  constructor(public i18n: I18nService) {}

  scrollToNextRace(): void {
    this.scrollToNextRaceRequest.emit();
  }

  scrollToGarminPairing(): void {
    this.scrollToGarminPairingRequest.emit();
  }

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteViewChange.emit(view);
  }

  generateGarminPairingCode(): void {
    this.generateGarminPairingCodeRequest.emit();
  }

  openStandingsModal(): void {
    this.openStandingsModalRequest.emit();
  }

  openHistoryModal(): void {
    this.openHistoryModalRequest.emit();
  }

  getLeagueBadge(points?: number): string {
    return getLeagueByPoints(points || 0).badge;
  }

  getLeagueName(points?: number): string {
    return getLeagueByPoints(points || 0).name;
  }

  getCountryFlag(country?: string): string {
    if (!country) return '🌐';
    const clean = country.trim().toLowerCase();
    const map: Record<string, string> = {
      france: '🇫🇷',
      suisse: '🇨🇭',
      switzerland: '🇨🇭',
      belgique: '🇧🇪',
      belgium: '🇧🇪',
      canada: '🇨🇦',
      'royaume-uni': '🇬🇧',
      'united kingdom': '🇬🇧',
      uk: '🇬🇧',
      gb: '🇬🇧',
      'états-unis': '🇺🇸',
      'etats-unis': '🇺🇸',
      'united states': '🇺🇸',
      usa: '🇺🇸',
      allemagne: '🇩🇪',
      germany: '🇩🇪',
      espagne: '🇪🇸',
      spain: '🇪🇸',
      italie: '🇮🇹',
      italy: '🇮🇹',
      'pays-bas': '🇳🇱',
      netherlands: '🇳🇱',
      portugal: '🇵🇹',
      australie: '🇦🇺',
      australia: '🇦🇺',
      'nouvelle-zélande': '🇳🇿',
      'new zealand': '🇳🇿',
      irlande: '🇮🇪',
      ireland: '🇮🇪',
      maroc: '🇲🇦',
      tunisie: '🇹🇳',
      algérie: '🇩🇿',
      japon: '🇯🇵',
      japan: '🇯🇵',
      brésil: '🇧🇷',
      brazil: '🇧🇷'
    };
    return map[clean] || '🌐';
  }

  getAgeCategoryLabel(birthYear?: number): string {
    if (!birthYear) return '--';
    const age = new Date().getFullYear() - birthYear;
    const yearsUnit = this.i18n.t('STANDINGS_YEARS_SUFFIX');
    if (age < 19) return `U19 (${age} ${yearsUnit})`;
    if (age <= 29) return `Senior (${age} ${yearsUnit})`;
    if (age <= 39) return `Master A (${age} ${yearsUnit})`;
    if (age <= 49) return `Master B (${age} ${yearsUnit})`;
    if (age <= 59) return `Master C (${age} ${yearsUnit})`;
    return `Master D+ (${age} ${yearsUnit})`;
  }

  onCountryFilterChange(val: string): void {
    this.leaderboardCountryFilter = val;
    this.leaderboardCountryFilterChange.emit(val);
    this.applyLeaderboardFiltersRequest.emit();
  }

  onGenderFilterChange(val: string): void {
    this.leaderboardGenderFilter = val;
    this.leaderboardGenderFilterChange.emit(val);
    this.applyLeaderboardFiltersRequest.emit();
  }

  onAgeFilterChange(val: string): void {
    this.leaderboardAgeCategoryFilter = val;
    this.leaderboardAgeCategoryFilterChange.emit(val);
    this.applyLeaderboardFiltersRequest.emit();
  }
}

import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../services/i18n.service';
import { UserProfile, LeagueTier, LeagueStandingItem, DuelLeaderboardItem } from '../../../models/user.model';
import { getLeagueByPoints } from '../../../utils/league.util';

@Component({
  selector: 'app-standings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './standings-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class StandingsModalComponent {
  @Input() isStandingsOpen = false;
  @Input() standingsActiveTab: 'leagues' | 'general' | 'duels' = 'leagues';
  @Input() selectedLeagueTier: LeagueTier = 'BRONZE';
  @Input() leagueTotalActive = 0;
  @Input() isLoadingLeagueStandings = false;
  @Input() leagueStandings: LeagueStandingItem[] = [];
  @Input() currentUser!: UserProfile;
  @Input() activeUserId = '';
  @Input() leaderboardCountryFilter = 'all';
  @Input() leaderboardGenderFilter = 'all';
  @Input() leaderboardAgeCategoryFilter = 'all';
  @Input() availableLeaderboardCountries: string[] = [];
  @Input() filteredGeneralLeaderboard: UserProfile[] = [];
  @Input() duelLeaderboard: DuelLeaderboardItem[] = [];
  @Input() isLoadingDuelLeaderboard = false;
  @Input() duelLeagueFilter = 'all';
  @Input() duelCountryFilter = 'all';
  @Input() duelGenderFilter = 'all';
  @Input() duelCategoryFilter = 'all';
  @Input() duelExactAgeFilter = '';

  @Output() closeStandingsModalRequest = new EventEmitter<void>();
  @Output() standingsActiveTabChange = new EventEmitter<'leagues' | 'general' | 'duels'>();
  @Output() loadLeagueStandingsRequest = new EventEmitter<LeagueTier>();
  @Output() loadGeneralLeaderboardRequest = new EventEmitter<void>();
  @Output() leaderboardCountryFilterChange = new EventEmitter<string>();
  @Output() leaderboardGenderFilterChange = new EventEmitter<string>();
  @Output() leaderboardAgeCategoryFilterChange = new EventEmitter<string>();
  @Output() applyLeaderboardFiltersRequest = new EventEmitter<void>();
  @Output() resetLeaderboardFiltersRequest = new EventEmitter<void>();
  @Output() loadDuelLeaderboardRequest = new EventEmitter<void>();
  @Output() duelLeagueFilterChange = new EventEmitter<string>();
  @Output() duelCountryFilterChange = new EventEmitter<string>();
  @Output() duelGenderFilterChange = new EventEmitter<string>();
  @Output() duelCategoryFilterChange = new EventEmitter<string>();
  @Output() duelExactAgeFilterChange = new EventEmitter<string>();
  @Output() resetDuelLeaderboardFiltersRequest = new EventEmitter<void>();
  @Output() challengePlayerRequest = new EventEmitter<string>();

  constructor(public i18n: I18nService) {}

  getLeagueBadge(points?: number): string {
    return getLeagueByPoints(points || 0).badge;
  }

  getLeagueTierLabel(tier?: string): string {
    const clean = String(tier || 'BRONZE').toUpperCase();
    if (clean === 'GOLD') return this.i18n.t('LEAGUE_GOLD_LABEL');
    if (clean === 'SILVER') return this.i18n.t('LEAGUE_SILVER_LABEL');
    return this.i18n.t('LEAGUE_BRONZE_LABEL');
  }

  getLeagueName(points?: number): string {
    return this.getLeagueTierLabel(getLeagueByPoints(points || 0).tier);
  }

  formatPaceMs(paceMs: number | null): string {
    if (!paceMs || paceMs <= 0) return '-';
    const totalSec = Math.round(paceMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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
    const yrs = this.i18n.t('STANDINGS_YEARS_SUFFIX');
    if (age < 19) return `U19 (${age} ${yrs})`;
    if (age <= 29) return `Senior (${age} ${yrs})`;
    if (age <= 39) return `Master A (${age} ${yrs})`;
    if (age <= 49) return `Master B (${age} ${yrs})`;
    if (age <= 59) return `Master C (${age} ${yrs})`;
    return `Master D+ (${age} ${yrs})`;
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

  onDuelFilterChanged(): void {
    this.loadDuelLeaderboardRequest.emit();
  }

  getLeagueLabelFromTier(tier?: string): string {
    const clean = String(tier || 'BRONZE').toUpperCase();
    if (clean === 'GOLD') return this.i18n.t('LEAGUE_GOLD_SHORT');
    if (clean === 'SILVER') return this.i18n.t('LEAGUE_SILVER_SHORT');
    return this.i18n.t('LEAGUE_BRONZE_SHORT');
  }
}

import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { WakeLockService } from './services/wake-lock.service';
import { I18nService, SupportedLang } from './services/i18n.service';
import { SocketService, LiveRacerMetric } from './services/socket.service';
import {
  PrivateRoomManagerComponent,
  PrivateModalTab
} from './components/private-room-manager/private-room-manager.component';
import { RowerData, NextRaceInfo, PastRaceResult, PrivateRacePayload } from './models/rower-data.model';
import { buildAndroidIntentUrl, detectInAppBrowser, extractInvitationEmail, extractRoomFromLocation, isRegattaModeRequested } from './utils/room-link.util';
import {
  UserProfile,
  UserHistoryItem,
  UserLastRaceSummary,
  KayakCustomization,
  KayakPattern,
  sanitizeKayakCustomization,
  hexToRgba,
  DEFAULT_KAYAK_CUSTOMIZATION,
  RegattaMetricKey,
  RegattaPreferences,
  LaneDataPosition,
  KayakNamePosition,
  RegattaMetricOption,
  REGATTA_METRICS_CATALOG,
  DEFAULT_REGATTA_PREFERENCES,
  sanitizeRegattaPreferences,
  LeagueTier,
  LeagueOutcome,
  LeagueStandingItem,
  WeeklyLeagueHistoryItem,
  DuelPreferences,
  DuelLeaderboardItem,
} from './models/user.model';

export { sanitizeKayakCustomization };
import { getLeagueByPoints, getLeagueByTier, LeagueInfo, WEEKLY_LEAGUES } from './utils/league.util';
import { interval, Subscription, of, Observable, Subject, forkJoin } from 'rxjs';
import { switchMap, startWith, catchError, debounceTime, filter } from 'rxjs/operators';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { RaceOverlaysComponent } from './components/race-overlays/race-overlays.component';
import { AppHeaderComponent } from './components/app-header/app-header.component';
import { HomeDashboardComponent } from './components/home-dashboard/home-dashboard.component';
import { RegattaViewComponent } from './components/regatta-view/regatta-view.component';
import { CockpitViewComponent } from './components/cockpit-view/cockpit-view.component';
import { SeoFooterComponent } from './components/seo-footer/seo-footer.component';
import { AccountModalComponent } from './components/modals/account-modal/account-modal.component';
import { StandingsModalComponent } from './components/modals/standings-modal/standings-modal.component';
import { RaceHistoryModalComponent } from './components/modals/race-history-modal/race-history-modal.component';
import { StatisticsModalComponent } from './components/modals/statistics-modal/statistics-modal.component';
import { SubscriptionModalComponent } from './components/modals/subscription-modal/subscription-modal.component';
import { UnifiedConfigModalComponent } from './components/modals/unified-config-modal/unified-config-modal.component';
import { LegalTermsModalComponent } from './components/modals/legal-terms-modal/legal-terms-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RaceOverlaysComponent,
    AppHeaderComponent,
    HomeDashboardComponent,
    RegattaViewComponent,
    CockpitViewComponent,
    SeoFooterComponent,
    AccountModalComponent,
    StandingsModalComponent,
    RaceHistoryModalComponent,
    StatisticsModalComponent,
    SubscriptionModalComponent,
    UnifiedConfigModalComponent,
    LegalTermsModalComponent,
    PrivateRoomManagerComponent,
    AdminDashboardComponent
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit, OnDestroy {
  protected Math = Math;
  protected Boolean = Boolean;

  // Administration de la plateforme & statut des courses publiques
  isAdminDashboardOpen = false;
  isPublicRaceSuspended = false;

  // Current user / player login
  activeUserId = '';
  userLoginInput = '';
  userIdInput = '';

  currentUser: UserProfile = {
    id: '',
    name: 'Rameur',
    totalRaces: 0,
    totalWins: 0,
    podiums: 0,
    isAdmin: false,
  };

  userHistory: UserHistoryItem[] = [];

  // Next Race & Multiplayer state
  nextRaceInfo: NextRaceInfo | null = null;
  racers: RowerData[] = [];
  liveMetricsList: LiveRacerMetric[] = [];
  myAssignedLane: number = 1;
  activeViewMode: 'canvas' | 'cockpit' = 'canvas';
  siteView: 'home' | 'regatta' | 'cockpit' = 'home';
  userExplicitlyNavigatedHome = false;
  isMobileSeoGuideOpen = false;
  userOverrodeViewMode = false;
  activeRacersCount = 0;
  myActivity: RowerData | null = null;
  raceHistory: PastRaceResult[] = [];

  // Countdown & Pre-start timer sound/visual
  countdownSeconds = 0;
  gameRemainingSeconds = 3300;
  gameMaxDurationSeconds = 3300;
  formattedGameRemaining = '55m 00s';
  is3sCountdown = false;
  isPreStartCountdown = false;
  isPrestartTimerDismissed = false;
  threeSecondsCount = 3;
  private goHoldUntilMs = 0;
  private goTransitionLockUntilMs = 0;
  private goHideTimer: any = null;

  // Live race gap metrics
  myRank: number | null = null;
  distToLeader = 0;
  distToPrev = 0;
  distToNext = 0;
  totalActiveRacers = 0;

  // Finish line toast & race completion state
  finishedRacerIds = new Set<string>();
  finisherCount = 0;
  activeFinishToast: string | null = null;
  private finishToastTimer: any = null;
  showFinishCelebration = false;
  private finishCelebrationTimer: any = null;
  hasCelebratedFinish = false;
  isPostRaceRankingActive = false;
  dismissedLeaderboardRaceIds = new Set<string>();
  completedPublicRaceId: string | null = null;

  // Race Config
  configTargetDistance = 10000;
  configIntervalMinutes = 15;

  backendConnected = false;
  apiUrl = '';
  customApiUrlInput = '';
  errorMessage = '';

  // UI Modals
  isLoginModalOpen = false;

  // Identification directe & Nouveau protocole d'appairage Garmin sécurisé (Code Web -> Montre)
  isWatchConfirmed = false;
  isPaired = false;
  watchPairingRecovered = false;
  isWatchGuidanceModalOpen = false;
  deviceToken = '';
  pairingCode = '';
  pairingCountdownSeconds = 300;
  isGeneratingPairingCode = false;
  pairingSuccessMessage = '';
  pairingErrorMessage = '';
  guestSessionId = '';
  private pairingTimerSub?: Subscription;
  private pairingStatusPollSub?: Subscription;
  private garminPairedSub?: Subscription;

  // Sélecteur de vue / Suivi de joueur (Caméra & Télémétrie spectateur)
  selectedSpectatorUserId = '';
  selectedCockpitPlayerId = '';

  // Immersion tactile automatique (Mode Cockpit & Régate)
  isImmersionControlsVisible = true;
  private immersionHoldTimer: any = null;
  private immersionInactivityTimer: any = null;
  private immersionTouchStart = { x: 0, y: 0 };
  private immersionTouchActive = false;

  // Vue Historique : Modale de consultation du classement complet d'une régate
  isRaceLeaderboardModalOpen = false;
  selectedRaceLeaderboard: any[] = [];
  selectedRaceInfo: any = null;
  isLoadingRaceLeaderboard = false;
  raceLeaderboardError = '';

  // Système de Ligues Hebdomadaires & Mode Repos
  selectedLeagueTier: LeagueTier = 'BRONZE';
  leagueStandings: LeagueStandingItem[] = [];
  isLoadingLeagueStandings = false;
  leaguePromoThreshold = 0;
  leagueRelegateThreshold = 0;
  leagueTotalActive = 0;
  isTogglingRestingMode = false;
  standingsActiveTab: 'leagues' | 'general' | 'duels' = 'leagues';

  // Duels 1v1 : Classement, préférences et défi direct
  duelLeaderboard: DuelLeaderboardItem[] = [];
  isLoadingDuelLeaderboard = false;
  duelLeagueFilter = 'all';
  duelCountryFilter = 'all';
  duelGenderFilter = 'all';
  duelCategoryFilter = 'all';
  duelExactAgeFilter = '';
  prefilledDuelLogin = '';
  prefilledDuelChallengeMode = false;
  pendingDuelInviteToken = '';
  pendingDuelChallengeId = '';
  pendingRegistrationEmail = '';

  regAcceptsDuels = true;
  regDuelStartTime = '08:00';
  regDuelEndTime = '22:00';
  regDuelRefusedDays: number[] = [];

  duelAcceptsDuels = true;
  duelIsAbsent = false;
  duelAbsenceStartDate = '';
  duelAbsenceEndDate = '';
  duelAvailableStartTime = '08:00';
  duelAvailableEndTime = '22:00';
  duelRefusedDays: number[] = [];
  isSavingDuelPreferences = false;
  duelPreferencesFeedback = '';
  duelPreferencesError = '';

  // Salons privés & Duels en attente
  pendingPrivateSalonsCount = 0;
  pendingDuelsCount = 0;
  isPrivateRoomPreview = false;
  isPublicRacePreview = false;
  activeDnfSummary: { distance: number; formattedText: string } | null = null;
  private dnfAutoExitTimer: any = null;

  togglePublicRacePreview(): void {
    if (!this.activePrivateRoom) return;
    this.isPublicRacePreview = !this.isPublicRacePreview;
    if (this.isPublicRacePreview) {
      this.rowerService.getNextRace().subscribe({
        next: (raceData) => {
          if (raceData) {
            this.nextRaceInfo = raceData;
            this.syncSocketRoom(raceData.race.id);
            this.cdr.markForCheck();
          }
        },
        error: () => {}
      });
    } else {
      this.nextRaceInfo = this.activePrivateRoom;
      if (this.activePrivateRoom.race?.id) {
        this.syncSocketRoom(this.activePrivateRoom.race.id);
      }
      this.cdr.markForCheck();
    }
  }

  abandonActiveRace(): void {
    const currentDistance = Math.round((this.myActivity as any)?.dist || this.myActivity?.netDistance || this.myActivity?.currentDistance || 0);
    const hasLane = Boolean(this.myAssignedLane) || this.isUserAssociatedWithRace;
    const isStarted = this.isRaceActive ||
      (this.nextRaceInfo?.status === 'in_progress') ||
      (this.nextRaceInfo?.race?.status === 'RUNNING') ||
      (this.activePrivateRoom?.status === 'in_progress') ||
      (this.activePrivateRoom?.race?.status === 'RUNNING');

    if (this.myActivity) {
      if (isStarted) {
        this.myActivity.status = 'abandoned';
      } else {
        this.myActivity = null;
      }
    }
    const myRacer = this.racers.find(r => r.userId === this.activeUserId);
    if (myRacer) {
      myRacer.status = 'abandoned';
    }

    this.activeDnfSummary = {
      distance: currentDistance,
      formattedText: `Course abandonnée (DNF) · Distance: ${currentDistance} m`
    };

    if (this.dnfAutoExitTimer) {
      clearTimeout(this.dnfAutoExitTimer);
    }
    this.dnfAutoExitTimer = setTimeout(() => {
      this.dismissDnfAndExitToPublic();
    }, 5000);

    this.cdr.markForCheck();
  }

  confirmAbandonRace(): void {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Êtes-vous sûr de vouloir abandonner la course et libérer votre couloir ?')
      : true;
    if (confirmed) {
      this.abandonActiveRace();
    }
  }

  dismissDnfAndExitToPublic(): void {
    if (this.dnfAutoExitTimer) {
      clearTimeout(this.dnfAutoExitTimer);
      this.dnfAutoExitTimer = null;
    }
    this.activeDnfSummary = null;
    if (this.activePrivateRoom) {
      const roomIdent = this.activePrivateRoom.race?.id || this.activePrivateRoom.code;
      if (roomIdent && this.activeUserId) {
        this.rowerService.leaveRoom(roomIdent, this.activeUserId).subscribe({
          next: () => {},
          error: (err) => console.warn('Could not notify leaveRoom to backend in dismissDnfAndExitToPublic:', err)
        });
      }
    } else {
      const currentRaceId = this.nextRaceInfo?.race?.id;
      if (currentRaceId && this.activeUserId) {
        this.rowerService.leaveRoom(currentRaceId, this.activeUserId).subscribe({
          next: () => {},
          error: (err) => console.warn('Could not notify leave public race to backend:', err)
        });
      }
    }
    this.myAssignedLane = null as any;
    this.selectedSpectatorUserId = '';
    this.selectedCockpitPlayerId = '';
    if (!this.isIdentified && !this.isPaired) {
      this.activeUserId = 'guest';
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('rower_active_private_room_id');
        localStorage.removeItem('rower_active_private_room_code');
      }
    } catch {}
    this.exitPrivateRoomToPublic(true);
    this.initGameLoop();
    this.setSiteView('home');
    this.cdr.markForCheck();
  }

  get activeRoomPin(): string {
    return this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || '';
  }

  exitPrivateRoomFromPreview(): void {
    this.exitPrivateRoomToPublic(true);
    this.initGameLoop();
    this.refreshPendingPrivateAndDuels();
  }

  copyActivePin(): void {
    const pin = this.activeRoomPin;
    if (pin && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(pin).then(() => {
        this.triggerFinishToast(`Code PIN ${pin} copié !`);
      }).catch(() => {});
    }
  }

  get totalPendingPrivateAndDuelsCount(): number {
    return this.pendingPrivateSalonsCount + this.pendingDuelsCount + this.pendingApprovalPlayers.length;
  }

  // Modale Bilan Hebdomadaire (Lundi récapitulatif)
  unseenWeeklySummary: WeeklyLeagueHistoryItem | null = null;
  isWeeklySummaryModalOpen = false;

  // Offres d'abonnement
  isSubscriptionModalOpen = false;
  subscriptionTiers: any[] = [];
  pioneerMode = true;
  subscriptionStatus: any = null;
  subscriptionLoading = false;
  subscriptionError = '';
  subscriptionSuccessMessage = '';

  // Admin configuration de la course publique
  isAdminConfigOpen = false;
  isUnifiedConfigOpen = false;
  unifiedConfigActiveTab: 'public' | 'active' = 'public';
  adminConfig = {
    targetDistance: 2000,
    maxParticipants: 20,
    maxDurationMinutes: 55,
    privateMaxDurationMinutes: 55,
    defaultBotsCount: 3,
    defaultBotsPace: 120,
    countdownAfterLastJoinSeconds: 15,
    lobbyWaitMinutes: 15,
  };
  adminConfigMessage = '';
  adminConfigError = '';
  isAdminConfigSubmitting = false;

  // Subscriber Account Management Modal
  isAccountModalOpen = false;
  accountModalTab: 'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer' | 'regatta-settings' = 'login';
  accountAuthError = '';
  accountAuthSuccess = '';
  isAccountSubmitting = false;

  get isAnyModalOpen(): boolean {
    return Boolean(
      this.isAccountModalOpen ||
      this.isLoginModalOpen ||
      this.isPrivateModalOpen ||
      this.isAdminDashboardOpen ||
      this.isStandingsOpen ||
      this.isHistoryOpen ||
      this.isStatisticsModalOpen ||
      this.isSubscriptionModalOpen ||
      this.isLegalTermsOpen ||
      this.isBotDuelModalOpen ||
      this.isWatchGuidanceModalOpen ||
      this.isRaceLeaderboardModalOpen ||
      this.isWeeklySummaryModalOpen ||
      this.isUnifiedConfigOpen ||
      this.isConfigRaceOpen ||
      this.isAdminConfigOpen ||
      this.isRegattaLaunchSplashOpen
    );
  }

  // Préférences d'affichage en Mode Régate (Zoom Lignes d'Eau x1..x3 & Données sous le Canvas)
  readonly regattaMetricsCatalog: RegattaMetricOption[] = REGATTA_METRICS_CATALOG;
  readonly regattaZoomPresets: number[] = [1, 1.5, 2, 2.5, 3];
  regattaZoomLevel = DEFAULT_REGATTA_PREFERENCES.zoomLevel;
  selectedRegattaMetrics: RegattaMetricKey[] = [...DEFAULT_REGATTA_PREFERENCES.selectedMetrics];
  myLaneMetrics: [RegattaMetricKey, RegattaMetricKey] = [...DEFAULT_REGATTA_PREFERENCES.myLaneMetrics];
  myLanePosition: LaneDataPosition = DEFAULT_REGATTA_PREFERENCES.myLanePosition;
  myHeaderMetric: RegattaMetricKey = DEFAULT_REGATTA_PREFERENCES.myHeaderMetric;
  myNamePosition: KayakNamePosition = DEFAULT_REGATTA_PREFERENCES.myNamePosition;
  opponentLaneMetrics: [RegattaMetricKey, RegattaMetricKey] = [...DEFAULT_REGATTA_PREFERENCES.opponentLaneMetrics];
  opponentLanePosition: LaneDataPosition = DEFAULT_REGATTA_PREFERENCES.opponentLanePosition;
  opponentHeaderMetric: RegattaMetricKey = DEFAULT_REGATTA_PREFERENCES.opponentHeaderMetric;
  opponentNamePosition: KayakNamePosition = DEFAULT_REGATTA_PREFERENCES.opponentNamePosition;
  watermarkMetric: RegattaMetricKey = DEFAULT_REGATTA_PREFERENCES.watermarkMetric;
  isSavingRegattaPreferences = false;
  regattaPreferencesFeedback = '';
  regattaPreferencesError = '';

  get userRegattaPreferences(): RegattaPreferences {
    return {
      zoomLevel: this.regattaZoomLevel,
      selectedMetrics: this.selectedRegattaMetrics,
      myLaneMetrics: this.myLaneMetrics,
      myLanePosition: this.myLanePosition,
      myHeaderMetric: this.myHeaderMetric,
      myNamePosition: this.myNamePosition,
      opponentLaneMetrics: this.opponentLaneMetrics,
      opponentLanePosition: this.opponentLanePosition,
      opponentHeaderMetric: this.opponentHeaderMetric,
      opponentNamePosition: this.opponentNamePosition,
      watermarkMetric: this.watermarkMetric,
    };
  }

  // Horloge locale monotone haute précision (interdiction absolue de recul temporel)
  private raceMonotonicStartTimestamp: number | null = null;
  private raceMonotonicMaxElapsed = 0;
  private lastFetchedLeaderboardRaceId: string | null = null;

  get currentRaceElapsedSeconds(): number {
    if (this.myActivity?.status === 'finished' && this.myActivity?.elapsedTime && this.myActivity.elapsedTime > 0) {
      return this.myActivity.elapsedTime;
    }
    const isRunning = this.isRaceActive;
    if (!isRunning) {
      if (this.isPostRaceDisplayActive && this.raceMonotonicMaxElapsed > 0) {
        return this.raceMonotonicMaxElapsed;
      }
      this.raceMonotonicStartTimestamp = null;
      this.raceMonotonicMaxElapsed = 0;
      return 0;
    }
    const now = Date.now();
    if (!this.raceMonotonicStartTimestamp) {
      const candidateElapsed = (this.myActivity?.elapsedTime && this.myActivity.elapsedTime > 0)
        ? this.myActivity.elapsedTime
        : Math.max(0, (this.gameMaxDurationSeconds || 0) - (this.gameRemainingSeconds || 0));
      this.raceMonotonicStartTimestamp = now - candidateElapsed * 1000;
      this.raceMonotonicMaxElapsed = Math.max(this.raceMonotonicMaxElapsed, candidateElapsed);
    }
    const computedElapsed = Math.max(0, Math.floor((now - this.raceMonotonicStartTimestamp) / 1000));
    const serverElapsed = (this.myActivity?.elapsedTime && this.myActivity.elapsedTime > 0)
      ? this.myActivity.elapsedTime
      : Math.max(0, (this.gameMaxDurationSeconds || 0) - (this.gameRemainingSeconds || 0));
    if (serverElapsed > computedElapsed + 2) {
      this.raceMonotonicStartTimestamp = now - serverElapsed * 1000;
    }
    const effective = Math.max(this.raceMonotonicMaxElapsed, computedElapsed, serverElapsed > computedElapsed ? serverElapsed : 0);
    this.raceMonotonicMaxElapsed = effective;
    return effective;
  }

  refreshOfficialRaceLeaderboard(raceId: string): void {
    if (!raceId) return;
    this.rowerService.getRaceLeaderboard(raceId).subscribe({
      next: (res) => {
        if (res && res.success && Array.isArray(res.leaderboard) && res.leaderboard.length > 0) {
          this.selectedRaceInfo = res.race || this.selectedRaceInfo;
          this.selectedRaceLeaderboard = res.leaderboard;
          const myEntry = this.selectedRaceLeaderboard.find(e => e.userId === this.activeUserId);
          if (myEntry) {
            this.myRank = myEntry.position;
            if (this.myActivity) {
              if (myEntry.elapsedTime) this.myActivity.elapsedTime = myEntry.elapsedTime;
              if (myEntry.formattedDuration) (this.myActivity as any).formattedDuration = myEntry.formattedDuration;
              if (myEntry.chrono) (this.myActivity as any).chrono = myEntry.chrono;
              if (myEntry.avgPaceSec) this.myActivity.avgPace = myEntry.avgPaceSec;
            }
          }
          this.cdr.markForCheck();
        }
      },
      error: () => {}
    });
  }

  // Personnalisation du Kayak 2D
  customKayakHullColor = '#00e5ff';
  customKayakBladeColor = '#00f0ff';
  customKayakPattern: KayakPattern = 'racing-stripe';
  customKayakGlowColor = '#00f0ff';
  isSavingKayak = false;
  isPostRegisterOnboarding = false;

  readonly presetColors = [
    { name: 'Cyan Néon', hex: '#00e5ff' },
    { name: 'Bleu Royal', hex: '#0055ff' },
    { name: 'Rouge Racing', hex: '#ff0055' },
    { name: 'Orange Éclair', hex: '#ff6600' },
    { name: 'Or Vainqueur', hex: '#ffe600' },
    { name: 'Vert Émeraude', hex: '#39ff14' },
    { name: 'Violet Pulsar', hex: '#b026ff' },
    { name: 'Noir Carbone', hex: '#1a1f2c' },
    { name: 'Blanc Pur', hex: '#ffffff' }
  ];

  readonly patternOptions: { id: KayakPattern; label: string; icon: string; desc: string }[] = [
    { id: 'solid', label: 'Uni Épuré', icon: '🎨', desc: 'Finition classique monochrome' },
    { id: 'racing-stripe', label: 'Bande Racing', icon: '⚡', desc: 'Double liseré central athlétique' },
    { id: 'dual-tone', label: 'Bi-Colore', icon: '🌗', desc: 'Contraste marqué proue / poupe' },
    { id: 'gradient', label: 'Dégradé', icon: '🌈', desc: 'Fusion fluide de teintes sportives' }
  ];

  committedKayakCustomization: KayakCustomization = {
    ...DEFAULT_KAYAK_CUSTOMIZATION
  };

  get currentKayakCustomization(): KayakCustomization {
    return this.committedKayakCustomization;
  }

  get previewKayakCustomization(): KayakCustomization {
    return {
      hullColor: this.customKayakHullColor,
      bladeColor: this.customKayakBladeColor,
      pattern: this.customKayakPattern,
      glowColor: this.customKayakGlowColor
    };
  }

  restorePreviewFromCommitted(): void {
    this.customKayakHullColor = this.committedKayakCustomization.hullColor;
    this.customKayakBladeColor = this.committedKayakCustomization.bladeColor;
    this.customKayakPattern = this.committedKayakCustomization.pattern;
    this.customKayakGlowColor = this.committedKayakCustomization.glowColor;
  }

  getPatternLabel(pattern: KayakPattern): string {
    const found = this.patternOptions.find(p => p.id === pattern);
    return found ? `${found.icon} ${found.label}` : 'Uni Épuré';
  }

  getLocalKayakCustomization(): KayakCustomization | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('rower_kayak_customization');
      if (raw) {
        return sanitizeKayakCustomization(JSON.parse(raw));
      }
    } catch {}
    return null;
  }

  syncKayakCustomizationFromUser(user?: UserProfile): void {
    const custom = user?.kayakCustomization || this.getLocalKayakCustomization();
    this.committedKayakCustomization = sanitizeKayakCustomization(custom);
    this.restorePreviewFromCommitted();
  }

  openKayakCustomizer(): void {
    this.syncKayakCustomizationFromUser(this.currentUser);
    this.accountModalTab = 'kayak-customizer';
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  saveKayakCustomization(): void {
    const customization = sanitizeKayakCustomization(this.previewKayakCustomization);
    try {
      localStorage.setItem('rower_kayak_customization', JSON.stringify(customization));
    } catch {}

    const targetUserId = this.currentUser?.login || this.currentUser?.id || this.activeUserId;
    if (!targetUserId || !this.isRegisteredUser) {
      this.committedKayakCustomization = customization;
      this.isPostRegisterOnboarding = false;
      this.accountAuthSuccess = 'Style de kayak sauvegardé en local !';
      this.accountModalTab = 'profile';
      this.cdr.markForCheck();
      return;
    }

    this.isSavingKayak = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.updateKayakCustomization(targetUserId, customization).subscribe({
      next: (res) => {
        this.isSavingKayak = false;
        this.committedKayakCustomization = customization;
        if (res.success && res.user) {
          this.currentUser = { ...this.currentUser, ...res.user, kayakCustomization: customization };
          this.accountAuthSuccess = 'Votre kayak personnalisé a été enregistré avec succès !';
        } else {
          this.accountAuthSuccess = 'Style de kayak sauvegardé !';
        }
        this.isPostRegisterOnboarding = false;
        this.accountModalTab = 'profile';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSavingKayak = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_KAYAK_SAVE');
        this.cdr.markForCheck();
      }
    });
  }

  skipKayakCustomization(): void {
    this.restorePreviewFromCommitted();
    this.isPostRegisterOnboarding = false;
    this.accountModalTab = 'profile';
    this.cdr.markForCheck();
  }

  // --------------------------------------------------------------------------
  // PRÉFÉRENCES D'AFFICHAGE EN MODE RÉGATE (ZOOM X3 & DONNÉES SOUS LE CANVAS)
  // --------------------------------------------------------------------------
  getLocalRegattaPreferences(): RegattaPreferences | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('rower_regatta_preferences');
      if (raw) {
        return sanitizeRegattaPreferences(JSON.parse(raw));
      }
    } catch {}
    return null;
  }

  syncRegattaPreferencesFromUser(user?: UserProfile): void {
    const prefs = sanitizeRegattaPreferences(user?.regattaPreferences || this.getLocalRegattaPreferences());
    this.regattaZoomLevel = prefs.zoomLevel;
    this.selectedRegattaMetrics = [...prefs.selectedMetrics];
    this.myLaneMetrics = [...prefs.myLaneMetrics];
    this.myLanePosition = prefs.myLanePosition;
    this.myHeaderMetric = prefs.myHeaderMetric;
    this.myNamePosition = prefs.myNamePosition;
    this.opponentLaneMetrics = [...prefs.opponentLaneMetrics];
    this.opponentLanePosition = prefs.opponentLanePosition;
    this.opponentHeaderMetric = prefs.opponentHeaderMetric;
    this.opponentNamePosition = prefs.opponentNamePosition;
    this.watermarkMetric = prefs.watermarkMetric;
  }

  openRegattaSettings(): void {
    this.syncRegattaPreferencesFromUser(this.currentUser);
    this.accountModalTab = 'regatta-settings';
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.regattaPreferencesError = '';
    this.regattaPreferencesFeedback = '';
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  isRegattaMetricSelected(key: RegattaMetricKey): boolean {
    return this.selectedRegattaMetrics.includes(key);
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

  toggleRegattaMetric(key: RegattaMetricKey): void {
    this.regattaPreferencesError = '';
    this.regattaPreferencesFeedback = '';
    const idx = this.selectedRegattaMetrics.indexOf(key);
    if (idx >= 0) {
      if (this.selectedRegattaMetrics.length <= 3) {
        this.regattaPreferencesError = this.i18n.translateError('ERR_REGATTA_MIN_METRICS');
        this.cdr.markForCheck();
        return;
      }
      this.selectedRegattaMetrics = this.selectedRegattaMetrics.filter((k) => k !== key);
    } else {
      this.selectedRegattaMetrics = [...this.selectedRegattaMetrics, key];
    }
    this.cdr.markForCheck();
  }

  moveRegattaMetric(index: number, direction: -1 | 1): void {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= this.selectedRegattaMetrics.length) return;
    const copy = [...this.selectedRegattaMetrics];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    this.selectedRegattaMetrics = copy;
    this.cdr.markForCheck();
  }

  resetRegattaPreferencesDefault(): void {
    this.regattaZoomLevel = DEFAULT_REGATTA_PREFERENCES.zoomLevel;
    this.selectedRegattaMetrics = [...DEFAULT_REGATTA_PREFERENCES.selectedMetrics];
    this.myLaneMetrics = [...DEFAULT_REGATTA_PREFERENCES.myLaneMetrics];
    this.myLanePosition = DEFAULT_REGATTA_PREFERENCES.myLanePosition;
    this.myHeaderMetric = DEFAULT_REGATTA_PREFERENCES.myHeaderMetric;
    this.myNamePosition = DEFAULT_REGATTA_PREFERENCES.myNamePosition;
    this.opponentLaneMetrics = [...DEFAULT_REGATTA_PREFERENCES.opponentLaneMetrics];
    this.opponentLanePosition = DEFAULT_REGATTA_PREFERENCES.opponentLanePosition;
    this.opponentHeaderMetric = DEFAULT_REGATTA_PREFERENCES.opponentHeaderMetric;
    this.opponentNamePosition = DEFAULT_REGATTA_PREFERENCES.opponentNamePosition;
    this.watermarkMetric = DEFAULT_REGATTA_PREFERENCES.watermarkMetric;
    this.regattaPreferencesError = '';
    this.regattaPreferencesFeedback = 'Paramètres par défaut restaurés.';
    this.cdr.markForCheck();
  }

  setRegattaZoom(level: number, persist: boolean = true): void {
    const cleanLevel = Math.min(3, Math.max(1, Math.round(Number(level || 1) * 2) / 2));
    this.regattaZoomLevel = cleanLevel;
    if (persist) {
      this.persistRegattaPreferencesSilent();
    }
    this.cdr.markForCheck();
  }

  stepRegattaZoom(delta: number): void {
    const next = Math.min(3, Math.max(1, Math.round((this.regattaZoomLevel + delta) * 2) / 2));
    this.setRegattaZoom(next, true);
  }

  private persistRegattaPreferencesSilent(): void {
    const prefs = sanitizeRegattaPreferences(this.userRegattaPreferences);
    try {
      localStorage.setItem('rower_regatta_preferences', JSON.stringify(prefs));
    } catch {}
    if (this.currentUser) {
      this.currentUser.regattaPreferences = prefs;
    }
    const targetUserId = this.currentUser?.login || this.currentUser?.id || this.activeUserId;
    if (targetUserId && this.isRegisteredUser) {
      this.rowerService.updateRegattaPreferences(targetUserId, prefs).subscribe({
        next: () => {},
        error: () => {},
      });
    }
  }

  saveRegattaPreferences(): void {
    if (this.selectedRegattaMetrics.length < 3) {
      this.regattaPreferencesError = this.i18n.translateError('ERR_REGATTA_MIN_METRICS');
      this.cdr.markForCheck();
      return;
    }

    const prefs = sanitizeRegattaPreferences(this.userRegattaPreferences);

    try {
      localStorage.setItem('rower_regatta_preferences', JSON.stringify(prefs));
    } catch {}

    const targetUserId = this.currentUser?.login || this.currentUser?.id || this.activeUserId;
    if (!targetUserId || !this.isRegisteredUser) {
      this.currentUser.regattaPreferences = prefs;
      this.regattaPreferencesFeedback = 'Préférences d’affichage enregistrées sur cet appareil !';
      this.accountAuthSuccess = 'Préférences de régate sauvegardées !';
      this.cdr.markForCheck();
      return;
    }

    this.isSavingRegattaPreferences = true;
    this.regattaPreferencesError = '';
    this.regattaPreferencesFeedback = '';

    this.rowerService.updateRegattaPreferences(targetUserId, prefs).subscribe({
      next: (res) => {
        this.isSavingRegattaPreferences = false;
        this.currentUser = {
          ...this.currentUser,
          ...(res.user || {}),
          regattaPreferences: prefs,
        };
        this.regattaPreferencesFeedback = 'Vos préférences de régate et de zoom ont été enregistrées dans votre profil !';
        this.accountAuthSuccess = 'Préférences de régate enregistrées avec succès !';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSavingRegattaPreferences = false;
        this.regattaPreferencesError = this.i18n.translateError(err.error?.message ? err : 'ERR_PREFS_SAVE');
        this.cdr.markForCheck();
      },
    });
  }

  syncDuelPreferencesFromUser(user?: UserProfile): void {
    const prefs = user?.duelPreferences;
    if (!prefs) return;
    this.duelAcceptsDuels = prefs.acceptsDuels !== undefined ? Boolean(prefs.acceptsDuels) : true;
    this.duelIsAbsent = Boolean(prefs.isAbsent);
    this.duelAbsenceStartDate = prefs.absenceStartDate || '';
    this.duelAbsenceEndDate = prefs.absenceEndDate || '';
    this.duelRefusedDays = Array.isArray(prefs.refusedDays) ? [...prefs.refusedDays] : [];
    const firstWindow = Array.isArray(prefs.availableWindows) && prefs.availableWindows.length > 0
      ? prefs.availableWindows[0]
      : { startTime: '08:00', endTime: '22:00' };
    this.duelAvailableStartTime = firstWindow.startTime || '08:00';
    this.duelAvailableEndTime = firstWindow.endTime || '22:00';
  }

  toggleRegDuelRefusedDay(day: number): void {
    if (this.regDuelRefusedDays.includes(day)) {
      this.regDuelRefusedDays = this.regDuelRefusedDays.filter((d) => d !== day);
    } else {
      this.regDuelRefusedDays = [...this.regDuelRefusedDays, day];
    }
  }

  toggleDuelRefusedDay(day: number): void {
    if (this.duelRefusedDays.includes(day)) {
      this.duelRefusedDays = this.duelRefusedDays.filter((d) => d !== day);
    } else {
      this.duelRefusedDays = [...this.duelRefusedDays, day];
    }
  }

  saveDuelPreferences(): void {
    const targetUserId = this.currentUser?.login || this.currentUser?.id || this.activeUserId;
    if (!targetUserId || !this.isRegisteredUser) {
      this.duelPreferencesError = this.i18n.translateError('ERR_DUEL_LOGIN_REQUIRED');
      return;
    }

    const startTime = this.duelAvailableStartTime || '08:00';
    const endTime = this.duelAvailableEndTime || '22:00';
    if (endTime <= startTime) {
      this.duelPreferencesError = this.i18n.translateError('ERR_DUEL_TIME_RANGE');
      return;
    }

    const prefs: DuelPreferences = {
      acceptsDuels: Boolean(this.duelAcceptsDuels),
      isAbsent: Boolean(this.duelIsAbsent),
      absenceStartDate: this.duelIsAbsent && this.duelAbsenceStartDate ? this.duelAbsenceStartDate : null,
      absenceEndDate: this.duelIsAbsent && this.duelAbsenceEndDate ? this.duelAbsenceEndDate : null,
      refusedDays: [...this.duelRefusedDays],
      availableWindows: [{ startTime, endTime }],
      timezone: typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris') : 'Europe/Paris',
    };

    this.isSavingDuelPreferences = true;
    this.duelPreferencesFeedback = '';
    this.duelPreferencesError = '';

    this.rowerService.updateDuelPreferences(targetUserId, prefs).subscribe({
      next: (res) => {
        this.isSavingDuelPreferences = false;
        this.currentUser = {
          ...this.currentUser,
          ...(res.user || {}),
          duelPreferences: res.duelPreferences || prefs,
        };
        this.duelPreferencesFeedback = res.message || 'Préférences de duel enregistrées !';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSavingDuelPreferences = false;
        this.duelPreferencesError = this.i18n.translateError(err?.error?.message ? err : 'ERR_PREFS_SAVE');
        this.cdr.markForCheck();
      },
    });
  }

  loadDuelLeaderboard(): void {
    this.isLoadingDuelLeaderboard = true;
    this.rowerService.getDuelLeaderboard({
      league: this.duelLeagueFilter,
      country: this.duelCountryFilter,
      gender: this.duelGenderFilter,
      category: this.duelCategoryFilter,
      age: this.duelExactAgeFilter,
      includeAll: true,
    }).pipe(
      catchError(() => of({ success: false, count: 0, players: [] }))
    ).subscribe((res) => {
      this.isLoadingDuelLeaderboard = false;
      if (res && res.players) {
        this.duelLeaderboard = res.players;
      }
      this.cdr.markForCheck();
    });
  }

  resetDuelLeaderboardFilters(): void {
    this.duelLeagueFilter = 'all';
    this.duelCountryFilter = 'all';
    this.duelGenderFilter = 'all';
    this.duelCategoryFilter = 'all';
    this.duelExactAgeFilter = '';
    this.loadDuelLeaderboard();
  }

  openDuelChallengeForPlayer(login: string): void {
    const cleanLogin = String(login || '').trim();
    if (!cleanLogin) return;
    this.closeAllOverlayModals();
    this.prefilledDuelLogin = cleanLogin;
    this.prefilledDuelChallengeMode = true;
    this.openPrivateModal('create');
    this.cdr.markForCheck();
  }

  onPrefilledDuelHandled(): void {
    this.prefilledDuelLogin = '';
    this.prefilledDuelChallengeMode = false;
  }

  handleIncomingDuelChallenge(challengeId: string): void {
    const cleanId = String(challengeId || '').trim();
    if (!cleanId) return;

    this.setSiteView('home');
    this.userExplicitlyNavigatedHome = true;

    if (!this.isIdentified) {
      this.pendingDuelChallengeId = cleanId;
      if (this.invitationEmail) {
        this.loginAccountInput = this.invitationEmail;
        this.regEmail = this.invitationEmail;
      }
      this.openAccountModal('login');
      this.accountAuthSuccess = 'Connectez-vous à votre compte pour accéder à votre défi de duel 1v1.';
      this.cdr.markForCheck();
      return;
    }

    this.rowerService.getDuelChallengeById(cleanId).subscribe({
      next: (res) => {
        if (!res?.success || !res.challenge) {
          this.triggerFinishToast('⚠️ Défi de duel introuvable ou expiré.');
          this.pendingDuelChallengeId = '';
          this.cdr.markForCheck();
          return;
        }

        const ch = res.challenge;
        const status = ch.status;

        if (status === 'REFUSED' || status === 'CANCELLED' || status === 'EXPIRED') {
          const statusLabel = status === 'REFUSED'
            ? 'refusé'
            : status === 'CANCELLED'
            ? 'annulé par son créateur'
            : 'expiré';
          this.triggerFinishToast(`⚠️ Ce défi de duel a été ${statusLabel}.`);
          this.pendingDuelChallengeId = '';
          this.isPrivateModalOpen = false;
          this.setSiteView('home');
          this.cdr.markForCheck();
          return;
        }

        // Si PENDING ou ACCEPTED : charger le salon privé et ouvrir la modale
        const targetRoomCode = ch.roomCode || ch.roomId;
        if (targetRoomCode) {
          this.rowerService.getPrivateRace(targetRoomCode).subscribe({
            next: (room) => {
              (room as any).duelChallenge = ch;
              this.activatePrivateRoom(room, false, true);
              this.setSiteView('home');
              this.userExplicitlyNavigatedHome = true;
              this.isPrivateModalOpen = true;
              this.privateModalTab = 'duels';
              this.pendingDuelChallengeId = '';
              this.cdr.markForCheck();
            },
            error: () => {
              this.setSiteView('home');
              this.userExplicitlyNavigatedHome = true;
              this.isPrivateModalOpen = true;
              this.privateModalTab = 'duels';
              this.pendingDuelChallengeId = '';
              this.cdr.markForCheck();
            }
          });
        }
      },
      error: () => {
        this.triggerFinishToast('⚠️ Erreur lors de la récupération du duel.');
        this.pendingDuelChallengeId = '';
      }
    });
  }

  /**
   * Liste des données visibles sous le canevas des lignes d'eau :
   * En zoomant (de x1 à x3), réduit progressivement le nombre de données visibles jusqu'à un minimum de 3.
   */
  get visibleRegattaMetrics(): RegattaMetricKey[] {
    const list = this.selectedRegattaMetrics.length >= 3
      ? this.selectedRegattaMetrics
      : DEFAULT_REGATTA_PREFERENCES.selectedMetrics;
    const total = list.length;
    if (total <= 3 || this.regattaZoomLevel <= 1) {
      return list;
    }
    const zoomRatio = Math.min(1, Math.max(0, (this.regattaZoomLevel - 1) / 2));
    const visibleCount = Math.max(3, Math.round(total - (total - 3) * zoomRatio));
    return list.slice(0, visibleCount);
  }

  drawKayakCustomizerPreview(): void {
    // Délégué à AccountModalComponent
  }

  // Login inputs
  loginAccountInput = '';
  passwordAccountInput = '';

  // Register inputs
  regNom = '';
  regPrenom = '';
  regAnneeNaissance = 1995;
  regSexe = 'M';
  regPays = 'France';
  regCustomPays = '';
  regLogin = '';
  regEmail = '';
  regPassword = '';
  regPasswordConfirm = '';
  showRegPassword = false;
  showRegPasswordConfirm = false;
  regWebsiteUrl = '';
  regWatchUserId = '';

  // Forgot / Reset inputs
  forgotEmailOrLogin = '';
  resetToken = '';
  resetNewPassword = '';
  resetPasswordConfirm = '';
  showResetFields = false;
  showResetPassword = false;

  // Change password inputs (connected user)
  currentPassword = '';
  changeNewPassword = '';
  changePasswordConfirm = '';
  isChangePasswordOpen = false;

  getPasswordStrength(pwd: string): { score: number; label: string; class: string; width: string } {
    if (!pwd) return { score: 0, label: '', class: '', width: '0%' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) score++;

    if (score <= 2) return { score, label: 'Faible', class: 'strength-weak', width: '33%' };
    if (score <= 4) return { score, label: 'Moyen', class: 'strength-medium', width: '66%' };
    return { score, label: 'Robuste', class: 'strength-strong', width: '100%' };
  }

  isPasswordPolicySatisfied(pwd: string): boolean {
    return Boolean(
      pwd &&
      pwd.length >= 8 &&
      /[A-Z]/.test(pwd) &&
      /[a-z]/.test(pwd) &&
      /\d/.test(pwd) &&
      /[!@#$%^&*(),.?":{}|<>]/.test(pwd)
    );
  }

  isHistoryOpen = false;
  isConfigRaceOpen = false;
  isSettingsOpen = false;
  isLegalTermsOpen = false; // Modale Conditions d'utilisation & RGPD
  isStandingsOpen = false;  // Modale Classement général par points

  // Filtres du tableau des classements
  leaderboardCountryFilter = 'all';
  leaderboardGenderFilter = 'all';
  leaderboardAgeCategoryFilter = 'all';

  // Mode Duel 1v1 Bot (pour les joueurs sans compte)
  isBotDuelModalOpen = false;
  botDuelDistance = 2000;
  botDuelName = '';
  isCreatingBotDuel = false;
  botDuelError = '';

  // Timer pré-course déplaçable (Draggable Pre-start countdown)
  timerPosition: { x: number; y: number } | null = null;
  isDraggingTimer = false;
  private dragStartPointer = { x: 0, y: 0 };
  private dragStartTimerPos = { x: 0, y: 0 };

  // Orientation paysage & notice de rotation
  isOrientationDismissed = false;

  // Écran d'accueil de lancement direct de régate (lien email ?mode=regatta)
  isRegattaLaunchSplashOpen = false;
  pendingRegattaLaunch = false;
  invitationEmail = '';
  invitationStep: 'choice' | 'guest-pairing' | 'login' | 'register' = 'choice';
  invitationAuthError = '';
  isInvitationSubmitting = false;
  isInAppBrowser = false;
  isIosInApp = false;
  isAndroidInApp = false;

  // Mini-leaderboard cockpit rétractable & déplaçable (Draggable Leaderboard)
  isCockpitLeaderboardCollapsed = true;
  cockpitLeaderboardPos: { x: number; y: number } | null = null;
  isDraggingCockpitLeaderboard = false;
  private dragStartCockpitPointer = { x: 0, y: 0 };
  private dragStartCockpitPos = { x: 0, y: 0 };
  private hasMovedCockpitLeaderboard = false;

  // Popup / Panneau de classement en direct flottant et déplaçable dans le plan d'eau (mode régate)
  isRegattaLeaderboardOpen = false;
  regattaLeaderboardPos: { x: number; y: number } = { x: 16, y: 16 };
  isDraggingRegattaLeaderboard = false;
  private dragStartRegattaPointer = { x: 0, y: 0 };
  private dragStartRegattaPos = { x: 0, y: 0 };
  private hasMovedRegattaLeaderboard = false;

  // Espace Statistiques & Analyses de courses (abonnés = illimité, comptes gratuits = 10 jours)
  isStatisticsModalOpen = false;
  userStatisticsData: any = null;
  isLoadingStatistics = false;
  statisticsError = '';

  // Résiliation d'abonnement & Suppression de compte RGPD
  isUnsubscribing = false;
  unsubscribeMessage = '';
  unsubscribeError = '';
  isDeletingAccount = false;
  deleteAccountError = '';

  // Espace de contenu SEO multilingue
  activeSeoLang: 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt' = 'fr';
  isSeoSectionExpanded = false;

  // Classement général
  generalLeaderboard: UserProfile[] = [];
  generalUserRank = 1;
  generalTotalPlayers = 1;

  wakeLockActive = false;
  wakeLockSupported = false;

  private pollingSub?: Subscription;
  private lastHttpSyncAtMs = 0;
  private lastSocketUpdateAtMs = 0;
  // Private Salons state
  activePrivateRoom: PrivateRacePayload | null = null;
  isPrivateRoomCompleted = false;
  isAwaitingWatchPin = false;
  isPrivateModalOpen = false;
  privateModalTab: PrivateModalTab = 'create';
  privateUrlError = '';
  isPrivateBannerCollapsed = false;

  onPrivateBannerCollapsedChange(collapsed: boolean): void {
    this.isPrivateBannerCollapsed = collapsed;
    this.cdr.markForCheck();
  }


  private socketSub?: Subscription;
  private statusSub?: Subscription;
  private privateUpdateSub?: Subscription;
  private duelEventSub?: Subscription;
  private countdownTickerSub?: Subscription;
  private joinedSocketRaceId: string | null = null;
  private readonly popstateListener = () => this.resolveRoomFromCurrentUrl();
  private readonly resizeListener = () => {
    this.clampCurrentCockpitPosition();
    this.syncRigidViewport();
    if (!this.userOverrodeViewMode) {
      const best = this.detectTerminalViewMode();
      if (this.activeViewMode !== best) {
        this.activeViewMode = best;
      }
    }
    this.cdr.markForCheck();
  };

  /**
   * Déclenche une synchronisation de mise en page échelonnée (0ms, 120ms, 300ms, 550ms)
   * pour absorber le délai d'animation de rotation d'écran et de masquage des barres système
   * sur smartphone lors du passage en plein écran.
   */
  triggerMultiStageLayoutResync(): void {
    const resync = () => {
      this.clampCurrentCockpitPosition();
      this.syncRigidViewport();
      this.cdr.markForCheck();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('resize'));
      }
    };
    resync();
    if (typeof window !== 'undefined') {
      try { window.requestAnimationFrame(() => resync()); } catch {}
      setTimeout(resync, 120);
      setTimeout(resync, 300);
      setTimeout(resync, 550);
    }
  }
  isFullscreen = false;
  fullscreenSupported = false;
  isPseudoFullscreen = false;

  checkNativeFullscreen(): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return Boolean(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.webkitCurrentFullScreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
  }

  checkIsFullscreen(): boolean {
    return this.checkNativeFullscreen() || this.isPseudoFullscreen;
  }

  checkFullscreenSupported(): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    const docEl = document.documentElement as any;
    return Boolean(
      docEl?.requestFullscreen ||
      docEl?.webkitRequestFullscreen ||
      docEl?.mozRequestFullScreen ||
      docEl?.msRequestFullscreen ||
      doc?.fullscreenEnabled ||
      doc?.webkitFullscreenEnabled ||
      doc?.mozFullScreenEnabled ||
      doc?.msFullscreenEnabled ||
      true // Pseudo-fullscreen fallback is supported across all browser viewports
    );
  }

  private syncPseudoFullscreenClass(): void {
    if (typeof document === 'undefined') return;
    if (this.isPseudoFullscreen) {
      document.body?.classList.add('app-pseudo-fullscreen');
    } else {
      document.body?.classList.remove('app-pseudo-fullscreen');
    }
  }

  private readonly fullscreenListener = () => {
    const isNative = this.checkNativeFullscreen();
    if (!isNative && this.isPseudoFullscreen) {
      this.isPseudoFullscreen = false;
      this.syncPseudoFullscreenClass();
    }
    this.isFullscreen = isNative || this.isPseudoFullscreen;
    if (this.isMobileFullscreenOnly && !this.userOverrodeViewMode) {
      this.activeViewMode = 'cockpit';
    }
    this.triggerMultiStageLayoutResync();
  };

  private readonly fullscreenErrorListener = () => {
    this.isPseudoFullscreen = true;
    this.syncPseudoFullscreenClass();
    this.isFullscreen = true;
    this.triggerMultiStageLayoutResync();
  };

  private readonly escapeKeyFullscreenHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isPseudoFullscreen) {
      this.isPseudoFullscreen = false;
      this.syncPseudoFullscreenClass();
      this.isFullscreen = this.checkIsFullscreen();
      this.syncRigidViewport();
      this.cdr.markForCheck();
    }
  };

  private readonly userInteractionWakeLockHandler = () => {
    if (!this.wakeLockService.isLockActive() && this.wakeLockService.isSupported()) {
      this.enableScreenWakeLock();
    }
  };

  constructor(
    private rowerService: RowerService,
    private wakeLockService: WakeLockService,
    public i18n: I18nService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef
  ) {
    this.apiUrl = this.rowerService.getApiUrl();
    this.customApiUrlInput = this.apiUrl;
    this.wakeLockSupported = this.wakeLockService.isSupported();
    this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);

    // Initialize or load stored user code and login
    const storedUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_user_id') : null;
    const storedLogin = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_user_login') : null;
    if (storedUserId) {
      this.activeUserId = storedUserId;
      this.userIdInput = storedUserId;
    } else {
      const randId = Math.random().toString(36).substring(2, 8);
      this.activeUserId = `usr_${randId}`;
      this.userIdInput = this.activeUserId;
      try {
        localStorage.setItem('rower_user_id', this.activeUserId);
      } catch {}
    }

    const storedIsSub = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_is_subscriber') === 'true' : false;
    const storedIsAdmin = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_is_admin') === 'true' : false;
    const storedRole = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_user_role') : null;
    const storedTier = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_subscription_tier') : null;
    const storedDeviceToken = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_device_token') : null;
    const storedIsPaired = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_is_paired') === 'true' : false;

    // Conservation de l'appairage montre qu'un compte soit connecté ou en session invité
    if (storedIsPaired && storedDeviceToken) {
      this.isPaired = true;
      this.isWatchConfirmed = true;
      this.deviceToken = storedDeviceToken;
    } else {
      this.isPaired = false;
      this.isWatchConfirmed = false;
      this.deviceToken = '';
    }

    if (typeof localStorage !== 'undefined') {
      let gid = localStorage.getItem('guest_session_id');
      if (!gid) {
        gid = 'guest_' + Math.random().toString(36).substring(2, 9);
        try { localStorage.setItem('guest_session_id', gid); } catch {}
      }
      this.guestSessionId = gid;
    }

    if (storedLogin) {
      this.currentUser.name = storedLogin;
      this.userLoginInput = storedLogin;
    } else {
      const guestName = `Racer_${this.activeUserId.slice(-4)}`;
      this.currentUser.name = guestName;
      this.userLoginInput = guestName;
      try {
        localStorage.setItem('rower_user_login', guestName);
      } catch {}
    }
    this.currentUser.id = this.activeUserId;
    const isEmma = storedLogin?.toLowerCase() === 'emmaracer' || this.activeUserId?.toLowerCase() === 'emmaracer';
    const isAdminUser = isEmma || storedIsAdmin || storedRole === 'ADMIN';
    const resolvedTier = storedTier || (isAdminUser ? 'premium' : (storedIsSub ? 'standard' : 'free'));
    this.currentUser.isAdmin = isAdminUser;
    this.currentUser.role = storedRole || (isAdminUser ? 'ADMIN' : 'USER');
    this.currentUser.subscriptionTier = resolvedTier;
    this.currentUser.isSubscriber = isEmma || (resolvedTier !== 'free' && storedIsSub) || isAdminUser;
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      try {
        const isResetPasswordPath = window.location.pathname === '/reset-password' || window.location.pathname.startsWith('/reset-password');
        const urlParams = window.location.search ? new URLSearchParams(window.location.search) : null;
        const incomingResetToken = urlParams ? (urlParams.get('resetToken') || urlParams.get('token')) : null;

        if (incomingResetToken) {
          this.resetToken = incomingResetToken.trim();
          this.showResetFields = true;
          this.setSiteView('home');
          this.userExplicitlyNavigatedHome = true;
          this.openAccountModal('forgot');
          const cleanUrl = window.location.pathname + (window.location.hash || '');
          window.history.replaceState({}, '', cleanUrl || '/');
        } else if (isResetPasswordPath) {
          this.setSiteView('home');
          this.userExplicitlyNavigatedHome = true;
          this.showResetFields = false;
          this.accountAuthError = this.i18n.t('ACCOUNT_RESET_MISSING_TOKEN');
          this.openAccountModal('forgot');
        }

        if (urlParams) {
          const subscriptionParam = urlParams.get('subscription');
          if (subscriptionParam === 'success') {
            const rawTier = (urlParams.get('tier') || 'Club').toLowerCase();
            const tierLabel = rawTier === 'premium' ? 'Élite Pro' : 'Club';
            this.subscriptionSuccessMessage = `Félicitations ! Votre abonnement ${tierLabel} est désormais actif. Profitez de vos nouveaux avantages !`;
            this.isSubscriptionModalOpen = true;
            this.loadUserProfile();
            const cleanUrl = window.location.pathname + (window.location.hash || '');
            window.history.replaceState({}, '', cleanUrl || '/');
          } else if (subscriptionParam === 'canceled') {
            this.subscriptionError = this.i18n.translateError('ERR_STRIPE_INTERRUPTED');
            this.isSubscriptionModalOpen = true;
            const cleanUrl = window.location.pathname + (window.location.hash || '');
            window.history.replaceState({}, '', cleanUrl || '/');
          }

          const duelChallengeParam = urlParams.get('duelChallenge');
          if (duelChallengeParam) {
            const cleanChallengeId = duelChallengeParam.trim();
            this.pendingDuelChallengeId = cleanChallengeId;
            this.handleIncomingDuelChallenge(cleanChallengeId);
          }

          const duelInviteToken = urlParams.get('duelInviteToken') || urlParams.get('inviteToken');
          const inviteEmail = urlParams.get('email');
          if (duelInviteToken) {
            const cleanInviteToken = duelInviteToken.trim();
            this.pendingDuelInviteToken = cleanInviteToken;
            if (inviteEmail && inviteEmail.trim()) {
              this.pendingRegistrationEmail = inviteEmail.trim();
              this.regEmail = inviteEmail.trim();
            }
            this.rowerService.getDuelInviteInfo(cleanInviteToken).subscribe({
              next: (res) => {
                if (res?.success && res.challenge) {
                  const challengerLabel = res.challenge.challengerName || res.challenge.challengerLogin || 'un rameur';
                  const resolvedEmail = (inviteEmail || res.challenge.challengedEmail || '').trim();
                  if (resolvedEmail) {
                    this.pendingRegistrationEmail = resolvedEmail;
                    this.regEmail = resolvedEmail;
                  }
                  this.setSiteView('home');
                  this.userExplicitlyNavigatedHome = true;
                  if (res.challenge.roomCode && !window.location.pathname.startsWith('/r/')) {
                    const targetUrl = `/r/${encodeURIComponent(res.challenge.roomCode)}?duelInviteToken=${encodeURIComponent(cleanInviteToken)}${resolvedEmail ? `&email=${encodeURIComponent(resolvedEmail)}` : ''}`;
                    try {
                      window.history.replaceState({ roomCode: res.challenge.roomCode }, '', targetUrl);
                    } catch {}
                    this.resolveRoomFromCurrentUrl();
                  }
                  if (this.isIdentified) {
                    this.refreshPendingPrivateAndDuels();
                    if (res.challenge.roomCode) {
                      this.rowerService.getPrivateRace(res.challenge.roomCode).subscribe((room) => {
                        (room as any).duelChallenge = res.challenge;
                        this.activatePrivateRoom(room, false, true);
                        this.setSiteView('home');
                        this.userExplicitlyNavigatedHome = true;
                        this.isPrivateModalOpen = true;
                        this.privateModalTab = 'share';
                        this.cdr.markForCheck();
                      });
                    } else {
                      this.triggerFinishToast(`⚔️ Défi 1v1 de ${challengerLabel} (${res.challenge.targetDistance || 2000}m).`);
                    }
                  } else {
                    this.accountAuthSuccess = `⚔️ Défi 1v1 de ${challengerLabel} (${res.challenge.targetDistance || 2000}m) ! Créez votre compte gratuit pour le relever.`;
                    this.openAccountModal('register');
                  }
                } else {
                  this.pendingDuelInviteToken = '';
                  this.triggerFinishToast('⚠️ Invitation expirée ou introuvable');
                  if (!this.isIdentified) {
                    this.setSiteView('home');
                    this.userExplicitlyNavigatedHome = true;
                    this.openAccountModal('register');
                    this.accountAuthError = this.i18n.translateError('Invitation expirée ou introuvable');
                  }
                }
                this.cdr.markForCheck();
              },
              error: () => {
                this.pendingDuelInviteToken = '';
                this.triggerFinishToast('⚠️ Invitation expirée ou introuvable');
                if (!this.isIdentified) {
                  this.setSiteView('home');
                  this.userExplicitlyNavigatedHome = true;
                  this.openAccountModal('register');
                  this.accountAuthError = this.i18n.translateError('Invitation expirée ou introuvable');
                }
                this.cdr.markForCheck();
              }
            });
          }
        }
      } catch (err) {
        console.warn('[Init] Erreur analyse paramètre resetToken URL:', err);
      }
    }
    if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
      if (this.isUserAdmin) {
        this.isAdminDashboardOpen = true;
      } else {
        try { window.history.replaceState({}, '', '/'); } catch {}
      }
    }
    if (typeof window !== 'undefined' && (window.location.pathname === '/login' || window.location.pathname.startsWith('/login/')) && !this.resetToken && !this.showResetFields) {
      this.setSiteView('home');
      this.userExplicitlyNavigatedHome = true;
      this.openAccountModal('login');
    }
    this.syncKayakCustomizationFromUser();
    this.syncRegattaPreferencesFromUser();
    this.activeViewMode = this.detectTerminalViewMode();
    this.syncSeoLanguage(this.i18n.getCurrentLang());
    this.loadUserProfile();
    this.loadGeneralLeaderboard();
    this.loadLeagueStandings();
    this.checkUnseenWeeklySummary();
    this.loadPastRaces();
    this.initHomeAutoRefresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.popstateListener);
      window.addEventListener('resize', this.resizeListener);
      window.addEventListener('orientationchange', this.resizeListener);
      window.addEventListener('pointerdown', this.userInteractionWakeLockHandler, { passive: true });
      window.addEventListener('touchstart', this.userInteractionWakeLockHandler, { passive: true });
      window.addEventListener('keydown', this.escapeKeyFullscreenHandler);
    }
    if (typeof document !== 'undefined') {
      this.fullscreenSupported = this.checkFullscreenSupported();
      this.isFullscreen = this.checkIsFullscreen();
      document.addEventListener('fullscreenchange', this.fullscreenListener);
      document.addEventListener('webkitfullscreenchange', this.fullscreenListener);
      document.addEventListener('mozfullscreenchange', this.fullscreenListener);
      document.addEventListener('MSFullscreenChange', this.fullscreenListener);
      document.addEventListener('fullscreenerror', this.fullscreenErrorListener);
      document.addEventListener('webkitfullscreenerror', this.fullscreenErrorListener);
    }
    this.wakeLockService.onStateChange = (isActive: boolean) => {
      this.wakeLockActive = isActive;
      this.cdr.markForCheck();
    };
    this.initSocketListeners();
    this.initCountdownTicker();
    this.refreshPendingPrivateAndDuels();
    this.resolveRoomFromCurrentUrl();
    this.enableScreenWakeLock();
    this.syncRigidViewport();
    try {
      if (typeof localStorage !== 'undefined') {
        const savedX = localStorage.getItem('rower_timer_pos_x');
        const savedY = localStorage.getItem('rower_timer_pos_y');
        if (savedX && savedY) {
          const parsedX = Number(savedX);
          const parsedY = Number(savedY);
          if (!isNaN(parsedX) && !isNaN(parsedY)) {
            this.timerPosition = { x: parsedX, y: parsedY };
          }
        }
        const savedLbX = localStorage.getItem('rower_cockpit_lb_pos_x');
        const savedLbY = localStorage.getItem('rower_cockpit_lb_pos_y');
        if (savedLbX && savedLbY) {
          const pLbX = Number(savedLbX);
          const pLbY = Number(savedLbY);
          if (!isNaN(pLbX) && !isNaN(pLbY)) {
            this.cockpitLeaderboardPos = { x: pLbX, y: pLbY };
          }
        }
        this.isPrestartTimerDismissed = localStorage.getItem('rower_prestart_timer_dismissed') === 'true';
      }
    } catch {}
    if (typeof window !== 'undefined') {
      setTimeout(() => this.clampCurrentCockpitPosition(), 60);
    }
  }

  ngOnDestroy(): void {
    this.destroyHomeAutoRefresh();
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = undefined;
    }
    if (this.socketSub) {
      this.socketSub.unsubscribe();
      this.socketSub = undefined;
    }
    if (this.statusSub) {
      this.statusSub.unsubscribe();
      this.statusSub = undefined;
    }
    if (this.privateUpdateSub) {
      this.privateUpdateSub.unsubscribe();
      this.privateUpdateSub = undefined;
    }
    if (this.countdownTickerSub) {
      this.countdownTickerSub.unsubscribe();
      this.countdownTickerSub = undefined;
    }
    if (this.pairingTimerSub) {
      this.pairingTimerSub.unsubscribe();
      this.pairingTimerSub = undefined;
    }
    if (this.pairingStatusPollSub) {
      this.pairingStatusPollSub.unsubscribe();
      this.pairingStatusPollSub = undefined;
    }
    if (this.garminPairedSub) {
      this.garminPairedSub.unsubscribe();
      this.garminPairedSub = undefined;
    }
    if (this.duelEventSub) {
      this.duelEventSub.unsubscribe();
      this.duelEventSub = undefined;
    }
    if (this.dnfAutoExitTimer) {
      clearTimeout(this.dnfAutoExitTimer);
      this.dnfAutoExitTimer = null;
    }
    if (this.joinedSocketRaceId) {
      this.socketService.leaveRaceRoom(this.joinedSocketRaceId);
      this.joinedSocketRaceId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.popstateListener);
      window.removeEventListener('resize', this.resizeListener);
      window.removeEventListener('orientationchange', this.resizeListener);
      window.removeEventListener('pointerdown', this.userInteractionWakeLockHandler);
      window.removeEventListener('touchstart', this.userInteractionWakeLockHandler);
      window.removeEventListener('keydown', this.escapeKeyFullscreenHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.fullscreenListener);
      document.removeEventListener('webkitfullscreenchange', this.fullscreenListener);
      document.removeEventListener('mozfullscreenchange', this.fullscreenListener);
      document.removeEventListener('MSFullscreenChange', this.fullscreenListener);
      document.removeEventListener('fullscreenerror', this.fullscreenErrorListener);
      document.removeEventListener('webkitfullscreenerror', this.fullscreenErrorListener);
    }
    this.isPseudoFullscreen = false;
    this.syncPseudoFullscreenClass();
    this.wakeLockService.releaseWakeLock();
    // Nettoyage garanti du plein écran et des styles de verrouillage lors de la destruction
    if (this.checkIsFullscreen()) {
      this.exitFullscreen().catch(() => {});
    }
    this.siteView = 'home';
    this.syncRigidViewport();
    if (typeof screen !== 'undefined' && (screen as any).orientation && (screen as any).orientation.unlock) {
      try {
        (screen as any).orientation.unlock();
      } catch {}
    }
  }

  /**
   * Main game telemetry loop:
   * 1. Fetches Next Race details & countdown
   * 2. Fetches Multiplayer Live Leaderboard
   * 3. Fetches Personal Activity stats
   */
  private initGameLoop(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
    }
    this.lastHttpSyncAtMs = 0;

    this.pollingSub = interval(2500)
      .pipe(
        startWith(0),
        filter((tick) => {
          if (tick === 0) return true;
          if (typeof document !== 'undefined' && document.hidden) return false;
          const now = Date.now();
          const wsConnected = this.socketService.isConnected();
          // When WebSocket is connected, only perform a periodic safety sync every 12s
          const minIntervalMs = wsConnected ? 12000 : 2500;
          return now - this.lastHttpSyncAtMs >= minIntervalMs;
        }),
        switchMap(() => {
          this.lastHttpSyncAtMs = Date.now();
          return this.pollActiveRaceSource().pipe(
            catchError((err) => {
              this.backendConnected = err.status !== 0;
              this.errorMessage = err.status === 0 ? 'Connexion en attente avec le backend (' + this.apiUrl + ')' : '';
              this.cdr.markForCheck();
              return of(null);
            })
          );
        })
      )
      .subscribe((raceData) => {
        if (raceData) {
          this.backendConnected = true;
          const isNewRaceInLoop = Boolean(
            !this.activePrivateRoom &&
            raceData.race?.id &&
            this.nextRaceInfo?.race?.id &&
            raceData.race.id !== this.nextRaceInfo.race.id
          );
          if (isNewRaceInLoop) {
            this.goHoldUntilMs = 0;
            this.goTransitionLockUntilMs = 0;
          }
          const inGoTransitionLoop = Date.now() < this.goTransitionLockUntilMs && !isNewRaceInLoop && (raceData.secondsRemaining ?? 0) <= 5;
          this.nextRaceInfo = raceData;
          if (inGoTransitionLoop) {
            this.nextRaceInfo.status = 'in_progress';
            this.nextRaceInfo.secondsRemaining = 0;
            if (this.nextRaceInfo.race) {
              this.nextRaceInfo.race.status = 'RUNNING';
              (this.nextRaceInfo.race as any).internalStatus = 'RUNNING';
            }
          }
          if ((raceData as any).isSuspended !== undefined) {
            this.isPublicRaceSuspended = Boolean((raceData as any).isSuspended);
          }
          if (this.activePrivateRoom && raceData.race.type === 'PRIVATE_INVITE') {
            this.activePrivateRoom = raceData as PrivateRacePayload;
            if (inGoTransitionLoop) {
              this.activePrivateRoom.status = 'RUNNING';
              (this.activePrivateRoom as any).internalStatus = 'RUNNING';
              if (this.activePrivateRoom.race) {
                this.activePrivateRoom.race.status = 'RUNNING';
                (this.activePrivateRoom.race as any).internalStatus = 'RUNNING';
              }
            }
          }
          this.syncSocketRoom(raceData.race.id);
          this.gameMaxDurationSeconds = raceData.maxDurationSeconds || 3300;
          this.configTargetDistance = raceData.race.targetDistance;
          this.configIntervalMinutes = raceData.race.intervalMinutes;

          // Décompte visuel synchronisé avec le backend et la montre
          const isRunning = this.isRaceActive;
          const isRoomWaiting = this.isPrivateRoomInWaitingLobby(raceData);

          if (isRunning) {
            this.countdownSeconds = 0;
            this.isPreStartCountdown = false;
            if (Date.now() >= this.goHoldUntilMs) {
              this.is3sCountdown = false;
            }
            this.gameRemainingSeconds = raceData.remainingSeconds !== undefined ? raceData.remainingSeconds : 3300;
            if (!this.isAnyModalOpen && this.siteView === 'home' && !this.userExplicitlyNavigatedHome) {
              this.siteView = this.activeViewMode === 'cockpit' ? 'cockpit' : 'regatta';
            }
          } else if (isRoomWaiting) {
            this.countdownSeconds = 0;
            this.is3sCountdown = false;
            this.isPreStartCountdown = false;
            this.gameRemainingSeconds = this.gameMaxDurationSeconds;
          } else {
            this.gameRemainingSeconds = this.gameMaxDurationSeconds;
            const serverRemaining = raceData.secondsRemaining;
            if (serverRemaining !== undefined && serverRemaining !== null) {
              this.applyMonotonicServerCountdown(serverRemaining);
            }
            this.syncCountdownUI();
          }
          this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);

          // Skip redundant HTTP leaderboard fetch when WebSocket has already delivered fresh live metrics recently (< 10s)
          const hasFreshSocketLeaderboard =
            this.socketService.isConnected() &&
            this.liveMetricsList.length > 0 &&
            Date.now() - this.lastSocketUpdateAtMs < 10000;
          if (hasFreshSocketLeaderboard) {
            this.cdr.markForCheck();
            return;
          }

          // Fetch Live Leaderboard (initial load or fallback when WebSocket is idle/disconnected)
          this.rowerService.getRaceLeaderboard(raceData.race.id).pipe(
            catchError(() => of({ activityId: raceData.race.id, totalParticipants: 0, leaderboard: [] }))
          ).subscribe((lb) => {
            const targetDist = raceData.race?.targetDistance || this.activeTargetDistance || 2000;
            const isRaceWaitingOrCountdown = raceData.status === 'waiting' || raceData.status === 'countdown';

            // Protection monotone : empêcher un poll HTTP en retard d'écraser une distance plus récente reçue via WebSocket
            this.racers = (lb.leaderboard || []).map((r) => {
              const existingMetric = this.liveMetricsList.find(m => m.userId === r.userId);
              const existingRacer = this.racers.find(x => x.userId === r.userId && x.activityId === r.activityId);
              const rawPollDist = Number((r as any).exactDistance ?? r.netDistance ?? 0);
              const prevKnownDist = Math.max(
                Number(existingMetric?.exactDist ?? existingMetric?.dist ?? 0),
                Number(existingRacer?.netDistance || 0),
                r.userId === this.activeUserId && this.myActivity?.activityId === r.activityId ? Number(this.myActivity?.netDistance || 0) : 0
              );

              const wasAlreadyFin = existingMetric?.status === 'finished' || existingRacer?.status === 'finished';
              let unifiedDist = isRaceWaitingOrCountdown && rawPollDist === 0
                ? 0
                : Math.max(rawPollDist, prevKnownDist);
              if (targetDist > 0 && (unifiedDist >= targetDist || r.status === 'finished' || (r.status as string) === 'completed' || wasAlreadyFin)) {
                unifiedDist = targetDist;
              }
              const unifiedStatus = (targetDist > 0 && unifiedDist >= targetDist && r.status !== 'abandoned')
                ? 'finished'
                : r.status;

              const isMe = r.userId === this.activeUserId;
              const rawKayak = r.kayak || existingMetric?.kayak || (isMe ? this.committedKayakCustomization : undefined);
              const kayak = rawKayak ? sanitizeKayakCustomization(rawKayak) : undefined;

              return {
                ...r,
                netDistance: unifiedDist,
                currentDistance: unifiedDist,
                status: unifiedStatus,
                kayak,
              };
            });

            this.activeRacersCount = Math.max(raceData.totalParticipants || 0, this.racers.filter(r => r.status !== 'abandoned').length);

            // Calcul du classement et des écarts de distance en direct
            let activeList = this.racers.filter(r => r.status !== 'abandoned').sort((a, b) => {
              const isFinA = a.status === 'finished' ? 1 : 0;
              const isFinB = b.status === 'finished' ? 1 : 0;
              if (isFinA !== isFinB) return isFinB - isFinA;
              return (b.netDistance || 0) - (a.netDistance || 0);
            });
            this.totalActiveRacers = activeList.length;
            const isPrivateRoom = Boolean(this.activePrivateRoom || (raceData.race as any)?.type === 'PRIVATE_INVITE');
            const roomParts = this.activePrivateRoom?.race?.participants || (raceData.race as any)?.participants || [];
            // Maintien continu des participants du salon sur la ligne de départ (anti-clignotement)
            if (roomParts && roomParts.length > 0 && (!this.isRaceActive || isRaceWaitingOrCountdown)) {
              for (const p of roomParts) {
                if (!p.userId) continue;
                const isBot = Boolean(p.isBot) || String(p.userId).startsWith('bot_');
                const isUserValidated = isBot || Boolean(p.pinValidated === true && p.connectionState !== 'PENDING_PIN');
                // Dans tout salon privé ou duel, un kayak humain n'apparaît sur une ligne d'eau QUE lorsque le joueur a validé son code PIN sur sa montre
                if (isPrivateRoom && !isUserValidated && (p.netDistance || 0) <= 0) {
                  continue;
                }
                if (!activeList.some(r => r.userId === p.userId)) {
                  activeList.push({
                    userId: p.userId,
                    userName: p.name || p.userName || p.userId,
                    netDistance: 0,
                    currentDistance: 0,
                    lane: p.lane || (activeList.length + 1),
                    status: 'waiting',
                    lastPower: 0,
                    lastStrokeRate: 0,
                    lastPace: 120,
                    isBot,
                    kayak: p.kayak
                  } as any);
                }
              }
            }
            if (isPrivateRoom) {
              activeList = activeList.filter(r => {
                const isBot = this.isBotRacer(r) || String(r.userId || '').startsWith('bot_');
                if (isBot) return true;
                const partInfo = roomParts.find((p: any) => p.userId === r.userId);
                const hasValidatedPin = Boolean(partInfo && partInfo.pinValidated !== false && partInfo.connectionState !== 'PENDING_PIN');
                return hasValidatedPin || (r.netDistance || 0) > 0 || (r.lastPower || 0) > 0;
              });
            }
            // S'assurer que le kayak du joueur local reste positionné sur sa ligne d'eau attribuée (uniquement si engagé dans un salon privé)
            if (this.activeUserId && !activeList.some(r => r.userId === this.activeUserId) && (!this.isRaceActive || isRaceWaitingOrCountdown)) {
              const myPart = isPrivateRoom ? roomParts.find((p: any) => p.userId === this.activeUserId) : null;
              const canKeepLocalKayak = !isPrivateRoom || Boolean(myPart && myPart.pinValidated !== false && myPart.connectionState !== 'PENDING_PIN');
              if (canKeepLocalKayak) {
                const myMetric = this.liveMetricsList.find(m => m.userId === this.activeUserId);
                if (myMetric && (!isPrivateRoom || (myMetric.lane && myMetric.lane > 0))) {
                  activeList.push({
                    userId: myMetric.userId,
                    userName: myMetric.name,
                    netDistance: myMetric.dist || 0,
                    currentDistance: myMetric.dist || 0,
                    lane: myMetric.lane || this.myAssignedLane || 1,
                    status: myMetric.status || 'waiting',
                    lastPower: myMetric.watts || 0,
                    lastStrokeRate: myMetric.spm || 0,
                    lastPace: myMetric.split || 120,
                    kayak: myMetric.kayak
                  } as any);
                }
              }
            }
            this.liveMetricsList = activeList.map((r, idx) => {
              const isMe = r.userId === this.activeUserId;
              const assignedLane = Number((r as any).lane) || (isMe && this.myAssignedLane ? this.myAssignedLane : (idx + 1));
              if (isMe && (r as any).lane) {
                this.myAssignedLane = Number((r as any).lane);
              }
              const partInfo = roomParts.find((p: any) => p.userId === r.userId);
              const isRowerAwake = (r.lastPower || 0) > 0 || (r.lastStrokeRate || 0) > 0 || (r.netDistance || 0) > 0;
              const readyVal = partInfo && partInfo.ready !== undefined ? partInfo.ready : (isRowerAwake || Boolean(r.userId?.startsWith('bot_')));
              const wattsVal = r.lastPower || r.avgPower || 0;
              const rawSplit = r.lastPace || r.avgPace || 0;
              const c2Split = wattsVal > 0
                ? Math.max(60, Math.min(360, Math.round(500 / Math.cbrt(wattsVal / 2.80))))
                : (rawSplit > 0 ? rawSplit : 120);
              const existingMetric = this.liveMetricsList.find(m => m.userId === r.userId);
              const rawKayak = r.kayak || existingMetric?.kayak || partInfo?.kayak || (isMe ? this.committedKayakCustomization : undefined);
              const kayak = rawKayak ? sanitizeKayakCustomization(rawKayak) : undefined;
              return {
                lane: assignedLane,
                userId: r.userId,
                name: r.userName || r.userId,
                dist: r.netDistance || 0,
                split: c2Split,
                watts: wattsVal,
                spm: r.lastStrokeRate || r.avgStrokeRate || 0,
                heartRate: r.lastHeartRate,
                status: r.status || 'in_progress',
                ready: readyVal,
                connectionState: readyVal ? 'READY' : 'CONNECTED',
                isBot: this.isBotRacer(r) || Boolean(partInfo?.isBot),
                isPaired: this.isPairedRacer(r) || Boolean(partInfo?.isPaired),
                kayak,
              };
            });

            // Liaison automatique du kayak si le joueur est connecté à un compte ou a une montre appairée
            this.autoResolveMyPublicKayak();

            const myIdx = activeList.findIndex(r => r.userId === this.activeUserId);

            if (myIdx >= 0) {
              this.myRank = myIdx + 1;
              const myDist = activeList[myIdx].netDistance || 0;
              const leaderDist = activeList[0]?.netDistance || 0;
              this.distToLeader = Math.max(0, Math.round(leaderDist - myDist));
              this.distToPrev = myIdx > 0 ? Math.max(0, Math.round((activeList[myIdx - 1]?.netDistance || 0) - myDist)) : 0;
              this.distToNext = myIdx < activeList.length - 1 ? Math.max(0, Math.round(myDist - (activeList[myIdx + 1]?.netDistance || 0))) : 0;
            } else if (!this.isPostRaceRankingActive) {
              this.myRank = null;
              this.distToLeader = 0;
              this.distToPrev = 0;
              this.distToNext = 0;
            }

            // CORRECTION AFFICHAGE DONNÉES UTILISATEUR & ANTI-SCINTILLEMENT :
            // 1. Chercher d'abord dans le leaderboard de la course
            const foundInRace = this.racers.find(r => r.userId === this.activeUserId);
            if (foundInRace) {
              const isDifferentRace = Boolean(
                this.myActivity?.activityId &&
                foundInRace.activityId &&
                this.myActivity.activityId !== foundInRace.activityId
              );
              const isPreStartReset = Boolean(
                (foundInRace.status === 'waiting' || raceData.status === 'waiting' || raceData.status === 'countdown') &&
                (foundInRace.netDistance || 0) === 0
              );
              // Mettre à jour en douceur sans écraser par des valeurs régressives
              if (!this.myActivity || isDifferentRace || isPreStartReset) {
                this.myActivity = { ...foundInRace };
              } else {
                const alignedDist = Math.max(this.myActivity.netDistance || 0, foundInRace.netDistance || 0);
                this.myActivity.netDistance = targetDist > 0 ? Math.min(targetDist, alignedDist) : alignedDist;
                this.myActivity.currentDistance = this.myActivity.netDistance;
                if ((foundInRace.lastPower || 0) > 0) this.myActivity.lastPower = foundInRace.lastPower;
                if ((foundInRace.lastStrokeRate || 0) > 0) this.myActivity.lastStrokeRate = foundInRace.lastStrokeRate;
                if ((foundInRace.lastPace || 0) > 0) this.myActivity.lastPace = foundInRace.lastPace;
                if (foundInRace.status) this.myActivity.status = foundInRace.status;
                if (foundInRace.lastHeartRate) this.myActivity.lastHeartRate = foundInRace.lastHeartRate;
              }
              this.cdr.markForCheck();
            } else if (!this.myActivity && !this.activePrivateRoom) {
              // 2. Si AUCUNE donnée en mémoire, interroger son activité récente une seule fois
              this.rowerService.getUserLatestActivity(this.activeUserId).pipe(
                catchError(() => of(null))
              ).subscribe((latest) => {
                if (latest && !this.myActivity) {
                  this.myActivity = latest;
                  this.cdr.markForCheck();
                }
              });
            }
          });

          // Seuls les joueurs associés à la course peuvent voir le cockpit (sauf en plein écran mobile/tablette où la sélection du joueur est affichée)
          if (this.activeViewMode === 'cockpit' && !this.canAccessCockpit && !this.isMobileFullscreenOnly) {
            this.activeViewMode = 'canvas';
          }
        }
        this.cdr.markForCheck();
      });
  }

  loadUserProfile(): void {
    this.rowerService.getUserProfile(this.activeUserId).pipe(
      catchError(() => of(null))
    ).subscribe((res) => {
      if (res && res.user) {
        const isAdminUser = Boolean(res.user.isAdmin || res.user.role === 'ADMIN' || res.user.is_admin);
        const resolvedRole = res.user.role || (isAdminUser ? 'ADMIN' : 'USER');
        const resolvedTier = String(res.user.subscriptionTier || res.user.subscription_tier || (isAdminUser ? 'premium' : 'free')).toLowerCase();
        const isSub = Boolean(isAdminUser || (resolvedTier !== 'free' && (res.user.isSubscriber || res.user.is_subscriber)));

        this.currentUser = {
          ...this.currentUser,
          ...res.user,
          name: res.user.login || res.user.name,
          isAdmin: isAdminUser,
          role: resolvedRole,
          subscriptionTier: resolvedTier,
          isSubscriber: isSub,
        };

        try {
          localStorage.setItem('rower_is_subscriber', String(isSub));
          localStorage.setItem('rower_is_admin', String(isAdminUser));
          localStorage.setItem('rower_user_role', resolvedRole);
          localStorage.setItem('rower_subscription_tier', resolvedTier);
        } catch {}

        this.userHistory = res.history || [];
        this.generalUserRank = res.generalRank || 1;
        this.generalTotalPlayers = res.totalPlayers || 1;

        // Restauration automatique et transparente de l'appairage Garmin rattaché au compte utilisateur
        const isPairedOnAccount = Boolean(res.isGarminPaired || res.user.isGarminPaired);
        const resolvedToken = res.pairedDevice?.deviceToken || res.user.pairedDevice?.deviceToken;
        if (isPairedOnAccount) {
          this.isPaired = true;
          this.isWatchConfirmed = true;
          if (resolvedToken) {
            this.deviceToken = resolvedToken;
          }
          try {
            localStorage.setItem('rower_is_paired', 'true');
            localStorage.setItem('rower_watch_confirmed', 'true');
            if (resolvedToken) {
              localStorage.setItem('rower_device_token', resolvedToken);
            }
          } catch {}
        }

        this.syncKayakCustomizationFromUser(res.user);
        this.syncRegattaPreferencesFromUser(res.user);
        this.syncDuelPreferencesFromUser(res.user);
        this.refreshPendingPrivateAndDuels();
        this.applyUserLanguagePreference(res.user.language);
        this.autoResolveMyPublicKayak();
        this.cdr.markForCheck();
      }

      // Vérifier également le statut d'appairage Garmin par userId ou deviceToken
      this.rowerService.getGarminPairingStatus({
        userId: this.currentUser?.login || this.activeUserId,
        deviceToken: this.deviceToken || undefined
      }).pipe(
        catchError(() => of(null))
      ).subscribe((status) => {
        if (status && status.paired) {
          this.isPaired = true;
          this.isWatchConfirmed = true;
          if (status.deviceToken) {
            this.deviceToken = status.deviceToken;
          }
          const storedLogin = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_user_login') : null;
          if (status.userId && storedLogin && (status.userId === storedLogin || status.userId === this.currentUser?.login)) {
            this.activeUserId = status.userId;
            this.currentUser.id = status.userId;
          }
          try {
            localStorage.setItem('rower_is_paired', 'true');
            localStorage.setItem('rower_watch_confirmed', 'true');
            if (this.deviceToken) {
              localStorage.setItem('rower_device_token', this.deviceToken);
            }
            if (this.activeUserId) {
              localStorage.setItem('rower_user_id', this.activeUserId);
            }
          } catch {}
          this.autoResolveMyPublicKayak();
          this.cdr.markForCheck();
        }
      });
    });
  }

  loadLeagueStandings(tier: LeagueTier = this.selectedLeagueTier): void {
    this.selectedLeagueTier = tier;
    this.isLoadingLeagueStandings = true;
    this.rowerService.getLeagueStandings(tier).pipe(
      catchError(() => of({
        success: false,
        tier,
        totalPlayers: 0,
        totalActive: 0,
        promoThreshold: 0,
        relegateThreshold: 0,
        standings: []
      }))
    ).subscribe((res) => {
      this.isLoadingLeagueStandings = false;
      if (res && res.standings) {
        this.leagueStandings = res.standings;
        this.leaguePromoThreshold = res.promoThreshold || 0;
        this.leagueRelegateThreshold = res.relegateThreshold || 0;
        this.leagueTotalActive = res.totalActive || 0;
      }
      this.cdr.markForCheck();
    });
  }

  toggleRestingMode(): void {
    const targetUserId = this.currentUser?.id || this.currentUser?.login || this.activeUserId;
    if (!targetUserId) return;
    const newRestingState = !this.currentUser?.isResting;
    this.isTogglingRestingMode = true;
    this.rowerService.toggleRestingMode(targetUserId, newRestingState).subscribe({
      next: (res) => {
        this.isTogglingRestingMode = false;
        if (res.success) {
          this.currentUser.isResting = res.isResting;
          this.loadLeagueStandings(this.selectedLeagueTier);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isTogglingRestingMode = false;
        this.cdr.markForCheck();
      }
    });
  }

  checkUnseenWeeklySummary(): void {
    const targetUserId = this.currentUser?.id || this.currentUser?.login || this.activeUserId;
    if (!targetUserId) return;
    this.rowerService.getUnseenLeagueSummary(targetUserId).subscribe({
      next: (res) => {
        if (res && res.success && res.summary) {
          this.unseenWeeklySummary = res.summary;
          this.isWeeklySummaryModalOpen = true;
          this.cdr.markForCheck();
        }
      },
      error: () => {}
    });
  }

  closeWeeklySummaryModal(): void {
    if (this.unseenWeeklySummary?.id) {
      this.rowerService.markLeagueSummarySeen(this.unseenWeeklySummary.id).subscribe({
        next: () => {},
        error: () => {}
      });
    }
    this.isWeeklySummaryModalOpen = false;
    this.unseenWeeklySummary = null;
    this.cdr.markForCheck();
  }

  formatPaceMs(paceMs: number | null): string {
    if (!paceMs || paceMs <= 0) return '-';
    const totalSec = Math.round(paceMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  getWeeklySummaryDetails(summary: WeeklyLeagueHistoryItem | null): { title: string; subtitle: string; icon: string; cls: string } {
    if (!summary) return { title: '', subtitle: '', icon: '', cls: '' };
    const prevInfo = getLeagueByTier(summary.previous_league);
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

  loadGeneralLeaderboard(): void {
    this.rowerService.getGeneralLeaderboard({
      country: this.leaderboardCountryFilter,
      gender: this.leaderboardGenderFilter,
      ageCategory: this.leaderboardAgeCategoryFilter
    }).pipe(
      catchError(() => of({ success: false, players: [] }))
    ).subscribe((res) => {
      if (res && res.players) {
        this.generalLeaderboard = res.players;
        this.cdr.markForCheck();
      }
    });
  }

  applyLeaderboardFilters(): void {
    this.loadGeneralLeaderboard();
  }

  resetLeaderboardFilters(): void {
    this.leaderboardCountryFilter = 'all';
    this.leaderboardGenderFilter = 'all';
    this.leaderboardAgeCategoryFilter = 'all';
    this.loadGeneralLeaderboard();
  }

  get filteredGeneralLeaderboard(): UserProfile[] {
    const currentYear = new Date().getFullYear();
    return this.generalLeaderboard
      .filter((player) => (player.totalRaces && player.totalRaces > 0) || (player.points && player.points > 0) || (player.totalWins && player.totalWins > 0))
      .filter((player) => {
      // 1. Filtrage pays
      if (this.leaderboardCountryFilter !== 'all') {
        const pCountry = (player.country || '').trim().toLowerCase();
        if (pCountry !== this.leaderboardCountryFilter.trim().toLowerCase()) {
          return false;
        }
      }

      // 2. Filtrage sexe
      if (this.leaderboardGenderFilter !== 'all') {
        const pGender = (player.gender || '').trim().toUpperCase();
        if (this.leaderboardGenderFilter === 'M' && pGender !== 'M' && pGender !== 'HOMME') return false;
        if (this.leaderboardGenderFilter === 'F' && pGender !== 'F' && pGender !== 'FEMME') return false;
        if (this.leaderboardGenderFilter === 'Autre' && pGender !== 'AUTRE') return false;
      }

      // 3. Filtrage catégorie d'âge
      if (this.leaderboardAgeCategoryFilter !== 'all') {
        if (!player.birthYear) return false;
        const age = currentYear - player.birthYear;
        if (this.leaderboardAgeCategoryFilter === 'U19' && !(age < 19)) return false;
        if (this.leaderboardAgeCategoryFilter === '19-29' && !(age >= 19 && age <= 29)) return false;
        if (this.leaderboardAgeCategoryFilter === '30-39' && !(age >= 30 && age <= 39)) return false;
        if (this.leaderboardAgeCategoryFilter === '40-49' && !(age >= 40 && age <= 49)) return false;
        if (this.leaderboardAgeCategoryFilter === '50-59' && !(age >= 50 && age <= 59)) return false;
        if (this.leaderboardAgeCategoryFilter === '60+' && !(age >= 60)) return false;
      }

      return true;
    });
  }

  get availableLeaderboardCountries(): string[] {
    const set = new Set<string>();
    // Pays présents dans le leaderboard + pays fréquents
    for (const p of this.generalLeaderboard) {
      if (p.country && p.country.trim()) {
        set.add(p.country.trim());
      }
    }
    const defaultList = ['France', 'Suisse', 'Belgique', 'Canada', 'Royaume-Uni', 'États-Unis', 'Allemagne', 'Espagne', 'Italie'];
    for (const d of defaultList) {
      set.add(d);
    }
    return Array.from(set).sort();
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
    if (age < 19) return `U19 (${age} ans)`;
    if (age <= 29) return `Senior (${age} ans)`;
    if (age <= 39) return `Master A (${age} ans)`;
    if (age <= 49) return `Master B (${age} ans)`;
    if (age <= 59) return `Master C (${age} ans)`;
    return `Master D+ (${age} ans)`;
  }

  openBotDuelModal(): void {
    if (!this.isPaired && !this.isWatchConfirmed) {
      alert("Le mode Duel 1v1 Bot est réservé aux rameurs ayant appareillé leur montre Garmin.");
      return;
    }
    this.closeAllOverlayModals();
    this.isBotDuelModalOpen = true;
    this.botDuelError = '';
    this.botDuelDistance = 2000;
    this.botDuelName = this.currentUser?.name || `Racer_${this.activeUserId.slice(-4)}`;
    this.cdr.markForCheck();
  }

  closeBotDuelModal(): void {
    this.isBotDuelModalOpen = false;
    this.cdr.markForCheck();
  }

  get maxDistanceAllowed(): number {
    if (this.currentUser?.isAdmin) return 100000;
    const rawTier = String(this.currentSubscriberTier || (this.isSubscriber ? 'intermediate' : 'free')).toLowerCase().trim();
    if (rawTier === 'pro' || rawTier === 'elite_pro' || rawTier === 'premium') return 10000;
    if (rawTier === 'club' || rawTier === 'standard' || rawTier === 'intermediate') return 5000;
    return 2000;
  }

  setBotDuelPresetDistance(dist: number): void {
    if (!this.currentUser?.isAdmin && dist > this.maxDistanceAllowed) {
      this.botDuelError = `Distance ${dist}m non autorisée avec votre offre (max ${this.maxDistanceAllowed}m). Surclassez votre abonnement pour y accéder.`;
      this.cdr.markForCheck();
      return;
    }
    this.botDuelError = '';
    this.botDuelDistance = dist;
    this.cdr.markForCheck();
  }

  startBotDuel(): void {
    if (this.botDuelDistance < 100 || (!this.currentUser?.isAdmin && this.botDuelDistance > this.maxDistanceAllowed)) {
      this.botDuelError = `Veuillez choisir une distance comprise entre 100m et ${this.maxDistanceAllowed}m autorisée par votre forfait.`;
      return;
    }

    this.isCreatingBotDuel = true;
    this.botDuelError = '';

    const hostUserId = this.activeUserId || this.guestSessionId || `guest_${Math.random().toString(36).substring(2, 7)}`;
    const hostUserName = this.botDuelName?.trim() || this.currentUser?.name || `Racer_${hostUserId.slice(-4)}`;

    if (!this.activeUserId) {
      this.activeUserId = hostUserId;
      this.currentUser.id = hostUserId;
      this.currentUser.name = hostUserName;
      try {
        localStorage.setItem('rower_user_id', hostUserId);
        localStorage.setItem('rower_user_login', hostUserName);
      } catch {}
    }

    this.rowerService.createPrivateRace({
      isBotDuel: true,
      botStartMode: 'first_stroke',
      title: `Duel 1v1 Bot (${this.botDuelDistance}m)`,
      targetDistance: this.botDuelDistance,
      maxParticipants: 2,
      hostUserId,
      hostUserName,
      botCount: 1
    }).subscribe({
      next: (res) => {
        this.isCreatingBotDuel = false;
        this.closeBotDuelModal();
        if (res.race) {
          this.onPrivateRoomSelected({ payload: res, pushUrl: true });
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isCreatingBotDuel = false;
        this.botDuelError = err.error?.error || err.error?.message || 'Erreur lors de la création du duel bot.';
        this.cdr.markForCheck();
      }
    });
  }

  // ===== Rafraîchissement automatique des boxes de l'accueil (Classement saison + Historique) =====
  private readonly HOME_POLL_MS = 60_000;
  private readonly HOME_REFRESH_STATUSES = new Set([
    'COMPLETED', 'FINISHED', 'POST_RACE_PAUSE', 'STOPPED', 'CANCELLED', 'ABANDONED'
  ]);
  private homeRefresh$ = new Subject<void>();
  private homeRefreshSub?: Subscription;
  private homePollSub?: Subscription;
  private homeSocketSub?: Subscription;
  lastHomeRefreshAt: Date | null = null;

  private homeVisibilityListener = (): void => {
    if (typeof document !== 'undefined' && !document.hidden) {
      this.homeRefresh$.next();
    }
  };

  private initHomeAutoRefresh(): void {
    this.homeRefreshSub?.unsubscribe();
    this.homePollSub?.unsubscribe();
    this.homeSocketSub?.unsubscribe();

    // Anti-rebond + annulation des requêtes en cours ; uniquement sur l'accueil et onglet visible
    this.homeRefreshSub = this.homeRefresh$.pipe(
      debounceTime(2000),
      filter(() => this.siteView === 'home' && !(typeof document !== 'undefined' && document.hidden)),
      switchMap(() => forkJoin({
        lb: this.rowerService.getGeneralLeaderboard({
          country: this.leaderboardCountryFilter,
          gender: this.leaderboardGenderFilter,
          ageCategory: this.leaderboardAgeCategoryFilter
        }).pipe(catchError(() => of(null))),
        hist: this.rowerService.getRaceHistory().pipe(catchError(() => of(null)))
      }))
    ).subscribe(({ lb, hist }) => {
      if ((lb as any)?.players) {
        this.generalLeaderboard = (lb as any).players;
      }
      if (hist) {
        this.applyPastRaces(hist as any[]);
      }
      this.lastHomeRefreshAt = new Date();
      this.cdr.markForCheck();
    });

    // Filet de sécurité périodique
    this.homePollSub = interval(this.HOME_POLL_MS).subscribe(() => this.homeRefresh$.next());

    // Fin de course (événement global, indépendant de la course suivie)
    this.homeSocketSub = this.socketService.onRaceStatusChange().subscribe((update) => {
      if (update && this.HOME_REFRESH_STATUSES.has(String(update.status || '').toUpperCase())) {
        this.homeRefresh$.next();
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.homeVisibilityListener);
    }
  }

  private destroyHomeAutoRefresh(): void {
    this.homeRefreshSub?.unsubscribe();
    this.homePollSub?.unsubscribe();
    this.homeSocketSub?.unsubscribe();
    this.homeRefreshSub = this.homePollSub = this.homeSocketSub = undefined;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.homeVisibilityListener);
    }
  }

  loadPastRaces(): void {
    this.rowerService.getRaceHistory().pipe(
      catchError(() => of([]))
    ).subscribe((history) => {
      this.applyPastRaces(history as any[]);
    });
  }

  private applyPastRaces(history: any[]): void {
    {
      const excludedStatuses = new Set([
        'STOPPED', 'CANCELLED', 'ABORTED', 'ABANDONED',
        'stopped', 'cancelled', 'aborted', 'abandoned'
      ]);
      this.raceHistory = (history || []).filter((item: any) => {
        if (!item) return false;
        const st = String(item.status || item.race?.status || '').trim();
        if (excludedStatuses.has(st)) return false;
        // Exclure toute course sans podium ou sans distance parcourue
        const podium = item.podium || item.finalRanking;
        if (!Array.isArray(podium) || podium.length === 0) return false;
        const maxDist = podium.reduce((acc: number, cur: any) => Math.max(acc, Number(cur.distance || cur.netDistance || 0)), 0);
        return maxDist > 0;
      });
      this.cdr.markForCheck();
    }
  }

  saveRaceConfig(): void {
    this.rowerService.updateRaceConfig(this.configTargetDistance, this.configIntervalMinutes, this.activeUserId).subscribe({
      next: () => {
        this.isConfigRaceOpen = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Erreur config course:', err);
        alert(err.error?.message || 'Action non autorisée');
      }
    });
  }

  saveCustomApiUrl(): void {
    if (this.customApiUrlInput && this.customApiUrlInput.trim().length > 0) {
      this.rowerService.setApiUrl(this.customApiUrlInput);
      this.apiUrl = this.rowerService.getApiUrl();
      this.isSettingsOpen = false;
      this.initGameLoop();
      this.cdr.markForCheck();
    }
  }

  async enableScreenWakeLock(): Promise<void> {
    const success = await this.wakeLockService.requestWakeLock();
    this.wakeLockActive = success;
    this.cdr.markForCheck();
  }

  async toggleWakeLock(): Promise<void> {
    this.wakeLockActive = await this.wakeLockService.toggleWakeLock();
    this.cdr.markForCheck();
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

  formatSpeed(val?: any): string {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return '0.0 km/h';
    return `${n.toFixed(1)} km/h`;
  }

  formatPoints(val?: any): string {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return `+${Math.round(n)} pts`;
  }

  get isUserAdmin(): boolean {
    return Boolean(
      this.currentUser.role === 'ADMIN' ||
      this.currentUser.isAdmin ||
      this.currentUser.name?.toLowerCase() === 'emmaracer' ||
      this.activeUserId?.toLowerCase() === 'emmaracer' ||
      (typeof localStorage !== 'undefined' && (localStorage.getItem('rower_user_role') === 'ADMIN' || localStorage.getItem('rower_is_admin') === 'true'))
    );
  }

  get isSubscriber(): boolean {
    if (this.isUserAdmin) return true;
    const tier = (this.currentUser?.subscriptionTier || (typeof localStorage !== 'undefined' ? localStorage.getItem('rower_subscription_tier') || '' : '')).toLowerCase().trim();
    if (tier === 'free' || tier === 'none' || !tier) return false;
    if (tier === 'intermediate' || tier === 'club' || tier === 'standard' || tier === 'premium' || tier === 'pro' || tier === 'elite_pro') return true;
    return Boolean(
      (this.currentUser.isSubscriber && tier !== 'free') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('rower_is_subscriber') === 'true' && localStorage.getItem('rower_subscription_tier') !== 'free')
    );
  }

  get isRegisteredUser(): boolean {
    if (this.isSubscriber || this.isUserAdmin) return true;
    const email = this.currentUser?.email?.trim();
    const login = this.currentUser?.login?.trim();
    const name = this.currentUser?.name?.trim();
    const isGuest = !login || login.startsWith('guest_') || login.startsWith('usr_');
    const isAnonymousRacer = !name || name.startsWith('Racer_');
    return Boolean((email && email.length > 0) || (!isGuest && !isAnonymousRacer));
  }

  get isGuestUser(): boolean {
    return !this.isRegisteredUser;
  }

  get currentSubscriberTier(): string {
    if (this.isUserAdmin) return 'admin';
    const tier = (this.currentUser?.subscriptionTier || (typeof localStorage !== 'undefined' ? localStorage.getItem('rower_subscription_tier') || '' : '')).toLowerCase().trim();
    if (tier) return tier;
    return this.isSubscriber ? 'intermediate' : 'free';
  }

  openAccountModal(tab: 'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer' | 'regatta-settings' = 'login'): void {
    if (!this.isPaired && typeof localStorage !== 'undefined') {
      const storedToken = localStorage.getItem('rower_device_token');
      const storedPaired = localStorage.getItem('rower_is_paired') === 'true';
      if (storedToken || storedPaired) {
        this.isPaired = true;
        this.isWatchConfirmed = true;
        if (storedToken && !this.deviceToken) {
          this.deviceToken = storedToken;
        }
        this.watchPairingRecovered = true;
      }
    }
    if (tab === 'login' && this.isIdentified) {
      this.accountModalTab = 'profile';
    } else {
      this.accountModalTab = tab;
    }
    if (this.accountModalTab === 'kayak-customizer') {
      this.syncKayakCustomizationFromUser(this.currentUser);
    }
    if (this.accountModalTab === 'regatta-settings' || this.accountModalTab === 'profile') {
      this.syncRegattaPreferencesFromUser(this.currentUser);
      this.syncDuelPreferencesFromUser(this.currentUser);
    }
    this.duelPreferencesFeedback = '';
    this.duelPreferencesError = '';
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.regattaPreferencesError = '';
    this.regattaPreferencesFeedback = '';
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  closeAccountModal(): void {
    if (this.accountModalTab === 'kayak-customizer') {
      this.restorePreviewFromCommitted();
    }
    this.isAccountModalOpen = false;
    this.isPostRegisterOnboarding = false;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.cdr.markForCheck();
  }

  submitAccountLogin(): void {
    if (!this.loginAccountInput.trim() || !this.passwordAccountInput.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_LOGIN_REQUIRED');
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    const existingGuestToken = (this.isPaired || this.isWatchConfirmed || this.deviceToken)
      ? (this.deviceToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('rower_device_token') || '' : ''))
      : undefined;

    this.rowerService.loginUser({
      login: this.loginAccountInput.trim(),
      password: this.passwordAccountInput.trim(),
      deviceToken: existingGuestToken || undefined,
      guestPairingToken: existingGuestToken || undefined,
      guestUserId: this.activeUserId || undefined,
    }).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          const isAdminUser = Boolean(res.isAdmin || res.role === 'ADMIN' || res.user.isAdmin || res.user.role === 'ADMIN');
          const resolvedRole = res.role || res.user.role || (isAdminUser ? 'ADMIN' : 'USER');
          const resolvedTier = String(res.subscriptionTier || res.user.subscriptionTier || (isAdminUser ? 'premium' : 'free')).toLowerCase();
          const isSub = Boolean(isAdminUser || (resolvedTier !== 'free' && (res.isSubscriber || res.user.isSubscriber)));

          this.activeUserId = userLogin;
          this.userIdInput = res.user.watchUserId || userLogin;
          // Règle stricte d'identité joueur : utilisateur connecté => login/username exclusif
          this.currentUser = {
            ...res.user,
            name: userLogin,
            isAdmin: isAdminUser,
            role: resolvedRole,
            subscriptionTier: resolvedTier,
            isSubscriber: isSub,
          };
          this.userLoginInput = userLogin;
          this.syncKayakCustomizationFromUser(res.user);
          this.syncRegattaPreferencesFromUser(res.user);
          this.syncDuelPreferencesFromUser(res.user);
          this.applyUserLanguagePreference(res.user.language);

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', userLogin);
            localStorage.setItem('rower_is_subscriber', String(isSub));
            localStorage.setItem('rower_is_admin', String(isAdminUser));
            localStorage.setItem('rower_user_role', resolvedRole);
            localStorage.setItem('rower_subscription_tier', resolvedTier);
            if (res.token) {
              localStorage.setItem('rower_auth_token', res.token);
            }
          } catch {}

          // Prise en charge multi-terminal transparente : réactivation automatique de la montre si appairée au compte
          const isPairedOnAccount = Boolean(res.isGarminPaired || res.user.isGarminPaired);
          const resolvedToken = res.pairedDevice?.deviceToken || res.user.pairedDevice?.deviceToken;
          if (isPairedOnAccount) {
            this.isPaired = true;
            this.isWatchConfirmed = true;
            if (resolvedToken) {
              this.deviceToken = resolvedToken;
            }
            try {
              localStorage.setItem('rower_is_paired', 'true');
              localStorage.setItem('rower_watch_confirmed', 'true');
              if (resolvedToken) {
                localStorage.setItem('rower_device_token', resolvedToken);
              }
            } catch {}
          }

          this.accountAuthSuccess = 'Connexion réussie !';
          this.pendingPrivateSalonsCount = 0;
          this.pendingDuelsCount = 0;
          this.refreshPendingPrivateAndDuels();
          this.loadUserProfile();
          this.loadGeneralLeaderboard();
          this.pendingPrivateSalonsCount = 0;
          this.pendingDuelsCount = 0;
          this.refreshPendingPrivateAndDuels();
          setTimeout(() => {
            this.closeAccountModal();
            this.setSiteView('home');
            this.userExplicitlyNavigatedHome = true;
            if (typeof window !== 'undefined' && (window.location.pathname === '/login' || window.location.pathname.startsWith('/login/')) && !this.resetToken && !this.showResetFields) {
              try { window.history.replaceState({}, '', '/'); } catch {}
            }
            if (this.pendingDuelChallengeId) {
              const pendingId = this.pendingDuelChallengeId;
              this.pendingDuelChallengeId = '';
              this.handleIncomingDuelChallenge(pendingId);
            } else if (this.activePrivateRoom || (typeof window !== 'undefined' && window.location.pathname.startsWith('/r/'))) {
              this.isPrivateModalOpen = true;
              this.privateModalTab = 'share';
            }
            this.cdr.markForCheck();
          }, 500);
        } else {
          this.accountAuthError = this.i18n.translateError(res.message || 'ERR_INVALID_CREDENTIALS');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_INVALID_CREDENTIALS');
        this.cdr.markForCheck();
      }
    });
  }

  submitAccountRegister(): void {
    const finalPays = this.regPays === 'Autre'
      ? this.regCustomPays.trim()
      : this.regPays.trim();

    if (
      !this.regNom.trim() ||
      !this.regPrenom.trim() ||
      !this.regLogin.trim() ||
      !this.regEmail.trim() ||
      !this.regPassword.trim() ||
      !finalPays
    ) {
      this.accountAuthError = this.i18n.translateError('ERR_REQUIRED_FIELDS');
      return;
    }

    if (!this.isPasswordPolicySatisfied(this.regPassword)) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORD_POLICY');
      return;
    }

    if (this.regPassword !== this.regPasswordConfirm) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORDS_DONT_MATCH');
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_device_token') || '' : '';
    const storedPaired = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_is_paired') === 'true' : false;
    const existingGuestToken = (this.isPaired || this.isWatchConfirmed || this.deviceToken || storedPaired)
      ? (this.deviceToken || storedToken || undefined)
      : (storedToken || undefined);

    const hadPriorPairing = Boolean(this.isPaired || this.isWatchConfirmed || this.deviceToken || storedToken || storedPaired);

    this.rowerService.registerUser({
      nom: this.regNom.trim(),
      prenom: this.regPrenom.trim(),
      anneeNaissance: Number(this.regAnneeNaissance) || 1995,
      sexe: this.regSexe,
      pays: finalPays,
      login: this.regLogin.trim(),
      email: this.regEmail.trim(),
      password: this.regPassword.trim(),
      watchUserId: this.regWatchUserId.trim() || undefined,
      deviceToken: existingGuestToken || undefined,
      guestPairingToken: existingGuestToken || undefined,
      guestToken: existingGuestToken || undefined,
      guestUserId: this.activeUserId || undefined,
      duelInviteToken: this.pendingDuelInviteToken || undefined,
      duelPreferences: {
        acceptsDuels: Boolean(this.regAcceptsDuels),
        isAbsent: false,
        absenceStartDate: null,
        absenceEndDate: null,
        refusedDays: [...this.regDuelRefusedDays],
        availableWindows: [{
          startTime: this.regDuelStartTime || '08:00',
          endTime: this.regDuelEndTime || '22:00',
        }],
        timezone: typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris') : 'Europe/Paris',
      },
      website_url: this.regWebsiteUrl.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          this.activeUserId = userLogin;
          this.userIdInput = res.user.watchUserId || userLogin;
          this.currentUser = res.user;
          this.userLoginInput = res.user.name || userLogin;
          this.syncRegattaPreferencesFromUser(res.user);
          this.syncDuelPreferencesFromUser(res.user);
          this.applyUserLanguagePreference(res.user.language);

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', res.user.name || userLogin);
            localStorage.setItem('rower_is_subscriber', 'true');
            localStorage.setItem('rower_is_admin', String(Boolean(res.user.isAdmin)));
            if (res.token) {
              localStorage.setItem('rower_auth_token', res.token);
            }
          } catch {}

          if (res.user.isGarminPaired || existingGuestToken || hadPriorPairing) {
            this.isPaired = true;
            this.isWatchConfirmed = true;
            this.watchPairingRecovered = true;
            if (existingGuestToken && !this.deviceToken) {
              this.deviceToken = existingGuestToken;
            }
            try {
              localStorage.setItem('rower_is_paired', 'true');
              localStorage.setItem('rower_watch_confirmed', 'true');
              if (this.deviceToken) {
                localStorage.setItem('rower_device_token', this.deviceToken);
              }
            } catch {}
          } else {
            this.watchPairingRecovered = false;
          }

          if (this.watchPairingRecovered) {
            this.accountAuthSuccess = 'Compte créé avec succès ! Votre statut abonné est actif et votre liaison montre Garmin effectuée sur la page d\'accueil a été récupérée avec succès.';
          } else {
            this.accountAuthSuccess = 'Compte créé avec succès ! Votre statut abonné est actif. Vous pouvez dès maintenant créer des salons privés ou associer votre montre Garmin.';
          }
          this.loadUserProfile();
          this.loadGeneralLeaderboard();
          this.pendingPrivateSalonsCount = 0;
          this.pendingDuelsCount = 0;
          this.refreshPendingPrivateAndDuels();
          if (this.pendingDuelInviteToken) {
            this.pendingDuelInviteToken = '';
            this.pendingRegistrationEmail = '';
            this.refreshPendingPrivateAndDuels();
            if (typeof window !== 'undefined') {
              try {
                const cleanUrl = window.location.pathname + (window.location.hash || '');
                window.history.replaceState({}, '', cleanUrl || '/');
              } catch {}
            }
          }
          this.isPostRegisterOnboarding = true;
          setTimeout(() => {
            if (this.pendingDuelChallengeId) {
              const pendingId = this.pendingDuelChallengeId;
              this.pendingDuelChallengeId = '';
              this.closeAccountModal();
              this.setSiteView('home');
              this.userExplicitlyNavigatedHome = true;
              this.handleIncomingDuelChallenge(pendingId);
            } else if (this.activePrivateRoom || (typeof window !== 'undefined' && window.location.pathname.startsWith('/r/'))) {
              this.closeAccountModal();
              this.setSiteView('home');
              this.userExplicitlyNavigatedHome = true;
              this.isPrivateModalOpen = true;
              this.privateModalTab = 'share';
            } else {
              this.accountModalTab = 'kayak-customizer';
            }
            this.cdr.markForCheck();
          }, 1200);
        } else {
          this.accountAuthError = this.i18n.translateError(res.message || 'ERR_GENERIC');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_GENERIC');
        this.cdr.markForCheck();
      }
    });
  }

  submitForgotPassword(): void {
    if (!this.forgotEmailOrLogin.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_FORGOT_REQUIRED');
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.forgotPassword(this.forgotEmailOrLogin.trim()).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        this.accountAuthSuccess = res.message || this.i18n.t('ACCOUNT_FORGOT_SENT_CONFIRMATION');
        this.showResetFields = false;
        this.forgotEmailOrLogin = '';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_GENERIC');
        this.cdr.markForCheck();
      }
    });
  }

  submitChangePassword(): void {
    if (!this.currentPassword.trim() || !this.changeNewPassword.trim() || !this.changePasswordConfirm.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_MISSING_FIELDS');
      return;
    }

    if (!this.isPasswordPolicySatisfied(this.changeNewPassword)) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORD_POLICY');
      return;
    }

    if (this.changeNewPassword.trim() !== this.changePasswordConfirm.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORDS_DO_NOT_MATCH');
      return;
    }

    if (this.currentPassword.trim() === this.changeNewPassword.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_NEW_PWD_SAME_AS_CURRENT');
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.changePassword(this.currentPassword.trim(), this.changeNewPassword.trim()).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        this.accountAuthSuccess = res.message || this.i18n.t('ACCOUNT_PWD_CHANGED_SUCCESS');
        this.currentPassword = '';
        this.changeNewPassword = '';
        this.changePasswordConfirm = '';
        this.isChangePasswordOpen = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_GENERIC');
        this.cdr.markForCheck();
      }
    });
  }

  submitResetPassword(): void {
    if (!this.resetToken.trim() || !this.resetNewPassword.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_RESET_REQUIRED');
      return;
    }

    if (!this.isPasswordPolicySatisfied(this.resetNewPassword)) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORD_POLICY');
      return;
    }

    if (this.resetNewPassword.trim() !== this.resetPasswordConfirm.trim()) {
      this.accountAuthError = this.i18n.translateError('ERR_PASSWORDS_DO_NOT_MATCH');
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.resetPassword(this.resetToken.trim(), this.resetNewPassword.trim()).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        this.accountAuthSuccess = res.message || this.i18n.t('ACCOUNT_RESET_SUCCESS');
        this.showResetFields = false;
        this.resetToken = '';
        this.resetNewPassword = '';
        this.resetPasswordConfirm = '';
        this.accountModalTab = 'login';
        this.loginAccountInput = this.forgotEmailOrLogin || this.loginAccountInput;
        this.passwordAccountInput = '';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = this.i18n.translateError(err.error?.message ? err : 'ERR_TOKEN_INVALID');
        this.cdr.markForCheck();
      }
    });
  }

  promptLogout(): void {
    this.logoutUser();
  }

  logoutUser(): void {
    try {
      localStorage.removeItem('rower_user_id');
      localStorage.removeItem('rower_user_login');
      localStorage.removeItem('rower_is_subscriber');
      localStorage.removeItem('rower_is_admin');
      localStorage.removeItem('rower_user_role');
      localStorage.removeItem('rower_subscription_tier');
      localStorage.removeItem('rower_auth_token');
      localStorage.removeItem('rower_kayak_customization');
      localStorage.removeItem('rower_claimed_kayak_id');
      localStorage.removeItem('rower_is_paired');
      localStorage.removeItem('rower_watch_confirmed');
      localStorage.removeItem('rower_device_token');
      localStorage.removeItem('rower_saved_private_salons');
      localStorage.removeItem('rower_saved_private_salons_guest');
    } catch {}

    this.isAdminDashboardOpen = false;
    this.isAccountModalOpen = false;
    this.isLoginModalOpen = false;
    this.isWatchGuidanceModalOpen = false;
    this.activePrivateRoom = null;
    this.myActivity = null;
    this.selectedSpectatorUserId = '';
    this.claimedRacerUserId = '';
    this.selectedCockpitPlayerId = '';

    // Désactivation automatique de l'appairage sur ce navigateur
    this.isPaired = false;
    this.isWatchConfirmed = false;
    this.deviceToken = '';
    this.pairingCode = '';
    this.pairingSuccessMessage = '';
    this.pairingErrorMessage = '';
    if (this.pairingTimerSub) {
      this.pairingTimerSub.unsubscribe();
      this.pairingTimerSub = undefined;
    }
    if (this.pairingStatusPollSub) {
      this.pairingStatusPollSub.unsubscribe();
      this.pairingStatusPollSub = undefined;
    }

    this.myAssignedLane = 1;
    const randId = Math.random().toString(36).substring(2, 8);
    this.activeUserId = `usr_${randId}`;
    this.userIdInput = this.activeUserId;
    this.currentUser = {
      id: this.activeUserId,
      name: `Racer_${this.activeUserId.slice(-4)}`,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      isAdmin: false,
      isSubscriber: false,
      subscriptionTier: 'free',
      role: 'USER',
      points: 0,
    };
    this.userLoginInput = this.currentUser.name;
    this.userHistory = [];
    this.generalUserRank = 1;
    this.generalTotalPlayers = 1;
    this.userStatisticsData = null;
    this.unseenWeeklySummary = null;
    this.accountModalTab = 'login';
    this.customKayakHullColor = '#00e5ff';
    this.customKayakBladeColor = '#00f0ff';
    this.customKayakPattern = 'racing-stripe';
    this.customKayakGlowColor = '#00f0ff';
    this.isPostRegisterOnboarding = false;
    this.loginAccountInput = '';
    this.passwordAccountInput = '';
    this.regLogin = '';
    this.regEmail = '';
    this.regPassword = '';
    this.accountAuthError = '';
    this.accountAuthSuccess = 'Vous avez été déconnecté.';
    this.pendingPrivateSalonsCount = 0;
    this.pendingDuelsCount = 0;
    this.refreshPendingPrivateAndDuels();

    this.setSiteView('home');
    this.userExplicitlyNavigatedHome = true;
    this.cdr.markForCheck();
  }

  get isOrganizerOfActiveRoom(): boolean {
    if (!this.activePrivateRoom) return false;
    const hostId = (this.activePrivateRoom.race?.hostUserId || '').trim();
    const origHostId = ((this.activePrivateRoom.race as any)?.originalHostUserId || '').trim();
    const uid = (this.activeUserId || '').trim();
    if (!uid || uid === 'anonymous' || (!hostId && !origHostId)) return false;
    return (
      (Boolean(hostId) && hostId !== 'anonymous' && hostId.toLowerCase() === uid.toLowerCase()) ||
      (Boolean(origHostId) && origHostId !== 'anonymous' && origHostId.toLowerCase() === uid.toLowerCase())
    );
  }

  get isRaceActive(): boolean {
    if (this.activePrivateRoom) {
      const roomStatus = String(this.activePrivateRoom.status || this.activePrivateRoom.race?.status || (this.activePrivateRoom as any).internalStatus || '').toUpperCase();
      if (roomStatus === 'LOBBY' || roomStatus === 'COUNTDOWN') {
        return false;
      }
    }
    const isRunningStatus = Boolean(
      this.nextRaceInfo?.status === 'in_progress' ||
      this.nextRaceInfo?.race?.status === 'RUNNING' ||
      this.nextRaceInfo?.race?.status === 'in_progress'
    );
    if (!isRunningStatus) return false;
    const race = this.activePrivateRoom?.race || this.nextRaceInfo?.race;
    const startMode = race?.startMode || (this.activePrivateRoom as any)?.startMode;
    const scheduledTime = race?.scheduledStartTime || (this.activePrivateRoom as any)?.scheduledStartTime;
    const startedAt = (race as any)?.startedAt || (this.activePrivateRoom as any)?.startedAt;
    if (startMode === 'scheduled' && scheduledTime && !startedAt) {
      const schedMs = new Date(scheduledTime).getTime();
      if (Number.isFinite(schedMs) && Date.now() < schedMs) {
        return false;
      }
    }
    return true;
  }

  get formattedPreRaceCountdown(): string {
    return this.i18n.formatDetailedCountdown(this.countdownSeconds);
  }

  get canStopRace(): boolean {
    if (!this.activePrivateRoom && this.isUserAdmin && this.nextRaceInfo?.race) {
      const st = String(this.nextRaceInfo.race.status || this.nextRaceInfo.status || '').toUpperCase();
      return st === 'LOBBY' || st === 'WAITING' || st === 'COUNTDOWN' || st === 'RUNNING' || st === 'IN_PROGRESS';
    }
    if (!this.isRaceActive) return false;
    return this.isUserAdmin || this.isOrganizerOfActiveRoom;
  }

  get isPrivateRoomStartLocked(): boolean {
    if (!this.activePrivateRoom) return false;
    const race = this.activePrivateRoom.race || this.activePrivateRoom;
    const startMode = race.startMode || (this.activePrivateRoom as any).startMode;
    const scheduledTime = race.scheduledStartTime || (this.activePrivateRoom as any).scheduledStartTime;
    if (startMode === 'scheduled' && scheduledTime) {
      const startMs = new Date(scheduledTime).getTime();
      if (Number.isFinite(startMs)) {
        const unlockMs = startMs - 5 * 60 * 1000;
        return Date.now() < unlockMs;
      }
    }
    return false;
  }

  get isWatchEngaged(): boolean {
    if (!this.activePrivateRoom) return false;
    const race = this.activePrivateRoom.race || this.activePrivateRoom;
    const parts: any = race.participants || (this.activePrivateRoom as any).participants || [];
    const list: any[] = Array.isArray(parts) ? parts : Array.from((parts as any).values ? (parts as any).values() : []);
    return list.some((p: any) =>
      p.userId === this.activeUserId &&
      p.lane > 0 &&
      p.pinValidated !== false &&
      p.connectionState !== 'PENDING_PIN'
    );
  }

  get engagedKayaksCountInActiveRoom(): number {
    if (!this.activePrivateRoom) return 0;
    const race: any = this.activePrivateRoom.race || this.activePrivateRoom;
    const parts: any = race.participants || (this.activePrivateRoom as any).participants || [];
    const list: any[] = Array.isArray(parts) ? parts : Array.from((parts as any).values ? (parts as any).values() : []);
    const engagedHumans = list.filter((p: any) => {
      const isBot = Boolean(p?.isBot) || String(p?.userId || '').startsWith('bot_');
      if (isBot) return false;
      if (p?.hasLeft || p?.status === 'abandoned') return false;
      return Boolean(p?.lane > 0 && p?.pinValidated !== false && p?.connectionState !== 'PENDING_PIN');
    }).length;
    const botParts = list.filter((p: any) => Boolean(p?.isBot) || String(p?.userId || '').startsWith('bot_')).length;
    const configuredBots = Number(race?.botCount ?? (this.activePrivateRoom as any)?.botCount ?? (race?.isBotDuel ? 1 : 0)) || 0;
    return engagedHumans + Math.max(botParts, configuredBots);
  }

  get canStartRace(): boolean {
    if (this.isRaceActive) return false;
    if (!this.activePrivateRoom) return false;
    if (this.isPrivateRoomStartLocked) return false;
    if (!this.isOrganizerOfActiveRoom && !this.isUserAdmin) return false;
    const race: any = this.activePrivateRoom.race || this.activePrivateRoom;
    const isSolo = Boolean(race?.isSolo || (this.activePrivateRoom as any)?.isSolo);
    const minRequiredKayaks = isSolo ? 1 : 2;
    if (this.engagedKayaksCountInActiveRoom < minRequiredKayaks) return false;
    if (!this.isWatchEngaged && !this.isUserAdmin) return false;
    const st = String(this.activePrivateRoom.status || this.activePrivateRoom.race?.status || '').toLowerCase();
    return st === 'waiting' || st === 'countdown' || st === 'lobby';
  }

  get canStartOrStopRace(): boolean {
    return this.canStopRace || this.canStartRace;
  }

  startActivePrivateRace(): void {
    if (!this.canStartRace || !this.activePrivateRoom) return;
    const identifier = this.activePrivateRoom.code || this.activePrivateRoom.race?.id || this.activePrivateRoom.raceId;
    if (!identifier) return;

    // Basculer immédiatement sur smartphone / web vers la vue régate en paysage plein écran lors du geste utilisateur
    this.onPrivateRaceStartTriggered({ countdownSeconds: 15 });

    this.rowerService.startOrResetPrivateRace(identifier, {
      hostUserId: this.activeUserId,
      countdownSeconds: 15
    }).subscribe({
      next: (res) => {
        this.cdr.markForCheck();
      },
      error: (err) => {
        alert(err?.error?.message || err?.error?.error || "Erreur lors du lancement de la course.");
      }
    });
  }

  stopActiveRace(): void {
    if (!this.canStopRace || !this.nextRaceInfo) return;
    const isPublic = !this.activePrivateRoom;
    const confirmed = window.confirm(
      isPublic
        ? "Voulez-vous vraiment arrêter la course publique en cours ? Tous les participants seront immédiatement arrêtés, aucun classement ne sera retenu et un nouveau cycle sera relancé."
        : "Voulez-vous vraiment arrêter la course en cours ? Le classement officiel final sera immédiatement établi selon la position des coureurs."
    );
    if (!confirmed) return;
    const raceId = this.nextRaceInfo.race?.id;
    if (!raceId) return;

    this.rowerService.stopRace(raceId, this.activeUserId).subscribe({
      next: (res) => {
        if (isPublic) {
          this.isPostRaceRankingActive = false;
          this.selectedRaceLeaderboard = [];
          this.myActivity = null;
          this.triggerFinishToast("🛑 Course arrêtée par l'administrateur. Aucun classement n'a été établi.");
          this.loadNextRaceInfo();
        } else {
          this.isPostRaceRankingActive = true;
          this.isPrivateRoomCompleted = true;
          if (this.nextRaceInfo) {
            this.nextRaceInfo.status = 'finished';
            (this.nextRaceInfo as any).stopReason = 'organizer_stopped';
            if (this.nextRaceInfo.race) {
              this.nextRaceInfo.race.status = 'COMPLETED';
              (this.nextRaceInfo.race as any).stopReason = 'organizer_stopped';
            }
          }
          if (this.activePrivateRoom) {
            this.activePrivateRoom.status = 'COMPLETED';
            (this.activePrivateRoom as any).stopReason = 'organizer_stopped';
            if (this.activePrivateRoom.race) {
              this.activePrivateRoom.race.status = 'COMPLETED';
              (this.activePrivateRoom.race as any).stopReason = 'organizer_stopped';
            }
          }
          if (res.ranking && res.ranking.length > 0) {
            this.selectedRaceLeaderboard = res.ranking;
          }
          this.openRaceLeaderboard(raceId);
          this.triggerFinishToast("🛑 Course arrêtée ! Le classement officiel est affiché.");
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        alert(err?.error?.message || "Erreur lors de l'arrêt de la course.");
      }
    });
  }

  get isRaceStoppedByOrganizer(): boolean {
    return Boolean(
      (this.nextRaceInfo?.race as any)?.stopReason === 'organizer_stopped' ||
      (this.nextRaceInfo as any)?.stopReason === 'organizer_stopped' ||
      (this.activePrivateRoom?.race as any)?.stopReason === 'organizer_stopped' ||
      (this.activePrivateRoom as any)?.stopReason === 'organizer_stopped'
    );
  }

  get isRaceEnded(): boolean {
    const st = String(this.nextRaceInfo?.status || this.nextRaceInfo?.race?.status || this.activePrivateRoom?.status || this.activePrivateRoom?.race?.status || '').toLowerCase();
    return Boolean(
      this.isPostRaceRankingActive ||
      this.isPrivateRoomCompleted ||
      st === 'completed' ||
      st === 'finished' ||
      st === 'stopped'
    );
  }

  get isPostRaceDisplayActive(): boolean {
    if (!this.activePrivateRoom) {
      return false;
    }
    const active = Boolean(this.isFinished || this.isPostRaceRankingActive || this.isRaceEnded);
    if (active) {
      const rId = this.completedPublicRaceId || this.selectedRaceInfo?.id || this.nextRaceInfo?.race?.id || this.activePrivateRoom?.race?.id || (this.nextRaceInfo as any)?.id || (this.activePrivateRoom as any)?.id;
      if (rId && rId !== this.lastFetchedLeaderboardRaceId) {
        this.lastFetchedLeaderboardRaceId = rId;
        this.refreshOfficialRaceLeaderboard(rId);
      }
    } else {
      this.lastFetchedLeaderboardRaceId = null;
    }
    return active;
  }

  returnToHomeAfterRace(): void {
    this.closeRaceLeaderboardModal();
    this.isPostRaceRankingActive = false;
    this.completedPublicRaceId = null;
    this.showFinishCelebration = false;
    this.raceMonotonicStartTimestamp = null;
    this.raceMonotonicMaxElapsed = 0;
    this.lastFetchedLeaderboardRaceId = null;
    this.selectedRaceLeaderboard = [];
    this.myActivity = null;
    if (!this.activePrivateRoom) {
      this.isPrivateRoomCompleted = false;
    }
    if (this.finishCelebrationTimer) {
      clearTimeout(this.finishCelebrationTimer);
      this.finishCelebrationTimer = null;
    }
    this.setSiteView('home');
    this.initGameLoop();
    this.cdr.markForCheck();
  }

  private isSupportedLang(lang: string): lang is SupportedLang {
    return ['fr', 'en', 'de', 'es', 'it', 'pt'].includes(lang);
  }

  private applyUserLanguagePreference(language?: string): void {
    if (!language || !this.isSupportedLang(language)) {
      return;
    }
    if (this.i18n.getCurrentLang() !== language) {
      this.i18n.setLang(language);
    }
    this.syncSeoLanguage(language);
    this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
  }

  onLanguageSelectChange(event: Event): void {
    const lang = (event.target as HTMLSelectElement)?.value as SupportedLang;
    if (lang) {
      this.changeLanguage(lang);
    }
  }

  get canConfigureRace(): boolean {
    if (this.activePrivateRoom) {
      return this.isOrganizerOfActiveRoom || this.isUserAdmin;
    }
    return this.isUserAdmin;
  }

  get pendingApprovalPlayers(): any[] {
    if (!this.activePrivateRoom) return [];
    if (!this.isOrganizerOfActiveRoom && !this.isUserAdmin) return [];
    return this.activePrivateRoom.pendingParticipants ?? this.activePrivateRoom.race?.pendingParticipants ?? [];
  }

  approvePendingPlayer(targetUserId: string): void {
    if (!this.activePrivateRoom || !targetUserId) return;
    const identifier = this.activePrivateRoom.code || this.activePrivateRoom.race?.id;
    if (!identifier) return;
    this.rowerService.approveParticipant(identifier, this.activeUserId, targetUserId, true).subscribe({
      next: (updated: PrivateRacePayload) => {
        this.activePrivateRoom = updated;
        this.nextRaceInfo = updated;
        this.cdr.markForCheck();
      }
    });
  }

  rejectPendingPlayer(targetUserId: string): void {
    if (!this.activePrivateRoom || !targetUserId) return;
    const identifier = this.activePrivateRoom.code || this.activePrivateRoom.race?.id;
    if (!identifier) return;
    this.rowerService.approveParticipant(identifier, this.activeUserId, targetUserId, false).subscribe({
      next: (updated: PrivateRacePayload) => {
        this.activePrivateRoom = updated;
        this.nextRaceInfo = updated;
        this.cdr.markForCheck();
      }
    });
  }

  getKayakColor(index: number): string {
    const colors = [
      '#FF0055', // Electric Pink / Acid Magenta
      '#00F0FF', // Cyan Turbo
      '#39FF14', // Neon Lime
      '#FFE600', // Acid Yellow
      '#FF6600', // Laser Orange
      '#B026FF', // Cyber Purple
      '#00FF9D', // Mint Neon
    ];
    return colors[index % colors.length];
  }

  changeLanguage(langCode: string): void {
    if (!this.isSupportedLang(langCode)) return;
    const lang = langCode as SupportedLang;
    this.i18n.setLang(lang);
    this.syncSeoLanguage(lang);
    this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
    const hasAuthToken = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('rower_auth_token'));
    if (this.currentUser && (this.isIdentified || this.currentUser.email || this.currentUser.login || hasAuthToken)) {
      this.currentUser.language = lang;
      this.rowerService.updateProfile({ language: lang }).subscribe({
        next: () => {},
        error: () => {}
      });
    }
    this.cdr.markForCheck();
  }

  syncSeoLanguage(langCode: string): void {
    const validLangs: Array<'fr' | 'en' | 'de' | 'es' | 'it' | 'pt'> = ['fr', 'en', 'de', 'es', 'it', 'pt'];
    if (validLangs.includes(langCode as any)) {
      this.activeSeoLang = langCode as 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt';
    } else {
      this.activeSeoLang = 'en';
    }
  }

  get isRigidViewportActive(): boolean {
    return Boolean(
      (this.siteView === 'regatta' || this.siteView === 'cockpit') &&
      (this.isMobileOrTablet || this.isMobileFullscreenOnly || this.isFullscreen || this.isPseudoFullscreen)
    );
  }

  syncRigidViewport(): void {
    if (typeof document !== 'undefined') {
      if (this.isRigidViewportActive) {
        document.documentElement.classList.add('rigid-viewport');
        document.body.classList.add('rigid-viewport');
      } else {
        document.documentElement.classList.remove('rigid-viewport');
        document.body.classList.remove('rigid-viewport');
      }
    }
  }

  triggerFinishToast(message: string): void {
    this.activeFinishToast = message;
    if (this.finishToastTimer) {
      clearTimeout(this.finishToastTimer);
    }
    this.finishToastTimer = setTimeout(() => {
      this.activeFinishToast = null;
      this.cdr.markForCheck();
    }, 2000);
    this.cdr.markForCheck();
  }

  triggerFinishCelebration(raceId?: string): void {
    if (this.hasCelebratedFinish) return;
    this.hasCelebratedFinish = true;
    this.showFinishCelebration = true;
    if (this.finishCelebrationTimer) {
      clearTimeout(this.finishCelebrationTimer);
    }
    this.cdr.markForCheck();

    this.finishCelebrationTimer = setTimeout(() => {
      this.showFinishCelebration = false;
      this.finishCelebrationTimer = null;
      const isPublicRace = !this.activePrivateRoom;
      const shouldOpenLeaderboard = Boolean(
        raceId && (!isPublicRace || this.completedPublicRaceId === raceId || this.isPostRaceRankingActive)
      );
      if (shouldOpenLeaderboard && raceId) {
        this.isPostRaceRankingActive = true;
        if (!this.dismissedLeaderboardRaceIds.has(raceId)) {
          this.openRaceLeaderboard(raceId);
        }
      }
      this.cdr.markForCheck();
    }, 2000);
  }

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteView = view;
    if (view === 'home') {
      this.isPrivateBannerCollapsed = false;
      if (this.isPostRaceRankingActive && !this.activePrivateRoom) {
        this.isPostRaceRankingActive = false;
        this.completedPublicRaceId = null;
        this.myActivity = null;
        this.selectedRaceLeaderboard = [];
      }
      this.homeRefresh$.next();
    }
    if (view === 'regatta') {
      this.userOverrodeViewMode = true;
      this.activeViewMode = 'canvas';
      this.userExplicitlyNavigatedHome = false;
      if (this.isMobileOrTablet && !this.checkIsFullscreen()) {
        this.enterFullscreen().catch(() => {});
      }
      this.startImmersionAutoFade();
      this.triggerMultiStageLayoutResync();
    } else if (view === 'cockpit') {
      this.userOverrodeViewMode = true;
      this.activeViewMode = 'cockpit';
      this.userExplicitlyNavigatedHome = false;
      if (this.isMobileOrTablet && !this.checkIsFullscreen()) {
        this.enterFullscreen().catch(() => {});
      }
      this.startImmersionAutoFade();
      this.triggerMultiStageLayoutResync();
    } else {
      this.userExplicitlyNavigatedHome = true;
      this.isImmersionControlsVisible = true;
      // DÉVERROUILLAGE AUTOMATIQUE DU PLEIN ÉCRAN LORS DU RETOUR À L'ACCUEIL
      if (this.checkIsFullscreen()) {
        this.exitFullscreen().catch(() => {});
      }
      // Libération éventuelle du verrouillage d'orientation écran
      if (typeof screen !== 'undefined' && (screen as any).orientation && (screen as any).orientation.unlock) {
        try {
          (screen as any).orientation.unlock();
        } catch {}
      }
    }
    this.syncRigidViewport();
    this.cdr.markForCheck();
  }

  onHeaderLogoClick(): void {
    // 1. Déterminer si le joueur a un kayak sur une ligne d'eau
    const hasLane = Boolean(this.myAssignedLane) || this.isUserAssociatedWithRace;

    // 2. Déterminer si la course a commencé
    const isStarted = this.isRaceActive ||
      (this.nextRaceInfo?.status === 'in_progress') ||
      (this.nextRaceInfo?.race?.status === 'RUNNING') ||
      (this.activePrivateRoom?.status === 'in_progress') ||
      (this.activePrivateRoom?.race?.status === 'RUNNING');

    // Si le joueur est sur une ligne d'eau et que la course a démarré -> Demander confirmation
    if (hasLane && isStarted) {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Êtes-vous sûr de vouloir abandonner la course et libérer votre couloir ?') : true;
      if (!confirmed) {
        return;
      }
    }

    // Sortie d'un salon privé / duel
    if (this.activePrivateRoom) {
      this.exitPrivateRoomToPublic(true);
      this.initGameLoop();
    } else if (hasLane) {
      // Sortie de la ligne d'eau en course publique
      const currentRaceId = this.nextRaceInfo?.race?.id;
      if (currentRaceId && this.activeUserId) {
        this.rowerService.leaveRoom(currentRaceId, this.activeUserId).subscribe({
          next: () => {},
          error: (err) => console.warn('Could not notify leave public race to backend:', err)
        });
      }
      if (this.myActivity) {
        if (isStarted) {
          this.myActivity.status = 'abandoned';
        } else {
          this.myActivity = null;
        }
      }
      this.myAssignedLane = null as any;
      this.selectedSpectatorUserId = '';
      this.selectedCockpitPlayerId = '';
      if (!this.isIdentified && !this.isPaired) {
        this.activeUserId = 'guest';
      }
    }

    // Toujours revenir sur la vue des courses publiques
    this.setSiteView('home');
    this.cdr.markForCheck();
  }

  isViewActive(view: string): boolean {
    return this.siteView === view;
  }

  toggleMobileSeoGuide(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    this.isMobileSeoGuideOpen = !this.isMobileSeoGuideOpen;
    this.cdr.markForCheck();
  }

  get activeTargetDistance(): number {
    return this.nextRaceInfo?.race?.targetDistance || 10000;
  }

  get quarterDistance(): number {
    return Math.round(this.activeTargetDistance * 0.25);
  }

  get halfDistance(): number {
    return Math.round(this.activeTargetDistance * 0.5);
  }

  get threeQuarterDistance(): number {
    return Math.round(this.activeTargetDistance * 0.75);
  }

  get myProgressPercent(): number {
    const dist = this.myActivity?.netDistance || 0;
    return Math.min(100, Math.max(0, Math.round((dist / this.activeTargetDistance) * 100)));
  }

  closeAllOverlayModals(): void {
    this.isLoginModalOpen = false;
    this.isHistoryOpen = false;
    this.isConfigRaceOpen = false;
    this.isAdminConfigOpen = false;
    this.isUnifiedConfigOpen = false;
    this.isAdminDashboardOpen = false;
    this.isStandingsOpen = false;
    this.isLegalTermsOpen = false;
    this.isBotDuelModalOpen = false;
    this.isStatisticsModalOpen = false;
    this.isWatchGuidanceModalOpen = false;
  }

  adminDashboardOpenedAt = 0;

  openAdminDashboard(): void {
    if (!this.isUserAdmin) return;
    this.closeAllOverlayModals();
    this.adminDashboardOpenedAt = Date.now();
    this.isAdminDashboardOpen = true;
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin') {
      try { window.history.pushState({}, '', '/admin'); } catch {}
    }
    this.cdr.markForCheck();
  }

  onAdminBackdropClick(_event?: MouseEvent): void {
    // La fermeture au clic sur le fond extérieur est désactivée.
    // La fenêtre se ferme uniquement via les boutons explicites.
  }

  closeAdminDashboard(): void {
    this.isAdminDashboardOpen = false;
    if (typeof window !== 'undefined' && window.location.pathname === '/admin') {
      try { window.history.pushState({}, '', '/'); } catch {}
    }
    this.cdr.markForCheck();
  }

  openWatchGuidanceAndPair(): void {
    this.isWatchGuidanceModalOpen = true;
    if (!this.pairingCode && !this.isGeneratingPairingCode) {
      this.generateGarminPairingCode();
    }
    this.cdr.markForCheck();
  }

  closeWatchGuidanceModal(): void {
    this.isWatchGuidanceModalOpen = false;
    this.cdr.markForCheck();
  }

  scrollToGarminPairing(): void {
    if (typeof document !== 'undefined') {
      const el = document.getElementById('garmin-pairing-section') || document.querySelector('.garmin-pairing-section');
      // Vérifier si l'élément existe ET est visible (non masqué en display:none sur smartphone)
      if (el && el.offsetParent !== null && typeof window !== 'undefined' && window.getComputedStyle(el).display !== 'none') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    // Sur smartphone où la section desktop est masquée, ouvrir directement la modale de guidage et générer le code PIN
    this.openWatchGuidanceAndPair();
  }

  startPairingFromProfile(): void {
    this.openWatchGuidanceAndPair();
  }

  // --------------------------------------------------------------------------
  // TIMER PRÉ-COURSE DÉPLAÇABLE (DRAGGABLE COUNTDOWN)
  // --------------------------------------------------------------------------
  onTimerPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target?.closest('button')) return;
    this.isDraggingTimer = true;
    const box = (event.currentTarget as HTMLElement);
    const rect = box.getBoundingClientRect();
    if (!this.timerPosition) {
      this.timerPosition = { x: rect.left, y: rect.top };
    }
    this.dragStartPointer = { x: event.clientX, y: event.clientY };
    this.dragStartTimerPos = { x: this.timerPosition.x, y: this.timerPosition.y };
    try {
      box.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  }

  onTimerPointerMove(event: PointerEvent): void {
    if (!this.isDraggingTimer) return;
    const dx = event.clientX - this.dragStartPointer.x;
    const dy = event.clientY - this.dragStartPointer.y;
    const maxX = Math.max(10, (typeof window !== 'undefined' ? window.innerWidth : 800) - 200);
    const maxY = Math.max(10, (typeof window !== 'undefined' ? window.innerHeight : 600) - 100);
    const nextX = Math.min(Math.max(10, this.dragStartTimerPos.x + dx), maxX);
    const nextY = Math.min(Math.max(10, this.dragStartTimerPos.y + dy), maxY);
    this.timerPosition = { x: Math.round(nextX), y: Math.round(nextY) };
    this.cdr.markForCheck();
  }

  onTimerPointerUp(event: PointerEvent): void {
    if (!this.isDraggingTimer) return;
    this.isDraggingTimer = false;
    const box = (event.currentTarget as HTMLElement);
    try {
      if (box.hasPointerCapture(event.pointerId)) {
        box.releasePointerCapture(event.pointerId);
      }
    } catch {}
    if (this.timerPosition && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('rower_timer_pos_x', String(this.timerPosition.x));
        localStorage.setItem('rower_timer_pos_y', String(this.timerPosition.y));
      } catch {}
    }
    this.cdr.markForCheck();
  }

  resetTimerPosition(event?: Event): void {
    if (event) event.stopPropagation();
    this.timerPosition = null;
    this.isDraggingTimer = false;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('rower_timer_pos_x');
        localStorage.removeItem('rower_timer_pos_y');
      } catch {}
    }
    this.cdr.markForCheck();
  }

  dismissPrestartTimerPermanently(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.isPrestartTimerDismissed = true;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('rower_prestart_timer_dismissed', 'true');
      } catch {}
    }
    this.cdr.markForCheck();
  }

  togglePrestartTimerPreference(enabled: boolean): void {
    this.isPrestartTimerDismissed = !enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        if (this.isPrestartTimerDismissed) {
          localStorage.setItem('rower_prestart_timer_dismissed', 'true');
        } else {
          localStorage.removeItem('rower_prestart_timer_dismissed');
        }
      } catch {}
    }
    this.cdr.markForCheck();
  }

  // --------------------------------------------------------------------------
  // ORIENTATION NOTICE & MINI-LEADERBOARD COCKPIT (DRAGGABLE LEADERBOARD)
  // --------------------------------------------------------------------------
  dismissOrientationNotice(): void {
    this.isOrientationDismissed = true;
    this.cdr.markForCheck();
  }

  get myCockpitRankBadgeText(): string {
    const rank = this.myRank;
    const total = this.totalActiveRacers || this.liveMetricsList.length || 1;
    if (!rank) {
      return total > 0 ? `-- / ${total}` : '--';
    }
    const suffix = rank === 1 ? 'er' : 'e';
    return `${rank}${suffix} / ${total}`;
  }

  get sortedLiveMetrics(): LiveRacerMetric[] {
    return [...this.liveMetricsList].sort((a, b) => (b.dist || 0) - (a.dist || 0));
  }

  private lastCockpitToggleTimestamp = 0;

  toggleRegattaLeaderboard(): void {
    this.isRegattaLeaderboardOpen = !this.isRegattaLeaderboardOpen;
    this.cdr.markForCheck();
  }

  onRegattaLeaderboardPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement;
    if (target?.closest('.btn-close-lead')) return;

    this.isDraggingRegattaLeaderboard = true;
    this.hasMovedRegattaLeaderboard = false;
    this.dragStartRegattaPointer = { x: event.clientX, y: event.clientY };
    this.dragStartRegattaPos = { ...this.regattaLeaderboardPos };

    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
  }

  onRegattaLeaderboardPointerMove(event: PointerEvent): void {
    if (!this.isDraggingRegattaLeaderboard) return;
    const dx = event.clientX - this.dragStartRegattaPointer.x;
    const dy = event.clientY - this.dragStartRegattaPointer.y;
    if (Math.hypot(dx, dy) > 4) {
      this.hasMovedRegattaLeaderboard = true;
    }
    if (!this.hasMovedRegattaLeaderboard) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    let containerWidth = 800;
    let containerHeight = 500;
    const handle = event.currentTarget as HTMLElement;
    const panel = handle?.closest('.regatta-floating-leaderboard-panel') as HTMLElement;
    const container = panel?.parentElement;
    if (container) {
      containerWidth = container.clientWidth;
      containerHeight = container.clientHeight;
    }

    const panelWidth = panel ? panel.offsetWidth : 320;
    const panelHeight = panel ? panel.offsetHeight : 200;

    const minX = 4;
    const minY = 4;
    const maxX = Math.max(minX, containerWidth - panelWidth - 4);
    const maxY = Math.max(minY, containerHeight - panelHeight - 4);

    const newX = Math.min(Math.max(minX, this.dragStartRegattaPos.x + dx), maxX);
    const newY = Math.min(Math.max(minY, this.dragStartRegattaPos.y + dy), maxY);

    this.regattaLeaderboardPos = { x: Math.round(newX), y: Math.round(newY) };
    this.cdr.markForCheck();
  }

  onRegattaLeaderboardPointerUp(event: PointerEvent): void {
    if (!this.isDraggingRegattaLeaderboard) return;
    this.isDraggingRegattaLeaderboard = false;
    const handle = event.currentTarget as HTMLElement;
    try {
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    } catch {}
    this.cdr.markForCheck();
  }

  toggleCockpitLeaderboard(): void {
    const now = Date.now();
    if (now - this.lastCockpitToggleTimestamp < 250) return;
    this.lastCockpitToggleTimestamp = now;
    this.isCockpitLeaderboardCollapsed = !this.isCockpitLeaderboardCollapsed;
    this.cdr.markForCheck();
    setTimeout(() => this.clampCurrentCockpitPosition(), 50);
  }

  onCockpitLeaderboardPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement;
    if (target?.closest('.mini-lead-body')) return;

    this.isDraggingCockpitLeaderboard = true;
    this.hasMovedCockpitLeaderboard = false;
    const box = event.currentTarget as HTMLElement;
    const rect = box.getBoundingClientRect();
    if (!this.cockpitLeaderboardPos) {
      this.cockpitLeaderboardPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
    }
    this.dragStartCockpitPointer = { x: event.clientX, y: event.clientY };
    this.dragStartCockpitPos = { ...this.cockpitLeaderboardPos };
    try {
      box.setPointerCapture(event.pointerId);
    } catch {}
  }

  onCockpitLeaderboardPointerMove(event: PointerEvent): void {
    if (!this.isDraggingCockpitLeaderboard) return;
    const dx = event.clientX - this.dragStartCockpitPointer.x;
    const dy = event.clientY - this.dragStartCockpitPointer.y;
    if (Math.hypot(dx, dy) > 5) {
      this.hasMovedCockpitLeaderboard = true;
    }
    if (!this.hasMovedCockpitLeaderboard) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    const box = event.currentTarget as HTMLElement;
    const boxWidth = box ? box.offsetWidth : (this.isCockpitLeaderboardCollapsed ? 120 : 180);
    const boxHeight = box ? box.offsetHeight : (this.isCockpitLeaderboardCollapsed ? 32 : 160);
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 600;

    this.cockpitLeaderboardPos = this.clampCockpitLeaderboardPosition(
      this.dragStartCockpitPos,
      { dx, dy },
      windowWidth,
      windowHeight,
      boxWidth,
      boxHeight
    );
    this.cdr.markForCheck();
  }

  onCockpitLeaderboardPointerUp(event: PointerEvent): void {
    if (!this.isDraggingCockpitLeaderboard) return;
    this.isDraggingCockpitLeaderboard = false;
    const box = event.currentTarget as HTMLElement;
    try {
      if (box.hasPointerCapture(event.pointerId)) {
        box.releasePointerCapture(event.pointerId);
      }
    } catch {}

    if (!this.hasMovedCockpitLeaderboard) {
      const target = event.target as HTMLElement;
      if (target?.closest('.mini-lead-header') || this.isCockpitLeaderboardCollapsed) {
        this.toggleCockpitLeaderboard();
      }
    }

    if (this.cockpitLeaderboardPos && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('rower_cockpit_lb_pos_x', String(this.cockpitLeaderboardPos.x));
        localStorage.setItem('rower_cockpit_lb_pos_y', String(this.cockpitLeaderboardPos.y));
      } catch {}
    }
    this.cdr.markForCheck();
  }

  onCockpitLeaderboardHeaderClick(event: MouseEvent): void {
    if (this.hasMovedCockpitLeaderboard) {
      event.preventDefault();
      event.stopPropagation();
      this.hasMovedCockpitLeaderboard = false;
      return;
    }
    this.toggleCockpitLeaderboard();
  }

  clampCurrentCockpitPosition(): void {
    if (!this.cockpitLeaderboardPos || typeof window === 'undefined') return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const boxWidth = this.isCockpitLeaderboardCollapsed ? 130 : 200;
    const boxHeight = this.isCockpitLeaderboardCollapsed ? 34 : 180;
    this.cockpitLeaderboardPos = this.clampCockpitLeaderboardPosition(
      this.cockpitLeaderboardPos,
      { dx: 0, dy: 0 },
      windowWidth,
      windowHeight,
      boxWidth,
      boxHeight
    );
    this.cdr.markForCheck();
  }

  formatRacerGap(racer: LiveRacerMetric, leader: LiveRacerMetric): string {
    if (!leader || racer.userId === leader.userId) return 'Leader';
    const distDiff = Math.round((leader.dist || 0) - (racer.dist || 0));
    if (distDiff <= 0) return 'Leader';
    let label = `-${distDiff}m`;
    if (racer.split && racer.split > 0 && racer.split < 600) {
      const secDiff = ((distDiff * racer.split) / 500).toFixed(1);
      label += ` (+${secDiff}s)`;
    }
    return label;
  }

  clampCockpitLeaderboardPosition(
    pos: { x: number; y: number },
    delta: { dx: number; dy: number },
    windowWidth: number = 1024,
    windowHeight: number = 768,
    boxWidth: number = 160,
    boxHeight: number = 40
  ): { x: number; y: number } {
    const maxX = Math.max(10, windowWidth - boxWidth - 10);
    const maxY = Math.max(10, windowHeight - boxHeight - 10);
    const nextX = Math.min(Math.max(10, pos.x + delta.dx), maxX);
    const nextY = Math.min(Math.max(10, pos.y + delta.dy), maxY);
    return { x: Math.round(nextX), y: Math.round(nextY) };
  }

  // --------------------------------------------------------------------------
  // ESPACE STATISTIQUES & ANALYSES DE COURSES
  // --------------------------------------------------------------------------
  openStatisticsModal(): void {
    this.closeAllOverlayModals();
    this.isStatisticsModalOpen = true;
    this.loadUserStatistics();
    this.cdr.markForCheck();
  }

  closeStatisticsModal(): void {
    this.isStatisticsModalOpen = false;
    this.cdr.markForCheck();
  }

  loadUserStatistics(): void {
    this.isLoadingStatistics = true;
    this.statisticsError = '';
    const userIdToQuery = String(this.activeUserId || this.currentUser?.id || this.currentUser?.login || '').trim();
    if (!userIdToQuery) {
      this.isLoadingStatistics = false;
      this.statisticsError = "Identifiant utilisateur manquant.";
      this.cdr.markForCheck();
      return;
    }
    this.rowerService.getUserStatistics(userIdToQuery).subscribe({
      next: (res) => {
        this.isLoadingStatistics = false;
        this.userStatisticsData = res;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingStatistics = false;
        this.statisticsError = err?.error?.message || "Impossible de charger vos analyses de course. Vérifiez votre compte.";
        this.cdr.markForCheck();
      }
    });
  }

  // --------------------------------------------------------------------------
  // RÉSILIATION ABONNEMENT & SUPPRESSION DE COMPTE (RGPD ART. 17)
  // --------------------------------------------------------------------------
  unsubscribeUser(): void {
    if (this.isUserAdmin) {
      alert("Le compte administratrice EmmaRacer ne peut pas résilier son accès.");
      return;
    }
    const confirmed = window.confirm(
      "Voulez-vous vraiment résilier votre abonnement ? Vous conserverez votre compte et passerez en offre gratuite avec accès aux 10 derniers jours de statistiques."
    );
    if (!confirmed) return;

    this.isUnsubscribing = true;
    this.unsubscribeMessage = '';
    this.unsubscribeError = '';
    this.rowerService.unsubscribeUser(this.activeUserId).subscribe({
      next: (res) => {
        this.isUnsubscribing = false;
        this.unsubscribeMessage = res.message || "Abonnement résilié avec succès.";
        if (res.user) {
          this.currentUser = { ...this.currentUser, ...res.user, isSubscriber: false };
        }
        try {
          localStorage.setItem('rower_is_subscriber', 'false');
        } catch {}
        this.loadUserProfile();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isUnsubscribing = false;
        this.unsubscribeError = err?.error?.message || "Erreur lors de la résiliation de l'abonnement.";
        this.cdr.markForCheck();
      }
    });
  }

  deleteUserAccount(): void {
    if (this.isUserAdmin) {
      alert("Le compte administratrice EmmaRacer ne peut pas être supprimé.");
      return;
    }
    const confirmed = window.confirm(
      "ATTENTION : Cette action est irréversible. Votre compte, vos identifiants et l'ensemble de vos données sportives seront définitivement supprimés (conformité RGPD Art. 17). Voulez-vous continuer ?"
    );
    if (!confirmed) return;

    this.isDeletingAccount = true;
    this.deleteAccountError = '';
    this.rowerService.deleteUserAccount(this.activeUserId).subscribe({
      next: (res) => {
        this.isDeletingAccount = false;
        alert(res.message || "Votre compte et vos données ont été définitivement supprimés.");
        this.logoutUser();
        this.closeAccountModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isDeletingAccount = false;
        this.deleteAccountError = this.i18n.translateError(err?.error?.message ? err : 'ERR_DELETE_ACCOUNT');
        this.cdr.markForCheck();
      }
    });
  }

  // --------------------------------------------------------------------------
  // ESPACE CONTENU SEO MULTILINGUE
  // --------------------------------------------------------------------------
  toggleSeoSection(): void {
    this.isSeoSectionExpanded = !this.isSeoSectionExpanded;
    this.cdr.markForCheck();
  }

  setSeoLang(lang: 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt'): void {
    this.activeSeoLang = lang;
    this.i18n.setLang(lang);
    this.cdr.markForCheck();
  }

  /**
   * Détecte automatiquement la vue la plus adaptée au terminal :
   * - Smartphone / mobile / écran compact (< 768px ou portrait tactile) -> 'cockpit'
   * - Ordinateur / grand écran / tablette paysage (>= 768px) -> 'canvas'
   */
  detectTerminalViewMode(): 'canvas' | 'cockpit' {
    if (typeof window === 'undefined') return 'canvas';
    const width = window.innerWidth;
    const isMobileBreakpoint = width < 768;
    const isMobileUserAgent = /Android|iPhone|iPod|Mobile|IEMobile/i.test(navigator.userAgent || '');
    const isNarrowPortrait = width < 900 && (window.innerHeight > width);
    if (isMobileBreakpoint || isMobileUserAgent || isNarrowPortrait) {
      return 'cockpit';
    }
    return 'canvas';
  }

  get recommendedViewMode(): 'canvas' | 'cockpit' {
    return this.detectTerminalViewMode();
  }

  get isUserAssociatedWithRace(): boolean {
    if (!this.activeUserId) return false;
    if (this.activePrivateRoom) {
      const isHost = this.activePrivateRoom.race?.hostUserId === this.activeUserId;
      const isPart = Boolean(
        this.activePrivateRoom.race?.participants?.some((p) => p.userId === this.activeUserId) ||
        this.racers.some((r) => r.userId === this.activeUserId)
      );
      return isHost || isPart;
    }
    const inRacers = this.racers.some((r) => r.userId === this.activeUserId);
    const hasActivePart = Boolean(
      this.myActivity &&
      this.myActivity.activityId === this.nextRaceInfo?.race?.id &&
      this.myActivity.status !== 'abandoned'
    );
    return inRacers || hasActivePart;
  }

  get isIdentified(): boolean {
    return Boolean(
      this.isSubscriber ||
      this.isUserAdmin ||
      this.isRegisteredUser
    );
  }

  get isMobileOrTablet(): boolean {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth;
    const isTouch = typeof navigator !== 'undefined' && (((navigator as any).maxTouchPoints && (navigator as any).maxTouchPoints > 0) || 'ontouchstart' in window);
    const hasCoarsePointer = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Silk|Kindle/i.test(navigator.userAgent || '');
    return isMobileUA || width <= 1024 || (Boolean(isTouch) && width <= 1200) || Boolean(hasCoarsePointer);
  }

  get isSmartphone(): boolean {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth;
    const isMobileUA = /Android|iPhone|iPod|Mobile|IEMobile/i.test(navigator.userAgent || '');
    return isMobileUA || width < 768;
  }

  get isMobileFullscreenOnly(): boolean {
    return Boolean(this.siteView !== 'home' && (this.isFullscreen || this.isPseudoFullscreen) && this.isMobileOrTablet);
  }

  get activeFullscreenPinCode(): string {
    const roomPin = this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || '';
    if (roomPin) return String(roomPin);
    if (this.pairingCode) return String(this.pairingCode);
    return '';
  }

  get hasPlayerJoinedWaterLane(): boolean {
    if (this.isPaired || this.isWatchConfirmed) return true;
    if (this.claimedRacerUserId && this.claimedRacerUserId === this.activeUserId) return true;
    if (this.activePrivateRoom?.race?.participants) {
      const p = this.activePrivateRoom.race.participants.find((item: any) =>
        (item.userId && item.userId === this.activeUserId) ||
        (this.currentUser?.login && item.login === this.currentUser.login)
      );
      if (p && (p.connectionState === 'CONNECTED' || p.ready === true || Boolean((p as any).deviceToken))) {
        return true;
      }
    }
    const inRacersActive = this.racers.some(r => r.userId === this.activeUserId && r.status !== 'abandoned' && (r.currentDistance > 0 || (r as any).connected));
    return Boolean(inRacersActive);
  }

  get isRaceOrCountdownActive(): boolean {
    const status = this.nextRaceInfo?.status || this.activePrivateRoom?.race?.status;
    const statusUpper = typeof status === 'string' ? status.toUpperCase() : '';
    return Boolean(
      this.isRaceActive ||
      this.isPreStartCountdown ||
      this.is3sCountdown ||
      status === 'in_progress' ||
      statusUpper === 'RUNNING' ||
      statusUpper === 'COUNTDOWN' ||
      status === 'countdown'
    );
  }

  get shouldShowSmartphonePinOverlay(): boolean {
    if (!this.isSmartphone) return false;
    if (this.siteView !== 'regatta' && this.siteView !== 'cockpit') return false;
    const isAnyFullscreen = Boolean(this.isFullscreen || this.isPseudoFullscreen || this.isMobileFullscreenOnly);
    if (!isAnyFullscreen) return false;
    if (this.isRaceOrCountdownActive) return false;
    if (this.hasPlayerJoinedWaterLane) return false;

    const pin = this.activeFullscreenPinCode;
    if (!pin) {
      if (!this.isGeneratingPairingCode && !this.activePrivateRoom) {
        this.generateGarminPairingCode();
      }
      return false;
    }
    return true;
  }

  get canAccessCockpit(): boolean {
    return true;
  }

  get formattedPairingCountdown(): string {
    const m = Math.floor(this.pairingCountdownSeconds / 60);
    const s = this.pairingCountdownSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  get selectedSpectatorRacerName(): string {
    if (!this.selectedSpectatorUserId) return '';
    const racer = this.racers.find(r => r.userId === this.selectedSpectatorUserId);
    return racer?.userName || racer?.userId || this.selectedSpectatorUserId;
  }

  get focusedTelemetry(): RowerData | null {
    if (this.selectedSpectatorUserId && this.selectedSpectatorUserId !== this.activeUserId) {
      const found = this.racers.find(r => r.userId === this.selectedSpectatorUserId);
      if (found) return found;
    }
    return this.myActivity;
  }

  get isFinished(): boolean {
    return Boolean(
      this.myActivity && (
        this.myActivity.status === 'finished' ||
        (this.myActivity.netDistance || 0) >= this.activeTargetDistance
      )
    );
  }

  get humanRacers(): RowerData[] {
    return this.racers.filter(r => !r.userId?.startsWith('bot_') && !(r as any).isBot);
  }

  /**
   * Indique si le joueur sur la plateforme web doit pouvoir sélectionner manuellement son kayak
   * dans une liste déroulante ou sur le plan d'eau : vrai UNIQUEMENT s'il n'est PAS connecté à un compte,
   * n'a PAS de montre appairée, et qu'il s'agit d'une course publique (la sélection manuelle est STRICTEMENT
   * IMPOSSIBLE dans les salons privés).
   */
  get canManualSelectPublicKayak(): boolean {
    const isConnectedToAccount = this.isRegisteredUser || this.isSubscriber || this.isUserAdmin;
    const hasPairedWatch = this.isPaired || this.isWatchConfirmed;
    const isPrivateRace = Boolean(
      this.activePrivateRoom ||
      this.nextRaceInfo?.race?.type === 'PRIVATE_INVITE' ||
      String(this.nextRaceInfo?.race?.id || '').startsWith('PRIV_')
    );
    return !isConnectedToAccount && !hasPairedWatch && !isPrivateRace;
  }

  public isBotRacer(r: any): boolean {
    if (!r) return false;
    const uid = String(r.userId || '').toLowerCase();
    const name = String(r.name || r.userName || '');
    return Boolean(r.isBot || uid.startsWith('bot_') || /\(bot\)/i.test(name));
  }

  public isPairedRacer(r: any): boolean {
    if (!r) return false;
    return Boolean(r.isPaired || r.deviceToken);
  }

  get claimedRacerUserId(): string {
    const match = this.selectablePublicKayaks.find(k => k.userId === this.activeUserId);
    return match ? match.userId : '';
  }

  set claimedRacerUserId(val: string) {
    if (val) {
      this.onKayakClaimed(val);
    }
  }

  /**
   * Liste de tous les kayaks humains d'une course (pour la résolution automatique de mon kayak)
   */
  private getAllHumanRaceKayaks(): { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number; isBot?: boolean; isPaired?: boolean }[] {
    const map = new Map<string, { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number; isBot?: boolean; isPaired?: boolean }>();

    const lobbyParticipants: any[] = ((this.nextRaceInfo?.race as any)?.participants || (this.nextRaceInfo as any)?.participants || []);
    lobbyParticipants.forEach((p: any, idx: number) => {
      const uid = String(p?.userId || '').trim();
      if (!uid || uid === 'anonymous' || this.isBotRacer(p)) return;
      const displayName = p.userName || p.name || uid;
      const distVal = Math.round(Number(p.netDistance || p.dist || 0));
      const powerVal = Math.round(Number(p.lastPower || p.watts || 0));
      map.set(uid, {
        userId: uid,
        name: displayName,
        userName: displayName,
        lane: Number(p.lane) || (idx + 1),
        dist: distVal,
        netDistance: distVal,
        lastPower: powerVal,
        isBot: false,
        isPaired: this.isPairedRacer(p),
      });
    });

    (this.racers || []).forEach((r: any, idx: number) => {
      const uid = String(r?.userId || '').trim();
      if (!uid || uid === 'anonymous' || this.isBotRacer(r) || r?.status === 'abandoned') return;
      const existing = map.get(uid);
      const displayName = r.userName || r.name || existing?.name || uid;
      const distVal = Math.round(Number(r.netDistance ?? r.dist ?? existing?.dist ?? 0));
      const powerVal = Math.round(Number(r.lastPower ?? r.watts ?? existing?.lastPower ?? 0));
      map.set(uid, {
        userId: uid,
        name: displayName,
        userName: displayName,
        lane: Number(r.lane) || existing?.lane || (idx + 1),
        dist: distVal,
        netDistance: distVal,
        lastPower: powerVal,
        isBot: false,
        isPaired: this.isPairedRacer(r) || Boolean(existing?.isPaired),
      });
    });

    (this.liveMetricsList || []).forEach((m: any, idx: number) => {
      const uid = String(m?.userId || '').trim();
      if (!uid || uid === 'anonymous' || this.isBotRacer(m) || m?.status === 'abandoned') return;
      const existing = map.get(uid);
      const displayName = m.name || m.userName || existing?.name || uid;
      const distVal = Math.round(Number(m.dist ?? m.netDistance ?? existing?.dist ?? 0));
      const powerVal = Math.round(Number(m.watts ?? m.lastPower ?? existing?.lastPower ?? 0));
      map.set(uid, {
        userId: uid,
        name: displayName,
        userName: displayName,
        lane: Number(m.lane) || existing?.lane || (idx + 1),
        dist: distVal,
        netDistance: distVal,
        lastPower: powerVal,
        isBot: false,
        isPaired: this.isPairedRacer(m) || Boolean(existing?.isPaired),
      });
    });

    return Array.from(map.values());
  }

  /**
   * Liste des kayaks humains libres (non appairés, non bots) sélectionnables manuellement en course publique
   */
  get selectablePublicKayaks(): { userId: string; name: string; userName: string; lane: number; dist: number; netDistance: number; lastPower: number }[] {
    if (!this.canManualSelectPublicKayak) {
      return [];
    }
    return this.getAllHumanRaceKayaks().filter(k => !this.isPairedRacer(k));
  }

  onSelectPublicKayak(userId: string): void {
    if (!userId) return;
    this.onKayakClaimed(userId);
  }

  /**
   * Fait automatiquement le lien entre la montre appairée, le compte utilisateur et le kayak
   * présent dans la course publique lorsque le joueur est connecté à un compte ou a une montre appairée.
   */
  private autoResolveMyPublicKayak(): void {
    const isConnectedToAccount = this.isRegisteredUser || this.isSubscriber || this.isUserAdmin;
    const hasPairedWatch = this.isPaired || this.isWatchConfirmed;
    const isSoloOrBotRoom = Boolean(
      this.activePrivateRoom &&
      ((this.activePrivateRoom as any).isSolo || (this.activePrivateRoom as any).isBotDuel || (this.activePrivateRoom.race as any)?.isSolo || this.activePrivateRoom.race?.isBotDuel)
    );
    if (!isConnectedToAccount && !hasPairedWatch && !isSoloOrBotRoom) return;

    const candidateIds = new Set<string>();
    const pushCandidate = (val?: string) => {
      const clean = String(val || '').trim();
      if (clean && clean !== 'anonymous' && !clean.startsWith('Racer_')) {
        candidateIds.add(clean.toLowerCase());
      }
    };

    pushCandidate(this.activeUserId);
    pushCandidate(this.currentUser?.id);
    pushCandidate(this.currentUser?.login);
    pushCandidate(this.currentUser?.watchUserId);
    pushCandidate(this.currentUser?.name);

    const kayaks = this.getAllHumanRaceKayaks();
    let matched = candidateIds.size > 0
      ? kayaks.find(
          (k) =>
            candidateIds.has(k.userId.toLowerCase()) ||
            (k.name && candidateIds.has(k.name.toLowerCase()))
        )
      : undefined;

    if (!matched && isSoloOrBotRoom && kayaks.length === 1) {
      matched = kayaks[0];
    }

    if (matched) {
      if (this.activeUserId !== matched.userId) {
        this.activeUserId = matched.userId;
        this.userIdInput = matched.userId;
        try {
          localStorage.setItem('rower_user_id', matched.userId);
        } catch {}
      }
      if (matched.lane && matched.lane > 0) {
        this.myAssignedLane = matched.lane;
      }
      this.selectedCockpitPlayerId = matched.userId;
    }
  }

  get topThreeLiveRacers(): { rank: number; name: string; dist: number }[] {
    const list = [...((this.racers && this.racers.length > 0)
      ? this.racers.filter(r => r.status !== 'abandoned')
      : (this.liveMetricsList || []).filter(r => r.status !== 'abandoned'))];
    list.sort((a: any, b: any) => {
      const isFinA = a.status === 'finished' ? 1 : 0;
      const isFinB = b.status === 'finished' ? 1 : 0;
      if (isFinA !== isFinB) return isFinB - isFinA;
      const distA = Number(a.netDistance != null ? a.netDistance : (a.dist != null ? a.dist : 0));
      const distB = Number(b.netDistance != null ? b.netDistance : (b.dist != null ? b.dist : 0));
      return distB - distA;
    });
    return list.slice(0, 3).map((r, i) => {
      const racerObj = r as any;
      const rawName = racerObj.userName || racerObj.name || racerObj.userId || `Rameur ${i + 1}`;
      const rawDist = Math.round(Number(racerObj.netDistance != null ? racerObj.netDistance : (racerObj.dist != null ? racerObj.dist : 0)));
      return {
        rank: i + 1,
        name: rawName,
        dist: rawDist
      };
    });
  }

  get fullPlayerId(): string {
    return this.currentUser?.login || this.currentUser?.name || this.activeUserId;
  }

  onSpectatorSelect(userId: string): void {
    this.selectedSpectatorUserId = userId;
    this.selectedCockpitPlayerId = userId;
    this.cdr.markForCheck();
  }

  onKayakClaimed(userId: string): void {
    if (!userId || !this.canManualSelectPublicKayak) return;
    const isEligible = this.selectablePublicKayaks.some(k => k.userId === userId);
    if (!isEligible) return;
    this.activeUserId = userId;
    this.userIdInput = userId;
    this.selectedSpectatorUserId = '';
    this.selectedCockpitPlayerId = userId;
    try {
      localStorage.setItem('rower_user_id', userId);
    } catch {}

    const racer = (this.liveMetricsList.find(r => r.userId === userId) || this.racers.find(r => r.userId === userId)) as any;
    if (racer) {
      this.myAssignedLane = racer.lane || null;
      const racerName = racer.name || racer.userName;
      if (racerName) {
        this.currentUser.name = racerName;
        this.userLoginInput = racerName;
        try {
          localStorage.setItem('rower_user_login', racerName);
        } catch {}
      }
      this.myActivity = {
        id: racer.id || `${this.nextRaceInfo?.race?.id || 'race'}_${userId}`,
        activityId: this.nextRaceInfo?.race?.id || '',
        userId: userId,
        userName: racerName || userId,
        netDistance: racer.dist ?? racer.netDistance ?? 0,
        currentDistance: racer.dist ?? racer.currentDistance ?? 0,
        lastPower: racer.watts ?? racer.lastPower ?? 0,
        lastStrokeRate: racer.spm ?? racer.lastStrokeRate ?? 0,
        lastPace: racer.split ?? racer.lastPace ?? 0,
        avgPower: racer.watts ?? racer.avgPower ?? 0,
        avgPace: racer.split ?? racer.avgPace ?? 0,
        avgStrokeRate: racer.spm ?? racer.avgStrokeRate ?? 0,
        status: racer.status || 'in_progress',
        elapsedTime: 0
      } as any;
    }
    this.cdr.markForCheck();
  }

  onSelectCockpitPlayer(userId: string): void {
    this.onSpectatorSelect(userId);
  }

  // Immersion Mode (Mode Cockpit & Régate)
  get isImmersionActive(): boolean {
    return (this.siteView === 'regatta' || this.siteView === 'cockpit') && (this.isFullscreen || this.isPseudoFullscreen || this.isRaceActive);
  }

  startImmersionAutoFade(): void {
    if (!this.isImmersionActive) {
      this.isImmersionControlsVisible = true;
      return;
    }
    if (this.immersionInactivityTimer) {
      clearTimeout(this.immersionInactivityTimer);
    }
    this.immersionInactivityTimer = setTimeout(() => {
      if (this.isImmersionActive) {
        this.isImmersionControlsVisible = false;
        this.cdr.markForCheck();
      }
    }, 1200);
  }

  revealImmersionControls(): void {
    this.isImmersionControlsVisible = true;
    this.cdr.markForCheck();
    if (this.immersionInactivityTimer) {
      clearTimeout(this.immersionInactivityTimer);
    }
    // S'estompe à nouveau après 4 secondes d'inactivité
    this.immersionInactivityTimer = setTimeout(() => {
      if (this.isImmersionActive) {
        this.isImmersionControlsVisible = false;
        this.cdr.markForCheck();
      }
    }, 4000);
  }

  onImmersionPointerDown(event: any): void {
    if (!this.isImmersionActive) return;
    const pt = event.touches ? event.touches[0] : event;
    if (!pt) return;
    this.immersionTouchStart = { x: pt.clientX, y: pt.clientY };
    this.immersionTouchActive = true;
    if (this.immersionHoldTimer) clearTimeout(this.immersionHoldTimer);
    // Appui prolongé (~800ms) n'importe où sur l'écran tactile
    this.immersionHoldTimer = setTimeout(() => {
      if (this.immersionTouchActive) {
        this.revealImmersionControls();
      }
    }, 800);
  }

  onImmersionPointerMove(event: any): void {
    if (!this.immersionTouchActive) return;
    const pt = event.touches ? event.touches[0] : event;
    if (!pt) return;
    const dx = Math.abs(pt.clientX - this.immersionTouchStart.x);
    const dy = Math.abs(pt.clientY - this.immersionTouchStart.y);
    if (dx > 12 || dy > 12) {
      this.immersionTouchActive = false;
      if (this.immersionHoldTimer) clearTimeout(this.immersionHoldTimer);
    }
  }

  onImmersionPointerUp(): void {
    this.immersionTouchActive = false;
    if (this.immersionHoldTimer) {
      clearTimeout(this.immersionHoldTimer);
      this.immersionHoldTimer = null;
    }
    if (this.isImmersionActive && this.isImmersionControlsVisible) {
      if (this.immersionInactivityTimer) clearTimeout(this.immersionInactivityTimer);
      this.immersionInactivityTimer = setTimeout(() => {
        if (this.isImmersionActive) {
          this.isImmersionControlsVisible = false;
          this.cdr.markForCheck();
        }
      }, 4000);
    }
  }

  // Résolution stricte de l'identité joueur : modification du pseudo invité uniquement pour utilisateur non connecté
  editGuestPseudo(): void {
    if (this.isIdentified) return;
    const current = this.currentUser.name || '';
    const chosen = typeof window !== 'undefined' ? window.prompt("Choisissez votre pseudo invité temporaire :", current) : null;
    if (chosen !== null) {
      const clean = chosen.trim().slice(0, 32);
      if (clean) {
        this.currentUser.name = clean;
        this.userLoginInput = clean;
        try {
          localStorage.setItem('rower_user_login', clean);
        } catch {}
        this.cdr.markForCheck();
      }
    }
  }

  // Vue Historique : Consultation des classements passés
  openCurrentRaceLeaderboard(): void {
    const targetRaceId = this.completedPublicRaceId || this.selectedRaceInfo?.id || this.nextRaceInfo?.race?.id;
    if (targetRaceId) {
      this.openRaceLeaderboard(targetRaceId);
    }
  }

  openRaceLeaderboard(raceId: string): void {
    if (!raceId) return;
    this.isRaceLeaderboardModalOpen = true;
    this.raceLeaderboardError = '';
    if (!this.selectedRaceInfo || this.selectedRaceInfo.id !== raceId) {
      this.isLoadingRaceLeaderboard = true;
      this.selectedRaceLeaderboard = [];
      this.selectedRaceInfo = null;
    }
    this.cdr.markForCheck();

    this.rowerService.getRaceLeaderboard(raceId).subscribe({
      next: (res) => {
        this.isLoadingRaceLeaderboard = false;
        if (res && res.success) {
          this.selectedRaceInfo = res.race;
          this.selectedRaceLeaderboard = res.leaderboard || [];
          const myEntry = this.selectedRaceLeaderboard.find(e => e.userId === this.activeUserId);
          if (myEntry) {
            this.myRank = myEntry.position;
          }
        } else {
          this.raceLeaderboardError = this.i18n.translateError('ERR_LEADERBOARD_LOAD');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingRaceLeaderboard = false;
        this.raceLeaderboardError = this.i18n.translateError(err?.error?.message ? err : 'ERR_LEADERBOARD_LOAD');
        this.cdr.markForCheck();
      }
    });
  }

  closeRaceLeaderboardModal(): void {
    const closedRaceId = this.selectedRaceInfo?.id || this.completedPublicRaceId || this.nextRaceInfo?.race?.id || this.activePrivateRoom?.race?.id;
    if (closedRaceId) {
      this.dismissedLeaderboardRaceIds.add(closedRaceId);
    }
    this.isRaceLeaderboardModalOpen = false;
    if (this.finishCelebrationTimer) {
      clearTimeout(this.finishCelebrationTimer);
      this.finishCelebrationTimer = null;
    }
    if (!this.isPostRaceDisplayActive) {
      this.isPostRaceRankingActive = false;
      this.showFinishCelebration = false;
      this.selectedRaceLeaderboard = [];
      this.selectedRaceInfo = null;
    }
    if (!this.activePrivateRoom) {
      this.isPrivateRoomCompleted = false;
    }
    this.cdr.markForCheck();
  }

  // Système de Ligues
  getLeagueBadge(points?: number): string {
    return getLeagueByPoints(points || 0).badge;
  }

  getLeagueName(points?: number): string {
    return getLeagueByPoints(points || 0).name;
  }

  get currentUserLeague(): LeagueInfo {
    if (this.currentUser?.currentLeague) {
      return getLeagueByTier(this.currentUser.currentLeague);
    }
    return getLeagueByPoints(this.currentUser?.points || 0);
  }

  get lastRaceSummary(): UserLastRaceSummary {
    if (this.userHistory && this.userHistory.length > 0) {
      // Filtrer pour retenir uniquement les courses terminées avec succès (status === 'finished')
      const finishedRaces = this.userHistory.filter(
        (h) => h && (String(h.status || '').toLowerCase() === 'finished' || String(h.status || '').toLowerCase() === 'completed')
      );

      if (finishedRaces.length > 0) {
        // Trier par date décroissante pour obtenir la dernière course terminée
        finishedRaces.sort((a, b) => {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });

        const last = finishedRaces[0];
        const r = Number(last.finalRank || this.currentUser?.lastRank || 0);
        const rankDisplay = r === 1 ? '🥇 1ᵉʳ' : r === 2 ? '🥈 2ᵉ' : r === 3 ? '🥉 3ᵉ' : r > 0 ? `#${r}` : 'Terminée';
        const dist = Number(last.targetDistance || last.netDistance || 0);
        const time = last.elapsedTime ? this.formatTime(last.elapsedTime) : '';

        let dateFormatted = '';
        if (last.createdAt) {
          try {
            const d = new Date(last.createdAt);
            if (!isNaN(d.getTime())) {
              const day = String(d.getDate()).padStart(2, '0');
              const month = String(d.getMonth() + 1).padStart(2, '0');
              const year = d.getFullYear();
              dateFormatted = `${day}/${month}/${year}`;
            }
          } catch {}
        }

        return {
          hasRaced: true,
          rank: r,
          rankDisplay,
          distance: dist > 0 ? dist : undefined,
          timeFormatted: time || undefined,
          date: last.createdAt,
          dateFormatted: dateFormatted || undefined,
        };
      }
    }

    return { hasRaced: false };
  }

  scrollToNextRace(): void {
    if (typeof document !== 'undefined') {
      const el = document.querySelector('.hero-schedule-cluster') || document.querySelector('.regatta-card-timer') || document.querySelector('.home-action-tunnel');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  openSubscriptionModal(): void {
    this.isSubscriptionModalOpen = true;
    this.subscriptionError = '';
    this.subscriptionSuccessMessage = '';
    this.rowerService.getSubscriptionTiers().subscribe({
      next: (res) => {
        if (res.success) {
          this.subscriptionTiers = res.tiers;
          this.pioneerMode = res.pioneerMode !== false;
        }
        this.cdr.markForCheck();
      }
    });
    if (this.activeUserId) {
      this.rowerService.getUserSubscriptionStatus(this.activeUserId).subscribe({
        next: (status) => {
          this.subscriptionStatus = status;
          this.cdr.markForCheck();
        }
      });
    }
  }

  closeSubscriptionModal(): void {
    this.isSubscriptionModalOpen = false;
    this.cdr.markForCheck();
  }

  isTierActive(tierId: string): boolean {
    if (this.pioneerMode) return true;
    const clean = String(tierId || '').toLowerCase().trim();
    const tier = (this.subscriptionTiers || []).find((t: any) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code === clean ||
        (clean === 'competitor' && (code === 'intermediate' || code === 'standard' || code === 'club')) ||
        (clean === 'club_elite' && (code === 'premium' || code === 'pro' || code === 'elite_pro')) ||
        (clean === 'intermediate' && code === 'standard') ||
        (clean === 'premium' && code === 'elite_pro');
    });
    if (!tier) return true;
    return tier.isActive !== false;
  }

  subscribeToTier(tierId: string): void {
    if (!this.activeUserId) {
      this.subscriptionError = this.i18n.translateError('ERR_SUB_LOGIN_REQUIRED');
      this.cdr.markForCheck();
      return;
    }

    const cleanTier = String(tierId || '').toLowerCase().trim();
    const normalizedTier = (cleanTier === 'intermediate' || cleanTier === 'standard' || cleanTier === 'club')
      ? 'competitor'
      : (cleanTier === 'premium' || cleanTier === 'pro' || cleanTier === 'elite_pro')
      ? 'club_elite'
      : cleanTier;

    if (!this.isTierActive(normalizedTier)) {
      this.subscriptionError = this.i18n.translateError('ERR_SUB_DISABLED');
      this.cdr.markForCheck();
      return;
    }

    this.subscriptionLoading = true;
    this.subscriptionError = '';

    // En mode Pionnier : activation gratuite instantanée sans Stripe
    if (this.pioneerMode && normalizedTier !== 'free') {
      this.rowerService.activatePioneerPlan(this.activeUserId, normalizedTier).subscribe({
        next: (res) => {
          this.subscriptionLoading = false;
          if (res.success) {
            this.subscriptionSuccessMessage = res.message || 'Accès Pionnier activé avec succès !';
            this.currentUser.isSubscriber = true;
            this.currentUser.subscriptionTier = res.tier || normalizedTier;
            if (this.subscriptionStatus) {
              this.subscriptionStatus.tier = res.tier || normalizedTier;
              this.subscriptionStatus.isSubscriber = true;
              this.subscriptionStatus.isPioneer = true;
              this.subscriptionStatus.limits = res.limits;
            }
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('rower_subscription_tier', res.tier || normalizedTier);
              localStorage.setItem('rower_is_subscriber', 'true');
            }
            this.cdr.markForCheck();
          }
        },
        error: (err) => {
          this.subscriptionLoading = false;
          this.subscriptionError = this.i18n.translateError(err.error?.message ? err : 'ERR_SUB_CHECKOUT');
          this.cdr.markForCheck();
        }
      });
      return;
    }

    // Hors mode Pionnier ou retour au plan gratuit : checkout standard
    this.rowerService.createSubscriptionCheckout(this.activeUserId, normalizedTier).subscribe({
      next: (res) => {
        this.subscriptionLoading = false;
        if (res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
        } else if (res.success) {
          this.subscriptionSuccessMessage = res.message || 'Abonnement activé avec succès !';
          this.currentUser.isSubscriber = normalizedTier !== 'free';
          this.currentUser.subscriptionTier = normalizedTier;
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.subscriptionLoading = false;
        this.subscriptionError = this.i18n.translateError(err.error?.message ? err : 'ERR_SUB_CHECKOUT');
        this.cdr.markForCheck();
      }
    });
  }

  openUnifiedConfigModal(): void {
    this.isUnifiedConfigOpen = true;
    this.adminConfigMessage = '';
    this.adminConfigError = '';
    if (this.isUserAdmin) {
      this.unifiedConfigActiveTab = 'public';
      this.rowerService.getPublicRaceAdminConfig().subscribe({
        next: (res) => {
          if (res.success && res.config) {
            this.adminConfig = { ...res.config };
          }
          this.cdr.markForCheck();
        }
      });
    }
    this.cdr.markForCheck();
  }

  closeUnifiedConfigModal(): void {
    this.isUnifiedConfigOpen = false;
    this.cdr.markForCheck();
  }

  openAdminConfigModal(): void {
    this.openUnifiedConfigModal();
  }

  closeAdminConfigModal(): void {
    this.closeUnifiedConfigModal();
  }

  saveAdminConfig(): void {
    this.isAdminConfigSubmitting = true;
    this.adminConfigMessage = '';
    this.adminConfigError = '';
    this.rowerService.updatePublicRaceAdminConfig({
      userId: this.activeUserId,
      ...this.adminConfig
    }).subscribe({
      next: (res) => {
        this.isAdminConfigSubmitting = false;
        if (res.success) {
          this.adminConfigMessage = '✓ Configuration publique enregistrée avec succès !';
          this.adminConfig = res.config;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAdminConfigSubmitting = false;
        this.adminConfigError = this.i18n.translateError(err.error?.message ? err : 'ERR_ADMIN_SAVE');
        this.cdr.markForCheck();
      }
    });
  }

  get myPodiumMedal(): { icon: string; label: string; class: string } | null {
    if (!this.myRank || this.myRank > 3) return null;
    if (this.myRank === 1) return { icon: '🥇', label: "Médaille d'Or", class: 'gold' };
    if (this.myRank === 2) return { icon: '🥈', label: "Médaille d'Argent", class: 'silver' };
    if (this.myRank === 3) return { icon: '🥉', label: "Médaille de Bronze", class: 'bronze' };
    return null;
  }

  // =========================================================================
  // NOUVEAU PROTOCOLE D'APPAIRAGE GARMIN SÉCURISÉ (Code Web -> Montre)
  // =========================================================================

  generateGarminPairingCode(): void {
    this.isGeneratingPairingCode = true;
    this.pairingErrorMessage = '';
    this.pairingSuccessMessage = '';
    const targetUserId = this.currentUser?.login || this.currentUser?.id || this.activeUserId || this.guestSessionId;
    const targetPlayerName = this.currentUser?.login || this.currentUser?.name || targetUserId;

    this.rowerService.requestGarminPairingCode(targetUserId, targetPlayerName).subscribe({
      next: (res) => {
        this.isGeneratingPairingCode = false;
        if (res && res.success && res.pairingCode) {
          this.pairingCode = res.pairingCode;
          this.pairingCountdownSeconds = res.expiresInSeconds || 300;
          this.startPairingCountdown();
          this.startPairingStatusPolling(res.pairingCode);
        } else {
          this.pairingErrorMessage = this.i18n.translateError('ERR_PAIRING_GEN');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isGeneratingPairingCode = false;
        this.pairingErrorMessage = this.i18n.translateError(err?.error?.message ? err : 'ERR_PAIRING_SERVER');
        this.cdr.markForCheck();
      }
    });
  }

  private startPairingCountdown(): void {
    if (this.pairingTimerSub) {
      this.pairingTimerSub.unsubscribe();
    }
    this.pairingTimerSub = interval(1000).subscribe(() => {
      if (this.pairingCountdownSeconds > 0) {
        this.pairingCountdownSeconds--;
        this.cdr.markForCheck();
      } else {
        if (this.pairingTimerSub) {
          this.pairingTimerSub.unsubscribe();
          this.pairingTimerSub = undefined;
        }
        if (this.pairingStatusPollSub) {
          this.pairingStatusPollSub.unsubscribe();
          this.pairingStatusPollSub = undefined;
        }
        this.pairingCode = '';
        this.pairingErrorMessage = this.i18n.translateError('ERR_PAIRING_EXPIRED');
        this.cdr.markForCheck();
      }
    });
  }

  private startPairingStatusPolling(code: string): void {
    if (this.pairingStatusPollSub) {
      this.pairingStatusPollSub.unsubscribe();
    }
    this.pairingStatusPollSub = interval(2000).pipe(
      switchMap(() => this.rowerService.getGarminPairingStatus({ pairingCode: code }))
    ).subscribe({
      next: (res) => {
        if (res && (res.status === 'paired' || res.paired) && res.deviceToken) {
          this.onWatchPairedSuccess(res.deviceToken, res.userId);
        } else if (res && res.status === 'expired') {
          this.pairingCode = '';
          this.pairingErrorMessage = this.i18n.translateError('ERR_PAIRING_EXPIRED');
          if (this.pairingStatusPollSub) {
            this.pairingStatusPollSub.unsubscribe();
            this.pairingStatusPollSub = undefined;
          }
          this.cdr.markForCheck();
        }
      },
      error: () => {}
    });
  }

  onWatchPairedSuccess(deviceToken: string, userId?: string): void {
    if (this.pairingTimerSub) {
      this.pairingTimerSub.unsubscribe();
      this.pairingTimerSub = undefined;
    }
    if (this.pairingStatusPollSub) {
      this.pairingStatusPollSub.unsubscribe();
      this.pairingStatusPollSub = undefined;
    }
    this.pairingCode = '';
    this.isPaired = true;
    this.isWatchConfirmed = true;
    this.isWatchGuidanceModalOpen = false;
    this.deviceToken = deviceToken;
    this.pairingSuccessMessage = '✓ Montre Garmin connectée avec succès !';
    this.pairingErrorMessage = '';

    if (userId) {
      this.activeUserId = userId;
      this.currentUser.id = userId;
      this.claimedRacerUserId = userId;
    }

    try {
      localStorage.setItem('rower_is_paired', 'true');
      localStorage.setItem('rower_watch_confirmed', 'true');
      localStorage.setItem('rower_device_token', deviceToken);
      if (userId) {
        localStorage.setItem('rower_user_id', userId);
        localStorage.setItem('rower_claimed_kayak_id', userId);
      }
    } catch {}

    this.autoResolveMyPublicKayak();
    this.loadUserProfile();

    if (!this.activePrivateRoom) {
      this.rowerService.getMyActiveRace(this.activeUserId, deviceToken).pipe(
        catchError(() => of({ activeRoom: null }))
      ).subscribe((res) => {
        const active = res?.activeRoom;
        if (
          active &&
          active.race?.id &&
          active.status !== 'STOPPED' &&
          active.status !== 'CANCELLED' &&
          active.status !== 'ABANDONED' &&
          active.race?.status !== 'CANCELLED' &&
          active.race?.status !== 'ABANDONED'
        ) {
          const isCompleted =
            active.race?.status === 'COMPLETED' ||
            active.status === 'COMPLETED' ||
            active.status === 'finished';
          if (isCompleted) {
            this.isPrivateRoomCompleted = true;
            this.isPostRaceRankingActive = true;
          }
          if (active.lane) {
            this.myAssignedLane = active.lane;
          }
          const wasAwaitingWatchPin = this.isAwaitingWatchPin;
          this.isAwaitingWatchPin = Boolean(active.isAwaitingWatchPin);
          if (this.isAwaitingWatchPin && !wasAwaitingWatchPin) {
            this.playDiscreteNotificationChime();
          }
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('rower_active_private_room_id', active.race.id);
              if (active.code || active.race?.code) {
                localStorage.setItem('rower_active_private_room_code', (active.code || active.race?.code || ''));
              }
            }
          } catch {}
          this.activatePrivateRoom(active, false);
          this.setSiteView('regatta');
          if (isCompleted && active.race?.id) {
            this.openRaceLeaderboard(active.race.id);
          }
          this.cdr.markForCheck();
        }
      });
    }

    this.cdr.markForCheck();
  }

  public installKayakOnWaterLane(laneNumber: number, userId?: string, playerName?: string, roomId?: string): void {
    const assigned = Number(laneNumber) || this.myAssignedLane || 1;
    this.myAssignedLane = assigned;

    const targetUserId = userId || this.activeUserId || this.currentUser?.id || this.guestSessionId;
    if (targetUserId) {
      this.activeUserId = targetUserId;
      this.claimedRacerUserId = targetUserId;
    }

    const displayName = playerName || this.currentUser?.name || targetUserId || `Kayakiste L${assigned}`;
    if (displayName) {
      this.currentUser.name = displayName;
      this.userLoginInput = displayName;
    }

    const racerKayak = this.committedKayakCustomization || this.currentKayakCustomization;
    const isRaceActive = Boolean(this.isRaceActive || this.activePrivateRoom?.race?.status === 'RUNNING');

    // Mettre à jour ou insérer dans liveMetricsList pour affichage immédiat sur le plan d'eau
    const existingIndex = this.liveMetricsList.findIndex(m => m.userId === targetUserId || m.lane === assigned);
    const metricEntry: LiveRacerMetric = {
      lane: assigned,
      userId: targetUserId,
      name: displayName,
      dist: 0,
      split: 120,
      watts: 0,
      spm: 0,
      heartRate: undefined,
      status: isRaceActive ? 'in_progress' : 'waiting',
      ready: true,
      pinValidated: true,
      connectionState: 'READY',
      isBot: false,
      isPaired: true,
      kayak: racerKayak
    };

    if (existingIndex >= 0) {
      this.liveMetricsList[existingIndex] = {
        ...this.liveMetricsList[existingIndex],
        ...metricEntry
      };
      this.liveMetricsList = [...this.liveMetricsList];
    } else {
      this.liveMetricsList = [...this.liveMetricsList, metricEntry];
    }

    // Persistance du salon par défaut
    if (roomId) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('rower_active_private_room_id', roomId);
          const roomCode = this.activePrivateRoom?.code || this.activePrivateRoom?.race?.code;
          if (roomCode) {
            localStorage.setItem('rower_active_private_room_code', roomCode);
          }
        }
      } catch {}
    }

    // Basculer immédiatement sur la vue régate et fermer les overlays
    this.isAwaitingWatchPin = false;
    this.isPrivateModalOpen = false;
    this.isPrivateRoomPreview = false;
    this.setSiteView('regatta');

    // Toast de confirmation avec numéro de ligne attribuée
    this.triggerFinishToast(`Kayak installé sur la ligne ${assigned} — Prêt pour le départ !`);

    this.cdr.markForCheck();
  }

  playDiscreteNotificationChime(): void {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.2);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.45);

      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 600);
    } catch {}
  }

  resetGarminPairing(): void {
    const tokenToRevoke = this.deviceToken;
    const userToRevoke = this.activeUserId || this.guestSessionId;

    if (tokenToRevoke) {
      this.rowerService.resetGarminPairing(tokenToRevoke, userToRevoke).subscribe({
        next: () => {},
        error: () => {}
      });
    }

    this.isPaired = false;
    this.isWatchConfirmed = false;
    this.deviceToken = '';
    this.pairingCode = '';
    this.pairingSuccessMessage = '';
    this.pairingErrorMessage = '';

    if (this.pairingTimerSub) {
      this.pairingTimerSub.unsubscribe();
      this.pairingTimerSub = undefined;
    }
    if (this.pairingStatusPollSub) {
      this.pairingStatusPollSub.unsubscribe();
      this.pairingStatusPollSub = undefined;
    }

    try {
      localStorage.removeItem('rower_is_paired');
      localStorage.removeItem('rower_watch_confirmed');
      localStorage.removeItem('rower_device_token');
      localStorage.removeItem('rower_saved_private_salons');
      localStorage.removeItem('rower_saved_private_salons_guest');
    } catch {}

    this.cdr.markForCheck();
  }

  clearPairing(): void {
    this.resetGarminPairing();
  }

  disconnectWatch(): void {
    this.resetGarminPairing();
    this.activeViewMode = 'canvas';
    this.cdr.markForCheck();
  }

  openStandingsModal(): void {
    this.closeAllOverlayModals();
    this.isStandingsOpen = true;
    this.loadGeneralLeaderboard();
    this.loadDuelLeaderboard();
    this.cdr.markForCheck();
  }

  openHistoryModal(): void {
    this.closeAllOverlayModals();
    this.isHistoryOpen = true;
    this.loadPastRaces();
    this.cdr.markForCheck();
  }

  switchViewMode(mode: 'canvas' | 'cockpit'): void {
    this.closeAllOverlayModals();
    this.userOverrodeViewMode = true;
    this.activeViewMode = mode;
    this.siteView = mode === 'canvas' ? 'regatta' : 'cockpit';
    this.userExplicitlyNavigatedHome = false;
    if (this.isMobileOrTablet && !this.checkIsFullscreen()) {
      this.enterFullscreen().catch(() => {});
    }
    this.cdr.markForCheck();
  }

  async enterFullscreen(): Promise<void> {
    if (typeof document === 'undefined') return;
    if (this.checkIsFullscreen()) return;
    const docEl = document.documentElement as any;
    const hasNativeFullscreen = Boolean(
      docEl?.requestFullscreen ||
      docEl?.webkitRequestFullscreen ||
      docEl?.mozRequestFullScreen ||
      docEl?.msRequestFullscreen
    );

    try {
      if (hasNativeFullscreen) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen();
        }
        this.isPseudoFullscreen = false;
      } else {
        this.isPseudoFullscreen = true;
        if (typeof window !== 'undefined') {
          try { window.scrollTo(0, 1); } catch {}
        }
      }
    } catch {
      this.isPseudoFullscreen = true;
    } finally {
      this.syncPseudoFullscreenClass();
      this.isFullscreen = this.checkIsFullscreen();
      if (this.isMobileFullscreenOnly && !this.userOverrodeViewMode) {
        this.activeViewMode = 'cockpit';
      }
      if (this.siteView === 'regatta' || this.siteView === 'cockpit') {
        this.startImmersionAutoFade();
      }
      if (this.siteView === 'regatta') {
        this.lockLandscape().catch(() => {});
      }
      this.enableScreenWakeLock();
      this.triggerMultiStageLayoutResync();
    }
  }

  async exitFullscreen(): Promise<void> {
    if (typeof document === 'undefined') return;
    const doc = document as any;
    try {
      if (this.checkNativeFullscreen()) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
      this.isPseudoFullscreen = false;
    } catch {
      this.isPseudoFullscreen = false;
    } finally {
      this.syncPseudoFullscreenClass();
      this.isFullscreen = this.checkIsFullscreen();
      this.isImmersionControlsVisible = true;
      this.triggerMultiStageLayoutResync();
    }
  }

  async toggleFullscreen(): Promise<void> {
    if (this.checkIsFullscreen()) {
      await this.exitFullscreen();
    } else {
      await this.enterFullscreen();
    }
  }

  /**
   * Tente de verrouiller l'orientation de l'écran en mode paysage (landscape).
   * Pris en charge sur les navigateurs mobiles compatibles (Android Chrome / Chromium).
   * Sur iOS Safari et les plateformes non supportées, l'erreur est absorbée silencieusement.
   */
  async lockLandscape(): Promise<void> {
    if (typeof screen === 'undefined') return;
    const orientation: any = (screen as any).orientation;
    if (orientation && typeof orientation.lock === 'function') {
      try {
        await orientation.lock('landscape');
      } catch {
        // Ignorer silencieusement si non supporté ou bloqué par le navigateur
      }
    }
    this.triggerMultiStageLayoutResync();
  }

  /**
   * Action déclenchée par le geste utilisateur sur l'écran d'accueil de la régate :
   * passe en mode régate, bascule en plein écran, verrouille le mode paysage et active le maintien d'écran éveillé.
   */
  async launchRegattaFromSplash(): Promise<void> {
    this.isRegattaLaunchSplashOpen = false;
    this.setSiteView('regatta');
    await this.enterFullscreen();
    await this.lockLandscape();
    await this.enableScreenWakeLock();
    this.cdr.markForCheck();
  }

  dismissRegattaLaunchSplash(): void {
    this.isRegattaLaunchSplashOpen = false;
    this.setSiteView('regatta');
    this.cdr.markForCheck();
  }

  onSetInvitationStep(step: 'choice' | 'guest-pairing' | 'login' | 'register'): void {
    this.invitationStep = step;
    this.invitationAuthError = '';
    this.cdr.markForCheck();
  }

  onQuickLoginSubmit(data: { emailOrLogin: string; password: string }): void {
    this.isInvitationSubmitting = true;
    this.invitationAuthError = '';
    this.loginAccountInput = data.emailOrLogin;
    this.passwordAccountInput = data.password;

    const existingGuestToken = (this.deviceToken || this.pairingCode) ? String(this.deviceToken || this.pairingCode) : undefined;
    this.rowerService.loginUser({
      login: data.emailOrLogin.trim(),
      password: data.password.trim(),
      deviceToken: existingGuestToken || undefined,
      guestPairingToken: existingGuestToken || undefined,
      guestUserId: this.activeUserId || undefined,
    }).subscribe({
      next: (res) => {
        this.isInvitationSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          const isAdminUser = Boolean(res.isAdmin || res.role === 'ADMIN' || res.user.isAdmin || res.user.role === 'ADMIN');
          const resolvedRole = res.role || res.user.role || (isAdminUser ? 'ADMIN' : 'USER');
          const resolvedTier = String(res.subscriptionTier || res.user.subscriptionTier || (isAdminUser ? 'premium' : 'free')).toLowerCase();
          const isSub = Boolean(isAdminUser || (resolvedTier !== 'free' && (res.isSubscriber || res.user.isSubscriber)));

          this.activeUserId = userLogin;
          this.userIdInput = res.user.watchUserId || userLogin;
          this.currentUser = {
            ...res.user,
            name: userLogin,
            isAdmin: isAdminUser,
            role: resolvedRole,
            subscriptionTier: resolvedTier,
            isSubscriber: isSub,
          };
          this.userLoginInput = userLogin;
          this.syncKayakCustomizationFromUser(res.user);
          this.syncRegattaPreferencesFromUser(res.user);
          this.syncDuelPreferencesFromUser(res.user);
          this.applyUserLanguagePreference(res.user.language);

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', userLogin);
            localStorage.setItem('rower_is_subscriber', String(isSub));
            localStorage.setItem('rower_is_admin', String(isAdminUser));
            localStorage.setItem('rower_user_role', resolvedRole);
            localStorage.setItem('rower_subscription_tier', resolvedTier);
            if (res.token) {
              localStorage.setItem('rower_auth_token', res.token);
            }
          } catch {}

          if (res.isGarminPaired || res.user.isGarminPaired) {
            this.isPaired = true;
            this.isWatchConfirmed = true;
          }

          this.pendingPrivateSalonsCount = 0;
          this.pendingDuelsCount = 0;
          this.refreshPendingPrivateAndDuels();
          this.launchRegattaFromSplash();
        } else {
          this.invitationAuthError = this.i18n.translateError(res.message || 'ERR_INVALID_CREDENTIALS');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isInvitationSubmitting = false;
        this.invitationAuthError = this.i18n.translateError(err?.error?.message || err?.error?.error || 'ERR_INVALID_CREDENTIALS');
        this.cdr.markForCheck();
      }
    });
  }

  onQuickRegisterSubmit(data: { login: string; email: string; password: string }): void {
    this.isInvitationSubmitting = true;
    this.invitationAuthError = '';
    const existingGuestToken = (this.deviceToken || this.pairingCode) ? String(this.deviceToken || this.pairingCode) : undefined;

    this.rowerService.registerUser({
      nom: data.login.trim(),
      prenom: data.login.trim(),
      anneeNaissance: 1995,
      sexe: 'M',
      pays: 'France',
      login: data.login.trim(),
      email: data.email.trim(),
      password: data.password.trim(),
      deviceToken: existingGuestToken || undefined,
      guestPairingToken: existingGuestToken || undefined,
      guestToken: existingGuestToken || undefined,
      guestUserId: this.activeUserId || undefined,
    }).subscribe({
      next: (res) => {
        this.isInvitationSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          this.activeUserId = userLogin;
          this.userIdInput = userLogin;
          this.currentUser = {
            ...res.user,
            name: userLogin,
            isAdmin: false,
            role: 'USER',
            subscriptionTier: 'free',
            isSubscriber: false,
          };
          this.userLoginInput = userLogin;
          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', userLogin);
            localStorage.setItem('rower_is_subscriber', 'false');
            localStorage.setItem('rower_is_admin', 'false');
            localStorage.setItem('rower_user_role', 'USER');
            localStorage.setItem('rower_subscription_tier', 'free');
            if (res.token) {
              localStorage.setItem('rower_auth_token', res.token);
            }
          } catch {}

          if (res.isGarminPaired) {
            this.isPaired = true;
            this.isWatchConfirmed = true;
          }

          this.pendingPrivateSalonsCount = 0;
          this.pendingDuelsCount = 0;
          this.refreshPendingPrivateAndDuels();
          this.launchRegattaFromSplash();
        } else {
          this.invitationAuthError = this.i18n.translateError(res.message || 'ERR_GENERIC');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isInvitationSubmitting = false;
        this.invitationAuthError = this.i18n.translateError(err?.error?.message || err?.error?.error || 'ERR_GENERIC');
        this.cdr.markForCheck();
      }
    });
  }

  onOpenFullAccountModal(tab: 'login' | 'register'): void {
    this.accountModalTab = tab;
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  onSaveGuestStatsRegister(): void {
    this.closeRaceLeaderboardModal();
    this.accountModalTab = 'register';
    if (this.invitationEmail && !this.regEmail) {
      this.regEmail = this.invitationEmail;
    }
    if (this.currentUser?.name && !this.regLogin && !this.currentUser.name.startsWith('Invité_')) {
      this.regLogin = this.currentUser.name;
    }
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  openPrivateModal(tab?: PrivateModalTab): void {
    this.closeAllOverlayModals();
    this.privateModalTab = tab || (this.activePrivateRoom ? 'share' : 'create');
    this.isPrivateModalOpen = true;
    this.refreshPendingPrivateAndDuels();
    this.cdr.markForCheck();
  }

  onPrivateModalClosed(): void {
    this.isPrivateModalOpen = false;
    this.privateUrlError = '';
    this.refreshPendingPrivateAndDuels();
    this.cdr.markForCheck();
  }

  /**
   * Déclenché lors du clic sur le bouton de démarrage de course dans un salon privé (notamment sur smartphone).
   * Bascule immédiatement l'interface sur la vue régate, ferme la modale, active le plein écran et verrouille le mode paysage.
   */
  onPrivateRaceStartTriggered(event?: { countdownSeconds?: number; isFirstStroke?: boolean }): void {
    this.isPrivateModalOpen = false;
    if (event && !event.isFirstStroke && event.countdownSeconds && event.countdownSeconds > 0) {
      this.countdownSeconds = event.countdownSeconds;
      if (this.activePrivateRoom) {
        this.activePrivateRoom.status = 'COUNTDOWN';
        (this.activePrivateRoom as any).internalStatus = 'COUNTDOWN';
        this.activePrivateRoom.waitingForHost = false;
        if (this.activePrivateRoom.race) {
          this.activePrivateRoom.race.status = 'COUNTDOWN';
          (this.activePrivateRoom.race as any).internalStatus = 'COUNTDOWN';
        }
      }
      if (this.nextRaceInfo) {
        this.nextRaceInfo.status = 'COUNTDOWN';
        (this.nextRaceInfo as any).internalStatus = 'COUNTDOWN';
        this.nextRaceInfo.waitingForHost = false;
        if (this.nextRaceInfo.race) {
          this.nextRaceInfo.race.status = 'COUNTDOWN';
          (this.nextRaceInfo.race as any).internalStatus = 'COUNTDOWN';
        }
      }
      this.syncCountdownUI();
    }
    this.setSiteView('regatta');
    this.enterFullscreen().catch(() => {});
    this.lockLandscape().catch(() => {});
    this.cdr.markForCheck();
  }

  onPrivateRoomSelected(event: { payload: PrivateRacePayload; pushUrl: boolean; isPreview?: boolean }): void {
    const isPreview = event.isPreview !== undefined ? event.isPreview : true;
    this.activatePrivateRoom(event.payload, event.pushUrl, isPreview);
    this.refreshPendingPrivateAndDuels();
  }

  onPrivateRoomUpdated(updated: PrivateRacePayload): void {
    const prevStatus = (this.activePrivateRoom?.status || this.activePrivateRoom?.race?.status || (this.activePrivateRoom as any)?.internalStatus || '').toString().toUpperCase();
    const inGoTransition = Date.now() < this.goTransitionLockUntilMs && (updated?.secondsRemaining ?? 0) <= 5;
    if (inGoTransition) {
      updated.status = 'RUNNING';
      (updated as any).internalStatus = 'RUNNING';
      updated.secondsRemaining = 0;
      if (updated.race) {
        updated.race.status = 'RUNNING';
        (updated.race as any).internalStatus = 'RUNNING';
      }
    }
    this.activePrivateRoom = updated;
    this.nextRaceInfo = updated;
    const updatedStatus = (
      (updated as any)?.internalStatus ||
      (updated?.race as any)?.internalStatus ||
      updated?.race?.status ||
      updated?.status ||
      ''
    ).toString().toUpperCase();

    if ((updatedStatus === 'COUNTDOWN' || (!updated?.waitingForHost && updated?.secondsRemaining && updated.secondsRemaining > 0 && updated.secondsRemaining <= 15)) && updated?.secondsRemaining && updated.secondsRemaining > 0) {
      this.applyMonotonicServerCountdown(updated.secondsRemaining);
      this.syncCountdownUI();
    } else if (updatedStatus !== 'RUNNING' && updatedStatus !== 'IN_PROGRESS' && updatedStatus !== 'COUNTDOWN') {
      if (Date.now() >= this.goTransitionLockUntilMs) {
        this.countdownSeconds = 0;
        this.isPreStartCountdown = false;
        this.is3sCountdown = false;
        this.gameRemainingSeconds = updated.maxDurationSeconds || this.gameMaxDurationSeconds || 3300;
        this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
      }
    }
    const isNowStartingOrRunning =
      updatedStatus === 'COUNTDOWN' ||
      updatedStatus === 'RUNNING' ||
      updatedStatus === 'IN_PROGRESS';
    const wasAlreadyStartingOrRunning =
      prevStatus === 'COUNTDOWN' ||
      prevStatus === 'RUNNING' ||
      prevStatus === 'IN_PROGRESS';
    const justStarted = isNowStartingOrRunning && !wasAlreadyStartingOrRunning;
    if (
      isNowStartingOrRunning &&
      (!this.userExplicitlyNavigatedHome || justStarted) &&
      (this.isSmartphone || this.isMobileOrTablet)
    ) {
      this.isPrivateModalOpen = false;
      if (this.siteView !== 'regatta') {
        this.setSiteView('regatta');
      }
      this.enterFullscreen().catch(() => {});
      this.lockLandscape().catch(() => {});
    }
    this.updateDocumentTitle();
    this.initGameLoop();
    this.refreshPendingPrivateAndDuels();
    this.cdr.markForCheck();
  }

  onPrivateRoomClosedOrLeft(_event: { closedOnServer: boolean; raceId?: string }): void {
    this.exitPrivateRoomToPublic(true);
    this.initGameLoop();
    this.refreshPendingPrivateAndDuels();
  }

  refreshPendingPrivateAndDuels(): void {
    const uid = (this.activeUserId || this.currentUser?.login || this.currentUser?.id || '').trim();
    let savedCodes: string[] = [];
    try {
      if (typeof localStorage !== 'undefined') {
        const storageKey = (uid && this.isRegisteredUser)
          ? `rower_saved_private_salons_${uid.toLowerCase()}`
          : 'rower_saved_private_salons_guest';
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            savedCodes = parsed
              .filter((s: any) => s && !s.isDuel1v1 && s.code)
              .map((s: any) => s.code);
          }
        }
      }
    } catch {
      savedCodes = [];
    }

    const closedStatuses = new Set([
      'ABANDONED', 'FINISHED', 'COMPLETED', 'STOPPED', 'CANCELLED',
      'abandoned', 'finished', 'completed', 'stopped', 'cancelled'
    ]);

    // 1. Salons privés actifs / en attente (hors duels 1v1 comptés séparément ci-dessous)
    if ((uid && uid !== 'anonymous') || savedCodes.length > 0) {
      const queryHostId = (uid && !uid.startsWith('usr_') && !uid.startsWith('guest_')) ? uid : uid;
      this.rowerService.listPrivateRaces(queryHostId || undefined, savedCodes).subscribe({
        next: (res) => {
          if (res?.success && Array.isArray(res.races)) {
            const seenIds = new Set<string>();
            const activeNonDuel = res.races.filter((r) => {
              if (!r?.race?.id) return false;
              if (seenIds.has(r.race.id)) return false;
              seenIds.add(r.race.id);
              const isDuel = Boolean(
                r.isDuel1v1 ||
                r.race.isDuel1v1 ||
                (r as any).gameMode === 'duel_1v1' ||
                (r.race as any).gameMode === 'duel_1v1' ||
                r.duelChallenge ||
                (r.race as any).duelChallenge
              );
              if (isDuel) return false;
              const st1 = String(r.status || '');
              const st2 = String(r.race.status || '');
              const st3 = String((r as any).internalStatus || (r.race as any).internalStatus || '');
              return !closedStatuses.has(st1) && !closedStatuses.has(st2) && !closedStatuses.has(st3);
            });
            this.pendingPrivateSalonsCount = activeNonDuel.length;
          } else {
            this.pendingPrivateSalonsCount = 0;
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.pendingPrivateSalonsCount = 0;
          this.cdr.markForCheck();
        }
      });
    } else {
      this.pendingPrivateSalonsCount = 0;
      this.cdr.markForCheck();
    }

    // 2. Duels actifs ou ouverts (statut PENDING ou ACCEPTED) pour le compte courant
    if (uid && this.isRegisteredUser) {
      this.rowerService.getMyDuelChallenges(uid).subscribe({
        next: (res) => {
          if (res?.success) {
            const seenDuelIds = new Set<string>();
            const allDuels = [...(res.received || []), ...(res.sent || [])];
            let activeDuelsCount = 0;
            for (const d of allDuels) {
              if (!d || !d.id || seenDuelIds.has(d.id)) continue;
              if (d.status === 'PENDING' || d.status === 'ACCEPTED') {
                seenDuelIds.add(d.id);
                activeDuelsCount++;
              }
            }
            this.pendingDuelsCount = activeDuelsCount;
          } else {
            this.pendingDuelsCount = 0;
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.pendingDuelsCount = 0;
          this.cdr.markForCheck();
        }
      });
    } else {
      this.pendingDuelsCount = 0;
      this.cdr.markForCheck();
    }
  }

  onPrivateRoomBotsToggled(enable: boolean): void {
    if (!this.activePrivateRoom) return;
    const raceId = this.activePrivateRoom.race.id;
    this.rowerService.toggleBots(enable, raceId, this.activeUserId).subscribe({
      next: () => {
        this.initGameLoop();
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Erreur bots salon privé:', err);
      }
    });
  }

  private pollActiveRaceSource(): Observable<NextRaceInfo | null> {
    if (this.activePrivateRoom && !this.isPublicRacePreview) {
      if (
        this.isPrivateRoomCompleted ||
        this.activePrivateRoom.status === 'COMPLETED' ||
        this.activePrivateRoom.status === 'finished' ||
        this.activePrivateRoom.race?.status === 'COMPLETED' ||
        this.activePrivateRoom.race?.status === 'finished'
      ) {
        return of(null);
      }
      const identifier = this.activePrivateRoom.code || this.activePrivateRoom.race.id;
      return this.rowerService.getPrivateRace(identifier).pipe(
        catchError((err) => {
          if (err?.status === 404) {
            this.exitPrivateRoomToPublic(true, this.i18n.t('JOIN_ERR_NOT_FOUND'));
            return this.rowerService.getNextRace();
          }
          throw err;
        })
      );
    }
    return this.rowerService.getNextRace();
  }

  private initSocketListeners(): void {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
    this.socketSub = this.socketService.onLeaderboardUpdate().subscribe((update) => {
      if (this.nextRaceInfo && update.raceId === this.nextRaceInfo.race.id) {
        this.lastSocketUpdateAtMs = Date.now();
        const targetDist = this.activeTargetDistance || 2000;
        this.liveMetricsList = update.leaderboard.map((m) => {
          const existing = this.liveMetricsList.find(x => x.userId === m.userId);
          const existingRacer = this.racers.find(x => x.userId === m.userId && x.activityId === update.raceId);
          const rawDist = Number(m.exactDist ?? m.dist ?? 0);
          const prevDist = (existing && existing.dist)
            ? Math.max(Number(existing.exactDist ?? existing.dist), Number(existingRacer?.netDistance || 0))
            : Number(existingRacer?.netDistance || 0);
          const wasAlreadyFin = existing?.status === 'finished' || existingRacer?.status === 'finished';
          let safeDist = (prevDist > 0 && rawDist > 0)
            ? Math.max(prevDist, rawDist)
            : rawDist;
          if (targetDist > 0 && (safeDist >= targetDist || m.status === 'finished' || (m.status as string) === 'completed' || wasAlreadyFin)) {
            safeDist = targetDist;
          }
          const safeStatus = (targetDist > 0 && safeDist >= targetDist && m.status !== 'abandoned')
            ? 'finished'
            : m.status;
          const wattsVal = Math.round(m.watts || 0);
          const c2Split = wattsVal > 0
            ? Math.max(60, Math.min(360, Math.round(500 / Math.cbrt(wattsVal / 2.80))))
            : (m.split || 120);
          const isBotVal = m.isBot !== undefined ? m.isBot : this.isBotRacer(m);
          const computedSpeedMs = safeStatus === 'finished'
            ? 0
            : (typeof m.speedMs === 'number' && Number.isFinite(m.speedMs) && m.speedMs >= 0
                ? m.speedMs
                : (wattsVal > 0
                    ? Math.min(8.33, Math.cbrt(Math.min(1200, wattsVal) / 2.80))
                    : ((isBotVal || (m.spm || 0) > 0) && c2Split >= 60 && c2Split <= 360 ? 500 / c2Split : 0)));

          let updated: LiveRacerMetric = {
            ...m,
            dist: safeDist,
            exactDist: safeDist,
            speedMs: Number(computedSpeedMs.toFixed(3)),
            watts: wattsVal,
            split: c2Split,
            status: safeStatus,
            isBot: isBotVal,
            isPaired: m.isPaired !== undefined ? m.isPaired : this.isPairedRacer(m),
          };
          if (m.userId === this.activeUserId) {
            if (m.lane && m.lane > 0) {
              this.myAssignedLane = m.lane;
            } else if (this.myAssignedLane) {
              updated.lane = this.myAssignedLane;
            }
          }
          return updated;
        });

        // Maintien continu des participants du salon sur la ligne de départ (anti-clignotement socket)
        const roomParts = this.activePrivateRoom?.race?.participants || [];
        if (roomParts.length > 0 && (!this.isRaceActive || this.isPreStartCountdown)) {
          for (const p of roomParts) {
            if (!p.userId) continue;
            const isBot = Boolean((p as any).isBot) || String(p.userId).startsWith('bot_');
            const isEngaged = isBot || Boolean(p.pinValidated !== false && p.connectionState !== 'PENDING_PIN');
            if (!isEngaged) continue;
            if (!this.liveMetricsList.some(m => m.userId === p.userId)) {
              this.liveMetricsList.push({
                lane: p.lane || (this.liveMetricsList.length + 1),
                userId: p.userId,
                name: (p as any).name || p.userName || p.userId,
                dist: 0,
                split: 120,
                watts: 0,
                spm: 0,
                ready: p.ready !== false,
                connectionState: p.connectionState || 'CONNECTED',
                isBot,
                kayak: p.kayak
              } as any);
            }
          }
        }

        // 1. Sync racers array for spectators and reactive gauges using the unified liveMetricsList
        this.liveMetricsList.forEach((m) => {
          let r = this.racers.find(x => x.userId === m.userId);
          if (!r) {
            r = {
              id: `${update.raceId}_${m.userId}`,
              activityId: update.raceId,
              userId: m.userId,
              userName: m.name,
              netDistance: m.dist,
              currentDistance: m.dist,
              lastPower: m.watts,
              lastStrokeRate: m.spm,
              lastPace: m.split,
              avgPower: m.watts,
              avgPace: m.split,
              avgStrokeRate: m.spm,
              avgSpeedKmh: m.split > 0 ? Number(((500 / m.split) * 3.6).toFixed(1)) : 0,
              status: (m.status as any) || 'in_progress',
              elapsedTime: 0,
              country: m.country,
              lastHeartRate: m.heartRate
            } as any;
            this.racers.push(r!);
          } else {
            r.netDistance = m.dist;
            r.currentDistance = m.dist;
            r.lastPower = m.watts;
            r.lastStrokeRate = m.spm;
            r.lastPace = m.split;
            if (m.split > 0) {
              r.avgSpeedKmh = Number(((500 / m.split) * 3.6).toFixed(1));
            }
            if (m.status) {
              r.status = m.status as any;
            }
            if (m.country) {
              r.country = m.country;
            }
            if (m.heartRate) {
              r.lastHeartRate = m.heartRate;
            }
          }
        });

        // 2. Synchronize active player's activity & HUD gauges continuously from unified liveMetricsList
        this.autoResolveMyPublicKayak();
        const activeName = this.currentUser?.name || '';
        const myMetric = this.liveMetricsList.find(m => m.userId === this.activeUserId || (activeName && m.name === activeName));
        if (myMetric) {
          const isDifferentRace = Boolean(
            this.myActivity?.activityId &&
            update.raceId &&
            this.myActivity.activityId !== update.raceId
          );
          if (!this.myActivity || isDifferentRace) {
            this.myActivity = {
              id: `${update.raceId}_${myMetric.userId}`,
              activityId: update.raceId,
              userId: myMetric.userId,
              userName: myMetric.name,
              netDistance: myMetric.dist,
              currentDistance: myMetric.dist,
              lastPower: myMetric.watts,
              lastStrokeRate: myMetric.spm,
              lastPace: myMetric.split,
              avgPower: myMetric.watts,
              avgPace: myMetric.split,
              avgStrokeRate: myMetric.spm,
              avgSpeedKmh: myMetric.split > 0 ? Number(((500 / myMetric.split) * 3.6).toFixed(1)) : 0,
              status: (myMetric.status as any) || 'in_progress',
              elapsedTime: myMetric.elapsedTime || Math.max(0, this.gameMaxDurationSeconds - this.gameRemainingSeconds),
              country: myMetric.country,
              lastHeartRate: myMetric.heartRate
            } as any;
          } else {
            // Alignement strict avec liveMetricsList
            this.myActivity.netDistance = myMetric.dist;
            this.myActivity.currentDistance = myMetric.dist;
            if (myMetric.watts > 0 || (this.myActivity.lastPower || 0) === 0) {
              this.myActivity.lastPower = myMetric.watts;
            }
            if (myMetric.spm > 0 || (this.myActivity.lastStrokeRate || 0) === 0) {
              this.myActivity.lastStrokeRate = myMetric.spm;
            }
            if (myMetric.split > 0 || (this.myActivity.lastPace || 0) === 0) {
              this.myActivity.lastPace = myMetric.split;
            }
            if (myMetric.elapsedTime !== undefined && myMetric.elapsedTime > 0) {
              this.myActivity.elapsedTime = myMetric.elapsedTime;
            } else if (this.nextRaceInfo?.status === 'in_progress') {
              this.myActivity.elapsedTime = Math.max(0, this.gameMaxDurationSeconds - this.gameRemainingSeconds);
            }
            if (myMetric.watts > 0) {
              this.myActivity.avgPower = this.myActivity.avgPower > 0
                ? Math.round((this.myActivity.avgPower + myMetric.watts) / 2)
                : myMetric.watts;
            }
            if (myMetric.split > 0) {
              this.myActivity.avgPace = this.myActivity.avgPace > 0
                ? Math.round((this.myActivity.avgPace + myMetric.split) / 2)
                : myMetric.split;
              this.myActivity.avgSpeedKmh = Number(((500 / myMetric.split) * 3.6).toFixed(1));
            }
            if (myMetric.status) {
              this.myActivity.status = myMetric.status as any;
            }
            if (myMetric.heartRate) {
              this.myActivity.lastHeartRate = myMetric.heartRate;
            }
          }
        }

        // 3. Update ranking & gaps in real-time using unified liveMetricsList
        const activeSorted = [...this.liveMetricsList].filter(r => r.status !== 'abandoned').sort((a, b) => {
          const isFinA = a.status === 'finished' ? 1 : 0;
          const isFinB = b.status === 'finished' ? 1 : 0;
          if (isFinA !== isFinB) return isFinB - isFinA;
          return (b.dist || 0) - (a.dist || 0);
        });
        this.totalActiveRacers = activeSorted.length;
        const myIdx = activeSorted.findIndex(r => r.userId === this.activeUserId || (activeName && r.name === activeName));
        if (myIdx >= 0) {
          this.myRank = myIdx + 1;
          const myDist = activeSorted[myIdx].dist || 0;
          const leaderDist = activeSorted[0].dist || 0;
          this.distToLeader = Math.max(0, Math.round(leaderDist - myDist));
          this.distToPrev = myIdx > 0 ? Math.max(0, Math.round((activeSorted[myIdx - 1].dist || 0) - myDist)) : 0;
          this.distToNext = myIdx < activeSorted.length - 1 ? Math.max(0, Math.round(myDist - (activeSorted[myIdx + 1].dist || 0))) : 0;
        }

        // 4. Notification Éphémère de Franchissement de Ligne (2 secondes strictes)
        for (const racer of this.liveMetricsList) {
          const isFin = racer.status === 'finished' || (racer.dist >= targetDist && targetDist > 0);
          if (isFin && !this.finishedRacerIds.has(racer.userId)) {
            this.finishedRacerIds.add(racer.userId);
            this.finisherCount++;
            const pos = this.finisherCount;
            const medal = pos === 1 ? '🥇 1er' : (pos === 2 ? '🥈 2e' : (pos === 3 ? '🥉 3e' : `${pos}e`));
            const elapsed = racer.elapsedTime || (this.gameMaxDurationSeconds - this.gameRemainingSeconds) || (this.focusedTelemetry || this.myActivity)?.elapsedTime || 0;
            const formattedChrono = this.formatTime(Math.max(0, elapsed));
            const toastMsg = `${medal} : ${racer.name} - ${formattedChrono} - Ligne d'arrivée franchie !`;
            this.triggerFinishToast(toastMsg);

            // Célébration visuelle feux d'artifice + BRAVO spécifique pour le joueur connecté au franchissement de la ligne
            const isMe = racer.userId === this.activeUserId || (activeName && racer.name === activeName);
            if (isMe && !this.hasCelebratedFinish) {
              const targetRaceId = this.activePrivateRoom?.race?.id || this.nextRaceInfo?.race?.id;
              this.triggerFinishCelebration(targetRaceId);
            }
          }
        }

        // 5. Affichage du Classement Général en Fin de Course publique (dès que l'ensemble des joueurs humains engagés ont atteint la ligne d'arrivée)
        const isPublicRace = !this.activePrivateRoom;
        const nonAbandonedHumans = this.liveMetricsList.filter(r => !this.isBotRacer(r) && r.status !== 'abandoned');
        const allHumansFinishedInMetric = nonAbandonedHumans.length > 0 && nonAbandonedHumans.every(
          r => r.status === 'finished' || (targetDist > 0 && (r.dist || 0) >= targetDist)
        );
        if (isPublicRace && allHumansFinishedInMetric && !this.isPostRaceRankingActive && this.nextRaceInfo?.race?.id) {
          const pubRaceId = this.nextRaceInfo.race.id;
          this.completedPublicRaceId = pubRaceId;
          if (this.isFinished && !this.hasCelebratedFinish) {
            this.triggerFinishCelebration(pubRaceId);
          } else if (!this.showFinishCelebration) {
            this.isPostRaceRankingActive = true;
            if (!this.dismissedLeaderboardRaceIds.has(pubRaceId)) {
              this.openRaceLeaderboard(pubRaceId);
            }
          }
        }

        this.cdr.markForCheck();
      }
    });

    if (this.statusSub) {
      this.statusSub.unsubscribe();
    }
    this.statusSub = this.socketService.onRaceStatusChange().subscribe((update) => {
      if (update.status === 'PUBLIC_RACES_SUSPENDED') {
        this.isPublicRaceSuspended = true;
        this.triggerFinishToast("⚠️ Les courses publiques sont temporairement suspendues.");
        this.cdr.markForCheck();
        return;
      }
      if (update.status === 'PUBLIC_RACES_RESUMED') {
        this.isPublicRaceSuspended = false;
        this.triggerFinishToast("✓ Les courses publiques ont repris !");
        this.loadNextRaceInfo();
        this.cdr.markForCheck();
        return;
      }

    this.socketService.onSettingsUpdated().subscribe((cfg) => {
      if (cfg && cfg.overtakeThresholdM) {
        if (this.nextRaceInfo) {
          (this.nextRaceInfo as any).overtakeThresholdM = cfg.overtakeThresholdM;
          if (this.nextRaceInfo.race) {
            (this.nextRaceInfo.race as any).overtakeThresholdM = cfg.overtakeThresholdM;
          }
        }
        if (this.activePrivateRoom) {
          (this.activePrivateRoom as any).overtakeThresholdM = cfg.overtakeThresholdM;
          if (this.activePrivateRoom.race) {
            (this.activePrivateRoom.race as any).overtakeThresholdM = cfg.overtakeThresholdM;
          }
        }
        this.cdr.markForCheck();
      }
    });

      const isPrivateTarget = Boolean(
        this.activePrivateRoom &&
        (update.raceId === this.activePrivateRoom.race?.id || update.raceId === this.activePrivateRoom.code)
      );
      const isPublicTarget = Boolean(
        !update.raceId || (this.nextRaceInfo && update.raceId === this.nextRaceInfo.race?.id)
      );

      if (!isPrivateTarget && !isPublicTarget) {
        return;
      }

      if (update.status === 'COUNTDOWN') {
        const sec = update.details?.countdownSeconds ?? update.details?.secondsUntilStart ?? 10;
        this.countdownSeconds = sec;
        if (isPrivateTarget && this.activePrivateRoom) {
          this.activePrivateRoom.status = 'COUNTDOWN';
          (this.activePrivateRoom as any).internalStatus = 'COUNTDOWN';
          this.activePrivateRoom.waitingForHost = false;
          if (this.activePrivateRoom.race) {
            this.activePrivateRoom.race.status = 'COUNTDOWN';
            (this.activePrivateRoom.race as any).internalStatus = 'COUNTDOWN';
          }
          if (!this.userExplicitlyNavigatedHome) {
            this.isPrivateModalOpen = false;
            if (this.siteView !== 'regatta' && this.siteView !== 'cockpit') {
              this.setSiteView('regatta');
            }
            if (this.isSmartphone || this.isMobileOrTablet) {
              this.enterFullscreen().catch(() => {});
              this.lockLandscape().catch(() => {});
            }
          }
        }
        if (isPublicTarget && this.nextRaceInfo) {
          this.nextRaceInfo.status = 'COUNTDOWN';
          (this.nextRaceInfo as any).internalStatus = 'COUNTDOWN';
          if (this.nextRaceInfo.race) {
            this.nextRaceInfo.race.status = 'COUNTDOWN';
            (this.nextRaceInfo.race as any).internalStatus = 'COUNTDOWN';
          }
        }
        this.syncCountdownUI();
      } else if (update.status === 'RUNNING') {
        const wasInPreStartOr3s = this.is3sCountdown || this.isPreStartCountdown || this.countdownSeconds > 0;
        this.countdownSeconds = 0;
        this.isPreStartCountdown = false;
        if (wasInPreStartOr3s || Date.now() < this.goHoldUntilMs) {
          this.triggerGoOverlayHold();
        } else {
          this.is3sCountdown = false;
        }
        this.finishedRacerIds.clear();
        this.finisherCount = 0;
        this.hasCelebratedFinish = false;
        this.showFinishCelebration = false;
        this.completedPublicRaceId = null;
        if (update.raceId) {
          this.dismissedLeaderboardRaceIds.delete(update.raceId);
        }
        if (this.finishCelebrationTimer) {
          clearTimeout(this.finishCelebrationTimer);
          this.finishCelebrationTimer = null;
        }
        if (this.isPostRaceRankingActive || this.isRaceLeaderboardModalOpen) {
          this.closeRaceLeaderboardModal();
          this.isPostRaceRankingActive = false;
        }
        if (isPrivateTarget && this.activePrivateRoom?.race) {
          this.activePrivateRoom.race.status = 'RUNNING';
          this.activePrivateRoom.status = 'RUNNING';
          if (!this.userExplicitlyNavigatedHome) {
            this.setSiteView('regatta');
            if (this.isSmartphone || this.isMobileOrTablet) {
              this.isPrivateModalOpen = false;
              this.enterFullscreen().catch(() => {});
              this.lockLandscape().catch(() => {});
            }
          }
        }
        if (isPublicTarget && this.nextRaceInfo) {
          this.nextRaceInfo.status = 'in_progress';
          if (this.nextRaceInfo.race) {
            this.nextRaceInfo.race.status = 'RUNNING';
          }
        }
        if (this.siteView === 'regatta' || this.siteView === 'cockpit') {
          this.startImmersionAutoFade();
        }
      } else if (update.status === 'POST_RACE_PAUSE') {
        const sec = update.details?.pauseSeconds ?? 120;
        this.countdownSeconds = sec;
        if (this.nextRaceInfo) {
          this.nextRaceInfo.status = 'post_race_pause';
          if (this.nextRaceInfo.race) {
            this.nextRaceInfo.race.status = 'post_race_pause';
          }
        }
        if (!this.activePrivateRoom && this.nextRaceInfo?.race?.id) {
          const pubRaceId = this.nextRaceInfo.race.id;
          this.completedPublicRaceId = pubRaceId;
          if (!this.showFinishCelebration && !this.isPostRaceRankingActive && !this.dismissedLeaderboardRaceIds.has(pubRaceId)) {
            this.openRaceLeaderboard(pubRaceId);
            this.isPostRaceRankingActive = true;
          }
        }
        this.syncCountdownUI();
      } else if (update.status === 'COMPLETED' || update.status === 'STOPPED' || update.status === 'CANCELLED' || update.status === 'ABANDONED') {
        if (isPrivateTarget && this.activePrivateRoom) {
          if (update.status === 'COMPLETED' || update.status === 'STOPPED') {
            this.isPrivateRoomCompleted = true;
            const stopReason = update.details?.reason || (update.status === 'STOPPED' ? 'organizer_stopped' : 'completed');
            if (this.activePrivateRoom.race) {
              this.activePrivateRoom.race.status = 'COMPLETED';
              (this.activePrivateRoom.race as any).stopReason = stopReason;
            }
            this.activePrivateRoom.status = 'COMPLETED';
            (this.activePrivateRoom as any).stopReason = stopReason;
            if (this.nextRaceInfo) {
              this.nextRaceInfo.status = 'finished';
              (this.nextRaceInfo as any).stopReason = stopReason;
              if (this.nextRaceInfo.race) {
                this.nextRaceInfo.race.status = 'COMPLETED';
                (this.nextRaceInfo.race as any).stopReason = stopReason;
              }
            }
            this.countdownSeconds = 0;
            this.is3sCountdown = false;
            this.isPreStartCountdown = false;
            this.formattedGameRemaining = '';
            const targetRaceId = update.raceId || this.activePrivateRoom.race.id;
            if (update.details?.ranking && update.details.ranking.length > 0) {
              this.selectedRaceLeaderboard = update.details.ranking;
            }
            if (targetRaceId && !this.dismissedLeaderboardRaceIds.has(targetRaceId)) {
              this.openRaceLeaderboard(targetRaceId);
            }
            this.isPostRaceRankingActive = true;
            const finishMsg = stopReason === 'organizer_stopped'
              ? "🛑 Course arrêtée par l'organisateur. Le classement officiel est affiché."
              : "🏁 Course terminée ! Le classement officiel est affiché.";
            this.triggerFinishToast(finishMsg);
          } else if (update.status === 'CANCELLED' || update.status === 'ABANDONED') {
            const reasonMsg = update.details?.reason === 'all_players_left'
              ? 'Tous les participants ont quitté le salon'
              : 'Course annulée';
            this.triggerFinishToast(`⚠️ Salon fermé : ${reasonMsg}`);
            this.exitPrivateRoomToPublic(true);
          }
        } else if (isPublicTarget && (update.status === 'COMPLETED' || update.status === 'STOPPED')) {
          if (update.status === 'STOPPED' || update.details?.hasRanking === false) {
            this.isPostRaceRankingActive = false;
            this.completedPublicRaceId = null;
            this.selectedRaceLeaderboard = [];
            this.resetPublicWaterForNextRace();
            this.triggerFinishToast(
              update.details?.message || "🛑 Course arrêtée par l'administrateur. Aucun classement n'a été établi."
            );
            this.loadNextRaceInfo();
          } else {
            const targetRaceId = update.raceId || this.nextRaceInfo?.race?.id;
            if (targetRaceId) {
              this.completedPublicRaceId = targetRaceId;
            }
            if (update.details?.ranking && update.details.ranking.length > 0) {
              this.selectedRaceLeaderboard = update.details.ranking;
            }
            this.isPostRaceRankingActive = true;
            if (targetRaceId && !this.showFinishCelebration && !this.dismissedLeaderboardRaceIds.has(targetRaceId)) {
              this.openRaceLeaderboard(targetRaceId);
            }
            // Réinitialiser immédiatement le plan d'eau pour préparer la prochaine course publique
            this.resetPublicWaterForNextRace(update.details?.nextRaceId);
            this.loadNextRaceInfo();
          }
        }
      }
      this.cdr.markForCheck();
    });

    if (this.privateUpdateSub) {
      this.privateUpdateSub.unsubscribe();
    }
    this.privateUpdateSub = this.socketService.onPrivateRoomUpdate().subscribe((update) => {
      // Si la montre liée ou l'utilisateur actif vient de rejoindre le salon via PIN ou Ticket Invité 5 caractères
      const currentActiveId = this.activeUserId || this.currentUser?.id || this.guestSessionId;
      const mySocketId = this.socketService.getSocketId();
      const assignedLaneVal = Number(update?.['lane'] || 0);
      const updateHostId = update?.['hostUserId'] ? String(update['hostUserId']) : '';
      const incomingPin = String(update?.['ticketPin'] || update?.['pinCode'] || update?.['code'] || '').toUpperCase();
      const currentPin = String(this.activeFullscreenPinCode || this.pairingCode || this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || this.activePrivateRoom?.code || this.activePrivateRoom?.race?.code || '').toUpperCase();
      const isPinMatch = Boolean(incomingPin && currentPin && (incomingPin === currentPin || currentPin.includes(incomingPin) || incomingPin.includes(currentPin)));
      const isDeviceMatch = Boolean(update?.['deviceToken'] && this.deviceToken && update['deviceToken'] === this.deviceToken);

      const isMyGuestTicketClaim = Boolean(
        (update?.['ticketClaimed'] || isPinMatch || isDeviceMatch) &&
        ((mySocketId && update?.['socketId'] === mySocketId) ||
          (update.userId && update.userId === currentActiveId) ||
          (this.activePrivateRoom && (this.activePrivateRoom.race?.id === update.raceId || this.activePrivateRoom.code === update.raceId)) ||
          isPinMatch ||
          isDeviceMatch)
      );
      const isMyRoomJoin = Boolean(
        update &&
        update.type === 'PARTICIPANT_JOINED' &&
        (isMyGuestTicketClaim ||
          (update.userId && (update.userId === currentActiveId || update.userId === this.currentUser?.id)) ||
          (updateHostId && (updateHostId === currentActiveId || updateHostId === this.currentUser?.id)) ||
          (this.activePrivateRoom && (this.activePrivateRoom.race?.id === update.raceId || this.activePrivateRoom.code === update.raceId)) ||
          isPinMatch ||
          isDeviceMatch)
      );

      if (isMyGuestTicketClaim) {
        this.isPrivateRoomPreview = false;
        if (update.raceId) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('rower_active_private_room_id', update.raceId);
              if (update['code']) {
                localStorage.setItem('rower_active_private_room_code', String(update['code']));
              }
            }
          } catch {}
        }
        if (update?.['deviceToken']) {
          this.onWatchPairedSuccess(String(update['deviceToken']), update.userId);
        }
        if (update?.['guestName'] || update.userName) {
          const gName = String(update['guestName'] || update.userName);
          this.currentUser.name = gName;
          this.userLoginInput = gName;
          try {
            localStorage.setItem('rower_user_login', gName);
          } catch {}
        }
        if (assignedLaneVal > 0) {
          this.myAssignedLane = assignedLaneVal;
        }
        this.installKayakOnWaterLane(assignedLaneVal || this.myAssignedLane, update.userId, String(update?.['guestName'] || update.userName), update.raceId);
      }

      if (isMyRoomJoin) {
        if (assignedLaneVal > 0 && (isMyGuestTicketClaim || update.userId === currentActiveId || updateHostId === currentActiveId || Boolean(update?.['isBotDuel']))) {
          this.myAssignedLane = assignedLaneVal;
        }
        const updateStatus = String(update?.['status'] || update?.['internalStatus'] || '').toUpperCase();
        const cdSec = Number(update?.['countdownSeconds'] ?? update?.['secondsRemaining'] ?? 0);
        if (cdSec > 0 && updateStatus === 'COUNTDOWN') {
          this.countdownSeconds = cdSec;
          this.syncCountdownUI();
        }
        if (Boolean(update?.['isBotDuel']) || isMyGuestTicketClaim) {
          this.setSiteView('regatta');
        }
        if (!this.activePrivateRoom || (this.activePrivateRoom.race?.id !== update.raceId && this.activePrivateRoom.code !== update.raceId)) {
          this.rowerService.getPrivateRace(update.raceId).subscribe({
            next: (room: PrivateRacePayload) => {
              (room as any).lane = assignedLaneVal || this.myAssignedLane;
              this.activatePrivateRoom(room, false);
              this.installKayakOnWaterLane(assignedLaneVal || (room as any).lane || this.myAssignedLane, update.userId, String(update?.['guestName'] || update.userName), update.raceId);
              this.setSiteView('regatta');
              this.cdr.markForCheck();
            }
          });
        } else {
          this.installKayakOnWaterLane(assignedLaneVal || this.myAssignedLane, update.userId, String(update?.['guestName'] || update.userName), update.raceId);
        }
      }

      if (this.activePrivateRoom && (update.raceId === this.activePrivateRoom.race?.id || update.raceId === this.activePrivateRoom.code)) {
        if (Boolean((update as any)?.roomClosed) || update?.['type'] === 'ROOM_CLOSED') {
          const updateStatus = (update as any)?.status;
          if (this.isPostRaceDisplayActive || this.isPrivateRoomCompleted || updateStatus === 'COMPLETED' || updateStatus === 'STOPPED') {
            this.isPrivateRoomCompleted = true;
            this.isPostRaceRankingActive = true;
            const targetRaceId = update.raceId || this.activePrivateRoom.race?.id;
            if (targetRaceId) {
              this.openRaceLeaderboard(targetRaceId);
            }
            this.cdr.markForCheck();
            return;
          }
          this.exitPrivateRoomToPublic(true);
          return;
        }
        this.pollActiveRaceSource().subscribe((data) => {
          if (data) {
            const inGoTransition = Date.now() < this.goTransitionLockUntilMs && (data.secondsRemaining ?? 0) <= 5;
            if (inGoTransition) {
              data.status = 'in_progress';
              (data as any).internalStatus = 'RUNNING';
              data.secondsRemaining = 0;
              if (data.race) {
                data.race.status = 'RUNNING';
                (data.race as any).internalStatus = 'RUNNING';
              }
            }
            this.activePrivateRoom = data as PrivateRacePayload;
            this.nextRaceInfo = data;
            if (data.remainingSeconds !== undefined) {
              this.gameRemainingSeconds = data.remainingSeconds;
              this.gameMaxDurationSeconds = data.maxDurationSeconds || this.gameMaxDurationSeconds;
              this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
            }
            const isCountdown = data.race?.status === 'COUNTDOWN' || (data as any)?.internalStatus === 'COUNTDOWN' || data.status === 'countdown';
            if (isCountdown && typeof data.secondsRemaining === 'number' && data.secondsRemaining > 0 && !data.waitingForHost) {
              this.applyMonotonicServerCountdown(data.secondsRemaining);
              this.syncCountdownUI();
            } else if (!isCountdown && !this.isRaceActive) {
              if (Date.now() >= this.goTransitionLockUntilMs) {
                this.countdownSeconds = 0;
                this.isPreStartCountdown = false;
                this.is3sCountdown = false;
                this.gameRemainingSeconds = data.maxDurationSeconds || this.gameMaxDurationSeconds || 3300;
                this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
              }
            }
            this.cdr.markForCheck();
          }
        });
      }
    });

    if (this.garminPairedSub) {
      this.garminPairedSub.unsubscribe();
    }
    this.garminPairedSub = this.socketService.onGarminPaired().subscribe((data) => {
      if (data && data.deviceToken) {
        const currentId = this.activeUserId || this.currentUser?.id || this.guestSessionId;
        const mySocketId = this.socketService.getSocketId();
        const claimedRoomId = data.raceId || (data as any).roomId;
        const incomingPin = String((data as any).code || (data as any).pinCode || (data as any).ticketPin || '').toUpperCase();
        const currentPin = String(this.activeFullscreenPinCode || this.pairingCode || this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || this.activePrivateRoom?.code || this.activePrivateRoom?.race?.code || '').toUpperCase();
        const isPinMatch = Boolean(incomingPin && currentPin && (incomingPin === currentPin || currentPin.includes(incomingPin) || incomingPin.includes(currentPin)));
        const isDeviceMatch = Boolean(data.deviceToken && this.deviceToken && data.deviceToken === this.deviceToken);
        const isMyTicket = Boolean(
          (data.ticketClaimed || (data as any).ticketPin || data.roomCode) &&
          ((mySocketId && data.socketId === mySocketId) ||
           (this.activePrivateRoom && (this.activePrivateRoom.race?.id === claimedRoomId || this.activePrivateRoom.code === data.roomCode)) ||
           (data.userId && data.userId === currentId) ||
           isPinMatch ||
           isDeviceMatch)
        );
        if (!this.isPaired || data.userId === currentId || isMyTicket || isPinMatch || isDeviceMatch) {
          this.onWatchPairedSuccess(data.deviceToken, data.userId);
          const claimedTarget = claimedRoomId || data.roomCode;
          if (claimedTarget) {
            this.isPrivateRoomPreview = false;
            try {
              if (typeof localStorage !== 'undefined') {
                if (claimedRoomId) {
                  localStorage.setItem('rower_active_private_room_id', claimedRoomId);
                }
                const codeToSave = data.roomCode || this.activePrivateRoom?.code || this.activePrivateRoom?.race?.code;
                if (codeToSave) {
                  localStorage.setItem('rower_active_private_room_code', codeToSave);
                }
              }
            } catch {}
            if (this.activePrivateRoom && (this.activePrivateRoom.race?.id === claimedRoomId || this.activePrivateRoom.code === data.roomCode)) {
              if (data.guestName) {
                this.currentUser.name = data.guestName;
                this.userLoginInput = data.guestName;
              }
              if (data.lane) {
                this.myAssignedLane = data.lane;
              }
              this.installKayakOnWaterLane(data.lane || this.myAssignedLane, data.userId, data.guestName, claimedRoomId);
            } else {
              // Si la page web était restée sur la course publique, la saisie du PIN sur la montre bascule vers le salon
              const targetCode = data.roomCode || claimedRoomId;
              this.rowerService.getPrivateRace(targetCode).subscribe({
                next: (room) => {
                  if (data.lane) {
                    (room as any).lane = data.lane;
                    this.myAssignedLane = data.lane;
                  }
                  if (data.guestName) {
                    this.currentUser.name = data.guestName;
                    this.userLoginInput = data.guestName;
                  }
                  this.activatePrivateRoom(room, false, false);
                  this.installKayakOnWaterLane(data.lane || (room as any).lane || this.myAssignedLane, data.userId, data.guestName, claimedRoomId || room.race?.id);
                }
              });
            }
          } else if (isMyTicket) {
            if (data.guestName) {
              this.currentUser.name = data.guestName;
              this.userLoginInput = data.guestName;
            }
            if (data.lane) {
              this.myAssignedLane = data.lane;
            }
            this.isPrivateModalOpen = false;
            this.setSiteView('regatta');
          }
        }
      }
    });

    if (this.duelEventSub) {
      this.duelEventSub.unsubscribe();
    }
    this.duelEventSub = this.socketService.onDuelEvent().subscribe((ev) => {
      const myIds = new Set(
        [this.activeUserId, this.currentUser?.id, this.currentUser?.login]
          .filter(Boolean)
          .map((x) => String(x).trim().toLowerCase())
      );
      if (myIds.size === 0) return;

      const involvesChallenged = Boolean(
        (ev.challengedUserId && myIds.has(ev.challengedUserId.toLowerCase())) ||
        (ev.challengedLogin && myIds.has(ev.challengedLogin.toLowerCase()))
      );
      const involvesChallenger = Boolean(
        (ev.challengerUserId && myIds.has(ev.challengerUserId.toLowerCase())) ||
        (ev.challengerLogin && myIds.has(ev.challengerLogin.toLowerCase()))
      );

      const removeDuelFromLocalStorage = () => {
        try {
          if (typeof localStorage === 'undefined') return;
          const uid = (this.activeUserId || this.currentUser?.login || this.currentUser?.id || '').trim().toLowerCase();
          const keys = [
            uid ? `rower_saved_private_salons_${uid}` : '',
            this.currentUser?.id ? `rower_saved_private_salons_${String(this.currentUser.id).trim().toLowerCase()}` : '',
            this.currentUser?.login ? `rower_saved_private_salons_${String(this.currentUser.login).trim().toLowerCase()}` : '',
            'rower_saved_private_salons_guest'
          ].filter(Boolean);
          const evRoomId = (ev.roomId || '').trim();
          const evCode = (ev.roomCode || '').trim().toLowerCase();
          const evChId = (ev.challengeId || '').trim();
          if (!evRoomId && !evCode && !evChId) return;

          for (const key of new Set(keys)) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) continue;
            const filtered = parsed.filter((s: any) => {
              if (!s) return false;
              if (evChId && (s.duelChallengeId === evChId || s.id === evChId)) return false;
              if (evRoomId && s.id === evRoomId) return false;
              if (evCode && s.code && String(s.code).trim().toLowerCase() === evCode) return false;
              return true;
            });
            if (filtered.length !== parsed.length) {
              localStorage.setItem(key, JSON.stringify(filtered));
            }
          }
        } catch {}
      };

      const isCurrentActiveDuelRoom = (): boolean => {
        if (!this.activePrivateRoom) return false;
        const activeId = (this.activePrivateRoom.race?.id || this.activePrivateRoom.id || '').trim();
        const activeCode = (this.activePrivateRoom.code || this.activePrivateRoom.race?.code || '').trim().toLowerCase();
        const activeChId = (
          this.activePrivateRoom.duelChallenge?.id ||
          (this.activePrivateRoom.race as any)?.duelChallenge?.id ||
          ''
        ).trim();
        return Boolean(
          (ev.challengeId && activeChId && activeChId === ev.challengeId) ||
          (ev.roomId && activeId && activeId === ev.roomId) ||
          (ev.roomCode && activeCode && activeCode === ev.roomCode.trim().toLowerCase())
        );
      };

      if (ev.eventType === 'challenge_received' && involvesChallenged) {
        this.triggerFinishToast(`⚔️ Nouveau défi en duel reçu de ${ev.challengerLogin || 'un abonné'} ! Consultez vos salons privés.`);
      } else if (ev.eventType === 'challenge_responded' && (involvesChallenger || involvesChallenged)) {
        if (ev.accepted) {
          if (involvesChallenger) {
            this.triggerFinishToast(`✅ ${ev.challengedLogin || 'Votre adversaire'} a accepté votre défi ! Créneau bloqué (Salon ${ev.roomCode || ''}).`);
          }
        } else {
          removeDuelFromLocalStorage();
          if (involvesChallenger) {
            this.triggerFinishToast(`❌ ${ev.challengedLogin || 'Votre adversaire'} a refusé/supprimé votre défi en duel.`);
          }
          if (isCurrentActiveDuelRoom()) {
            this.exitPrivateRoomToPublic(true);
          }
        }
      } else if (ev.eventType === 'challenge_cancelled' && (involvesChallenged || involvesChallenger)) {
        removeDuelFromLocalStorage();
        const actorMatch = ev.cancelledByUserId && myIds.has(ev.cancelledByUserId.toLowerCase());
        if (!actorMatch) {
          if (ev.isForfeit) {
            this.triggerFinishToast('🏆 Duel annulé par votre adversaire dans les 24h : victoire par forfait (+10 pts) !');
          } else {
            this.triggerFinishToast('🚫 Duel supprimé / annulé par votre adversaire. Le créneau est libéré.');
          }
        }
        if (isCurrentActiveDuelRoom()) {
          this.exitPrivateRoomToPublic(true);
        }
        this.loadUserProfile();
      } else if (ev.eventType === 'challenge_deleted' && (involvesChallenged || involvesChallenger)) {
        removeDuelFromLocalStorage();
        if (isCurrentActiveDuelRoom()) {
          this.exitPrivateRoomToPublic(true);
        }
      }
      if (this.isStandingsOpen && this.standingsActiveTab === 'duels') {
        this.loadDuelLeaderboard();
      }
      this.refreshPendingPrivateAndDuels();
      this.cdr.markForCheck();
    });
  }

  private isPrivateRoomInWaitingLobby(raceData?: any): boolean {
    if (!this.activePrivateRoom) return false;
    const room = this.activePrivateRoom;
    const data = raceData || this.nextRaceInfo || room;
    const internalSt = String(
      (data as any)?.internalStatus ||
      (data?.race as any)?.internalStatus ||
      (room as any)?.internalStatus ||
      (room.race as any)?.internalStatus ||
      ''
    ).toUpperCase();
    const raceSt = String(data?.race?.status || room.race?.status || '').toUpperCase();
    const topSt = String(data?.status || room.status || '').toUpperCase();

    if (internalSt === 'COUNTDOWN' || raceSt === 'COUNTDOWN' || topSt === 'COUNTDOWN') {
      return false;
    }
    if (internalSt === 'RUNNING' || raceSt === 'RUNNING' || topSt === 'RUNNING' || topSt === 'IN_PROGRESS') {
      return false;
    }
    const sec = Number(data?.secondsRemaining ?? room?.secondsRemaining ?? this.countdownSeconds ?? 0);
    const waitingForHost = data?.waitingForHost ?? room?.waitingForHost;
    if (waitingForHost === false && sec > 0 && sec <= 15) {
      return false;
    }
    return Boolean(
      internalSt === 'LOBBY' ||
      raceSt === 'LOBBY' ||
      topSt === 'LOBBY' ||
      topSt === 'WAITING'
    );
  }

  private triggerGoOverlayHold(): void {
    const now = Date.now();
    this.is3sCountdown = true;
    this.isPreStartCountdown = false;
    this.threeSecondsCount = 0;
    this.goHoldUntilMs = now + 1000;
    this.goTransitionLockUntilMs = now + 4000;
    if (this.activePrivateRoom) {
      this.activePrivateRoom.status = 'RUNNING';
      (this.activePrivateRoom as any).internalStatus = 'RUNNING';
      if (this.activePrivateRoom.race) {
        this.activePrivateRoom.race.status = 'RUNNING';
        (this.activePrivateRoom.race as any).internalStatus = 'RUNNING';
      }
    }
    if (this.nextRaceInfo) {
      this.nextRaceInfo.status = 'in_progress';
      this.nextRaceInfo.secondsRemaining = 0;
      if (this.nextRaceInfo.race) {
        this.nextRaceInfo.race.status = 'RUNNING';
        (this.nextRaceInfo.race as any).internalStatus = 'RUNNING';
      }
    }
    if (this.goHideTimer) {
      clearTimeout(this.goHideTimer);
    }
    this.goHideTimer = setTimeout(() => {
      this.goHideTimer = null;
      if (this.countdownSeconds <= 0) {
        this.is3sCountdown = false;
        this.cdr.markForCheck();
      }
    }, 1000);
  }

  /**
   * Synchronise le compte à rebours serveur de manière strictement monotone (décroissante)
   * pendant les 15 dernières secondes et bloque tout retour à 1..5s après le « GO ! ».
   */
  private applyMonotonicServerCountdown(serverRemaining: number): void {
    if (typeof serverRemaining !== 'number' || isNaN(serverRemaining)) {
      return;
    }
    const now = Date.now();
    // Pendant la fenêtre de transition suivant le GO (4s), ignorer tout reliquat de décompte (<= 5s)
    if (now < this.goTransitionLockUntilMs && serverRemaining <= 5) {
      this.countdownSeconds = 0;
      return;
    }
    // Pendant la séquence finale de lancement (<= 15s), interdire toute remontée du compteur due à la latence HTTP
    if (this.countdownSeconds > 0 && this.countdownSeconds <= 15 && serverRemaining <= 15) {
      if (serverRemaining < this.countdownSeconds) {
        // N'accepter une baisse serveur que si l'écart dépasse 2s pour préserver la régularité du tick 1Hz local
        if (this.countdownSeconds - serverRemaining > 2) {
          this.countdownSeconds = serverRemaining;
        }
      }
      return;
    }
    if (this.countdownSeconds <= 0 || Math.abs(this.countdownSeconds - serverRemaining) > 3) {
      this.countdownSeconds = serverRemaining;
    }
  }

  private initCountdownTicker(): void {
    if (this.countdownTickerSub) {
      this.countdownTickerSub.unsubscribe();
    }
    this.countdownTickerSub = interval(1000).subscribe(() => {
      if (
        this.isPrivateRoomCompleted ||
        this.activePrivateRoom?.status === 'COMPLETED' ||
        this.activePrivateRoom?.race?.status === 'COMPLETED'
      ) {
        this.countdownSeconds = 0;
        this.is3sCountdown = false;
        this.isPreStartCountdown = false;
        return;
      }
      const isRunning = this.isRaceActive;
      const isRoomWaiting = this.isPrivateRoomInWaitingLobby();

      if (!isRunning && !isRoomWaiting && this.countdownSeconds > 0) {
        this.countdownSeconds--;
        if (this.nextRaceInfo) {
          this.nextRaceInfo.secondsRemaining = this.countdownSeconds;
          this.nextRaceInfo.formattedCountdown = this.formattedPreRaceCountdown;
        }
        if (this.countdownSeconds === 0) {
          if (this.nextRaceInfo?.status === 'post_race_pause') {
            this.is3sCountdown = false;
            this.isPreStartCountdown = false;
            this.loadNextRaceInfo();
          } else {
            // Afficher « GO ! » pendant 1s au passage à 0s en attendant/accompagnant le statut RUNNING du backend
            this.triggerGoOverlayHold();
            this.loadNextRaceInfo();
            if (this.siteView === 'regatta' || this.siteView === 'cockpit') {
              this.startImmersionAutoFade();
            }
          }
        } else {
          this.syncCountdownUI();
        }
        this.cdr.markForCheck();
      } else if (isRoomWaiting) {
        this.countdownSeconds = 0;
        this.is3sCountdown = false;
        this.isPreStartCountdown = false;
        this.gameRemainingSeconds = this.gameMaxDurationSeconds || 3300;
        this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
        this.cdr.markForCheck();
      } else if (isRunning && this.gameRemainingSeconds > 0) {
        if (this.is3sCountdown && Date.now() >= this.goHoldUntilMs) {
          this.is3sCountdown = false;
        }
        this.gameRemainingSeconds--;
        this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
        if (this.myActivity && this.nextRaceInfo?.status === 'in_progress') {
          this.myActivity.elapsedTime = Math.max(0, this.gameMaxDurationSeconds - this.gameRemainingSeconds);
        }
        this.cdr.markForCheck();
      } else if (!isRunning) {
        if (this.is3sCountdown && Date.now() >= this.goHoldUntilMs) {
          this.is3sCountdown = false;
        }
        this.gameRemainingSeconds = this.gameMaxDurationSeconds || 3300;
        this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
        this.cdr.markForCheck();
      }
    });
  }

  private syncCountdownUI(): void {
    const now = Date.now();
    if (now < this.goHoldUntilMs) {
      this.is3sCountdown = true;
      this.isPreStartCountdown = false;
      this.threeSecondsCount = 0;
      return;
    }

    const isRunning = this.isRaceActive;
    const isRoomWaiting = this.isPrivateRoomInWaitingLobby();

    if (this.nextRaceInfo?.status === 'post_race_pause') {
      this.is3sCountdown = false;
      this.isPreStartCountdown = false;
      return;
    }

    if (isRunning || isRoomWaiting || this.countdownSeconds <= 0) {
      this.isPreStartCountdown = false;
      this.is3sCountdown = false;
      return;
    }

    if (this.activePrivateRoom && this.countdownSeconds > 15) {
      this.is3sCountdown = false;
      this.isPreStartCountdown = false;
      return;
    }

    if (this.countdownSeconds <= 3) {
      this.is3sCountdown = true;
      this.isPreStartCountdown = false;
      this.threeSecondsCount = this.countdownSeconds;
      if (!this.isAnyModalOpen && this.siteView === 'home' && !this.userExplicitlyNavigatedHome) {
        this.setSiteView('regatta');
      }
    } else {
      this.is3sCountdown = false;
      this.isPreStartCountdown = true;
    }
  }

  resetPublicWaterForNextRace(nextRaceId?: string): void {
    this.goHoldUntilMs = 0;
    this.goTransitionLockUntilMs = 0;
    this.racers = [];
    this.liveMetricsList = [];
    this.myActivity = null;
    this.finishedRacerIds.clear();
    this.finisherCount = 0;
    this.totalActiveRacers = 0;
    this.activeRacersCount = 0;
    this.distToLeader = 0;
    this.distToPrev = 0;
    this.distToNext = 0;
    this.raceMonotonicStartTimestamp = null;
    this.raceMonotonicMaxElapsed = 0;
    this.lastSocketUpdateAtMs = 0;
    this.lastHttpSyncAtMs = 0;
    if (nextRaceId) {
      this.syncSocketRoom(nextRaceId);
    }
  }

  loadNextRaceInfo(): void {
    this.pollActiveRaceSource().subscribe((data) => {
      if (data) {
        const isNewPublicRace = Boolean(
          !this.activePrivateRoom &&
          data.race?.id &&
          this.nextRaceInfo?.race?.id &&
          data.race.id !== this.nextRaceInfo.race.id
        );
        if (isNewPublicRace) {
          this.goHoldUntilMs = 0;
          this.goTransitionLockUntilMs = 0;
        }
        const inGoTransition = Date.now() < this.goTransitionLockUntilMs && !isNewPublicRace && (data.secondsRemaining ?? 0) <= 5;
        this.nextRaceInfo = data;
        if (inGoTransition) {
          this.nextRaceInfo.status = 'in_progress';
          this.nextRaceInfo.secondsRemaining = 0;
          if (this.nextRaceInfo.race) {
            this.nextRaceInfo.race.status = 'RUNNING';
            (this.nextRaceInfo.race as any).internalStatus = 'RUNNING';
          }
          if (this.activePrivateRoom && data.race?.type === 'PRIVATE_INVITE') {
            this.activePrivateRoom.status = 'RUNNING';
            (this.activePrivateRoom as any).internalStatus = 'RUNNING';
            if (this.activePrivateRoom.race) {
              this.activePrivateRoom.race.status = 'RUNNING';
              (this.activePrivateRoom.race as any).internalStatus = 'RUNNING';
            }
          }
        }
        if (data.race?.id) {
          this.syncSocketRoom(data.race.id);
        }
        if (isNewPublicRace) {
          this.countdownSeconds = data.secondsRemaining;
        } else {
          this.applyMonotonicServerCountdown(data.secondsRemaining);
        }
        this.syncCountdownUI();
        if (isNewPublicRace || (!this.activePrivateRoom && this.liveMetricsList.length === 0 && data.race?.id)) {
          this.rowerService.getRaceLeaderboard(data.race.id).pipe(
            catchError(() => of({ leaderboard: [] }))
          ).subscribe((lb: any) => {
            if (this.nextRaceInfo?.race?.id === data.race.id && Array.isArray(lb?.leaderboard)) {
              const activeRows = lb.leaderboard.filter((r: any) => r.status !== 'abandoned');
              this.racers = activeRows.map((r: any) => ({
                ...r,
                netDistance: r.netDistance || 0,
                currentDistance: r.netDistance || 0,
              }));
              this.liveMetricsList = activeRows.map((r: any, idx: number) => ({
                lane: Number(r.lane) || (idx + 1),
                userId: r.userId,
                name: r.userName || r.name || r.userId,
                dist: r.netDistance || 0,
                split: r.avgPaceSec || 120,
                watts: 0,
                spm: 0,
                status: r.status || 'waiting',
                ready: true,
                connectionState: 'READY',
                isBot: Boolean(r.isBot),
                isPaired: Boolean(r.isPaired),
                kayak: r.kayak,
              }));
              this.totalActiveRacers = this.liveMetricsList.length;
              this.activeRacersCount = this.liveMetricsList.length;
              this.cdr.markForCheck();
            }
          });
        }
        this.cdr.markForCheck();
      }
    });
  }

  private syncSocketRoom(raceId: string): void {
    if (!raceId) return;
    if (this.joinedSocketRaceId && this.joinedSocketRaceId !== raceId) {
      this.socketService.leaveRaceRoom(this.joinedSocketRaceId);
    }
    if (this.joinedSocketRaceId !== raceId) {
      this.joinedSocketRaceId = raceId;
      this.socketService.joinRaceRoom(raceId);
    }
  }

  private resolveRoomFromCurrentUrl(): void {
    if (typeof window === 'undefined') {
      this.initGameLoop();
      return;
    }

    if (window.location.pathname === '/admin') {
      if (this.isUserAdmin) {
        this.isAdminDashboardOpen = true;
      } else {
        this.isAdminDashboardOpen = false;
        try { window.history.replaceState({}, '', '/'); } catch {}
      }
      this.cdr.markForCheck();
    }

    const extracted = extractRoomFromLocation(window.location.pathname, window.location.search);
    const isRegattaRequested = isRegattaModeRequested(window.location.search);
    const emailParam = extractInvitationEmail(window.location.search);

    const inAppInfo = detectInAppBrowser();
    this.isInAppBrowser = inAppInfo.isInApp;
    this.isIosInApp = inAppInfo.isIosInApp;
    this.isAndroidInApp = inAppInfo.isAndroidInApp;

    // Tentative d'échappement automatique de la WebView sur Android vers le navigateur externe par défaut
    if (inAppInfo.isAndroidInApp && typeof window !== 'undefined') {
      try {
        const hasEscaped = sessionStorage.getItem('rower_inapp_escape_attempted');
        if (!hasEscaped) {
          sessionStorage.setItem('rower_inapp_escape_attempted', '1');
          const intentUrl = buildAndroidIntentUrl(window.location.href);
          if (intentUrl) {
            window.location.href = intentUrl;
          }
        }
      } catch {}
    }

    if (emailParam) {
      this.invitationEmail = emailParam;
      if (!this.loginAccountInput) {
        this.loginAccountInput = emailParam;
      }
      if (!this.regEmail) {
        this.regEmail = emailParam;
      }
    }
    if (extracted && extracted.valid) {
      // Un clic sur un lien e-mail de salon privé ou duel (/r/:code) arrive toujours sur la page d'accueil du salon ou du duel (jamais directement en vue régate)
      this.pendingRegattaLaunch = false;
      this.isRegattaLaunchSplashOpen = false;
      this.setSiteView('home');
      this.userExplicitlyNavigatedHome = true;
    } else if (isRegattaRequested) {
      this.pendingRegattaLaunch = false;
      this.isRegattaLaunchSplashOpen = false;
      this.setSiteView('home');
      this.userExplicitlyNavigatedHome = true;
    }

    if (!extracted) {
      if (this.showResetFields || this.resetToken || (typeof window !== 'undefined' && (window.location.pathname === '/reset-password' || window.location.pathname.startsWith('/reset-password')))) {
        // En cours de réinitialisation de mot de passe : maintenir la vue accueil et la modale active sans basculer sur la régate
        return;
      }
      this.rowerService.getMyActiveRace(this.activeUserId, this.deviceToken).pipe(
        catchError(() => of({ activeRoom: null }))
      ).subscribe((res) => {
        const active = res?.activeRoom;
        if (
          active &&
          active.race?.id &&
          active.status !== 'STOPPED' &&
          active.status !== 'CANCELLED' &&
          active.status !== 'ABANDONED' &&
          active.race?.status !== 'CANCELLED' &&
          active.race?.status !== 'ABANDONED'
        ) {
          const isCompleted =
            active.race?.status === 'COMPLETED' ||
            active.status === 'COMPLETED' ||
            active.status === 'finished';
          if (isCompleted) {
            this.isPrivateRoomCompleted = true;
            this.isPostRaceRankingActive = true;
          }
          if (active.lane) {
            this.myAssignedLane = active.lane;
          }
          const wasAwaitingWatchPin = this.isAwaitingWatchPin;
          this.isAwaitingWatchPin = Boolean(active.isAwaitingWatchPin);
          if (this.isAwaitingWatchPin && !wasAwaitingWatchPin) {
            this.playDiscreteNotificationChime();
          }
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('rower_active_private_room_id', active.race.id);
              if (active.code || active.race?.code) {
                localStorage.setItem('rower_active_private_room_code', (active.code || active.race?.code || ''));
              }
            }
          } catch {}
          this.activatePrivateRoom(active, false, false);
          this.setSiteView('regatta');
          if (isCompleted && active.race?.id) {
            this.openRaceLeaderboard(active.race.id);
          }
          this.cdr.markForCheck();
        } else {
          if (this.activePrivateRoom) {
            this.activePrivateRoom = null;
            this.updateDocumentTitle();
          }
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('rower_active_private_room_id');
              localStorage.removeItem('rower_active_private_room_code');
            }
          } catch {}
          this.initGameLoop();
        }
      });
      return;
    }

    if (!extracted.valid) {
      const msg =
        extracted.reason === 'empty'
          ? this.i18n.t('JOIN_ERR_EMPTY')
          : this.i18n.t('JOIN_ERR_FORMAT');
      this.exitPrivateRoomToPublic(true, msg);
      this.initGameLoop();
      return;
    }

    this.rowerService.openRoom(extracted.value, this.activeUserId, this.currentUser.name).subscribe({
      next: (joinRes) => {
        const assignedLane = joinRes.lane || 0;
        this.myAssignedLane = assignedLane;
        const roomIdent = joinRes.code || extracted.value;
        this.rowerService.getPrivateRace(roomIdent).subscribe({
          next: (room) => {
            (room as any).lane = assignedLane;
            this.activatePrivateRoom(room, false, true);
            this.setSiteView('home');
            this.userExplicitlyNavigatedHome = true;
            const hasDuelChallenge = typeof window !== 'undefined' && (window.location.search.includes('duelChallenge') || window.location.search.includes('duelInviteToken'));
            if (!hasDuelChallenge) {
              this.isPrivateModalOpen = true;
              this.privateModalTab = 'share';
            }
            if (!this.isIdentified && emailParam) {
              this.loginAccountInput = emailParam;
              this.regEmail = emailParam;
            }
            this.cdr.markForCheck();
          },
          error: () => {
            this.exitPrivateRoomToPublic(true, this.i18n.t('JOIN_ERR_NOT_FOUND'));
            this.initGameLoop();
          }
        });
      },
      error: (err) => {
        let msg = this.i18n.t('JOIN_ERR_NOT_FOUND');
        if (err?.status === 409) {
          msg = err?.error?.error || "Salon complet - quota atteint";
        } else if (err?.status === 403) {
          msg = err?.error?.error || "Accès refusé pour ce salon";
        }
        this.exitPrivateRoomToPublic(true, msg);
        this.initGameLoop();
      }
    });
  }

  formatDetailedCountdown(msUntilStart: number): string {
    if (msUntilStart <= 0) return 'imminent';
    const totalSec = Math.max(0, Math.ceil(msUntilStart / 1000));
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (days > 0) {
      return `${days}j ${hours}h ${minutes}m ${seconds}s`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (seconds > 0 && minutes > 0) {
      return `${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;
    }
    if (seconds > 0 && minutes === 0) {
      return `${seconds}s`;
    }
    return `${minutes} min`;
  }

  getWaitingStatusText(): string {
    const race = this.activePrivateRoom?.race || (this.nextRaceInfo as any)?.race || (this.nextRaceInfo as any);
    if (!race && !this.activePrivateRoom) {
      return '';
    }
    const status = this.nextRaceInfo?.status || race?.status;
    if (status === 'in_progress' || status === 'RUNNING') {
      return this.formattedGameRemaining ? ('Fin dans : ' + this.formattedGameRemaining) : 'Course en cours';
    }
    if (status === 'finished' || status === 'completed' || status === 'COMPLETED') {
      return 'Course terminée';
    }
    if (this.isPreStartCountdown || this.is3sCountdown || status === 'countdown') {
      return `Départ dans ${this.formattedPreRaceCountdown}`;
    }
    const isScheduled = race?.startMode === 'scheduled' || (this.activePrivateRoom as any)?.startMode === 'scheduled';
    if (isScheduled) {
      const scheduledTime = race?.scheduledStartTime || (this.activePrivateRoom as any)?.scheduledStartTime;
      if (scheduledTime) {
        const d = new Date(scheduledTime);
        const ms = d.getTime() - Date.now();
        const localTimeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isSameDay = new Date().toDateString() === d.toDateString();
        const localDateStr = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
        if (ms <= 0) {
          return `Départ imminent (prévu à ${localTimeStr})`;
        }
        const durationStr = this.formatDetailedCountdown(ms);
        if (isSameDay) {
          return `Départ prévu à ${localTimeStr} (dans ${durationStr})`;
        } else {
          return `Départ prévu ${localDateStr} à ${localTimeStr} (dans ${durationStr})`;
        }
      }
    }
    const lobbyEndsAt = race?.lobbyEndsAt || (this.activePrivateRoom as any)?.lobbyEndsAt;
    if (lobbyEndsAt && (race?.autoStart || (this.activePrivateRoom as any)?.autoStart)) {
      const ms = new Date(lobbyEndsAt).getTime() - Date.now();
      if (ms > 0) {
        const durationStr = this.formatDetailedCountdown(ms);
        return `Départ dans ${durationStr}`;
      }
    }
    const serverMsg = (this.activePrivateRoom as any)?.waitingStatusMessage || race?.waitingStatusMessage;
    if (serverMsg) {
      return serverMsg;
    }
    const parts: any[] = race?.participants || (this.activePrivateRoom as any)?.participants || [];
    const anyNotReady = parts.some((p: any) => p.ready === false || p.connectionState === 'CONNECTED');
    const isDuel = Boolean(race?.isDuel1v1 || (this.activePrivateRoom as any)?.isDuel1v1);
    if (isDuel) {
      const pCount = parts.length || (this.activePrivateRoom as any)?.totalParticipants || 0;
      if (pCount < 2) {
        return "En attente de l'adversaire...";
      }
      if (anyNotReady) {
        return "Adversaire en cours de connexion au rameur...";
      }
      return "Rameur prêt - En attente du départ";
    }
    const isBot = Boolean(race?.isBotDuel || (this.activePrivateRoom as any)?.isBotDuel);
    if (isBot) {
      if (anyNotReady) {
        return `Ligne ${this.myAssignedLane || 1} attribuée - Donnez un coup de rame pour réveiller le rameur`;
      }
      return "Rameur prêt - En attente du départ";
    }
    if (anyNotReady) {
      return "En attente de connexion au rameur...";
    }
    return "En attente du signal de départ de l'organisateur...";
  }

  private activatePrivateRoom(room: PrivateRacePayload, pushHistory: boolean, isPreview: boolean = false): void {
    const prevRoomId = this.activePrivateRoom?.race?.id;
    if (!prevRoomId || prevRoomId !== room.race?.id) {
      this.myActivity = null;
      this.finishedRacerIds.clear();
      this.hasCelebratedFinish = false;
      this.showFinishCelebration = false;
      if (this.finishCelebrationTimer) {
        clearTimeout(this.finishCelebrationTimer);
        this.finishCelebrationTimer = null;
      }
    }
    this.activePrivateRoom = room;
    this.nextRaceInfo = room;
    this.isPrivateRoomPreview = isPreview;
    if ((room as any).lane !== undefined) {
      this.myAssignedLane = Number((room as any).lane) || 0;
    } else if (isPreview) {
      this.myAssignedLane = 0;
    }
    this.privateUrlError = '';

    if (room.remainingSeconds !== undefined) {
      this.gameRemainingSeconds = room.remainingSeconds;
      this.gameMaxDurationSeconds = room.maxDurationSeconds || this.gameMaxDurationSeconds;
      this.formattedGameRemaining = this.i18n.formatDetailedCountdown(this.gameRemainingSeconds);
    }

    const code = room.code || room.race?.code;
    if (typeof window !== 'undefined' && code) {
      const targetPath = `/r/${encodeURIComponent(code)}`;
      if (!isPreview && (window.location.pathname !== targetPath || window.location.search)) {
        if (pushHistory) {
          window.history.pushState({ roomCode: code }, '', targetPath);
        } else {
          window.history.replaceState({ roomCode: code }, '', targetPath);
        }
      }
    }

    // L'ouverture d'un salon ou duel depuis le web ne doit pas le rendre comme salon actif par défaut.
    // C'est la saisie du code PIN depuis la montre qui rend le salon ou le duel visible par défaut à la place de la course publique.
    try {
      if (typeof localStorage !== 'undefined') {
        if (!isPreview && room?.race?.id) {
          localStorage.setItem('rower_active_private_room_id', room.race.id);
          if (room.code || room.race?.code) {
            localStorage.setItem('rower_active_private_room_code', (room.code || room.race?.code || ''));
          }
        } else if (isPreview) {
          localStorage.removeItem('rower_active_private_room_id');
          localStorage.removeItem('rower_active_private_room_code');
        }
      }
    } catch {}

    this.updateDocumentTitle();
    this.syncSocketRoom(room.race.id);

    // Synchroniser immédiatement les participants engagés (bots ou humains ayant validé le PIN sur leur montre) sur leurs lignes d'eau
    const roomParts = room?.race?.participants || [];
    if (Array.isArray(roomParts) && roomParts.length > 0) {
      for (const p of roomParts) {
        if (!p.userId) continue;
        const isBot = Boolean(p.isBot) || String(p.userId).startsWith('bot_');
        const isEngagedOnLane = isBot || Boolean(p.pinValidated !== false && p.connectionState !== 'PENDING_PIN');
        if (!isEngagedOnLane) continue;
        const pLane = Number(p.lane) || (this.liveMetricsList.length + 1);
        if (!this.liveMetricsList.some(m => m.userId === p.userId || m.lane === pLane)) {
          const isMe = p.userId === this.activeUserId;
          const pKayak = (isMe && this.committedKayakCustomization)
            ? this.committedKayakCustomization
            : p.kayak;
          this.liveMetricsList.push({
            lane: pLane,
            userId: p.userId,
            name: (p as any).name || p.userName || p.userId,
            dist: 0,
            split: 120,
            watts: 0,
            spm: 0,
            ready: p.ready !== false,
            connectionState: p.connectionState || 'CONNECTED',
            kayak: pKayak,
            status: room.race?.status === 'RUNNING' ? 'in_progress' : 'waiting',
            isBot,
            isPaired: Boolean(p.isPaired || p.deviceToken || isMe)
          } as any);
        }
      }
      this.liveMetricsList = [...this.liveMetricsList];
    }

    this.pendingRegattaLaunch = false;
    this.isRegattaLaunchSplashOpen = false;

    this.initGameLoop();
    this.cdr.markForCheck();
  }

  leaveCompletedPrivateRoom(): void {
    if (this.isRaceLeaderboardModalOpen) {
      this.closeRaceLeaderboardModal();
    }
    this.isPrivateRoomCompleted = false;
    this.exitPrivateRoomToPublic(true);
    this.initGameLoop();
    this.cdr.markForCheck();
  }

  exitPrivateRoomToPublic(resetUrl: boolean, notFoundMessage?: string): void {
    this.isPrivateRoomPreview = false;
    this.isPublicRacePreview = false;
    if (this.activePrivateRoom) {
      const roomIdent = this.activePrivateRoom.race?.id || this.activePrivateRoom.code;
      if (roomIdent && this.activeUserId) {
        this.rowerService.leaveRoom(roomIdent, this.activeUserId).subscribe({
          next: () => {},
          error: (err) => console.warn('Could not notify leaveRoom to backend in exitPrivateRoomToPublic:', err)
        });
      }
    }
    this.activePrivateRoom = null;
    this.isPrivateRoomCompleted = false;
    this.isAwaitingWatchPin = false;
    this.isRegattaLaunchSplashOpen = false;
    this.pendingRegattaLaunch = false;
    this.racers = [];
    this.liveMetricsList = [];
    this.myActivity = null;
    this.finishedRacerIds.clear();
    this.finisherCount = 0;
    this.totalActiveRacers = 0;
    this.myAssignedLane = 1;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('rower_active_private_room_id');
        localStorage.removeItem('rower_active_private_room_code');
      }
    } catch {}
    if (resetUrl && typeof window !== 'undefined') {
      if (window.location.pathname !== '/' || window.location.search) {
        window.history.replaceState({}, '', '/');
      }
    }
    this.updateDocumentTitle();
    if (notFoundMessage) {
      this.privateUrlError = notFoundMessage;
      this.openPrivateModal('join');
    }
    this.cdr.markForCheck();
  }

  private updateDocumentTitle(): void {
    if (typeof document === 'undefined') return;
    if (this.activePrivateRoom) {
      document.title = `🔒 ${this.activePrivateRoom.race.title} — Rower Race`;
    } else {
      document.title = 'Rower Race — Pro Esport Regatta';
    }
  }
}

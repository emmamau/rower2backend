import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { WakeLockService } from './services/wake-lock.service';
import { I18nService, SupportedLang } from './services/i18n.service';
import { SocketService, LiveRacerMetric } from './services/socket.service';
import { RegattaCanvasComponent } from './components/regatta-canvas/regatta-canvas.component';
import {
  PrivateRoomManagerComponent,
  PrivateModalTab
} from './components/private-room-manager/private-room-manager.component';
import { RowerData, NextRaceInfo, PastRaceResult, PrivateRacePayload } from './models/rower-data.model';
import { extractRoomFromLocation } from './utils/room-link.util';
import { UserProfile, UserHistoryItem } from './models/user.model';
import { getLeagueByPoints, LeagueInfo } from './utils/league.util';
import { interval, Subscription, of, Observable } from 'rxjs';
import { switchMap, startWith, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RegattaCanvasComponent, PrivateRoomManagerComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, OnDestroy {
  protected Math = Math;

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
  threeSecondsCount = 3;

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
  isPostRaceRankingActive = false;

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

  // Offres d'abonnement & Lemon Squeezy
  isSubscriptionModalOpen = false;
  subscriptionTiers: any[] = [];
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
  accountModalTab: 'login' | 'register' | 'profile' | 'forgot' = 'login';
  accountAuthError = '';
  accountAuthSuccess = '';
  isAccountSubmitting = false;

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
  regWatchUserId = '';

  // Forgot / Reset inputs
  forgotEmailOrLogin = '';
  resetToken = '';
  resetNewPassword = '';
  showResetFields = false;

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

  // Mini-leaderboard cockpit rétractable & déplaçable (Draggable Leaderboard)
  isCockpitLeaderboardCollapsed = true;
  cockpitLeaderboardPos: { x: number; y: number } | null = null;
  isDraggingCockpitLeaderboard = false;
  private dragStartCockpitPointer = { x: 0, y: 0 };
  private dragStartCockpitPos = { x: 0, y: 0 };
  private hasMovedCockpitLeaderboard = false;

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
  // Private Salons state
  activePrivateRoom: PrivateRacePayload | null = null;
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
        this.cdr.markForCheck();
      }
    }
  };
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
    this.syncRigidViewport();
    this.cdr.markForCheck();
  };

  private readonly fullscreenErrorListener = () => {
    this.isPseudoFullscreen = true;
    this.syncPseudoFullscreenClass();
    this.isFullscreen = true;
    this.syncRigidViewport();
    this.cdr.markForCheck();
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
    const storedDeviceToken = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_device_token') : null;
    const storedIsPaired = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_is_paired') === 'true' : false;

    // Liaison stricte au compte actif : le statut appairé est rattaché à la session du compte connecté
    if (!storedLogin) {
      this.isPaired = false;
      this.isWatchConfirmed = false;
      this.deviceToken = '';
      try {
        localStorage.removeItem('rower_is_paired');
        localStorage.removeItem('rower_watch_confirmed');
        localStorage.removeItem('rower_device_token');
      } catch {}
    } else {
      this.isPaired = storedIsPaired && !!storedDeviceToken;
      this.isWatchConfirmed = this.isPaired;
      if (storedDeviceToken) {
        this.deviceToken = storedDeviceToken;
      }
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
    this.currentUser.isAdmin = isEmma || storedIsAdmin;
    this.currentUser.isSubscriber = isEmma || storedIsSub;
  }

  ngOnInit(): void {
    this.activeViewMode = this.detectTerminalViewMode();
    this.syncSeoLanguage(this.i18n.getCurrentLang());
    this.loadUserProfile();
    this.loadGeneralLeaderboard();
    this.loadPastRaces();
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
      }
    } catch {}
    if (typeof window !== 'undefined') {
      setTimeout(() => this.clampCurrentCockpitPosition(), 60);
    }
  }

  ngOnDestroy(): void {
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

    this.pollingSub = interval(1500)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.pollActiveRaceSource().pipe(
            catchError((err) => {
              this.backendConnected = err.status !== 0;
              this.errorMessage = err.status === 0 ? 'Connexion en attente avec le backend (' + this.apiUrl + ')' : '';
              this.cdr.markForCheck();
              return of(null);
            })
          )
        )
      )
      .subscribe((raceData) => {
        if (raceData) {
          this.backendConnected = true;
          this.nextRaceInfo = raceData;
          if (this.activePrivateRoom && raceData.race.type === 'PRIVATE_INVITE') {
            this.activePrivateRoom = raceData as PrivateRacePayload;
          }
          this.syncSocketRoom(raceData.race.id);
          this.countdownSeconds = raceData.secondsRemaining;
          this.gameRemainingSeconds = raceData.remainingSeconds !== undefined ? raceData.remainingSeconds : 3300;
          this.gameMaxDurationSeconds = raceData.maxDurationSeconds || 3300;
          const remMin = Math.floor(this.gameRemainingSeconds / 60);
          const remSec = this.gameRemainingSeconds % 60;
          this.formattedGameRemaining = `${remMin}m ${remSec < 10 ? '0' : ''}${remSec}s`;
          this.configTargetDistance = raceData.race.targetDistance;
          this.configIntervalMinutes = raceData.race.intervalMinutes;

          // Décompte visuel synchronisé avec le backend et la montre
          const isRunning = raceData.status === 'in_progress' ||
                            raceData.race?.status === 'RUNNING' ||
                            raceData.race?.status === 'in_progress';
          if (isRunning) {
            this.countdownSeconds = 0;
            this.is3sCountdown = false;
            this.isPreStartCountdown = false;
            if (this.siteView === 'home' && !this.userExplicitlyNavigatedHome) {
              this.siteView = this.activeViewMode === 'cockpit' ? 'cockpit' : 'regatta';
            }
          } else {
            const serverRemaining = raceData.secondsRemaining;
            if (serverRemaining !== undefined && serverRemaining !== null) {
              // Réconciliation douce : n'écrase pas le décompte local actif sauf si reset/nouveau joueur (diff > 3s)
              if (this.countdownSeconds <= 0 || Math.abs(this.countdownSeconds - serverRemaining) > 3) {
                this.countdownSeconds = serverRemaining;
              }
            }
            this.syncCountdownUI();
          }

          // Fetch Live Leaderboard
          this.rowerService.getRaceLeaderboard(raceData.race.id).pipe(
            catchError(() => of({ activityId: raceData.race.id, totalParticipants: 0, leaderboard: [] }))
          ).subscribe((lb) => {
            this.racers = lb.leaderboard;
            this.activeRacersCount = Math.max(raceData.totalParticipants || 0, this.racers.filter(r => r.status !== 'abandoned').length);

            // Calcul du classement et des écarts de distance en direct
            const activeList = this.racers.filter(r => r.status !== 'abandoned');
            this.totalActiveRacers = activeList.length;
            const roomParts = this.activePrivateRoom?.race?.participants || [];
            this.liveMetricsList = activeList.map((r, idx) => {
              const isMe = r.userId === this.activeUserId;
              const assignedLane = isMe && this.myAssignedLane ? this.myAssignedLane : ((r as any).lane || idx + 1);
              const partInfo = roomParts.find(p => p.userId === r.userId);
              const isRowerAwake = (r.lastPower || 0) > 0 || (r.lastStrokeRate || 0) > 0 || (r.netDistance || 0) > 0;
              const readyVal = partInfo && partInfo.ready !== undefined ? partInfo.ready : (isRowerAwake || Boolean(r.userId?.startsWith('bot_')));
              return {
                lane: assignedLane,
                userId: r.userId,
                name: r.userName || r.userId,
                dist: r.netDistance || 0,
                split: r.lastPace || r.avgPace || 120,
                watts: r.lastPower || r.avgPower || 0,
                spm: r.lastStrokeRate || r.avgStrokeRate || 0,
                heartRate: r.lastHeartRate,
                status: r.status || 'in_progress',
                ready: readyVal,
                connectionState: readyVal ? 'READY' : 'CONNECTED'
              };
            });
            const myIdx = activeList.findIndex(r => r.userId === this.activeUserId);

            if (myIdx >= 0) {
              this.myRank = myIdx + 1;
              const myDist = activeList[myIdx].netDistance || 0;
              const leaderDist = activeList[0]?.netDistance || 0;
              this.distToLeader = Math.max(0, leaderDist - myDist);
              this.distToPrev = myIdx > 0 ? Math.max(0, (activeList[myIdx - 1]?.netDistance || 0) - myDist) : 0;
              this.distToNext = myIdx < activeList.length - 1 ? Math.max(0, myDist - (activeList[myIdx + 1]?.netDistance || 0)) : 0;
            } else {
              this.myRank = null;
              this.distToLeader = 0;
              this.distToPrev = 0;
              this.distToNext = 0;
            }

            // CORRECTION AFFICHAGE DONNÉES UTILISATEUR :
            // 1. Chercher d'abord dans le leaderboard de la course
            const foundInRace = this.racers.find(r => r.userId === this.activeUserId);
            if (foundInRace) {
              this.myActivity = foundInRace;
              this.cdr.markForCheck();
            } else {
              // 2. Si pas encore dans cette course, interroger son activité récente directement par son userId
              this.rowerService.getUserLatestActivity(this.activeUserId).pipe(
                catchError(() => of(null))
              ).subscribe((latest) => {
                if (latest) {
                  this.myActivity = latest;
                }
                this.cdr.markForCheck();
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
        this.currentUser = { ...res.user, name: res.user.login || res.user.name };
        this.userHistory = res.history || [];
        this.generalUserRank = res.generalRank || 1;
        this.generalTotalPlayers = res.totalPlayers || 1;
        this.cdr.markForCheck();
      }
    });
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

  setBotDuelPresetDistance(dist: number): void {
    this.botDuelDistance = dist;
    this.cdr.markForCheck();
  }

  startBotDuel(): void {
    if (this.botDuelDistance < 100 || this.botDuelDistance > 10000) {
      this.botDuelError = 'Veuillez choisir une distance comprise entre 100m et 10 000m.';
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

  loadPastRaces(): void {
    this.rowerService.getRaceHistory().pipe(
      catchError(() => of([]))
    ).subscribe((history) => {
      this.raceHistory = history;
      this.cdr.markForCheck();
    });
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

  formatPace(seconds?: number): string {
    if (!seconds || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  formatTime(seconds?: number): string {
    if (!seconds || seconds <= 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  get isUserAdmin(): boolean {
    return Boolean(
      this.currentUser.isAdmin ||
      this.currentUser.name?.toLowerCase() === 'emmaracer' ||
      this.activeUserId?.toLowerCase() === 'emmaracer'
    );
  }

  get isSubscriber(): boolean {
    return Boolean(
      this.isUserAdmin ||
      this.currentUser.isSubscriber ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('rower_is_subscriber') === 'true')
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

  get currentSubscriberTier(): string {
    if (this.isUserAdmin) return 'admin';
    return this.currentUser?.subscriptionTier || (this.isSubscriber ? 'club' : 'free');
  }

  openAccountModal(tab: 'login' | 'register' | 'profile' | 'forgot' = 'login'): void {
    if (tab === 'login' && (this.isSubscriber || this.isUserAdmin)) {
      this.accountModalTab = 'profile';
    } else {
      this.accountModalTab = tab;
    }
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.isAccountModalOpen = true;
    this.cdr.markForCheck();
  }

  closeAccountModal(): void {
    this.isAccountModalOpen = false;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';
    this.cdr.markForCheck();
  }

  submitAccountLogin(): void {
    if (!this.loginAccountInput.trim() || !this.passwordAccountInput.trim()) {
      this.accountAuthError = 'Veuillez saisir votre login et votre mot de passe.';
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.loginUser({
      login: this.loginAccountInput.trim(),
      password: this.passwordAccountInput.trim(),
    }).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          this.activeUserId = userLogin;
          this.userIdInput = res.user.watchUserId || userLogin;
          // Règle stricte d'identité joueur : utilisateur connecté => login/username exclusif
          this.currentUser = { ...res.user, name: userLogin };
          this.userLoginInput = userLogin;

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', userLogin);
            localStorage.setItem('rower_is_subscriber', String(Boolean(res.isSubscriber)));
            localStorage.setItem('rower_is_admin', String(Boolean(res.isAdmin)));
          } catch {}

          this.accountAuthSuccess = 'Connexion réussie ! Vous avez accès aux salons privés.';
          this.loadUserProfile();
          this.loadGeneralLeaderboard();
          setTimeout(() => {
            this.accountModalTab = 'profile';
            this.cdr.markForCheck();
          }, 800);
        } else {
          this.accountAuthError = res.message || 'Identifiants invalides.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = err.error?.message || 'Erreur lors de la connexion. Vérifiez vos identifiants.';
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
      this.accountAuthError = 'Tous les champs obligatoires (nom, prénom, année, sexe, pays, login, email, mot de passe) doivent être renseignés.';
      return;
    }

    if (this.regPassword.trim().length < 4) {
      this.accountAuthError = 'Le mot de passe doit comporter au moins 4 caractères.';
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

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
    }).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        if (res.success && res.user) {
          const userLogin = res.user.login || res.user.id;
          this.activeUserId = userLogin;
          this.userIdInput = res.user.watchUserId || userLogin;
          this.currentUser = res.user;
          this.userLoginInput = res.user.name || userLogin;

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', res.user.name || userLogin);
            localStorage.setItem('rower_is_subscriber', 'true');
            localStorage.setItem('rower_is_admin', String(Boolean(res.user.isAdmin)));
          } catch {}

          this.accountAuthSuccess = 'Compte créé avec succès ! Votre statut abonné est actif. Vous pouvez dès maintenant créer des salons privés.';
          this.loadUserProfile();
          this.loadGeneralLeaderboard();
          setTimeout(() => {
            this.accountModalTab = 'profile';
            this.cdr.markForCheck();
          }, 1200);
        } else {
          this.accountAuthError = res.message || 'Erreur lors de la création du compte.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = err.error?.message || 'Erreur lors de l’inscription.';
        this.cdr.markForCheck();
      }
    });
  }

  submitForgotPassword(): void {
    if (!this.forgotEmailOrLogin.trim()) {
      this.accountAuthError = 'Veuillez saisir votre email ou login.';
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.forgotPassword(this.forgotEmailOrLogin.trim()).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        this.accountAuthSuccess = res.message || 'Demande de réinitialisation envoyée.';
        this.showResetFields = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = err.error?.message || 'Erreur lors de la demande de réinitialisation.';
        this.cdr.markForCheck();
      }
    });
  }

  submitResetPassword(): void {
    if (!this.resetToken.trim() || !this.resetNewPassword.trim()) {
      this.accountAuthError = 'Veuillez fournir le jeton et un nouveau mot de passe.';
      return;
    }

    this.isAccountSubmitting = true;
    this.accountAuthError = '';
    this.accountAuthSuccess = '';

    this.rowerService.resetPassword(this.resetToken.trim(), this.resetNewPassword.trim()).subscribe({
      next: (res) => {
        this.isAccountSubmitting = false;
        this.accountAuthSuccess = res.message || 'Mot de passe réinitialisé ! Vous pouvez vous connecter.';
        this.accountModalTab = 'login';
        this.loginAccountInput = this.forgotEmailOrLogin;
        this.passwordAccountInput = this.resetNewPassword;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isAccountSubmitting = false;
        this.accountAuthError = err.error?.message || 'Jeton invalide ou expiré.';
        this.cdr.markForCheck();
      }
    });
  }

  logoutUser(): void {
    try {
      localStorage.removeItem('rower_user_id');
      localStorage.removeItem('rower_user_login');
      localStorage.removeItem('rower_is_subscriber');
      localStorage.removeItem('rower_is_admin');
    } catch {}

    // Dès la déconnexion, réinitialiser immédiatement tout statut et affichage d'appairage Garmin
    this.resetGarminPairing();
    this.myAssignedLane = 1;
    this.myActivity = null;
    this.selectedSpectatorUserId = '';
    this.activePrivateRoom = null;
    this.isWatchGuidanceModalOpen = false;
    this.isLoginModalOpen = false;

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
    };
    this.userLoginInput = this.currentUser.name;
    this.accountModalTab = 'login';
    this.accountAuthSuccess = 'Vous avez été déconnecté.';
    this.cdr.markForCheck();
  }

  get isOrganizerOfActiveRoom(): boolean {
    if (!this.activePrivateRoom) return false;
    const hostId = this.activePrivateRoom.race?.hostUserId;
    return Boolean(hostId && this.activeUserId && hostId === this.activeUserId);
  }

  get isRaceActive(): boolean {
    return Boolean(
      this.nextRaceInfo?.status === 'in_progress' ||
      this.nextRaceInfo?.race?.status === 'RUNNING' ||
      this.nextRaceInfo?.race?.status === 'in_progress'
    );
  }

  get formattedPreRaceCountdown(): string {
    const s = Math.max(0, Math.floor(this.countdownSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec < 10 ? '0' : ''}${sec}s`;
  }

  get canStopRace(): boolean {
    if (!this.isRaceActive) return false;
    return this.isUserAdmin || this.isOrganizerOfActiveRoom;
  }

  stopActiveRace(): void {
    if (!this.canStopRace || !this.nextRaceInfo) return;
    const confirmed = window.confirm(
      "Voulez-vous vraiment arrêter la course en cours ? Le classement officiel final sera immédiatement établi selon la position des coureurs."
    );
    if (!confirmed) return;
    const raceId = this.nextRaceInfo.race?.id;
    if (!raceId) return;

    this.rowerService.stopRace(raceId, this.activeUserId).subscribe({
      next: (res) => {
        alert(res.message || "Course arrêtée ! Le classement a été établi.");
        this.initGameLoop();
        this.cdr.markForCheck();
      },
      error: (err) => {
        alert(err.error?.message || "Erreur lors de l'arrêt de la course.");
      }
    });
  }

  onLanguageSelectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select && select.value) {
      this.changeLanguage(select.value);
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
    this.i18n.setLang(langCode as SupportedLang);
    this.syncSeoLanguage(langCode);
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

  setSiteView(view: 'home' | 'regatta' | 'cockpit'): void {
    this.siteView = view;
    if (view === 'regatta') {
      this.userOverrodeViewMode = true;
      this.activeViewMode = 'canvas';
      this.userExplicitlyNavigatedHome = false;
      if (this.isMobileOrTablet && !this.checkIsFullscreen()) {
        this.enterFullscreen().catch(() => {});
      }
      this.startImmersionAutoFade();
    } else if (view === 'cockpit') {
      this.userOverrodeViewMode = true;
      this.activeViewMode = 'cockpit';
      this.userExplicitlyNavigatedHome = false;
      if (this.isMobileOrTablet && !this.checkIsFullscreen()) {
        this.enterFullscreen().catch(() => {});
      }
      this.startImmersionAutoFade();
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
    this.isStandingsOpen = false;
    this.isLegalTermsOpen = false;
    this.isBotDuelModalOpen = false;
    this.isStatisticsModalOpen = false;
    this.isWatchGuidanceModalOpen = false;
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
        this.deleteAccountError = err?.error?.message || "Erreur lors de la suppression du compte.";
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
      this.isPaired ||
      this.isWatchConfirmed ||
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
    return Boolean((this.isFullscreen || this.isPseudoFullscreen) && this.isMobileOrTablet);
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
    return this.racers.filter(r => !r.userId.startsWith('bot_'));
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
    if (this.nextRaceInfo?.race?.id) {
      this.openRaceLeaderboard(this.nextRaceInfo.race.id);
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
        } else {
          this.raceLeaderboardError = 'Impossible de charger le classement de cette régate.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingRaceLeaderboard = false;
        this.raceLeaderboardError = err?.error?.message || 'Erreur lors du chargement du classement.';
        this.cdr.markForCheck();
      }
    });
  }

  closeRaceLeaderboardModal(): void {
    this.isRaceLeaderboardModalOpen = false;
    this.isPostRaceRankingActive = false;
    this.selectedRaceLeaderboard = [];
    this.selectedRaceInfo = null;
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
    return getLeagueByPoints(this.currentUser?.points || 0);
  }

  openSubscriptionModal(): void {
    this.isSubscriptionModalOpen = true;
    this.subscriptionError = '';
    this.subscriptionSuccessMessage = '';
    this.rowerService.getSubscriptionTiers().subscribe({
      next: (res) => {
        if (res.success) this.subscriptionTiers = res.tiers;
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

  subscribeToTier(tierId: string): void {
    if (!this.activeUserId) return;
    if (tierId !== 'free') {
      this.subscriptionError = "Les abonnements payants ne sont pas encore activables.";
      this.cdr.markForCheck();
      return;
    }
    this.subscriptionLoading = true;
    this.subscriptionError = '';
    this.rowerService.createSubscriptionCheckout(this.activeUserId, tierId).subscribe({
      next: (res) => {
        this.subscriptionLoading = false;
        if (res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
        } else if (res.success) {
          this.subscriptionSuccessMessage = res.message || 'Abonnement activé avec succès !';
          this.currentUser.isSubscriber = tierId !== 'free';
          this.currentUser.subscriptionTier = tierId;
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.subscriptionLoading = false;
        this.subscriptionError = err.error?.message || "Erreur lors de l'accès au paiement Lemon Squeezy.";
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
        this.adminConfigError = err.error?.message || 'Erreur lors de la sauvegarde.';
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
    const targetUserId = this.activeUserId || this.currentUser?.id || this.guestSessionId;

    this.rowerService.requestGarminPairingCode(targetUserId).subscribe({
      next: (res) => {
        this.isGeneratingPairingCode = false;
        if (res && res.success && res.pairingCode) {
          this.pairingCode = res.pairingCode;
          this.pairingCountdownSeconds = res.expiresInSeconds || 300;
          this.startPairingCountdown();
          this.startPairingStatusPolling(res.pairingCode);
        } else {
          this.pairingErrorMessage = "Erreur lors de la génération du code d'appairage.";
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isGeneratingPairingCode = false;
        this.pairingErrorMessage = err?.error?.message || "Impossible de contacter le serveur d'appairage.";
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
        this.pairingErrorMessage = "Le code d'appairage a expiré. Veuillez en générer un nouveau.";
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
          this.pairingErrorMessage = "Le code d'appairage a expiré.";
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

    if (userId && (!this.activeUserId || this.activeUserId.startsWith('guest_'))) {
      this.activeUserId = userId;
      this.currentUser.id = userId;
    }

    try {
      localStorage.setItem('rower_is_paired', 'true');
      localStorage.setItem('rower_watch_confirmed', 'true');
      localStorage.setItem('rower_device_token', deviceToken);
      if (userId) {
        localStorage.setItem('rower_user_id', userId);
      }
    } catch {}

    this.loadUserProfile();
    this.cdr.markForCheck();
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
      this.enableScreenWakeLock();
      this.clampCurrentCockpitPosition();
      this.syncRigidViewport();
      this.cdr.markForCheck();
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
      this.clampCurrentCockpitPosition();
      this.syncRigidViewport();
      this.cdr.markForCheck();
    }
  }

  async toggleFullscreen(): Promise<void> {
    if (this.checkIsFullscreen()) {
      await this.exitFullscreen();
    } else {
      await this.enterFullscreen();
    }
  }

  openPrivateModal(tab?: PrivateModalTab): void {
    this.privateModalTab = tab || (this.activePrivateRoom ? 'share' : 'create');
    this.isPrivateModalOpen = true;
    this.cdr.markForCheck();
  }

  onPrivateModalClosed(): void {
    this.isPrivateModalOpen = false;
    this.privateUrlError = '';
    this.cdr.markForCheck();
  }

  onPrivateRoomSelected(event: { payload: PrivateRacePayload; pushUrl: boolean }): void {
    this.activatePrivateRoom(event.payload, event.pushUrl);
  }

  onPrivateRoomUpdated(updated: PrivateRacePayload): void {
    this.activePrivateRoom = updated;
    this.nextRaceInfo = updated;
    this.updateDocumentTitle();
    this.initGameLoop();
    this.cdr.markForCheck();
  }

  onPrivateRoomClosedOrLeft(_event: { closedOnServer: boolean; raceId?: string }): void {
    this.exitPrivateRoomToPublic(true);
    this.initGameLoop();
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
    if (this.activePrivateRoom) {
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
        this.liveMetricsList = update.leaderboard.map((m) => {
          if (m.userId === this.activeUserId && this.myAssignedLane) {
            return { ...m, lane: this.myAssignedLane };
          }
          return m;
        });

        // 1. Sync racers array for spectators and reactive gauges
        update.leaderboard.forEach((m) => {
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

        // 2. Synchronize active player's activity & HUD gauges continuously
        const activeName = this.currentUser?.name || '';
        const myMetric = update.leaderboard.find(m => m.userId === this.activeUserId || (activeName && m.name === activeName));
        if (myMetric) {
          if (!this.myActivity) {
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
            this.myActivity.netDistance = myMetric.dist;
            this.myActivity.lastPower = myMetric.watts;
            this.myActivity.lastStrokeRate = myMetric.spm;
            this.myActivity.lastPace = myMetric.split;
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

        // 3. Update ranking & gaps in real-time
        const activeSorted = [...update.leaderboard].filter(r => r.status !== 'abandoned').sort((a, b) => {
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
        const targetDist = this.activeTargetDistance || 2000;
        for (const racer of update.leaderboard) {
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
          }
        }

        // 5. Affichage du Classement Général en Fin de Course publique
        const isPublicRace = !this.activePrivateRoom;
        if (isPublicRace && this.isFinished && !this.isPostRaceRankingActive && this.nextRaceInfo?.race?.id) {
          this.openRaceLeaderboard(this.nextRaceInfo.race.id);
          this.isPostRaceRankingActive = true;
        }

        this.cdr.markForCheck();
      }
    });

    if (this.statusSub) {
      this.statusSub.unsubscribe();
    }
    this.statusSub = this.socketService.onRaceStatusChange().subscribe((update) => {
      if (this.nextRaceInfo && (update.raceId === this.nextRaceInfo.race?.id || !update.raceId)) {
        if (update.status === 'COUNTDOWN') {
          const sec = update.details?.countdownSeconds ?? update.details?.secondsUntilStart ?? 15;
          this.countdownSeconds = sec;
          if (this.nextRaceInfo.race) {
            this.nextRaceInfo.race.status = 'COUNTDOWN';
          }
          this.syncCountdownUI();
        } else if (update.status === 'RUNNING') {
          this.countdownSeconds = 0;
          this.is3sCountdown = false;
          this.isPreStartCountdown = false;
          this.finishedRacerIds.clear();
          this.finisherCount = 0;
          if (this.isPostRaceRankingActive || this.isRaceLeaderboardModalOpen) {
            this.closeRaceLeaderboardModal();
            this.isPostRaceRankingActive = false;
          }
          if (this.nextRaceInfo) {
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
          // Maintenir l'affichage du classement tout au long de la période de pause d'après-course (les 2 minutes)
          if (!this.activePrivateRoom && this.nextRaceInfo?.race?.id) {
            this.openRaceLeaderboard(this.nextRaceInfo.race.id);
            this.isPostRaceRankingActive = true;
          }
          this.syncCountdownUI();
        }
        this.cdr.markForCheck();
      }
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
      const isMyGuestTicketClaim = Boolean(
        update?.['ticketClaimed'] &&
        ((mySocketId && update?.['socketId'] === mySocketId) ||
          (update.userId && update.userId === currentActiveId) ||
          (this.activePrivateRoom && (this.activePrivateRoom.race?.id === update.raceId || this.activePrivateRoom.code === update.raceId)))
      );
      const isMyRoomJoin = Boolean(
        update &&
        update.type === 'PARTICIPANT_JOINED' &&
        (isMyGuestTicketClaim ||
          (update.userId && (update.userId === currentActiveId || update.userId === this.currentUser?.id)) ||
          (updateHostId && (updateHostId === currentActiveId || updateHostId === this.currentUser?.id)) ||
          (this.activePrivateRoom && (this.activePrivateRoom.race?.id === update.raceId || this.activePrivateRoom.code === update.raceId)))
      );

      if (isMyGuestTicketClaim) {
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
        this.isPrivateModalOpen = false;
        this.setSiteView('regatta');
      }

      if (isMyRoomJoin) {
        if (assignedLaneVal > 0 && (isMyGuestTicketClaim || update.userId === currentActiveId || updateHostId === currentActiveId || Boolean(update?.['isBotDuel']))) {
          this.myAssignedLane = assignedLaneVal;
        }
        const cdSec = Number(update?.['countdownSeconds'] ?? update?.['secondsRemaining'] ?? 0);
        if (cdSec > 0) {
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
              this.setSiteView('regatta');
              this.cdr.markForCheck();
            }
          });
        }
      }

      if (this.activePrivateRoom && (update.raceId === this.activePrivateRoom.race?.id || update.raceId === this.activePrivateRoom.code)) {
        this.pollActiveRaceSource().subscribe((data) => {
          if (data) {
            this.activePrivateRoom = data as PrivateRacePayload;
            this.nextRaceInfo = data;
            if (typeof data.secondsRemaining === 'number' && data.secondsRemaining > 0 && !data.waitingForHost) {
              this.countdownSeconds = data.secondsRemaining;
              this.syncCountdownUI();
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
        const isMyTicket = Boolean(data.ticketClaimed && ((mySocketId && data.socketId === mySocketId) || (this.activePrivateRoom && this.activePrivateRoom.race?.id === data.raceId)));
        if (!this.isPaired || data.userId === currentId || isMyTicket) {
          this.onWatchPairedSuccess(data.deviceToken, data.userId);
          if (isMyTicket) {
            if (data.guestName) {
              this.currentUser.name = data.guestName;
              this.userLoginInput = data.guestName;
            }
            if (data.lane) {
              this.myAssignedLane = data.lane;
            }
            this.isPrivateModalOpen = false;
            this.setSiteView('regatta');
          } else if (this.siteView === 'home') {
            this.setSiteView(this.activePrivateRoom ? 'regatta' : 'cockpit');
          }
        }
      }
    });
  }

  private initCountdownTicker(): void {
    if (this.countdownTickerSub) {
      this.countdownTickerSub.unsubscribe();
    }
    this.countdownTickerSub = interval(1000).subscribe(() => {
      const isRunning = this.nextRaceInfo?.status === 'in_progress' ||
                        this.nextRaceInfo?.race?.status === 'RUNNING' ||
                        this.nextRaceInfo?.race?.status === 'in_progress';
      if (!isRunning && this.countdownSeconds > 0) {
        this.countdownSeconds--;
        if (this.nextRaceInfo) {
          this.nextRaceInfo.secondsRemaining = this.countdownSeconds;
          this.nextRaceInfo.formattedCountdown = this.formattedPreRaceCountdown;
        }
        this.syncCountdownUI();
        if (this.countdownSeconds === 0) {
          if (this.nextRaceInfo?.status === 'post_race_pause') {
            this.loadNextRaceInfo();
          } else {
            if (this.nextRaceInfo) {
              this.nextRaceInfo.status = 'in_progress';
              if (this.nextRaceInfo.race) {
                this.nextRaceInfo.race.status = 'RUNNING';
              }
            }
            if (this.siteView === 'regatta' || this.siteView === 'cockpit') {
              this.startImmersionAutoFade();
            }
          }
        }
        this.cdr.markForCheck();
      } else if (isRunning && this.gameRemainingSeconds > 0) {
        this.gameRemainingSeconds--;
        const remMin = Math.floor(this.gameRemainingSeconds / 60);
        const remSec = this.gameRemainingSeconds % 60;
        this.formattedGameRemaining = `${remMin}m ${remSec < 10 ? '0' : ''}${remSec}s`;
        if (this.myActivity && this.nextRaceInfo?.status === 'in_progress') {
          this.myActivity.elapsedTime = Math.max(0, this.gameMaxDurationSeconds - this.gameRemainingSeconds);
        }
        this.cdr.markForCheck();
      }
    });
  }

  private syncCountdownUI(): void {
    const isRunning = this.nextRaceInfo?.status === 'in_progress' ||
                      this.nextRaceInfo?.race?.status === 'RUNNING' ||
                      this.nextRaceInfo?.race?.status === 'in_progress';
    if (isRunning || this.countdownSeconds <= 0) {
      this.is3sCountdown = false;
      this.isPreStartCountdown = false;
      return;
    }

    if (this.countdownSeconds <= 3) {
      this.is3sCountdown = true;
      this.isPreStartCountdown = false;
      this.threeSecondsCount = this.countdownSeconds;
    } else {
      this.is3sCountdown = false;
      this.isPreStartCountdown = true;
    }
  }

  loadNextRaceInfo(): void {
    this.pollActiveRaceSource().subscribe((data) => {
      if (data) {
        this.nextRaceInfo = data;
        this.countdownSeconds = data.secondsRemaining;
        this.syncCountdownUI();
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

    const extracted = extractRoomFromLocation(window.location.pathname, window.location.search);
    if (!extracted) {
      if (this.activePrivateRoom) {
        this.activePrivateRoom = null;
        this.updateDocumentTitle();
      }
      this.initGameLoop();
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

    this.rowerService.joinRoom(extracted.value, this.activeUserId, this.currentUser.name).subscribe({
      next: (joinRes) => {
        const assignedLane = joinRes.lane || 1;
        this.myAssignedLane = assignedLane;
        const roomIdent = joinRes.code || extracted.value;
        this.rowerService.getPrivateRace(roomIdent).subscribe({
          next: (room) => {
            (room as any).lane = assignedLane;
            this.activatePrivateRoom(room, false);
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

  getWaitingStatusText(): string {
    const race = this.activePrivateRoom?.race || (this.nextRaceInfo as any)?.race || (this.nextRaceInfo as any);
    if (!race && !this.activePrivateRoom) {
      return '';
    }
    const status = this.nextRaceInfo?.status || race?.status;
    if (status === 'in_progress') {
      return 'Course en cours';
    }
    if (status === 'finished' || status === 'completed') {
      return 'Course terminée';
    }
    if (this.isPreStartCountdown || this.is3sCountdown || status === 'countdown') {
      return `Départ dans ${this.formattedPreRaceCountdown}`;
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
    const isScheduled = race?.startMode === 'scheduled' || (this.activePrivateRoom as any)?.startMode === 'scheduled';
    if (isScheduled) {
      const scheduledTime = race?.scheduledStartTime || (this.activePrivateRoom as any)?.scheduledStartTime;
      if (scheduledTime) {
        const d = new Date(scheduledTime);
        const ms = d.getTime() - Date.now();
        const min = Math.max(0, Math.ceil(ms / 60000));
        const pad = (n: number) => n.toString().padStart(2, '0');
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        if (min > 0) {
          return `Départ prévu dans ${min} min / à ${hh}:${mm}`;
        } else {
          return `Départ prévu à ${hh}:${mm}`;
        }
      }
      return 'Départ programmé...';
    }
    return "En attente du signal de départ de l'organisateur...";
  }

  private activatePrivateRoom(room: PrivateRacePayload, pushHistory: boolean): void {
    this.activePrivateRoom = room;
    this.nextRaceInfo = room;
    if ((room as any).lane) {
      this.myAssignedLane = (room as any).lane;
    }
    this.privateUrlError = '';

    const code = room.code || room.race?.code;
    if (typeof window !== 'undefined' && code) {
      const targetPath = `/r/${encodeURIComponent(code)}`;
      if (window.location.pathname !== targetPath || window.location.search) {
        if (pushHistory) {
          window.history.pushState({ roomCode: code }, '', targetPath);
        } else {
          window.history.replaceState({ roomCode: code }, '', targetPath);
        }
      }
    }

    if (code && this.activeUserId) {
      this.rowerService
        .joinPrivateRace(code, this.activeUserId, this.currentUser.name, false)
        .pipe(catchError(() => of(null)))
        .subscribe();
    }

    this.updateDocumentTitle();
    this.syncSocketRoom(room.race.id);
    this.initGameLoop();
    this.cdr.markForCheck();
  }

  private exitPrivateRoomToPublic(resetUrl: boolean, notFoundMessage?: string): void {
    this.activePrivateRoom = null;
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

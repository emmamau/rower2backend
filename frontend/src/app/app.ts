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
  activeViewMode: 'canvas' | 'cockpit' = 'canvas';
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

  // Race Config
  configTargetDistance = 10000;
  configIntervalMinutes = 15;

  backendConnected = false;
  apiUrl = '';
  customApiUrlInput = '';
  errorMessage = '';

  // UI Modals
  isLoginModalOpen = false;
  loginPendingRequestId: string | null = null;
  loginStatusMessage = '';
  loginErrorMessage = '';
  isWaitingWatchApproval = false;

  // Identification directe par montre Garmin
  isWatchConfirmed = false;
  watchIdLoginInput = '';
  isWatchIdLoginPending = false;
  watchIdLoginMessage = '';
  watchIdLoginError = '';
  showCockpitBlockedModal = false;
  cockpitAccessBlockedMessage = '';

  // Sélection joueur cockpit dans la course
  selectedCockpitPlayerId = '';

  // Personnalisation préfixe identifiant joueur (abonnés)
  customPrefixInput = '';
  prefixUpdateMessage = '';
  prefixUpdateError = '';
  isSavingPrefix = false;

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


  private authCheckSub?: Subscription;
  private socketSub?: Subscription;
  private statusSub?: Subscription;
  private privateUpdateSub?: Subscription;
  private countdownTickerSub?: Subscription;
  private joinedSocketRaceId: string | null = null;
  private readonly popstateListener = () => this.resolveRoomFromCurrentUrl();
  private readonly resizeListener = () => {
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
  private readonly fullscreenListener = () => {
    this.isFullscreen = Boolean(document.fullscreenElement);
    this.cdr.markForCheck();
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
    const storedWatchConfirmed = typeof localStorage !== 'undefined' ? localStorage.getItem('rower_watch_confirmed') === 'true' : false;
    this.isWatchConfirmed = storedWatchConfirmed;
    this.watchIdLoginInput = this.activeUserId;

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
    this.loadUserProfile();
    this.loadGeneralLeaderboard();
    this.loadPastRaces();
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.popstateListener);
      window.addEventListener('resize', this.resizeListener);
      window.addEventListener('orientationchange', this.resizeListener);
    }
    if (typeof document !== 'undefined') {
      this.fullscreenSupported = Boolean(document.documentElement?.requestFullscreen);
      document.addEventListener('fullscreenchange', this.fullscreenListener);
    }
    this.initSocketListeners();
    this.initCountdownTicker();
    this.resolveRoomFromCurrentUrl();
    this.enableScreenWakeLock();
  }

  ngOnDestroy(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = undefined;
    }
    if (this.authCheckSub) {
      this.authCheckSub.unsubscribe();
      this.authCheckSub = undefined;
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
    if (this.joinedSocketRaceId) {
      this.socketService.leaveRaceRoom(this.joinedSocketRaceId);
      this.joinedSocketRaceId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.popstateListener);
      window.removeEventListener('resize', this.resizeListener);
      window.removeEventListener('orientationchange', this.resizeListener);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.fullscreenListener);
    }
    this.wakeLockService.releaseWakeLock();
  }

  /**
   * Envoi de la demande d'authentification sur le front web.
   * La montre Garmin doit avoir lancé l'app pour valider la demande.
   */
  startWebLogin(): void {
    if (!this.userIdInput || !this.userLoginInput) {
      this.loginErrorMessage = 'Veuillez saisir votre login et le code de votre montre.';
      return;
    }

    this.loginErrorMessage = '';
    this.loginStatusMessage = 'Vérification de la connexion avec votre montre Garmin...';
    this.isWaitingWatchApproval = true;

    this.rowerService.requestWebLogin(this.userIdInput.trim(), this.userLoginInput.trim()).subscribe({
      next: (res) => {
        if (res.success && res.requestId) {
          this.loginPendingRequestId = res.requestId;
          this.loginStatusMessage = 'Notification envoyée sur votre montre ! Veuillez accepter la connexion sur votre montre.';
          this.pollLoginApproval(res.requestId);
        } else {
          this.isWaitingWatchApproval = false;
          this.loginErrorMessage = res.message || 'Connexion refusée.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isWaitingWatchApproval = false;
        if (err.error && err.error.error === 'WATCH_NOT_CONNECTED') {
          this.loginErrorMessage = "L'application Garmin Rower Race doit être lancée sur votre montre pour vous connecter !";
        } else {
          this.loginErrorMessage = err.error?.message || 'Erreur lors de la demande de connexion.';
        }
        this.cdr.markForCheck();
      }
    });
  }

  private pollLoginApproval(requestId: string): void {
    if (this.authCheckSub) {
      this.authCheckSub.unsubscribe();
    }

    this.authCheckSub = interval(1500).pipe(
      switchMap(() => this.rowerService.checkWebLoginStatus(requestId))
    ).subscribe({
      next: (res) => {
        if (res.status === 'approved') {
          this.authCheckSub?.unsubscribe();
          this.activeUserId = res.userId;
          this.currentUser.id = res.userId;
          this.currentUser.name = res.login;
          this.isWatchConfirmed = true;
          this.watchIdLoginInput = res.userId;
          try {
            localStorage.setItem('rower_user_id', res.userId);
            localStorage.setItem('rower_user_login', res.login);
            localStorage.setItem('rower_watch_confirmed', 'true');
          } catch {}

          this.isWaitingWatchApproval = false;
          this.isLoginModalOpen = false;
          this.loadUserProfile();
          this.cdr.markForCheck();
        } else if (res.status === 'rejected') {
          this.authCheckSub?.unsubscribe();
          this.isWaitingWatchApproval = false;
          this.loginErrorMessage = 'Connexion refusée depuis votre montre.';
          this.cdr.markForCheck();
        } else if (res.status === 'expired') {
          this.authCheckSub?.unsubscribe();
          this.isWaitingWatchApproval = false;
          this.loginErrorMessage = 'La demande a expiré.';
          this.cdr.markForCheck();
        }
      },
      error: () => {
        this.authCheckSub?.unsubscribe();
        this.isWaitingWatchApproval = false;
      }
    });
  }

  cancelLogin(): void {
    if (this.authCheckSub) {
      this.authCheckSub.unsubscribe();
    }
    this.isWaitingWatchApproval = false;
    this.isLoginModalOpen = false;
    this.loginErrorMessage = '';
    this.loginStatusMessage = '';
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
            this.liveMetricsList = activeList.map((r, idx) => ({
              lane: idx + 1,
              userId: r.userId,
              name: r.userName || r.userId,
              dist: r.netDistance || 0,
              split: r.lastPace || r.avgPace || 120,
              watts: r.lastPower || r.avgPower || 0,
              spm: r.lastStrokeRate || r.avgStrokeRate || 0,
              heartRate: r.lastHeartRate,
              status: r.status || 'in_progress'
            }));
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

          // Seuls les joueurs associés à la course peuvent voir le cockpit
          if (this.activeViewMode === 'cockpit' && !this.canAccessCockpit) {
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
        this.currentUser = res.user;
        this.userHistory = res.history || [];
        this.generalUserRank = res.generalRank || 1;
        this.generalTotalPlayers = res.totalPlayers || 1;
        this.cdr.markForCheck();
      }
    });
  }

  loadGeneralLeaderboard(): void {
    this.rowerService.getGeneralLeaderboard().pipe(
      catchError(() => of({ success: false, players: [] }))
    ).subscribe((res) => {
      if (res && res.players) {
        this.generalLeaderboard = res.players;
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
          this.currentUser = res.user;
          this.userLoginInput = res.user.name || userLogin;

          try {
            localStorage.setItem('rower_user_id', userLogin);
            localStorage.setItem('rower_user_login', res.user.name || userLogin);
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
    if (
      !this.regNom.trim() ||
      !this.regPrenom.trim() ||
      !this.regLogin.trim() ||
      !this.regEmail.trim() ||
      !this.regPassword.trim() ||
      !this.regPays.trim()
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
      pays: this.regPays.trim(),
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

  get canAccessCockpit(): boolean {
    return Boolean(this.isWatchConfirmed && this.isUserAssociatedWithRace);
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

  get fullPlayerId(): string {
    const prefix = this.currentUser?.userPrefix || 'Row';
    const suffix = this.currentUser?.userSuffix || 'IQ01';
    return `${prefix}_${suffix}`;
  }

  onSelectCockpitPlayer(userId: string): void {
    if (!userId) return;
    this.selectedCockpitPlayerId = userId;
    this.watchIdLoginInput = userId;
    if (this.isWatchConfirmed && this.activeUserId === userId) {
      this.switchViewMode('cockpit');
    } else {
      this.identifyWithWatchId();
    }
  }

  saveCustomPrefix(): void {
    if (!this.customPrefixInput || !this.customPrefixInput.trim()) {
      this.prefixUpdateError = 'Veuillez saisir un préfixe de 3 à 12 caractères alphanumériques.';
      return;
    }
    this.prefixUpdateError = '';
    this.prefixUpdateMessage = '';
    this.isSavingPrefix = true;
    this.rowerService.updateUserPrefix(this.activeUserId, this.customPrefixInput.trim()).subscribe({
      next: (res) => {
        this.isSavingPrefix = false;
        if (res.success) {
          this.prefixUpdateMessage = '✓ Préfixe mis à jour avec succès !';
          this.currentUser.userPrefix = res.userPrefix;
          this.currentUser.userSuffix = res.userSuffix;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSavingPrefix = false;
        this.prefixUpdateError = err.error?.message || 'Erreur mise à jour préfixe.';
        this.cdr.markForCheck();
      }
    });
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

  identifyWithWatchId(): void {
    if (!this.watchIdLoginInput || !this.watchIdLoginInput.trim()) {
      this.watchIdLoginError = 'Veuillez saisir votre identifiant de montre Garmin (ex: EMMA01).';
      return;
    }
    const watchId = this.watchIdLoginInput.trim();
    this.watchIdLoginError = '';
    this.watchIdLoginMessage = 'Notification envoyée sur votre montre... Veuillez confirmer sur votre montre !';
    this.isWatchIdLoginPending = true;

    this.rowerService.requestWebLogin(watchId, watchId).subscribe({
      next: (res) => {
        if (res.success && res.requestId) {
          this.pollWatchIdApproval(res.requestId, watchId);
        } else {
          this.isWatchIdLoginPending = false;
          this.watchIdLoginError = res.message || "Échec de la demande d'identification.";
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isWatchIdLoginPending = false;
        if (err.error?.error === 'WATCH_NOT_CONNECTED') {
          this.watchIdLoginError = "L'application Garmin Rower Race doit être lancée sur votre montre pour confirmer !";
        } else {
          this.watchIdLoginError = err.error?.message || "Erreur lors de la demande d'identification.";
        }
        this.cdr.markForCheck();
      }
    });
  }

  private pollWatchIdApproval(requestId: string, watchId: string): void {
    if (this.authCheckSub) {
      this.authCheckSub.unsubscribe();
    }
    this.authCheckSub = interval(1500).pipe(
      switchMap(() => this.rowerService.checkWebLoginStatus(requestId))
    ).subscribe({
      next: (res) => {
        if (res.status === 'approved') {
          this.authCheckSub?.unsubscribe();
          this.isWatchIdLoginPending = false;
          this.isWatchConfirmed = true;
          this.activeUserId = res.userId || watchId;
          this.currentUser.id = this.activeUserId;
          this.currentUser.name = res.login || watchId;
          this.userIdInput = this.activeUserId;
          this.userLoginInput = this.currentUser.name;
          try {
            localStorage.setItem('rower_user_id', this.activeUserId);
            localStorage.setItem('rower_user_login', this.currentUser.name);
            localStorage.setItem('rower_watch_confirmed', 'true');
          } catch {}
          this.watchIdLoginMessage = `✓ Montre [${this.activeUserId}] confirmée avec succès !`;
          this.loadUserProfile();
          if (this.isUserAssociatedWithRace) {
            this.switchViewMode('cockpit');
          }
          this.cdr.markForCheck();
        } else if (res.status === 'rejected') {
          this.authCheckSub?.unsubscribe();
          this.isWatchIdLoginPending = false;
          this.watchIdLoginError = 'Identification refusée depuis votre montre.';
          this.cdr.markForCheck();
        } else if (res.status === 'expired') {
          this.authCheckSub?.unsubscribe();
          this.isWatchIdLoginPending = false;
          this.watchIdLoginError = 'La demande a expiré.';
          this.cdr.markForCheck();
        }
      },
      error: () => {
        this.authCheckSub?.unsubscribe();
        this.isWatchIdLoginPending = false;
        this.cdr.markForCheck();
      }
    });
  }

  disconnectWatch(): void {
    this.isWatchConfirmed = false;
    try {
      localStorage.removeItem('rower_watch_confirmed');
    } catch {}
    this.watchIdLoginMessage = '';
    this.watchIdLoginError = '';
    this.activeViewMode = 'canvas';
    this.cdr.markForCheck();
  }

  switchViewMode(mode: 'canvas' | 'cockpit'): void {
    this.closeAllOverlayModals();
    if (mode === 'cockpit' && !this.canAccessCockpit) {
      this.cockpitAccessBlockedMessage = !this.isWatchConfirmed
        ? "Pour accéder à votre cockpit, vous devez d'abord vous identifier avec votre montre Garmin sur la page d'accueil et valider la notification sur votre montre."
        : "Votre montre est confirmée, mais vous n'êtes pas associé à la course en cours (publique ou invité dans un salon privé). Seule la vue Régate 2D est accessible aux spectateurs.";
      this.showCockpitBlockedModal = true;
      this.activeViewMode = 'canvas';
      this.cdr.markForCheck();
      return;
    }
    this.userOverrodeViewMode = true;
    this.activeViewMode = mode;
    this.cdr.markForCheck();
  }

  async toggleFullscreen(): Promise<void> {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // Ignore fullscreen rejection on restricted embedded contexts
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
        this.liveMetricsList = update.leaderboard;
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
          if (this.nextRaceInfo) {
            this.nextRaceInfo.status = 'in_progress';
            if (this.nextRaceInfo.race) {
              this.nextRaceInfo.race.status = 'RUNNING';
            }
          }
        }
        this.cdr.markForCheck();
      }
    });

    if (this.privateUpdateSub) {
      this.privateUpdateSub.unsubscribe();
    }
    this.privateUpdateSub = this.socketService.onPrivateRoomUpdate().subscribe((update) => {
      if (this.activePrivateRoom && (update.raceId === this.activePrivateRoom.race?.id || update.raceId === this.activePrivateRoom.code)) {
        this.pollActiveRaceSource().subscribe((data) => {
          if (data) {
            this.activePrivateRoom = data as PrivateRacePayload;
            this.nextRaceInfo = data;
            this.cdr.markForCheck();
          }
        });
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
          if (this.nextRaceInfo) {
            this.nextRaceInfo.status = 'in_progress';
            if (this.nextRaceInfo.race) {
              this.nextRaceInfo.race.status = 'RUNNING';
            }
          }
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

    const request$ =
      extracted.kind === 'pin'
        ? this.rowerService.getRaceByPin(extracted.value)
        : this.rowerService.getPrivateRace(extracted.value);

    request$.subscribe({
      next: (room) => {
        this.activatePrivateRoom(room, false);
      },
      error: () => {
        this.exitPrivateRoomToPublic(true, this.i18n.t('JOIN_ERR_NOT_FOUND'));
        this.initGameLoop();
      }
    });
  }

  private activatePrivateRoom(room: PrivateRacePayload, pushHistory: boolean): void {
    this.activePrivateRoom = room;
    this.nextRaceInfo = room;
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

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { WakeLockService } from './services/wake-lock.service';
import { I18nService, SupportedLang } from './services/i18n.service';
import { RowerData, NextRaceInfo, PastRaceResult } from './models/rower-data.model';
import { UserProfile, UserHistoryItem } from './models/user.model';
import { interval, Subscription, of } from 'rxjs';
import { switchMap, startWith, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, OnDestroy {
  // Current user / player login
  activeUserId = 'aB3_9Z';
  userLoginInput = 'EmmaRacer';
  userIdInput = 'aB3_9Z';

  currentUser: UserProfile = {
    id: 'aB3_9Z',
    name: 'EmmaRacer',
    totalRaces: 0,
    totalWins: 0,
    podiums: 0,
    isAdmin: true,
  };

  userHistory: UserHistoryItem[] = [];

  // Next Race & Multiplayer state
  nextRaceInfo: NextRaceInfo | null = null;
  racers: RowerData[] = [];
  activeRacersCount = 0;
  myActivity: RowerData | null = null;
  raceHistory: PastRaceResult[] = [];

  // Countdown & 3s start sound/visual
  countdownSeconds = 0;
  is3sCountdown = false;
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
  private authCheckSub?: Subscription;

  constructor(
    private rowerService: RowerService,
    private wakeLockService: WakeLockService,
    public i18n: I18nService,
    private cdr: ChangeDetectorRef
  ) {
    this.apiUrl = this.rowerService.getApiUrl();
    this.customApiUrlInput = this.apiUrl;
    this.wakeLockSupported = this.wakeLockService.isSupported();

    // Check stored user code and login
    const storedUserId = localStorage.getItem('rower_user_id');
    const storedLogin = localStorage.getItem('rower_user_login');
    if (storedUserId) {
      this.activeUserId = storedUserId;
      this.userIdInput = storedUserId;
    }
    if (storedLogin) {
      this.currentUser.name = storedLogin;
      this.userLoginInput = storedLogin;
    }
  }

  ngOnInit(): void {
    this.loadUserProfile();
    this.loadGeneralLeaderboard();
    this.loadPastRaces();
    this.initGameLoop();
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
          localStorage.setItem('rower_user_id', res.userId);
          localStorage.setItem('rower_user_login', res.login);

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
          this.rowerService.getNextRace().pipe(
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
          this.countdownSeconds = raceData.secondsRemaining;
          this.configTargetDistance = raceData.race.targetDistance;
          this.configIntervalMinutes = raceData.race.intervalMinutes;

          // Décompte visuel 3 secondes avant départ
          if (this.countdownSeconds > 0 && this.countdownSeconds <= 3) {
            this.is3sCountdown = true;
            this.threeSecondsCount = this.countdownSeconds;
          } else {
            this.is3sCountdown = false;
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
    if (this.currentUser.isAdmin) return true;
    const name = (this.currentUser.name || '').toLowerCase();
    const id = (this.activeUserId || '').toLowerCase();
    return name.includes('emma') || name.includes('admin') || id.includes('emma') || id.includes('admin');
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
}

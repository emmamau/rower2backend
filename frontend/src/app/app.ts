import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { WakeLockService } from './services/wake-lock.service';
import { RowerData, NextRaceInfo } from './models/rower-data.model';
import { UserProfile } from './models/user.model';
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
  userLoginInput = 'aB3_9Z';

  currentUser: UserProfile = {
    id: 'aB3_9Z',
    name: 'Emma Kayak Racer',
    email: 'athlete@rower-race.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&q=80',
    athleteLevel: 'Pro Kayaker',
    weightKg: 72.0,
    heightCm: 178.0,
  };

  // Next Race & Multiplayer state
  nextRaceInfo: NextRaceInfo | null = null;
  racers: RowerData[] = [];
  activeRacersCount = 0;
  myActivity: RowerData | null = null;
  raceHistory: RowerData[] = [];

  // Race Config
  configTargetDistance = 10000;
  configIntervalMinutes = 15;

  backendConnected = false;
  apiUrl = '';
  customApiUrlInput = '';
  errorMessage = '';

  // UI Modals
  isEditProfileOpen = false;
  isSettingsOpen = false;
  isConfigRaceOpen = false;
  isLoginModalOpen = false;

  wakeLockActive = false;
  wakeLockSupported = false;

  private pollingSub?: Subscription;

  constructor(
    private rowerService: RowerService,
    private wakeLockService: WakeLockService,
    private cdr: ChangeDetectorRef
  ) {
    this.apiUrl = this.rowerService.getApiUrl();
    this.customApiUrlInput = this.apiUrl;
    this.wakeLockSupported = this.wakeLockService.isSupported();

    // Check stored user code
    const storedUser = localStorage.getItem('rower_user_id');
    if (storedUser) {
      this.activeUserId = storedUser;
      this.userLoginInput = storedUser;
    }
  }

  ngOnInit(): void {
    this.loadUserProfile();
    this.initGameLoop();
    this.enableScreenWakeLock();
  }

  ngOnDestroy(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = undefined;
    }
    this.wakeLockService.releaseWakeLock();
  }

  changeLogin(): void {
    if (this.userLoginInput && this.userLoginInput.trim().length > 0) {
      this.activeUserId = this.userLoginInput.trim();
      localStorage.setItem('rower_user_id', this.activeUserId);
      this.isLoginModalOpen = false;
      this.loadUserProfile();
      this.cdr.markForCheck();
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

    this.pollingSub = interval(2000)
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
          this.configTargetDistance = raceData.race.targetDistance;
          this.configIntervalMinutes = raceData.race.intervalMinutes;

          // Fetch Live Leaderboard
          this.rowerService.getRaceLeaderboard(raceData.race.id).pipe(
            catchError(() => of({ activityId: raceData.race.id, totalParticipants: 0, leaderboard: [] }))
          ).subscribe((lb) => {
            this.racers = lb.leaderboard;
            this.activeRacersCount = Math.max(raceData.totalParticipants || 0, this.racers.length);
            this.myActivity = this.racers.find(r => r.userId === this.activeUserId) || null;
            this.cdr.markForCheck();
          });
        }
        this.cdr.markForCheck();
      });
  }

  saveRaceConfig(): void {
    this.rowerService.updateRaceConfig(this.configTargetDistance, this.configIntervalMinutes).subscribe({
      next: () => {
        this.isConfigRaceOpen = false;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('Erreur config course:', err)
    });
  }

  loadUserProfile(): void {
    this.rowerService.getUserProfile(this.activeUserId).pipe(
      catchError(() => of(null))
    ).subscribe((user) => {
      if (user) {
        this.currentUser = user;
        this.cdr.markForCheck();
      }
    });
  }

  saveProfile(): void {
    if (!this.currentUser) return;
    this.rowerService.updateUserProfile(this.activeUserId, this.currentUser).subscribe({
      next: (u) => {
        this.currentUser = u;
        this.isEditProfileOpen = false;
        this.cdr.markForCheck();
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
}

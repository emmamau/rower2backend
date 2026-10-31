import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { WakeLockService } from './services/wake-lock.service';
import { RowerData } from './models/rower-data.model';
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
  // Profil athlète par défaut pour garantir l'affichage sans aucune dépendance réseau
  currentUser: UserProfile = {
    id: 1,
    name: 'Emma Rower Athlete',
    email: 'athlete@garmin-rower.app',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&q=80',
    athleteLevel: 'Advanced Competitor',
    weightKg: 72.5,
    heightCm: 178,
    maxHeartRate: 195,
    vo2MaxEstimate: 54.2
  };

  latestData: RowerData | null = null;
  history: RowerData[] = [];
  backendConnected = false;
  apiUrl = '';
  customApiUrlInput = '';
  errorMessage = '';
  isEditProfileOpen = false;
  isSettingsOpen = false;

  // Wake Lock status (Anti-veille écran)
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
  }

  ngOnInit(): void {
    this.loadUserProfile();
    this.initSecurePolling();
    this.loadHistory();
    this.enableScreenWakeLock();
  }

  ngOnDestroy(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = undefined;
    }
    this.wakeLockService.releaseWakeLock();
  }

  /**
   * Active le Screen Wake Lock pour maintenir l'écran du smartphone allumé pendant la séance
   */
  async enableScreenWakeLock(): Promise<void> {
    const success = await this.wakeLockService.requestWakeLock();
    this.wakeLockActive = success;
    this.cdr.markForCheck();
  }

  async toggleWakeLock(): Promise<void> {
    this.wakeLockActive = await this.wakeLockService.toggleWakeLock();
    this.cdr.markForCheck();
  }

  toggleSettings(): void {
    this.isSettingsOpen = !this.isSettingsOpen;
    this.customApiUrlInput = this.apiUrl;
    this.cdr.markForCheck();
  }

  saveCustomApiUrl(): void {
    if (this.customApiUrlInput && this.customApiUrlInput.trim().length > 0) {
      this.rowerService.setApiUrl(this.customApiUrlInput);
      this.apiUrl = this.rowerService.getApiUrl();
      this.isSettingsOpen = false;
      this.loadUserProfile();
      this.initSecurePolling();
      this.loadHistory();
      this.cdr.markForCheck();
    }
  }

  private initSecurePolling(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
    }

    this.pollingSub = interval(2000)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.rowerService.getLatestData().pipe(
            catchError((err) => {
              if (err.status === 404) {
                this.backendConnected = true;
                this.errorMessage = 'Backend connecté. En attente de la première émission de la montre Garmin...';
              } else {
                this.backendConnected = false;
                this.errorMessage = 'Connexion en attente avec le backend (' + this.apiUrl + ')';
              }
              this.cdr.markForCheck();
              return of(null);
            })
          )
        )
      )
      .subscribe({
        next: (data) => {
          if (data) {
            this.latestData = data;
            this.backendConnected = true;
            this.errorMessage = '';
            // Ensure wake lock remains active on active telemetry stream
            if (!this.wakeLockActive && this.wakeLockSupported) {
              this.enableScreenWakeLock();
            }
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.warn('Erreur polling inattendue (auto-relance):', err);
          this.cdr.markForCheck();
          setTimeout(() => this.initSecurePolling(), 3000);
        }
      });
  }

  loadUserProfile(): void {
    this.rowerService.getCurrentUser().pipe(
      catchError((err) => {
        console.warn('Backend user profile inaccessible, utilisation du profil local', err);
        return of(null);
      })
    ).subscribe((user) => {
      if (user) {
        this.currentUser = user;
        this.backendConnected = true;
        this.cdr.markForCheck();
      }
    });
  }

  toggleEditProfile(): void {
    this.isEditProfileOpen = !this.isEditProfileOpen;
    this.cdr.markForCheck();
  }

  saveProfile(): void {
    if (!this.currentUser) return;
    this.rowerService.updateCurrentUser(this.currentUser).pipe(
      catchError((err) => {
        console.error('Erreur mise à jour profil', err);
        return of(this.currentUser);
      })
    ).subscribe((updated) => {
      if (updated) {
        this.currentUser = updated;
      }
      this.isEditProfileOpen = false;
      this.cdr.markForCheck();
    });
  }

  loadHistory(): void {
    this.rowerService.getHistory(20, 0).pipe(
      catchError(() => of({ total: 0, records: [] }))
    ).subscribe((res) => {
      this.history = res.records;
      this.cdr.markForCheck();
    });
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
}

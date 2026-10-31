import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
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
  errorMessage = '';
  isEditProfileOpen = false;

  private pollingSub?: Subscription;

  constructor(
    private rowerService: RowerService,
    private cdr: ChangeDetectorRef
  ) {
    this.apiUrl = this.rowerService.getApiUrl();
  }

  ngOnInit(): void {
    this.loadUserProfile();
    this.initSecurePolling();
    this.loadHistory();
  }

  ngOnDestroy(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = undefined;
    }
  }

  /**
   * Polling sécurisé et résilient :
   * - Ne plante jamais (catchError localisé dans l'observable interne).
   * - Gère les cold starts du backend ou l'absence initiale d'enregistrements en base (404).
   * - Déclenche markForCheck() pour forcer la mise à jour UI en mode Zoneless ultra-performant.
   */
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
              // Si 404, le backend fonctionne mais aucune montre n'a encore transmis de relevé
              if (err.status === 404) {
                this.backendConnected = true;
                this.errorMessage = 'Backend connecté. En attente de la première émission de la montre Garmin...';
              } else {
                this.backendConnected = false;
                this.errorMessage = 'Connexion en attente avec le backend API (' + this.apiUrl + ')';
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
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.warn('Erreur polling inattendue (auto-relance):', err);
          this.cdr.markForCheck();
          // Relance automatique de secours
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

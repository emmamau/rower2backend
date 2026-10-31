import { Component, OnInit, OnDestroy } from '@angular/core';
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
  // Default fallback user so the page is never blank even if offline
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

  constructor(private rowerService: RowerService) {
    this.apiUrl = this.rowerService.getApiUrl();
  }

  ngOnInit(): void {
    this.loadUserProfile();

    // Poll latest metrics every 2 seconds without dying on 404 or connection errors
    this.pollingSub = interval(2000)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.rowerService.getLatestData().pipe(
            catchError((err) => {
              this.backendConnected = err.status !== 0; // if status 404, backend is alive
              if (err.status === 404) {
                this.errorMessage = 'En attente de la première émission de données par la montre Garmin...';
              } else {
                this.errorMessage = 'Connexion en attente avec le backend (' + this.apiUrl + ')';
              }
              return of(null);
            })
          )
        )
      )
      .subscribe((data) => {
        if (data) {
          this.latestData = data;
          this.backendConnected = true;
          this.errorMessage = '';
        }
      });

    this.loadHistory();
  }

  ngOnDestroy(): void {
    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
    }
  }

  loadUserProfile(): void {
    this.rowerService.getCurrentUser().pipe(
      catchError((err) => {
        console.warn('Backend user profile inaccessible, using default presentation profile', err);
        return of(null);
      })
    ).subscribe((user) => {
      if (user) {
        this.currentUser = user;
      }
    });
  }

  toggleEditProfile(): void {
    this.isEditProfileOpen = !this.isEditProfileOpen;
  }

  saveProfile(): void {
    if (!this.currentUser) return;
    this.rowerService.updateCurrentUser(this.currentUser).subscribe({
      next: (updated) => {
        this.currentUser = updated;
        this.isEditProfileOpen = false;
      },
      error: (err) => {
        console.error('Erreur mise à jour profil', err);
        this.isEditProfileOpen = false;
      }
    });
  }

  loadHistory(): void {
    this.rowerService.getHistory(20, 0).pipe(
      catchError(() => of({ total: 0, records: [] }))
    ).subscribe((res) => {
      this.history = res.records;
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

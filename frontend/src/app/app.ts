import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RowerService } from './services/rower.service';
import { RowerData } from './models/rower-data.model';
import { UserProfile } from './models/user.model';
import { interval, Subscription } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, OnDestroy {
  currentUser: UserProfile | null = null;
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

    // Poll latest metrics every 2 seconds
    this.pollingSub = interval(2000)
      .pipe(
        startWith(0),
        switchMap(() => this.rowerService.getLatestData())
      )
      .subscribe({
        next: (data) => {
          this.latestData = data;
          this.backendConnected = true;
          this.errorMessage = '';
        },
        error: (err) => {
          this.backendConnected = false;
          if (err.status === 404) {
            this.errorMessage = 'En attente de données émises par la montre...';
          } else {
            this.errorMessage = 'Impossible de joindre le backend API (' + this.apiUrl + ')';
          }
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
    this.rowerService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
      },
      error: (err) => {
        console.error('Impossible de charger le profil utilisateur', err);
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
      }
    });
  }

  loadHistory(): void {
    this.rowerService.getHistory(20, 0).subscribe({
      next: (res) => {
        this.history = res.records;
      },
      error: () => {}
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

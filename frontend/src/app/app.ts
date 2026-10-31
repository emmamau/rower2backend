import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RowerService } from './services/rower.service';
import { RowerData } from './models/rower-data.model';
import { interval, Subscription } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, OnDestroy {
  latestData: RowerData | null = null;
  history: RowerData[] = [];
  backendConnected = false;
  apiUrl = '';
  errorMessage = '';
  private pollingSub?: Subscription;

  constructor(private rowerService: RowerService) {
    this.apiUrl = this.rowerService.getApiUrl();
  }

  ngOnInit(): void {
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

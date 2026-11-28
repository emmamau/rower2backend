import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SocketService } from './socket.service';

export type RaceCanvasMode = 'global_fit' | 'follow_camera';
export const DEFAULT_RACE_CANVAS_MODE: RaceCanvasMode = 'follow_camera';

export function normalizeRaceCanvasMode(value: unknown): RaceCanvasMode | null {
  return value === 'global_fit' || value === 'follow_camera' ? value : null;
}

/**
 * Mode de rendu du canevas de course (configuré par l'administrateur).
 * Chargé au démarrage via l'API publique, puis mis à jour en direct
 * par l'événement WebSocket `settings:updated`.
 */
@Injectable({ providedIn: 'root' })
export class RaceCanvasModeService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);
  private readonly apiUrl = (environment.apiUrl || 'https://rower-api-service.onrender.com').trim().replace(/\/$/, '');

  readonly mode = signal<RaceCanvasMode>(DEFAULT_RACE_CANVAS_MODE);

  constructor() {
    this.load();
    this.socket.onSettingsUpdated().subscribe((cfg) => {
      const mode = normalizeRaceCanvasMode(cfg?.raceCanvasMode);
      if (mode) {
        this.mode.set(mode);
      }
    });
  }

  load(): void {
    this.http.get<{ success: boolean; raceCanvasMode?: string }>(`${this.apiUrl}/api/race/canvas-mode`).subscribe({
      next: (res) => {
        const mode = normalizeRaceCanvasMode(res?.raceCanvasMode);
        if (mode) {
          this.mode.set(mode);
        }
      },
      error: () => {
        /* On conserve le mode courant (défaut : follow_camera) */
      },
    });
  }

  /** Application locale immédiate (ex. après enregistrement par l'admin). */
  set(mode: RaceCanvasMode): void {
    this.mode.set(mode);
  }
}

import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

export interface MinimapRacer {
  userId: string;
  name: string;
  dist: number;
  color: string;
  isSelf: boolean;
}

export interface MinimapFrame {
  racers: MinimapRacer[];
  targetDistance: number;
  followedId: string;
  /** Fenêtre visible de la caméra, en mètres */
  viewStartM: number;
  viewEndM: number;
}

/**
 * Mini-map tactique : 0 m → raceDistance sur toute la largeur.
 * Dessinée de façon impérative (render) depuis la boucle d'animation du canevas
 * afin de ne pas dépendre de la détection de changements d'Angular.
 */
@Component({
  selector: 'app-race-minimap',
  standalone: true,
  template: `<canvas #mapCanvas class="minimap-canvas" (click)="onClick($event)"></canvas>`,
  styles: [`
    :host {
      display: block;
      position: absolute;
      inset-inline: 0;
      top: 0;
      z-index: 6;
    }
    .minimap-canvas {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      touch-action: manipulation;
      cursor: pointer;
    }
  `],
})
export class RaceMinimapComponent {
  @ViewChild('mapCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() heightPx = 44;
  @Output() racerSelect = new EventEmitter<string>();

  /** Rayon de capture tactile autour d'un point (px CSS) */
  static readonly HIT_RADIUS_PX = 22;

  private last: MinimapFrame | null = null;
  private cssW = 0;
  private cssH = 0;

  /** Position X (px CSS) d'une distance sur la mini-map */
  static distToX(distM: number, targetM: number, width: number, pad: number): number {
    const t = targetM > 0 ? Math.min(1, Math.max(0, distM / targetM)) : 0;
    return pad + t * Math.max(1, width - pad * 2);
  }

  /** Retourne le coureur le plus proche de x (dans le rayon tactile), sinon null */
  static pickRacer(frame: MinimapFrame, x: number, width: number, pad: number): string | null {
    let best: string | null = null;
    let bestD = RaceMinimapComponent.HIT_RADIUS_PX;
    for (const r of frame.racers) {
      const d = Math.abs(RaceMinimapComponent.distToX(r.dist, frame.targetDistance, width, pad) - x);
      if (d <= bestD) {
        bestD = d;
        best = r.userId;
      }
    }
    return best;
  }

  private static readonly PAD = 14;

  onClick(event: MouseEvent): void {
    if (!this.last) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const id = RaceMinimapComponent.pickRacer(this.last, event.clientX - rect.left, rect.width, RaceMinimapComponent.PAD);
    if (id) {
      event.stopPropagation();
      this.racerSelect.emit(id);
    }
  }

  render(frame: MinimapFrame, width: number): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.last = frame;
    const h = this.heightPx;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    if (this.cssW !== width || this.cssH !== h) {
      this.cssW = width;
      this.cssH = h;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);

    const pad = RaceMinimapComponent.PAD;
    const trackY = Math.round(h * 0.55);
    const toX = (d: number) => RaceMinimapComponent.distToX(d, frame.targetDistance, width, pad);

    // Fond de la barre
    ctx.fillStyle = 'rgba(6, 13, 29, 0.88)';
    ctx.fillRect(0, 0, width, h);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(width, h - 0.5);
    ctx.stroke();

    // Rail 0 m → arrivée
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(0), trackY);
    ctx.lineTo(toX(frame.targetDistance), trackY);
    ctx.stroke();

    // Fenêtre visible de la caméra
    const vx0 = toX(frame.viewStartM);
    const vx1 = toX(frame.viewEndM);
    ctx.fillStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(vx0, trackY - 12, Math.max(4, vx1 - vx0), 24);
    ctx.strokeRect(vx0 + 0.5, trackY - 12 + 0.5, Math.max(4, vx1 - vx0) - 1, 23);

    // Arrivée (damier simplifié)
    const fx = toX(frame.targetDistance);
    ctx.fillStyle = '#ffe600';
    ctx.fillRect(fx - 1.5, trackY - 12, 3, 24);

    // Départ
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(toX(0) - 1.5, trackY - 12, 3, 24);

    // Graduations 500 m
    ctx.font = '600 9px monospace';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.textAlign = 'center';
    for (let m = 500; m < frame.targetDistance; m += 500) {
      const gx = toX(m);
      ctx.fillRect(gx - 0.5, trackY - 5, 1, 10);
      if (frame.targetDistance >= 1000 && width > 300) {
        ctx.fillText(`${m}`, gx, h - 3);
      }
    }

    // Coureurs (le suivi est dessiné en dernier, par-dessus)
    const ordered = [...frame.racers].sort((a, b) =>
      (a.userId === frame.followedId ? 1 : 0) - (b.userId === frame.followedId ? 1 : 0)
    );
    for (const r of ordered) {
      const x = toX(r.dist);
      const followed = r.userId === frame.followedId;
      const radius = followed ? 7 : r.isSelf ? 6 : 5;
      if (followed) {
        ctx.save();
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, trackY, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = r.isSelf ? '#00e5ff' : r.color;
      ctx.beginPath();
      ctx.arc(x, trackY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Nom du kayak suivi
    const fb = frame.racers.find((r) => r.userId === frame.followedId);
    if (fb) {
      const x = toX(fb.dist);
      const label = fb.name.length > 14 ? fb.name.slice(0, 13) + '…' : fb.name;
      ctx.font = '700 10px sans-serif';
      ctx.fillStyle = '#00f0ff';
      ctx.textAlign = x > width * 0.8 ? 'right' : x < width * 0.2 ? 'left' : 'center';
      ctx.fillText(label, x, 11);
    }
  }
}

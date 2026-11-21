import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';
import { PrivateRacePayload } from '../../models/rower-data.model';

@Component({
  selector: 'app-race-overlays',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './race-overlays.component.html',
  encapsulation: ViewEncapsulation.None
})
export class RaceOverlaysComponent {
  @Input() activeFinishToast: string | null = null;
  @Input() showFinishCelebration = false;
  @Input() isMobileOrTablet = false;
  @Input() isMobileFullscreenOnly = false;
  @Input() isOrientationDismissed = false;
  @Input() siteView: 'home' | 'regatta' | 'cockpit' = 'home';
  @Input() isFullscreen = false;
  @Input() isPseudoFullscreen = false;
  @Input() isRegattaLaunchSplashOpen = false;
  @Input() activePrivateRoom: PrivateRacePayload | null = null;
  @Input() is3sCountdown = false;
  @Input() threeSecondsCount = 3;
  @Input() isPreStartCountdown = false;
  @Input() isPrestartTimerDismissed = false;
  @Input() formattedPreRaceCountdown = '0m 00s';
  @Input() timerPosition: { x: number; y: number } | null = null;
  @Input() isDraggingTimer = false;
  @Input() pendingApprovalPlayers: any[] = [];

  @Output() dismissOrientation = new EventEmitter<void>();
  @Output() launchRegattaSplash = new EventEmitter<void>();
  @Output() dismissRegattaSplash = new EventEmitter<void>();
  @Output() timerPointerDown = new EventEmitter<PointerEvent>();
  @Output() timerPointerMove = new EventEmitter<PointerEvent>();
  @Output() timerPointerUp = new EventEmitter<PointerEvent>();
  @Output() resetTimerPos = new EventEmitter<Event>();
  @Output() dismissPrestartTimer = new EventEmitter<Event>();
  @Output() approvePlayer = new EventEmitter<string>();
  @Output() rejectPlayer = new EventEmitter<string>();

  constructor(public i18n: I18nService) {}

  dismissOrientationNotice(): void {
    this.dismissOrientation.emit();
  }

  launchRegattaFromSplash(): void {
    this.launchRegattaSplash.emit();
  }

  dismissRegattaLaunchSplash(): void {
    this.dismissRegattaSplash.emit();
  }

  onTimerPointerDown(event: PointerEvent): void {
    this.timerPointerDown.emit(event);
  }

  onTimerPointerMove(event: PointerEvent): void {
    this.timerPointerMove.emit(event);
  }

  onTimerPointerUp(event: PointerEvent): void {
    this.timerPointerUp.emit(event);
  }

  resetTimerPosition(event: Event): void {
    this.resetTimerPos.emit(event);
  }

  dismissPrestartTimerPermanently(event: Event): void {
    this.dismissPrestartTimer.emit(event);
  }
}

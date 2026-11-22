import { Component, Input, Output, EventEmitter, ViewEncapsulation, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { PrivateRacePayload } from '../../models/rower-data.model';

export type InvitationOverlayStep = 'choice' | 'guest-pairing' | 'login' | 'register';

@Component({
  selector: 'app-race-overlays',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './race-overlays.component.html',
  encapsulation: ViewEncapsulation.None
})
export class RaceOverlaysComponent implements OnChanges {
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
  @Input() shouldShowSmartphonePinOverlay = false;
  @Input() activeFullscreenPinCode = '';
  @Input() formattedPairingCountdown = '';

  // Nouveaux états d'authentification et d'invitation mobile-first
  @Input() isIdentified = false;
  @Input() currentUserName = '';
  @Input() isPaired = false;
  @Input() invitationEmail = '';
  @Input() invitationStep: InvitationOverlayStep = 'choice';
  @Input() invitationAuthError = '';
  @Input() isInvitationSubmitting = false;

  // Détection du navigateur intégré de messagerie (In-App Browser / WebView)
  @Input() isInAppBrowser = false;
  @Input() isIosInApp = false;
  @Input() isAndroidInApp = false;
  isInAppNoticeDismissed = false;

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

  @Output() setInvitationStep = new EventEmitter<InvitationOverlayStep>();
  @Output() quickLoginSubmit = new EventEmitter<{ emailOrLogin: string; password: string }>();
  @Output() quickRegisterSubmit = new EventEmitter<{ login: string; email: string; password: string }>();
  @Output() openFullAccountModal = new EventEmitter<'login' | 'register'>();

  // Champs de saisie formulaires rapides d'invitation
  quickLoginInput = '';
  quickPasswordInput = '';
  quickRegLogin = '';
  quickRegEmail = '';
  quickRegPassword = '';

  constructor(public i18n: I18nService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['invitationEmail'] && this.invitationEmail) {
      if (!this.quickLoginInput) {
        this.quickLoginInput = this.invitationEmail;
      }
      if (!this.quickRegEmail) {
        this.quickRegEmail = this.invitationEmail;
      }
    }
  }

  goToInvitationStep(step: InvitationOverlayStep): void {
    if (step === 'login' && this.invitationEmail && !this.quickLoginInput) {
      this.quickLoginInput = this.invitationEmail;
    }
    if (step === 'register' && this.invitationEmail && !this.quickRegEmail) {
      this.quickRegEmail = this.invitationEmail;
    }
    this.setInvitationStep.emit(step);
  }

  onQuickLogin(): void {
    const emailOrLogin = (this.quickLoginInput || '').trim();
    const password = (this.quickPasswordInput || '').trim();
    if (!emailOrLogin || !password) return;
    this.quickLoginSubmit.emit({ emailOrLogin, password });
  }

  onQuickRegister(): void {
    const login = (this.quickRegLogin || '').trim();
    const email = (this.quickRegEmail || '').trim();
    const password = (this.quickRegPassword || '').trim();
    if (!login || !password) return;
    this.quickRegisterSubmit.emit({ login, email, password });
  }

  openAccountModal(tab: 'login' | 'register'): void {
    this.openFullAccountModal.emit(tab);
  }

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

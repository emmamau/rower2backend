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
  styleUrls: ['./race-overlays.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class RaceOverlaysComponent implements OnChanges {
  @Input() activeFinishToast: string | null = null;
  @Input() showFinishCelebration = false;
  @Input() isMobileOrTablet = false;
  @Input() isMobileFullscreenOnly = false;
  @Input() isAnyModalOpen = false;
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

  // Course par défaut & Encart invitation montre Garmin
  @Input() isAwaitingWatchPin = false;
  @Input() activeRoomPin = '';
  @Input() hasPlayerJoinedWaterLane = false;
  @Output() copyActivePin = new EventEmitter<void>();
  @Output() dismissWatchPinOverlay = new EventEmitter<void>();
  isWatchPinDismissed = false;
  isPinCopied = false;

  // Nouveaux états d'authentification et d'invitation mobile-first
  @Input() isIdentified = false;
  @Input() currentUserId = '';
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
    if (changes['isAwaitingWatchPin']) {
      if (changes['isAwaitingWatchPin'].currentValue) {
        this.isWatchPinDismissed = false;
      }
    }
    if (changes['invitationEmail'] && this.invitationEmail) {
      if (!this.quickLoginInput) {
        this.quickLoginInput = this.invitationEmail;
      }
      if (!this.quickRegEmail) {
        this.quickRegEmail = this.invitationEmail;
      }
    }
  }

  get shouldShowWatchPinInvitationOverlay(): boolean {
    if (this.isWatchPinDismissed) return false;
    if (this.hasPlayerJoinedWaterLane) return false;
    if (!this.isAwaitingWatchPin) return false;
    return true;
  }

  get displayWatchPin(): string {
    return this.activeRoomPin || this.activeFullscreenPinCode || this.activePrivateRoom?.pinCode || this.activePrivateRoom?.race?.pinCode || '----';
  }

  onCopyWatchPin(): void {
    const pin = this.displayWatchPin;
    if (pin && pin !== '----' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(pin).then(() => {
        this.isPinCopied = true;
        setTimeout(() => { this.isPinCopied = false; }, 2000);
      }).catch(() => {});
    }
    this.copyActivePin.emit();
  }

  dismissWatchPinPrompt(): void {
    this.isWatchPinDismissed = true;
    this.dismissWatchPinOverlay.emit();
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

  get isDuel1v1(): boolean {
    return Boolean(
      this.activePrivateRoom?.isDuel1v1 ||
      this.activePrivateRoom?.race?.isDuel1v1 ||
      (this.activePrivateRoom as any)?.gameMode === 'duel_1v1' ||
      (this.activePrivateRoom?.race as any)?.gameMode === 'duel_1v1'
    );
  }

  get activeDuelChallenge(): any {
    return this.activePrivateRoom?.duelChallenge || (this.activePrivateRoom?.race as any)?.duelChallenge || null;
  }

  get duelLaunchTitle(): string {
    if (!this.isDuel1v1) return '';
    const ch = this.activeDuelChallenge;
    if (!ch) return '⚔️ Duel 1v1';

    const uid = (this.currentUserId || '').trim().toLowerCase();
    const uname = (this.currentUserName || '').trim().toLowerCase();

    const challengerUserId = (ch.challengerUserId || '').trim().toLowerCase();
    const challengerLogin = (ch.challengerLogin || '').trim();
    const challengerName = (ch.challengerName || '').trim();

    const challengedUserId = (ch.challengedUserId || '').trim().toLowerCase();
    const challengedLogin = (ch.challengedLogin || '').trim();
    const challengedName = (ch.challengedName || '').trim();
    const challengedEmail = (ch.challengedEmail || '').trim();

    const isChallenger = (challengerUserId && challengerUserId === uid) ||
                         (challengerLogin && (challengerLogin.toLowerCase() === uid || challengerLogin.toLowerCase() === uname));

    const isChallenged = (challengedUserId && challengedUserId === uid) ||
                         (challengedLogin && (challengedLogin.toLowerCase() === uid || challengedLogin.toLowerCase() === uname));

    if (isChallenger) {
      const opp = this.formatPlayerDisplay(challengedName, challengedLogin, challengedEmail);
      return `⚔️ Duel contre ${opp}`;
    } else if (isChallenged) {
      const opp = this.formatPlayerDisplay(challengerName, challengerLogin);
      return `⚔️ Duel contre ${opp}`;
    } else if (challengerName || challengerLogin || challengedName || challengedLogin) {
      const p1 = this.formatPlayerDisplay(challengerName, challengerLogin);
      const p2 = this.formatPlayerDisplay(challengedName, challengedLogin, challengedEmail);
      return `⚔️ Duel : ${p1} vs ${p2}`;
    }

    return '⚔️ Duel 1v1';
  }

  private formatPlayerDisplay(name?: string, login?: string, email?: string): string {
    const cleanName = (name || '').trim();
    const cleanLogin = (login || '').trim();
    const cleanEmail = (email || '').trim();

    if (cleanName && cleanLogin && cleanName.toLowerCase() !== cleanLogin.toLowerCase()) {
      return `${cleanName} (@${cleanLogin})`;
    }
    if (cleanName) return cleanName;
    if (cleanLogin) return `@${cleanLogin}`;
    if (cleanEmail) return `Invité : ${cleanEmail}`;
    return 'Adversaire';
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

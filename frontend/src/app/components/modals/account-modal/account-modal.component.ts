import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnDestroy, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../services/i18n.service';
import {
  UserProfile,
  KayakPattern,
  hexToRgba,
  RegattaMetricKey,
  RegattaMetricOption,
  REGATTA_METRICS_CATALOG,
  DuelPreferences
} from '../../../models/user.model';
import { LeagueInfo } from '../../../utils/league.util';
import { PrivateModalTab } from '../../private-room-manager/private-room-manager.component';

export type AccountModalTabType = 'login' | 'register' | 'profile' | 'forgot' | 'kayak-customizer' | 'regatta-settings';

@Component({
  selector: 'app-account-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class AccountModalComponent implements OnDestroy {
  @Input() isAccountModalOpen = false;
  @Input() isLoginModalOpen = false;
  @Input() accountModalTab: AccountModalTabType = 'login';
  @Input() isUserAdmin = false;
  @Input() isSubscriber = false;
  @Input() isIdentified = false;
  @Input() isRegisteredUser = false;
  @Input() isPostRegisterOnboarding = false;
  @Input() accountAuthSuccess = '';
  @Input() accountAuthError = '';
  @Input() isAccountSubmitting = false;
  @Input() currentUser!: UserProfile;
  @Input() currentUserLeague!: LeagueInfo;
  @Input() fullPlayerId = '';
  @Input() activeUserId = '';
  @Input() isPaired = false;
  @Input() watchPairingRecovered = false;
  @Input() isGeneratingPairingCode = false;
  @Input() isTogglingRestingMode = false;
  @Input() isUnsubscribing = false;
  @Input() isDeletingAccount = false;
  @Input() unsubscribeMessage = '';
  @Input() unsubscribeError = '';
  @Input() deleteAccountError = '';

  // Login / Register / Forgot inputs
  @Input() loginAccountInput = '';
  @Input() passwordAccountInput = '';
  @Input() regNom = '';
  @Input() regPrenom = '';
  @Input() regAnneeNaissance = 1995;
  @Input() regSexe = 'M';
  @Input() regPays = 'France';
  @Input() regCustomPays = '';
  @Input() regLogin = '';
  @Input() regEmail = '';
  @Input() regPassword = '';
  @Input() regPasswordConfirm = '';
  @Input() regWebsiteUrl = '';
  @Input() forgotEmailOrLogin = '';
  @Input() resetToken = '';
  @Input() resetNewPassword = '';
  @Input() showResetFields = false;

  // Kayak customizer inputs
  @Input() customKayakHullColor = '#00e5ff';
  @Input() customKayakBladeColor = '#00f0ff';
  @Input() customKayakPattern: KayakPattern = 'racing-stripe';
  @Input() customKayakGlowColor = '#00f0ff';
  @Input() isSavingKayak = false;

  // Regatta preferences inputs
  @Input() regattaZoomLevel = 1;
  @Input() selectedRegattaMetrics: RegattaMetricKey[] = [];
  @Input() visibleRegattaMetrics: RegattaMetricKey[] = [];
  @Input() isSavingRegattaPreferences = false;
  @Input() regattaPreferencesFeedback = '';
  @Input() regattaPreferencesError = '';
  @Input() isPrestartTimerDismissed = false;

  // Duel 1v1 registration & profile preferences
  @Input() regAcceptsDuels = true;
  @Input() regDuelStartTime = '08:00';
  @Input() regDuelEndTime = '22:00';
  @Input() regDuelRefusedDays: number[] = [];
  @Input() duelAcceptsDuels = true;
  @Input() duelIsAbsent = false;
  @Input() duelAbsenceStartDate = '';
  @Input() duelAbsenceEndDate = '';
  @Input() duelAvailableStartTime = '08:00';
  @Input() duelAvailableEndTime = '22:00';
  @Input() duelRefusedDays: number[] = [];
  @Input() isSavingDuelPreferences = false;
  @Input() duelPreferencesFeedback = '';
  @Input() duelPreferencesError = '';

  @Output() accountModalTabChange = new EventEmitter<AccountModalTabType>();
  @Output() loginAccountInputChange = new EventEmitter<string>();
  @Output() passwordAccountInputChange = new EventEmitter<string>();
  @Output() regNomChange = new EventEmitter<string>();
  @Output() regPrenomChange = new EventEmitter<string>();
  @Output() regAnneeNaissanceChange = new EventEmitter<number>();
  @Output() regSexeChange = new EventEmitter<string>();
  @Output() regPaysChange = new EventEmitter<string>();
  @Output() regCustomPaysChange = new EventEmitter<string>();
  @Output() regLoginChange = new EventEmitter<string>();
  @Output() regEmailChange = new EventEmitter<string>();
  @Output() regPasswordChange = new EventEmitter<string>();
  @Output() regPasswordConfirmChange = new EventEmitter<string>();
  @Output() regWebsiteUrlChange = new EventEmitter<string>();
  @Output() forgotEmailOrLoginChange = new EventEmitter<string>();
  @Output() resetTokenChange = new EventEmitter<string>();
  @Output() resetNewPasswordChange = new EventEmitter<string>();
  @Output() showResetFieldsChange = new EventEmitter<boolean>();

  @Output() customKayakHullColorChange = new EventEmitter<string>();
  @Output() customKayakBladeColorChange = new EventEmitter<string>();
  @Output() customKayakPatternChange = new EventEmitter<KayakPattern>();
  @Output() customKayakGlowColorChange = new EventEmitter<string>();

  @Output() closeAccountModalRequest = new EventEmitter<void>();
  @Output() promptLogoutRequest = new EventEmitter<void>();
  @Output() openKayakCustomizerRequest = new EventEmitter<void>();
  @Output() openRegattaSettingsRequest = new EventEmitter<void>();
  @Output() submitAccountLoginRequest = new EventEmitter<void>();
  @Output() submitAccountRegisterRequest = new EventEmitter<void>();
  @Output() submitForgotPasswordRequest = new EventEmitter<void>();
  @Output() submitResetPasswordRequest = new EventEmitter<void>();
  @Output() startPairingFromProfileRequest = new EventEmitter<void>();
  @Output() resetGarminPairingRequest = new EventEmitter<void>();
  @Output() toggleRestingModeRequest = new EventEmitter<void>();
  @Output() openStatisticsModalRequest = new EventEmitter<void>();
  @Output() unsubscribeUserRequest = new EventEmitter<void>();
  @Output() deleteUserAccountRequest = new EventEmitter<void>();
  @Output() openSubscriptionModalRequest = new EventEmitter<void>();
  @Output() openPrivateModalRequest = new EventEmitter<PrivateModalTab | undefined>();
  @Output() saveKayakCustomizationRequest = new EventEmitter<void>();
  @Output() skipKayakCustomizationRequest = new EventEmitter<void>();
  @Output() setRegattaZoomRequest = new EventEmitter<{ level: number; persist: boolean }>();
  @Output() resetRegattaPreferencesDefaultRequest = new EventEmitter<void>();
  @Output() toggleRegattaMetricRequest = new EventEmitter<RegattaMetricKey>();
  @Output() moveRegattaMetricRequest = new EventEmitter<{ index: number; direction: -1 | 1 }>();
  @Output() togglePrestartTimerPreferenceRequest = new EventEmitter<boolean>();
  @Output() saveRegattaPreferencesRequest = new EventEmitter<void>();

  @Output() regAcceptsDuelsChange = new EventEmitter<boolean>();
  @Output() regDuelStartTimeChange = new EventEmitter<string>();
  @Output() regDuelEndTimeChange = new EventEmitter<string>();
  @Output() toggleRegDuelRefusedDayRequest = new EventEmitter<number>();
  @Output() duelAcceptsDuelsChange = new EventEmitter<boolean>();
  @Output() duelIsAbsentChange = new EventEmitter<boolean>();
  @Output() duelAbsenceStartDateChange = new EventEmitter<string>();
  @Output() duelAbsenceEndDateChange = new EventEmitter<string>();
  @Output() duelAvailableStartTimeChange = new EventEmitter<string>();
  @Output() duelAvailableEndTimeChange = new EventEmitter<string>();
  @Output() toggleDuelRefusedDayRequest = new EventEmitter<number>();
  @Output() saveDuelPreferencesRequest = new EventEmitter<void>();

  readonly duelWeekDays: { id: number; label: string }[] = [
    { id: 1, label: 'Lun' },
    { id: 2, label: 'Mar' },
    { id: 3, label: 'Mer' },
    { id: 4, label: 'Jeu' },
    { id: 5, label: 'Ven' },
    { id: 6, label: 'Sam' },
    { id: 0, label: 'Dim' }
  ];

  showRegPassword = false;
  showRegPasswordConfirm = false;
  showResetPassword = false;

  readonly regattaMetricsCatalog: RegattaMetricOption[] = REGATTA_METRICS_CATALOG;
  readonly regattaZoomPresets: number[] = [1, 1.5, 2, 2.5, 3];

  readonly presetColors = [
    { name: 'Cyan Néon', hex: '#00e5ff' },
    { name: 'Bleu Royal', hex: '#0055ff' },
    { name: 'Rouge Racing', hex: '#ff0055' },
    { name: 'Orange Éclair', hex: '#ff6600' },
    { name: 'Or Vainqueur', hex: '#ffe600' },
    { name: 'Vert Émeraude', hex: '#39ff14' },
    { name: 'Violet Pulsar', hex: '#b026ff' },
    { name: 'Noir Carbone', hex: '#1a1f2c' },
    { name: 'Blanc Pur', hex: '#ffffff' }
  ];

  readonly patternOptions: { id: KayakPattern; label: string; icon: string; desc: string }[] = [
    { id: 'solid', label: 'Uni Épuré', icon: '🎨', desc: 'Finition classique monochrome' },
    { id: 'racing-stripe', label: 'Bande Racing', icon: '⚡', desc: 'Double liseré central athlétique' },
    { id: 'dual-tone', label: 'Bi-Colore', icon: '🌗', desc: 'Contraste marqué proue / poupe' },
    { id: 'gradient', label: 'Dégradé', icon: '🌈', desc: 'Fusion fluide de teintes sportives' }
  ];

  private _previewCanvasRef?: ElementRef<HTMLCanvasElement>;
  private _previewAnimFrameId?: any;

  @ViewChild('kayakPreviewCanvas')
  set kayakPreviewCanvas(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this._previewCanvasRef = ref;
    if (ref) {
      this.startKayakPreviewAnimation();
    } else {
      this.stopKayakPreviewAnimation();
    }
  }

  constructor(public i18n: I18nService) {}

  ngOnDestroy(): void {
    this.stopKayakPreviewAnimation();
  }

  switchTab(tab: AccountModalTabType): void {
    this.accountModalTab = tab;
    this.accountModalTabChange.emit(tab);
  }

  openKayakCustomizer(): void {
    this.openKayakCustomizerRequest.emit();
  }

  openRegattaSettings(): void {
    this.openRegattaSettingsRequest.emit();
  }

  saveKayakCustomization(): void {
    this.saveKayakCustomizationRequest.emit();
  }

  skipKayakCustomization(): void {
    this.skipKayakCustomizationRequest.emit();
  }

  startPairingFromProfile(): void {
    this.startPairingFromProfileRequest.emit();
  }

  resetGarminPairing(): void {
    this.resetGarminPairingRequest.emit();
  }

  getPatternLabel(pattern: KayakPattern): string {
    const found = this.patternOptions.find(p => p.id === pattern);
    return found ? `${found.icon} ${found.label}` : 'Uni Épuré';
  }

  isRegattaMetricSelected(key: RegattaMetricKey): boolean {
    return this.selectedRegattaMetrics.includes(key);
  }

  getRegattaMetricOption(key: RegattaMetricKey): RegattaMetricOption {
    return (
      this.regattaMetricsCatalog.find((m) => m.key === key) || {
        key,
        label: key,
        shortLabel: key.toUpperCase(),
        unit: '',
        icon: '📊',
        desc: '',
      }
    );
  }

  getPasswordStrength(pwd: string): { score: number; label: string; class: string; width: string } {
    if (!pwd) return { score: 0, label: '', class: '', width: '0%' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) score++;

    if (score <= 2) return { score, label: 'Faible', class: 'strength-weak', width: '33%' };
    if (score <= 4) return { score, label: 'Moyen', class: 'strength-medium', width: '66%' };
    return { score, label: 'Robuste', class: 'strength-strong', width: '100%' };
  }

  isPasswordPolicySatisfied(pwd: string): boolean {
    return Boolean(
      pwd &&
      pwd.length >= 8 &&
      /[A-Z]/.test(pwd) &&
      /[a-z]/.test(pwd) &&
      /\d/.test(pwd) &&
      /[!@#$%^&*(),.?":{}|<>]/.test(pwd)
    );
  }

  startKayakPreviewAnimation(): void {
    this.stopKayakPreviewAnimation();
    const render = () => {
      this.drawKayakCustomizerPreview();
      this._previewAnimFrameId = requestAnimationFrame(render);
    };
    this._previewAnimFrameId = requestAnimationFrame(render);
  }

  stopKayakPreviewAnimation(): void {
    if (this._previewAnimFrameId) {
      cancelAnimationFrame(this._previewAnimFrameId);
      this._previewAnimFrameId = undefined;
    }
  }

  drawKayakCustomizerPreview(): void {
    const canvas = this._previewCanvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const nowSec = performance.now() / 1000;

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0a1628');
    bgGrad.addColorStop(0.5, '#0c223d');
    bgGrad.addColorStop(1, '#07111e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const waveY = ((height * 0.25 * i + (nowSec * 15)) % height);
      ctx.beginPath();
      ctx.moveTo(0, waveY);
      for (let xPos = 0; xPos <= width; xPos += 20) {
        const offset = Math.sin(xPos * 0.03 + nowSec * 2 + i) * 3;
        ctx.lineTo(xPos, waveY + offset);
      }
      ctx.stroke();
    }

    const bobbingY = Math.sin(nowSec * 2.2) * 2;
    const centerX = width * 0.5;
    const centerY = height * 0.5 + bobbingY;

    const hullRx = Math.min(width * 0.26, 85);
    const hullRy = 14;

    const sternX = centerX - hullRx;
    const previewGlow = this.customKayakGlowColor || '#00f0ff';
    ctx.fillStyle = hexToRgba(previewGlow, 0.15);
    ctx.beginPath();
    ctx.ellipse(sternX - 16, centerY, 32, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToRgba(previewGlow, 0.28);
    ctx.beginPath();
    ctx.ellipse(sternX - 6, centerY, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = this.customKayakGlowColor || '#00f0ff';
    ctx.shadowBlur = 16 + Math.sin(nowSec * 4) * 4;
    ctx.strokeStyle = this.customKayakGlowColor || '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, hullRx + 4, hullRy + 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const strokeAngle = Math.sin(nowSec * 2.4) * 0.42;
    const oarLen = 44;
    const dxOar = Math.sin(strokeAngle) * oarLen;
    const dyOar = Math.cos(strokeAngle) * oarLen;
    const x1 = centerX - dxOar;
    const y1 = centerY - dyOar;
    const x2 = centerX + dxOar;
    const y2 = centerY + dyOar;

    if (Math.abs(strokeAngle) > 0.2) {
      ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
      ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const bladeColor = this.customKayakBladeColor || '#00f0ff';
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(-strokeAngle);
    ctx.fillStyle = bladeColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(x2, y2);
    ctx.rotate(-strokeAngle);
    ctx.fillStyle = bladeColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(centerX + hullRx, centerY);
    ctx.quadraticCurveTo(centerX, centerY - hullRy, centerX - hullRx, centerY);
    ctx.quadraticCurveTo(centerX, centerY + hullRy, centerX + hullRx, centerY);
    ctx.closePath();

    const hullColor = this.customKayakHullColor || '#00e5ff';
    const pattern = this.customKayakPattern || 'racing-stripe';

    if (pattern === 'gradient') {
      const grad = ctx.createLinearGradient(centerX - hullRx, centerY, centerX + hullRx, centerY);
      grad.addColorStop(0, bladeColor);
      grad.addColorStop(1, hullColor);
      ctx.fillStyle = grad;
      ctx.fill();
    } else if (pattern === 'dual-tone') {
      ctx.fillStyle = hullColor;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = bladeColor;
      ctx.fillRect(centerX - hullRx, centerY - hullRy * 2, hullRx, hullRy * 4);
      ctx.restore();
    } else {
      ctx.fillStyle = hullColor;
      ctx.fill();
    }

    if (pattern === 'racing-stripe') {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(centerX - hullRx + 4, centerY - 2.5);
      ctx.lineTo(centerX + hullRx - 4, centerY - 2.5);
      ctx.moveTo(centerX - hullRx + 4, centerY + 2.5);
      ctx.lineTo(centerX + hullRx - 4, centerY + 2.5);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.clip();
    const sheenGrad = ctx.createLinearGradient(centerX, centerY - hullRy, centerX, centerY);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheenGrad;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(centerX - 4, centerY, 13, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(centerX - 4, centerY, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

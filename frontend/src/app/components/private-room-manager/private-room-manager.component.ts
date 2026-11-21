import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
  OnInit,
  OnDestroy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { RowerService } from '../../services/rower.service';
import { I18nService } from '../../services/i18n.service';
import { SocketService } from '../../services/socket.service';
import { PrivateRacePayload, SavedPrivateSalon, RoomCreationQuotaInfo } from '../../models/rower-data.model';
import { DuelChallenge, AvailableDuelPlayer } from '../../models/user.model';
import {
  parseRoomInviteInput,
  buildShareableRoomUrl,
  buildRoomInviteMessage
} from '../../utils/room-link.util';

export type PrivateModalTab = 'create' | 'share' | 'join' | 'duels';

const SAVED_SALONS_STORAGE_KEY = 'rower_saved_private_salons';

@Component({
  selector: 'app-private-room-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './private-room-manager.component.html',
  styleUrls: ['./private-room-manager.component.css']
})
export class PrivateRoomManagerComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('dialogEl') dialogRef?: ElementRef<HTMLElement>;

  private openedTimestamp = 0;

  @Input() isOpen = false;
  @Input() initialTab: PrivateModalTab = 'create';
  @Input() activeRoom: PrivateRacePayload | null = null;
  @Input() activeUserId = '';
  @Input() activeUserName = '';
  @Input() isUserAdmin = false;
  @Input() isSubscriber = false;
  @Input() isRegisteredUser = false;
  @Input() isWatchConnected = false;
  @Input() deviceToken = '';
  @Input() userSubscriptionTier = 'free';
  @Input() activeRacersCount = 0;
  @Input() externalError = '';
  @Input() siteView: 'home' | 'regatta' | 'cockpit' = 'home';
  @Input() prefilledDuelLogin = '';
  @Input() prefilledDuelChallengeMode = false;

  @Output() modalClose = new EventEmitter<void>();
  @Output() prefilledDuelHandled = new EventEmitter<void>();
  @Output() openModalRequest = new EventEmitter<PrivateModalTab>();
  @Output() roomSelected = new EventEmitter<{ payload: PrivateRacePayload; pushUrl: boolean }>();
  @Output() roomUpdated = new EventEmitter<PrivateRacePayload>();
  @Output() roomClosedOrLeft = new EventEmitter<{ closedOnServer: boolean; raceId?: string }>();
  @Output() botsToggled = new EventEmitter<boolean>();
  @Output() requestAccountModal = new EventEmitter<'login' | 'register'>();
  @Output() bannerCollapsedChange = new EventEmitter<boolean>();
  @Output() viewRankingRequest = new EventEmitter<string>();

  activeTab: PrivateModalTab = 'create';
  isBannerCollapsed = false;

  // Selected Game Mode for Creation: 'solo' | 'bot_duel' | 'duel_1v1' | 'multi'
  selectedGameMode: 'solo' | 'bot_duel' | 'duel_1v1' | 'multi' = 'solo';

  // Mode de départ spécifique au mode Solo ('first_stroke' par défaut ou 'countdown')
  soloStartMode: 'first_stroke' | 'countdown' = 'first_stroke';

  // Bot difficulty pace presets (plage autorisée : 1:45 -> 2:45 aux 500m)
  readonly BOT_PACE_MIN = 105;
  readonly BOT_PACE_MAX = 165;
  readonly botPacePresets = [
    { label: 'Loisir', pace: 165, time: '2:45/500m' },
    { label: 'Régulier', pace: 145, time: '2:25/500m' },
    { label: 'Intermédiaire', pace: 130, time: '2:10/500m' },
    { label: 'Avancé', pace: 115, time: '1:55/500m' },
    { label: 'Expert', pace: 105, time: '1:45/500m' }
  ];
  isCustomBotPace = false;
  customBotPaceText = '2:00';
  botPaceError = '';

  formatPace(seconds: number): string {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Convertit "m:ss" (ou secondes) en secondes ; null si invalide. */
  parsePace(text: string): number | null {
    const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(text || '');
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const n = Number(String(text || '').trim());
    return Number.isFinite(n) && n > 0 && /^\d+$/.test(String(text).trim()) ? n : null;
  }

  selectBotPreset(pace: number): void {
    this.isCustomBotPace = false;
    this.botPaceError = '';
    this.botMaxPace = pace;
  }

  selectCustomBotPace(): void {
    this.isCustomBotPace = true;
    this.customBotPaceText = this.formatPace(this.botMaxPace);
    this.onCustomBotPaceChange(this.customBotPaceText);
  }

  onCustomBotPaceChange(text: string): void {
    this.customBotPaceText = text;
    const p = this.parsePace(text);
    if (p === null || p < this.BOT_PACE_MIN || p > this.BOT_PACE_MAX) {
      this.botPaceError = `Allure entre ${this.formatPace(this.BOT_PACE_MIN)} et ${this.formatPace(this.BOT_PACE_MAX)} /500m (format m:ss).`;
    } else {
      this.botPaceError = '';
      this.botMaxPace = p;
    }
  }

  // Create form fields
  roomTitle = '';
  targetDistance = 2000;
  maxParticipants = 8;
  startMode: 'manual' | 'scheduled' = 'manual';
  scheduledDateTime = '';
  selectedTimezone: string = typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris') : 'Europe/Paris';

  readonly supportedTimezones = [
    { id: 'Europe/Paris', label: 'Paris, Bruxelles, Madrid (CET / UTC+1)' },
    { id: 'Europe/London', label: 'Londres, Dublin, Lisbonne (GMT / UTC+0)' },
    { id: 'UTC', label: 'Temps Universel Coordonné (UTC)' },
    { id: 'America/New_York', label: 'New York, Montréal, Toronto (EST / UTC-5)' },
    { id: 'America/Chicago', label: 'Chicago, Mexico (CST / UTC-6)' },
    { id: 'America/Denver', label: 'Denver, Edmonton (MST / UTC-7)' },
    { id: 'America/Los_Angeles', label: 'Los Angeles, Vancouver (PST / UTC-8)' },
    { id: 'America/Sao_Paulo', label: 'São Paulo, Buenos Aires (BRT / UTC-3)' },
    { id: 'Asia/Dubai', label: 'Dubaï, Abu Dhabi (GST / UTC+4)' },
    { id: 'Asia/Singapore', label: 'Singapour, Pékin, Hong Kong (SGT / UTC+8)' },
    { id: 'Asia/Tokyo', label: 'Tokyo, Séoul (JST / UTC+9)' },
    { id: 'Australia/Sydney', label: 'Sydney, Melbourne (AEDT / UTC+11)' },
    { id: 'Pacific/Auckland', label: 'Auckland, Wellington (NZDT / UTC+13)' }
  ];
  botCount = 0;
  botMinPace = 165; // Loisir (2:45 / 500m)
  botMaxPace = 145; // 2:25 / 500m
  multiBotCount = 0;
  isCustomBotMinPace = false;
  customBotMinPaceText = '2:45';
  botMinPaceError = '';
  isCustomBotMaxPace = false;
  customBotMaxPaceText = '1:55';
  botMaxPaceError = '';

  get maxBotsAllowed(): number {
    if (this.quotaInfo?.maxBots !== undefined) return this.quotaInfo.maxBots;
    const rawTier = String(this.userSubscriptionTier || (this.isSubscriber ? 'intermediate' : 'free')).toLowerCase().trim();
    if (rawTier === 'pro' || rawTier === 'elite_pro' || rawTier === 'premium') return 5;
    if (rawTier === 'club' || rawTier === 'standard' || rawTier === 'intermediate') return 3;
    if (rawTier === 'free') return 1;
    if (this.isUserAdmin) return 20;
    return this.isSubscriber ? 3 : 1;
  }

  get multiBotCountOptions(): number[] {
    const max = this.maxBotsAllowed;
    const opts: number[] = [];
    for (let i = 0; i <= max; i++) {
      opts.push(i);
    }
    return opts;
  }

  selectMultiBotMinPreset(pace: number): void {
    this.isCustomBotMinPace = false;
    this.botMinPaceError = '';
    this.botMinPace = pace;
  }

  selectCustomBotMinPace(): void {
    this.isCustomBotMinPace = true;
    this.customBotMinPaceText = this.formatPace(this.botMinPace);
    this.onCustomBotMinPaceChange(this.customBotMinPaceText);
  }

  onCustomBotMinPaceChange(text: string): void {
    this.customBotMinPaceText = text;
    const p = this.parsePace(text);
    if (p === null || p < this.BOT_PACE_MIN || p > this.BOT_PACE_MAX) {
      this.botMinPaceError = `Allure entre ${this.formatPace(this.BOT_PACE_MIN)} et ${this.formatPace(this.BOT_PACE_MAX)} /500m.`;
    } else {
      this.botMinPaceError = '';
      this.botMinPace = p;
    }
  }

  selectMultiBotMaxPreset(pace: number): void {
    this.isCustomBotMaxPace = false;
    this.botMaxPaceError = '';
    this.botMaxPace = pace;
  }

  selectCustomBotMaxPace(): void {
    this.isCustomBotMaxPace = true;
    this.customBotMaxPaceText = this.formatPace(this.botMaxPace);
    this.onCustomBotMaxPaceChange(this.customBotMaxPaceText);
  }

  onCustomBotMaxPaceChange(text: string): void {
    this.customBotMaxPaceText = text;
    const p = this.parsePace(text);
    if (p === null || p < this.BOT_PACE_MIN || p > this.BOT_PACE_MAX) {
      this.botMaxPaceError = `Allure entre ${this.formatPace(this.BOT_PACE_MIN)} et ${this.formatPace(this.BOT_PACE_MAX)} /500m.`;
    } else {
      this.botMaxPaceError = '';
      this.botMaxPace = p;
    }
  }

  updateLobbyBots(count: number): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race?.id;
    if (!identifier) return;

    this.isActionBusy = true;
    this.rowerService
      .toggleBots(
        count > 0,
        identifier,
        this.activeUserId,
        count,
        this.botMinPace,
        this.botMaxPace
      )
      .subscribe({
        next: () => {
          this.isActionBusy = false;
          this.showFeedback(count > 0 ? `${count} bot(s) engagé(s) !` : 'Bots retirés.');
          this.refreshActiveRoom();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.message || err?.error?.error || 'Erreur bots salon';
          this.cdr.markForCheck();
        }
      });
  }

  addQuickBots(): void {
    const target = Math.min(3, this.maxBotsAllowed);
    this.updateLobbyBots(target);
  }

  get activeRoomBotCount(): number {
    return this.activeRoom?.race?.botCount ?? (this.activeRoom as any)?.botCount ?? 0;
  }
  countdownMinutes = 5;
  requireApproval = true;
  readonly distancePresets = [500, 1000, 2000, 5000, 10000];

  createTitleError = '';
  createGeneralError = '';
  isCreating = false;

  // Join form fields
  joinInput = '';
  joinError = '';
  isJoining = false;

  // Parcours 2 : Ticket Invité de Salon (Code à 5 caractères atomique)
  guestTicketName = '';
  guestTicketPin = '';
  guestTicketLane = 0;
  guestTicketCountdownSeconds = 0;
  isGeneratingGuestTicket = false;
  guestTicketError = '';
  private guestTicketTimerSub?: Subscription;

  // Share & host action state
  feedbackMessage = '';
  actionError = '';
  isActionBusy = false;
  canNativeShare = false;
  isMobileDevice = false;

  // Invitations e-mail & Calendrier
  duelInviteEmail = '';
  multiInviteEmails: string[] = [];
  multiEmailInput = '';
  includeCalendarInvite = true;
  isSendingInvites = false;
  inviteSuccessMessage = '';
  inviteErrorMessage = '';

  // Quotas & Montre connectée
  quotaInfo: RoomCreationQuotaInfo | null = null;
  isLoadingQuotas = false;

  // Saved / My Rooms list
  savedSalons: SavedPrivateSalon[] = [];
  liveRoomsMap: Map<string, PrivateRacePayload> = new Map();
  isLoadingRooms = false;

  // Duels 1v1 : création de défi, recherche d'adversaire disponible & gestion des défis
  duelTargetLogin = '';
  duelSlotStartLocal = '';
  duelSlotDurationMinutes = 60;
  isSendingDuelChallenge = false;
  duelChallengeSuccess = '';
  duelChallengeError = '';

  duelFindLeague = 'all';
  duelFindCountry = '';
  duelFindGender = 'all';
  isSearchingAvailablePlayers = false;
  hasSearchedAvailablePlayers = false;
  availableDuelPlayers: AvailableDuelPlayer[] = [];

  receivedDuelChallenges: DuelChallenge[] = [];
  sentDuelChallenges: DuelChallenge[] = [];
  blockedDuelSlots: DuelChallenge[] = [];
  isLoadingDuelChallenges = false;
  duelActionBusyId = '';
  duelManageMessage = '';
  duelManageError = '';

  private feedbackTimer?: ReturnType<typeof setTimeout>;
  private socketSub?: Subscription;
  private duelSocketSub?: Subscription;
  private modalPollSub?: Subscription;

  constructor(
    private rowerService: RowerService,
    public i18n: I18nService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    this.isMobileDevice = typeof window !== 'undefined' && (
      window.innerWidth <= 768 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
      (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0)
    );
    this.loadSavedSalonsFromStorage();
    if (!this.roomTitle) {
      this.roomTitle = this.defaultRoomTitle();
    }
    if (!this.duelSlotStartLocal) {
      this.duelSlotStartLocal = this.getDefaultDuelSlotLocal();
    }
    if (!this.guestTicketName) {
      this.guestTicketName = this.activeUserName || `Rameur_${Math.floor(10 + Math.random() * 89)}`;
    }
    this.socketSub = this.socketService.onPrivateRoomUpdate().subscribe((update) => {
      if (this.activeRoom && (update.raceId === this.activeRoom.race?.id || update.raceId === this.activeRoom.code)) {
        this.refreshActiveRoom();
      }
    });
    this.duelSocketSub = this.socketService.onDuelEvent().subscribe(() => {
      if (this.isOpen && this.activeUserId) {
        this.refreshMyDuels();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
    if (this.duelSocketSub) {
      this.duelSocketSub.unsubscribe();
    }
    if (this.modalPollSub) {
      this.modalPollSub.unsubscribe();
    }
    if (this.guestTicketTimerSub) {
      this.guestTicketTimerSub.unsubscribe();
    }
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeRoom']) {
      if (this.activeRoom?.race?.code) {
        this.rememberSalon(this.activeRoom);
      }
      this.checkAutoCollapseOnMobile();
      this.cdr.markForCheck();
    }

    if (changes['siteView']) {
      this.checkAutoCollapseOnMobile();
      this.cdr.markForCheck();
    }

    if (changes['initialTab'] && this.initialTab) {
      this.activeTab = this.resolveTab(this.initialTab);
    }

    if ((changes['prefilledDuelLogin'] || changes['prefilledDuelChallengeMode']) && (this.prefilledDuelLogin || this.prefilledDuelChallengeMode)) {
      this.applyPrefilledDuelChallenge();
    }

    if (changes['isOpen']) {
      if (this.isOpen) {
        this.openedTimestamp = Date.now();
        this.activeTab = this.resolveTab(this.initialTab);
        this.actionError = '';
        if (this.externalError) {
          this.joinError = this.externalError;
        }
        if (!this.roomTitle.trim()) {
          this.roomTitle = this.defaultRoomTitle();
        }
        if (!this.duelSlotStartLocal) {
          this.duelSlotStartLocal = this.getDefaultDuelSlotLocal();
        }
        if (this.prefilledDuelLogin || this.prefilledDuelChallengeMode) {
          this.applyPrefilledDuelChallenge();
        }
        this.refreshRoomLimits();
        this.refreshMyRooms();
        this.refreshMyDuels();
        this.refreshActiveRoom();
        this.startModalPolling();
        this.syncDialogState(true);
      } else {
        this.stopModalPolling();
        this.syncDialogState(false);
      }
    }
  }

  private startModalPolling(): void {
    this.stopModalPolling();
    this.modalPollSub = interval(2000).subscribe(() => {
      if (this.isOpen && this.activeRoom) {
        this.refreshActiveRoom();
      }
    });
  }

  private stopModalPolling(): void {
    if (this.modalPollSub) {
      this.modalPollSub.unsubscribe();
      this.modalPollSub = undefined;
    }
  }

  public refreshActiveRoom(): void {
    const code = this.activeRoomCode;
    if (!code) return;
    this.rowerService.getPrivateRace(code).subscribe({
      next: (updated) => {
        this.activeRoom = updated;
        this.roomUpdated.emit(updated);
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  private resolveTab(requested: PrivateModalTab): PrivateModalTab {
    if (requested === 'share' && !this.activeRoom) {
      return 'create';
    }
    return requested;
  }

  private defaultRoomTitle(): string {
    const cleanName = (this.activeUserName || '').trim();
    return cleanName ? `Salon ${cleanName}` : 'Régate Privée';
  }

  private syncDialogState(open: boolean): void {
    if (open) {
      setTimeout(() => {
        const firstInput = this.dialogRef?.nativeElement?.querySelector<HTMLElement>(
          'input, select, textarea, button:not(.priv-close-btn)'
        );
        firstInput?.focus();
        this.cdr.markForCheck();
      }, 50);
    }
  }

  onNativeDialogClose(): void {
    if (this.isOpen) {
      this.closeModal();
    }
  }

  onBackdropClick(_event?: MouseEvent): void {
    // La fermeture au clic sur le fond est désactivée selon les exigences IHM.
    // La modale se ferme uniquement via la croix ou les boutons explicites.
  }

  closeModal(): void {
    this.isOpen = false;
    this.stopModalPolling();
    this.modalClose.emit();
    this.cdr.markForCheck();
  }

  switchTab(tab: PrivateModalTab): void {
    if (tab === 'share' && !this.activeRoom) return;
    this.activeTab = tab;
    this.actionError = '';
    if (tab === 'join') {
      this.refreshMyRooms();
    } else if (tab === 'duels') {
      this.refreshMyDuels();
    } else if (tab === 'create') {
      this.refreshRoomLimits();
    }
    this.cdr.markForCheck();
  }

  onTabKeydown(event: KeyboardEvent): void {
    const availableTabs: PrivateModalTab[] = this.activeRoom
      ? ['create', 'share', 'join', 'duels']
      : ['create', 'join', 'duels'];
    const currentIdx = availableTabs.indexOf(this.activeTab);
    let targetTab: PrivateModalTab | null = null;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      targetTab = availableTabs[(currentIdx + 1) % availableTabs.length];
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      targetTab = availableTabs[(currentIdx - 1 + availableTabs.length) % availableTabs.length];
    }
    if (targetTab) {
      this.switchTab(targetTab);
      const btn = this.dialogRef?.nativeElement?.querySelector<HTMLButtonElement>(
        `#priv-tab-${targetTab}`
      );
      btn?.focus();
    }
  }

  get isRoomCompleted(): boolean {
    return Boolean(
      this.activeRoom &&
      (this.activeRoom.status === 'COMPLETED' ||
       this.activeRoom.status === 'finished' ||
       this.activeRoom.race?.status === 'COMPLETED' ||
       this.activeRoom.race?.status === 'finished')
    );
  }

  get canManageActiveRoom(): boolean {
    if (!this.activeRoom) return false;
    if (this.isUserAdmin) return true;
    const hostId = this.activeRoom.race.hostUserId;
    const origHostId = (this.activeRoom.race as any).originalHostUserId;
    if (!hostId || hostId === 'anonymous') return true;
    return hostId === this.activeUserId || (Boolean(origHostId) && origHostId === this.activeUserId);
  }

  get isBotDuelRoom(): boolean {
    return Boolean(this.activeRoom?.race?.isBotDuel || (this.activeRoom as any)?.isBotDuel);
  }

  get isSoloRoom(): boolean {
    return Boolean(this.activeRoom?.race?.isSolo || (this.activeRoom as any)?.isSolo);
  }

  get isDuel1v1Room(): boolean {
    return Boolean(this.activeRoom?.race?.isDuel1v1 || (this.activeRoom as any)?.isDuel1v1);
  }

  get activeDuelChallenge(): DuelChallenge | null {
    const roomChallenge = this.activeRoom?.duelChallenge || (this.activeRoom?.race as any)?.duelChallenge;
    if (roomChallenge) return roomChallenge;
    const code = this.activeRoom?.code || this.activeRoom?.race?.code;
    const raceId = this.activeRoom?.id || this.activeRoom?.race?.id;
    if (!code && !raceId) return null;
    const all = [...this.receivedDuelChallenges, ...this.sentDuelChallenges];
    return all.find(d => (d.roomCode && code && d.roomCode.toLowerCase() === code.toLowerCase()) ||
                         (d.roomId && raceId && d.roomId === raceId)) || null;
  }

  get isChallengedPlayer(): boolean {
    const ch = this.activeDuelChallenge;
    if (!ch || !this.activeUserId) return false;
    const uid = this.activeUserId.trim().toLowerCase();
    return (Boolean(ch.challengedUserId) && ch.challengedUserId.toLowerCase() === uid) ||
           (Boolean(ch.challengedLogin) && ch.challengedLogin.toLowerCase() === uid);
  }

  get isChallengerPlayer(): boolean {
    const ch = this.activeDuelChallenge;
    if (!ch || !this.activeUserId) return false;
    const uid = this.activeUserId.trim().toLowerCase();
    return (Boolean(ch.challengerUserId) && ch.challengerUserId.toLowerCase() === uid) ||
           (Boolean(ch.challengerLogin) && ch.challengerLogin.toLowerCase() === uid);
  }

  acceptActiveDuel(): void {
    const ch = this.activeDuelChallenge;
    if (!ch) return;
    this.respondToDuel(ch, 'accept');
  }

  refuseActiveDuel(): void {
    const ch = this.activeDuelChallenge;
    if (!ch) return;
    this.respondToDuel(ch, 'refuse');
  }

  get canShareOrInvite(): boolean {
    return !this.isSoloRoom && !this.isBotDuelRoom;
  }

  selectGameMode(mode: 'solo' | 'bot_duel' | 'duel_1v1' | 'multi'): void {
    this.selectedGameMode = mode;
    if (mode === 'solo') {
      this.roomTitle = `Entraînement Solo (${this.activeUserName || 'Moi'})`;
      this.maxParticipants = 1;
      this.botCount = 0;
      this.startMode = 'manual';
    } else if (mode === 'bot_duel') {
      this.roomTitle = `Duel 1v1 contre un Bot`;
      this.maxParticipants = 2;
      this.botCount = 1;
      this.startMode = 'manual';
    } else if (mode === 'duel_1v1') {
      this.roomTitle = `Duel 1v1 contre un Ami`;
      this.maxParticipants = 2;
      this.botCount = 0;
      this.startMode = 'manual';
    } else {
      this.roomTitle = this.defaultRoomTitle();
      this.maxParticipants = 8;
      this.botCount = 0;
    }
    this.cdr.markForCheck();
  }

  toggleBannerCollapse(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.isBannerCollapsed = !this.isBannerCollapsed;
    this.bannerCollapsedChange.emit(this.isBannerCollapsed);
    this.cdr.markForCheck();
  }

  setBannerCollapsed(collapsed: boolean): void {
    if (this.isBannerCollapsed !== collapsed) {
      this.isBannerCollapsed = collapsed;
      this.bannerCollapsedChange.emit(this.isBannerCollapsed);
      this.cdr.markForCheck();
    }
  }

  private checkAutoCollapseOnMobile(): void {
    if (typeof window === 'undefined' || !this.activeRoom) return;
    const isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 600;
    const internalSt = (this.activeRoom as any)?.internalStatus || (this.activeRoom.race as any)?.internalStatus;
    const isRaceStartingOrRunning =
      this.activeRoom.status === 'in_progress' ||
      this.activeRoom.race?.status === 'RUNNING' ||
      this.activeRoom.race?.status === 'in_progress' ||
      internalSt === 'COUNTDOWN' ||
      internalSt === 'RUNNING';
    if (isSmallScreen && (this.siteView === 'regatta' || this.siteView === 'cockpit' || isRaceStartingOrRunning)) {
      this.setBannerCollapsed(true);
    }
  }

  get activeRoomCode(): string {
    return this.activeRoom?.code || this.activeRoom?.race?.code || '';
  }

  get activeRoomPin(): string {
    return this.activeRoom?.pinCode || this.activeRoom?.race?.pinCode || '';
  }

  get activePinDigits(): string[] {
    const pin = this.activeRoomPin;
    return pin ? pin.split('') : ['-', '-', '-', '-', '-'];
  }

  get isApprovalRequired(): boolean {
    return this.activeRoom?.requireApproval ?? this.activeRoom?.race?.requireApproval ?? true;
  }

  get pendingParticipants(): any[] {
    return this.activeRoom?.pendingParticipants ?? this.activeRoom?.race?.pendingParticipants ?? [];
  }

  get roomParticipants(): any[] {
    const raw: any = this.activeRoom?.race?.participants;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw.values === 'function') return Array.from(raw.values());
    if (raw && typeof raw === 'object') return Object.values(raw);
    return [];
  }

  get areAllParticipantsReady(): boolean {
    const parts = this.roomParticipants;
    if (parts.length === 0) return true;
    return parts.every((p) => p.ready !== false && p.connectionState !== 'CONNECTED');
  }

  get formattedGuestTicketCountdown(): string {
    const m = Math.floor(this.guestTicketCountdownSeconds / 60);
    const s = this.guestTicketCountdownSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  get guestTicketPinDigits(): string[] {
    return this.guestTicketPin ? this.guestTicketPin.split('') : ['-', '-', '-', '-', '-'];
  }

  requestGuestBoardingTicket(roomIdentifier?: string): void {
    const identifier = (roomIdentifier || this.activeRoomCode || this.activeRoom?.race?.id || this.joinInput || '').trim();
    if (!identifier) {
      this.guestTicketError = 'Veuillez saisir ou sélectionner un code salon.';
      this.cdr.markForCheck();
      return;
    }

    const parsed = parseRoomInviteInput(identifier);
    const targetCode = parsed.valid ? parsed.value : identifier;
    const cleanGuestName = (this.guestTicketName || this.activeUserName || `Rameur_${Math.floor(10 + Math.random() * 89)}`).trim();

    this.isGeneratingGuestTicket = true;
    this.guestTicketError = '';
    const socketId = this.socketService.getSocketId();

    this.rowerService
      .createGuestTicket(targetCode, cleanGuestName, socketId, this.activeUserId)
      .subscribe({
        next: (res) => {
          this.isGeneratingGuestTicket = false;
          this.guestTicketPin = res.ticketPin || res.pinCode;
          this.guestTicketLane = res.lane || 1;
          this.guestTicketCountdownSeconds = res.expiresInSeconds || 600;
          this.startGuestTicketCountdown();
          this.showFeedback(`✓ Code d'embarquement ${this.guestTicketPin} généré (Ligne ${this.guestTicketLane}) !`);
          if (!this.activeRoom && res.roomCode) {
            this.rowerService.getPrivateRace(res.roomCode).subscribe({
              next: (room) => {
                (room as any).lane = this.guestTicketLane;
                this.rememberSalon(room);
                this.roomSelected.emit({ payload: room, pushUrl: true });
                this.cdr.markForCheck();
              },
              error: () => {}
            });
          } else {
            this.refreshActiveRoom();
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isGeneratingGuestTicket = false;
          this.guestTicketError = err?.error?.error || err?.error?.message || "Impossible de générer le ticket invité.";
          this.cdr.markForCheck();
        }
      });
  }

  private startGuestTicketCountdown(): void {
    if (this.guestTicketTimerSub) {
      this.guestTicketTimerSub.unsubscribe();
    }
    this.guestTicketTimerSub = interval(1000).subscribe(() => {
      if (this.guestTicketCountdownSeconds > 0) {
        this.guestTicketCountdownSeconds--;
        this.cdr.markForCheck();
      } else {
        this.guestTicketPin = '';
        if (this.guestTicketTimerSub) {
          this.guestTicketTimerSub.unsubscribe();
          this.guestTicketTimerSub = undefined;
        }
        this.cdr.markForCheck();
      }
    });
  }

  get shareUrl(): string {
    const code = this.activeRoomCode;
    if (!code) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return buildShareableRoomUrl(origin, code);
  }

  formatScheduledDateTimeForUtc(naiveDateTime: string, timeZone: string): string {
    if (!naiveDateTime) return '';
    try {
      const match = naiveDateTime.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (!match) return new Date(naiveDateTime).toISOString();
      const [_, yStr, mStr, dStr, hStr, minStr] = match;
      const year = parseInt(yStr, 10);
      const month = parseInt(mStr, 10);
      const day = parseInt(dStr, 10);
      const hour = parseInt(hStr, 10);
      const minute = parseInt(minStr, 10);

      const utcRef = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'Europe/Paris',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const parts = dtf.formatToParts(utcRef);
      const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
      const tzYear = getVal('year');
      const tzMonth = getVal('month');
      const tzDay = getVal('day');
      let tzHour = getVal('hour');
      if (tzHour === 24) tzHour = 0;
      const tzMin = getVal('minute');
      const tzSec = getVal('second');

      const tzTimeAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, tzSec);
      const offsetMs = tzTimeAsUtc - utcRef.getTime();
      return new Date(utcRef.getTime() - offsetMs).toISOString();
    } catch {
      return new Date(naiveDateTime).toISOString();
    }
  }

  get scheduledUtcPreview(): string {
    if (!this.scheduledDateTime) return '';
    try {
      const iso = this.formatScheduledDateTimeForUtc(this.scheduledDateTime, this.selectedTimezone);
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toISOString().replace('.000Z', ' UTC').replace('T', ' ');
    } catch {
      return '';
    }
  }

  get fullInviteMessage(): string {
    if (!this.activeRoom) return '';
    let scheduledInfo: string | undefined;
    const raceStartMode = this.activeRoom.race?.startMode || this.activeRoom.startMode;
    const raceStartTime = this.activeRoom.race?.scheduledStartTime || this.activeRoom.scheduledStartTime;
    if (raceStartMode === 'scheduled' && raceStartTime) {
      try {
        const d = new Date(raceStartTime);
        const tz = this.activeRoom.race?.timezone || this.activeRoom.timezone || 'Europe/Paris';
        const dtf = new Intl.DateTimeFormat('fr-FR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: tz
        });
        const dtfUtc = new Intl.DateTimeFormat('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC'
        });
        scheduledInfo = `${dtf.format(d)} (${tz}) / ${dtfUtc.format(d)} UTC`;
      } catch {
        scheduledInfo = raceStartTime;
      }
    }
    return buildRoomInviteMessage({
      headerLabel: this.i18n.t('INVITE_MSG_HEADER'),
      title: this.activeRoom.race.title,
      targetDistance: this.activeRoom.race.targetDistance,
      urlLabel: this.i18n.t('SHARE_SECTION_URL'),
      shareUrl: this.shareUrl,
      codeLabel: this.i18n.t('SHARE_SECTION_CODE'),
      code: this.activeRoomCode,
      pinLabel: this.i18n.t('SHARE_SECTION_PIN'),
      pinCode: this.activeRoomPin,
      scheduledInfo
    });
  }

  selectDistancePreset(dist: number): void {
    this.targetDistance = dist;
  }

  validateCreateTitle(): boolean {
    const clean = this.roomTitle.trim();
    if (!clean) {
      this.createTitleError = this.i18n.t('FIELD_ROOM_TITLE') + ' requis.';
      return false;
    }
    this.createTitleError = '';
    return true;
  }

  refreshRoomLimits(): void {
    this.isLoadingQuotas = true;
    this.rowerService.getRoomCreationLimits(this.activeUserId, this.deviceToken).subscribe({
      next: (res) => {
        this.isLoadingQuotas = false;
        if (res && res.success) {
          this.quotaInfo = res;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingQuotas = false;
        this.cdr.markForCheck();
      }
    });
  }

  get hasSubscriberRights(): boolean {
    const rawTier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    const isPaidTier = rawTier !== '' && rawTier !== 'free' && rawTier !== 'none';
    return Boolean(this.isUserAdmin || this.isSubscriber || isPaidTier);
  }

  get userOfferName(): string {
    if (this.isUserAdmin) return 'Administrateur';
    if (this.quotaInfo?.tierName) return this.quotaInfo.tierName;
    const tier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    if (tier === 'pro' || tier === 'elite_pro' || tier === 'premium') return 'Offre Élite Pro';
    if (tier === 'club' || tier === 'standard' || tier === 'intermediate' || this.isSubscriber) return 'Offre Club';
    return 'Offre Gratuite';
  }

  get concurrentRoomsAvailable(): string | number {
    if (this.isUserAdmin) return 'Illimités';
    if (this.quotaInfo?.concurrent) return this.quotaInfo.concurrent.remaining;
    const tier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    if (tier === 'pro' || tier === 'elite_pro' || tier === 'premium') return 5;
    if (tier === 'club' || tier === 'standard' || tier === 'intermediate' || this.isSubscriber) return 3;
    return 1;
  }

  get concurrentRoomsMax(): string | number {
    if (this.isUserAdmin) return 'Illimités';
    if (this.quotaInfo?.concurrent) return this.quotaInfo.concurrent.max;
    const tier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    if (tier === 'pro' || tier === 'elite_pro' || tier === 'premium') return 5;
    if (tier === 'club' || tier === 'standard' || tier === 'intermediate' || this.isSubscriber) return 3;
    return 1;
  }

  get weeklyRoomsAvailable(): string | number {
    if (this.isUserAdmin) return 'Illimités';
    if (this.quotaInfo?.weekly) return this.quotaInfo.weekly.remaining;
    const tier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    if (tier === 'pro' || tier === 'elite_pro' || tier === 'premium') return 15;
    if (tier === 'club' || tier === 'standard' || tier === 'intermediate' || this.isSubscriber) return 10;
    return 5;
  }

  get weeklyRoomsMax(): string | number {
    if (this.isUserAdmin) return 'Illimités';
    if (this.quotaInfo?.weekly) return this.quotaInfo.weekly.max;
    const tier = String(this.userSubscriptionTier || '').toLowerCase().trim();
    if (tier === 'pro' || tier === 'elite_pro' || tier === 'premium') return 15;
    if (tier === 'club' || tier === 'standard' || tier === 'intermediate' || this.isSubscriber) return 10;
    return 5;
  }

  get isConcurrentQuotaReached(): boolean {
    if (this.isUserAdmin) return false;
    if (this.quotaInfo?.concurrent) return this.quotaInfo.concurrent.remaining <= 0;
    return false;
  }

  get isWeeklyQuotaReached(): boolean {
    if (this.isUserAdmin) return false;
    if (this.quotaInfo?.weekly) return this.quotaInfo.weekly.remaining <= 0;
    return false;
  }

  get pendingReceivedDuelsCount(): number {
    return (this.receivedDuelChallenges || []).filter(d => d.status === 'PENDING').length;
  }

  get totalDuelsCount(): number {
    return (this.receivedDuelChallenges?.length || 0) + (this.sentDuelChallenges?.length || 0);
  }

  get submitButtonLabel(): string {
    if (this.selectedGameMode === 'duel_1v1') {
      return this.isSendingDuelChallenge ? 'Envoi du défi...' : 'Envoyer le défi en duel';
    }
    if (this.isCreating) {
      return this.i18n.t('CREATING_ROOM');
    }
    if (this.selectedGameMode === 'solo' || this.selectedGameMode === 'bot_duel') {
      return 'Obtenir mon code PIN montre';
    }
    return 'Lancer le salon privé';
  }

  get isSubmitDisabled(): boolean {
    if (this.selectedGameMode === 'duel_1v1') {
      return (
        this.isSendingDuelChallenge ||
        this.isCreating ||
        (!this.isRegisteredUser && !this.isUserAdmin) ||
        !this.duelTargetLogin.trim() ||
        !this.computeDuelSlotIsoRange() ||
        this.isConcurrentQuotaReached ||
        this.isWeeklyQuotaReached
      );
    }
    return (
      this.isCreating ||
      !this.canCreateRoom ||
      (this.selectedGameMode === 'multi' && !this.hasSubscriberRights)
    );
  }

  get canCreateRoom(): boolean {
    if (this.isUserAdmin) return true;
    if (this.selectedGameMode === 'duel_1v1') {
      return (this.isRegisteredUser || this.isUserAdmin) && !this.isConcurrentQuotaReached && !this.isWeeklyQuotaReached;
    }
    const hasWatch = this.isWatchConnected || (this.quotaInfo ? this.quotaInfo.isWatchConnected : false);
    if (!hasWatch) return false;
    if (this.isConcurrentQuotaReached || this.isWeeklyQuotaReached) return false;
    return true;
  }

  get createDisabledReason(): string {
    if (this.isUserAdmin) return '';
    if (this.selectedGameMode === 'duel_1v1') {
      if (!this.isRegisteredUser && !this.isUserAdmin) {
        return "Compte gratuit requis pour défier un abonné en duel.";
      }
      if (!this.duelTargetLogin.trim()) {
        return "Veuillez renseigner le login de l'abonné à défier.";
      }
      if (!this.computeDuelSlotIsoRange()) {
        return "Veuillez choisir un créneau horaire valide dans le futur.";
      }
      if (this.isConcurrentQuotaReached) {
        return `Plafond atteint : vous avez déjà ${this.concurrentRoomsMax} salon(s) ouvert(s) à la fois.`;
      }
      if (this.isWeeklyQuotaReached) {
        return `Quota hebdomadaire atteint (${this.weeklyRoomsMax} salons max cette semaine selon votre ${this.userOfferName}).`;
      }
      return '';
    }
    const hasWatch = this.isWatchConnected || (this.quotaInfo ? this.quotaInfo.isWatchConnected : false);
    if (!hasWatch) {
      return "Appairage requis : connectez votre montre Garmin pour créer un salon.";
    }
    if (this.isConcurrentQuotaReached) {
      return `Plafond atteint : vous avez déjà ${this.concurrentRoomsMax} salon(s) ouvert(s) à la fois. Fermez un salon existant avant d'en créer un nouveau.`;
    }
    if (this.isWeeklyQuotaReached) {
      return `Quota hebdomadaire atteint (${this.weeklyRoomsMax} salons max cette semaine selon votre ${this.userOfferName}).`;
    }
    return '';
  }

  onCreateRoomSubmit(): void {
    if (this.isCreating || this.isSendingDuelChallenge) return;

    if (this.selectedGameMode === 'duel_1v1') {
      this.onSendDuelChallenge();
      return;
    }

    if (!this.canCreateRoom && !this.isUserAdmin) {
      this.createGeneralError = this.createDisabledReason || "Impossible de créer le salon : conditions requises non remplies.";
      this.cdr.markForCheck();
      return;
    }

    if (this.selectedGameMode === 'multi' && !this.hasSubscriberRights) {
      this.createGeneralError = "La création de salon multi-joueurs est réservée aux abonnés Club et Élite Pro. Connectez-vous avec votre compte ou découvrez nos offres.";
      this.cdr.markForCheck();
      return;
    }

    if (!this.validateCreateTitle()) return;

    if (this.selectedGameMode === 'bot_duel' && this.isCustomBotPace && this.botPaceError) {
      this.createGeneralError = this.botPaceError;
      this.cdr.markForCheck();
      return;
    }
    this.createGeneralError = '';
    this.isCreating = true;

    const clampedDist = Math.min(100000, Math.max(100, Math.round(Number(this.targetDistance) || 2000)));
    const clampedMax = this.selectedGameMode === 'solo'
      ? 1
      : this.selectedGameMode === 'bot_duel'
      ? 2
      : Math.min(30, Math.max(2, Math.round(Number(this.maxParticipants) || 8)));

    const isSolo = this.selectedGameMode === 'solo';
    const isBotDuel = this.selectedGameMode === 'bot_duel';
    const isDuel1v1 = false;

    this.rowerService
      .createPrivateRace({
        title: this.roomTitle.trim(),
        targetDistance: clampedDist,
        maxParticipants: clampedMax,
        hostUserId: this.activeUserId || 'anonymous',
        hostUserName: this.activeUserName || undefined,
        startMode: this.selectedGameMode === 'multi' ? this.startMode : 'manual',
        scheduledStartTime: this.selectedGameMode === 'multi' && this.startMode === 'scheduled' && this.scheduledDateTime
          ? this.formatScheduledDateTimeForUtc(this.scheduledDateTime, this.selectedTimezone)
          : undefined,
        timezone: this.selectedGameMode === 'multi' && this.startMode === 'scheduled' ? this.selectedTimezone : undefined,
        botCount: isBotDuel ? 1 : (this.selectedGameMode === 'multi' ? Math.min(this.maxBotsAllowed, Math.max(0, Number(this.multiBotCount) || 0)) : 0),
        botMinPace: isBotDuel ? undefined : this.botMinPace,
        botMaxPace: isBotDuel
          ? Math.min(this.BOT_PACE_MAX, Math.max(this.BOT_PACE_MIN, Math.round(Number(this.botMaxPace) || 145)))
          : (Number(this.botMaxPace) || 120),
        requireApproval: this.selectedGameMode === 'multi' ? this.requireApproval : false,
        botStartMode: isSolo || isBotDuel ? 'first_stroke' : undefined,
        isBotDuel,
        isDuel1v1,
        isSolo,
        gameMode: this.selectedGameMode,
        mode: this.selectedGameMode
      })
      .subscribe({
        next: (created) => {
          this.isCreating = false;
          (created as any).lane = (created as any).lane !== undefined ? (created as any).lane : 1;
          this.rememberSalon(created, true);
          this.roomSelected.emit({ payload: created, pushUrl: true });
          this.activeTab = 'share';
          this.showFeedback(this.i18n.t('PRIVATE_ROOM_BADGE') + ' : ' + (created.code || ''));
          this.refreshRoomLimits();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isCreating = false;
          this.createGeneralError = err?.error?.error || err?.error?.message || 'Erreur lors de la création du salon.';
          this.refreshRoomLimits();
          this.cdr.markForCheck();
        }
      });
  }

  onToggleApproval(event: Event): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const checkbox = event.target as HTMLInputElement;
    const newReqVal = checkbox.checked;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .toggleApprovalRequirement(identifier, this.activeUserId, newReqVal)
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback(
            newReqVal
              ? '✓ Validation manuelle des joueurs requise'
              : '✓ Validation automatique : tous les joueurs acceptés'
          );
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Impossible de modifier la validation.';
          this.cdr.markForCheck();
        }
      });
  }

  approvePlayer(targetUserId: string): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .approveParticipant(identifier, this.activeUserId, targetUserId, true)
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback('✓ Joueur accepté dans la course !');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Erreur validation joueur.';
          this.cdr.markForCheck();
        }
      });
  }

  rejectPlayer(targetUserId: string): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .approveParticipant(identifier, this.activeUserId, targetUserId, false)
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback('Joueur refusé.');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Erreur refus joueur.';
          this.cdr.markForCheck();
        }
      });
  }

  onJoinInputBlur(): void {
    if (!this.joinInput.trim()) {
      this.joinError = '';
      return;
    }
    const parsed = parseRoomInviteInput(this.joinInput);
    if (!parsed.valid) {
      this.joinError = this.i18n.t('JOIN_ERR_FORMAT');
    }
  }

  onJoinSubmit(): void {
    if (this.isJoining) return;

    const parsed = parseRoomInviteInput(this.joinInput);
    if (!parsed.valid) {
      this.joinError =
        parsed.reason === 'empty'
          ? this.i18n.t('JOIN_ERR_EMPTY')
          : this.i18n.t('JOIN_ERR_FORMAT');
      return;
    }

    this.joinError = '';
    this.isJoining = true;

    this.rowerService.joinRoom(parsed.value, this.activeUserId, this.activeUserName).subscribe({
      next: (joinRes) => {
        const assignedLane = joinRes.lane || 1;
        const roomIdent = joinRes.code || parsed.value;

        this.rowerService.getPrivateRace(roomIdent).subscribe({
          next: (room) => {
            this.isJoining = false;
            this.joinInput = '';
            (room as any).lane = assignedLane;
            this.rememberSalon(room);
            this.roomSelected.emit({ payload: room, pushUrl: true });
            this.feedbackMessage = joinRes.message || `Entrée validée sur la ligne d'eau ${assignedLane}`;
            this.activeTab = 'share';
            this.cdr.markForCheck();
          },
          error: () => {
            this.isJoining = false;
            this.joinInput = '';
            const fallbackRoom: any = {
              success: true,
              raceId: joinRes.raceId,
              code: joinRes.code,
              lane: assignedLane,
              targetDistance: joinRes.targetDistance || 2000,
              race: {
                id: joinRes.raceId,
                code: joinRes.code,
                targetDistance: joinRes.targetDistance || 2000,
                status: joinRes.internalStatus || 'LOBBY'
              }
            };
            this.roomSelected.emit({ payload: fallbackRoom, pushUrl: true });
            this.feedbackMessage = `Entrée validée sur la ligne d'eau ${assignedLane}`;
            this.activeTab = 'share';
            this.cdr.markForCheck();
          }
        });
      },
      error: (err) => {
        this.isJoining = false;
        if (err?.status === 409) {
          this.joinError = err?.error?.error || "Salon complet - quota atteint";
        } else if (err?.status === 403) {
          this.joinError = err?.error?.error || "Accès refusé pour ce salon";
        } else if (err?.status === 404) {
          this.joinError = this.i18n.t('JOIN_ERR_NOT_FOUND');
        } else {
          this.joinError = err?.error?.error || err?.error?.message || this.i18n.t('JOIN_ERR_NOT_FOUND');
        }
        this.cdr.markForCheck();
      }
    });
  }

  openSavedSalon(salon: SavedPrivateSalon): void {
    this.actionError = '';
    this.rowerService.joinRoom(salon.code, this.activeUserId, this.activeUserName).subscribe({
      next: (joinRes) => {
        const assignedLane = joinRes.lane || 1;
        this.rowerService.getPrivateRace(salon.code).subscribe({
          next: (room) => {
            (room as any).lane = assignedLane;
            this.rememberSalon(room);
            this.roomSelected.emit({ payload: room, pushUrl: true });
            this.activeTab = 'share';
            this.cdr.markForCheck();
          },
          error: () => {
            this.removeSavedSalonLocal(salon.id);
            this.joinError = this.i18n.t('JOIN_ERR_NOT_FOUND');
            this.cdr.markForCheck();
          }
        });
      },
      error: (err) => {
        if (err?.status === 409) {
          this.joinError = err?.error?.error || "Salon complet - quota atteint";
        } else if (err?.status === 403) {
          this.joinError = err?.error?.error || "Accès refusé pour ce salon";
        } else {
          this.removeSavedSalonLocal(salon.id);
          this.joinError = err?.error?.error || this.i18n.t('JOIN_ERR_NOT_FOUND');
        }
        this.cdr.markForCheck();
      }
    });
  }

  registerMyLane(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .joinPrivateRace(identifier, this.activeUserId, this.activeUserName, true)
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback('✓ Couloir enregistré sur la ligne de départ !');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Impossible de rejoindre un couloir.';
          this.cdr.markForCheck();
        }
      });
  }

  get isFirstStrokeMode(): boolean {
    return (this.activeRoom?.race?.botStartMode || (this.activeRoom as any)?.botStartMode) === 'first_stroke';
  }

  get isBotFirstStrokeMode(): boolean {
    return this.isFirstStrokeMode;
  }

  triggerStartOnFirstStroke(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';
    this.rowerService
      .startOrResetPrivateRace(identifier, {
        hostUserId: this.activeUserId,
        botStartMode: 'first_stroke',
        reset: false
      })
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback('✓ Départ au premier coup de rame activé');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Action refusée.';
          this.cdr.markForCheck();
        }
      });
  }

  triggerStart(countdownSeconds: number): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .startOrResetPrivateRace(identifier, {
        hostUserId: this.activeUserId,
        countdownSeconds,
        reset: false
      })
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.closeModal();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Action refusée.';
          this.cdr.markForCheck();
        }
      });
  }

  stopActiveRace(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const raceId = this.activeRoom.race?.id;
    if (!raceId) return;
    const promptMsg = this.i18n.t('CONFIRM_STOP_RACE') || "Voulez-vous vraiment arrêter la course ? Le classement officiel sera immédiatement établi selon les positions actuelles.";
    if (!confirm(promptMsg)) {
      return;
    }
    this.isActionBusy = true;
    this.actionError = '';
    this.rowerService.stopRace(raceId, this.activeUserId).subscribe({
      next: (res) => {
        this.isActionBusy = false;
        this.showFeedback(res.message || 'Course arrêtée.');
        this.refreshActiveRoom();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isActionBusy = false;
        this.actionError = err?.error?.message || err?.error?.error || "Erreur lors de l'arrêt de la course.";
        this.cdr.markForCheck();
      }
    });
  }

  triggerResetRoom(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService
      .startOrResetPrivateRace(identifier, {
        hostUserId: this.activeUserId,
        reset: true
      })
      .subscribe({
        next: (updated) => {
          this.isActionBusy = false;
          this.roomUpdated.emit(updated);
          this.showFeedback('✓ Salon prêt pour une nouvelle manche !');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isActionBusy = false;
          this.actionError = err?.error?.error || 'Impossible de réinitialiser le salon.';
          this.cdr.markForCheck();
        }
      });
  }

  regeneratePin(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService.regeneratePrivatePin(identifier, this.activeUserId).subscribe({
      next: (updated) => {
        this.isActionBusy = false;
        this.rememberSalon(updated);
        this.roomUpdated.emit(updated);
        this.showFeedback(this.i18n.t('PIN_REGENERATED'));
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isActionBusy = false;
        this.actionError = err?.error?.error || 'Erreur régénération PIN.';
        this.cdr.markForCheck();
      }
    });
  }

  regenerateCode(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const identifier = this.activeRoomCode || this.activeRoom.race.id;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService.regeneratePrivateCode(identifier, this.activeUserId).subscribe({
      next: (updated) => {
        this.isActionBusy = false;
        this.rememberSalon(updated);
        this.roomSelected.emit({ payload: updated, pushUrl: true });
        this.showFeedback(this.i18n.t('CODE_REGENERATED'));
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isActionBusy = false;
        this.actionError = err?.error?.error || 'Erreur régénération lien.';
        this.cdr.markForCheck();
      }
    });
  }

  closeAndRevokeActiveRoom(): void {
    if (!this.activeRoom || this.isActionBusy) return;
    const raceId = this.activeRoom.race.id;
    const identifier = this.activeRoomCode || raceId;
    this.isActionBusy = true;
    this.actionError = '';

    this.rowerService.closePrivateRace(identifier, this.activeUserId).subscribe({
      next: () => {
        this.isActionBusy = false;
        this.removeSavedSalonLocal(raceId);
        this.closeModal();
        this.roomClosedOrLeft.emit({ closedOnServer: true, raceId });
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isActionBusy = false;
        this.actionError = err?.error?.error || 'Impossible de fermer le salon.';
        this.cdr.markForCheck();
      }
    });
  }

  leaveToPublicRace(): void {
    if (this.activeRoom) {
      const roomIdent = this.activeRoom.race?.id || this.activeRoom.code;
      if (roomIdent && this.activeUserId) {
        this.rowerService.leaveRoom(roomIdent, this.activeUserId).subscribe({
          next: () => {},
          error: (err) => console.warn('Could not notify leaveRoom to backend:', err)
        });
      }
    }
    this.closeModal();
    this.roomClosedOrLeft.emit({ closedOnServer: false });
  }

  removeOrCloseSavedSalon(salon: SavedPrivateSalon, event: Event): void {
    event.stopPropagation();
    if (salon.isHost || this.isUserAdmin) {
      this.rowerService.closePrivateRace(salon.code, this.activeUserId).subscribe({
        next: () => {
          this.removeSavedSalonLocal(salon.id);
          if (this.activeRoom?.race?.id === salon.id) {
            this.roomClosedOrLeft.emit({ closedOnServer: true, raceId: salon.id });
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.removeSavedSalonLocal(salon.id);
          this.cdr.markForCheck();
        }
      });
    } else {
      this.removeSavedSalonLocal(salon.id);
    }
  }

  async copyText(value: string): Promise<void> {
    if (!value) return;
    const copied = await this.writeClipboard(value);
    if (copied) {
      this.showFeedback(this.i18n.t('COPIED_FEEDBACK'));
    }
  }

  async copySavedSalonUrl(salon: SavedPrivateSalon, event: Event): Promise<void> {
    event.stopPropagation();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = buildShareableRoomUrl(origin, salon.code);
    await this.copyText(url);
  }

  async shareRoomNative(): Promise<void> {
    if (!this.activeRoom || !this.canNativeShare) {
      await this.copyText(this.fullInviteMessage);
      return;
    }
    try {
      await navigator.share({
        title: `${this.activeRoom.race.title} — Rower Race`,
        text: this.fullInviteMessage,
        url: this.shareUrl
      });
    } catch {
      // User dismissed native share dialog
    }
  }

  get isDuelRoom(): boolean {
    return Boolean(
      (this.activeRoom?.race as any)?.isDuel1v1 ||
      (this.activeRoom as any)?.isDuel1v1 ||
      this.selectedGameMode === 'duel_1v1'
    );
  }

  get maxAllowedInvitations(): number {
    if (this.isDuelRoom) return 1;
    let maxParticipants = 2;
    if (this.quotaInfo?.maxParticipants !== undefined) {
      maxParticipants = this.quotaInfo.maxParticipants;
    } else {
      const rawTier = String(this.userSubscriptionTier || (this.isSubscriber ? 'intermediate' : 'free')).toLowerCase().trim();
      if (rawTier === 'pro' || rawTier === 'elite_pro' || rawTier === 'premium') maxParticipants = 10;
      else if (rawTier === 'club' || rawTier === 'standard' || rawTier === 'intermediate') maxParticipants = 5;
      else if (this.isUserAdmin) maxParticipants = 30;
      else maxParticipants = this.isSubscriber ? 5 : 2;
    }
    const bots = this.activeRoom?.race?.botCount || (this.activeRoom as any)?.botCount || 0;
    return Math.max(1, maxParticipants - 1 - bots);
  }

  get remainingInvitationsCount(): number {
    return Math.max(0, this.maxAllowedInvitations - this.multiInviteEmails.length);
  }

  addMultiEmail(): void {
    const raw = this.multiEmailInput.trim().toLowerCase();
    if (!raw) return;
    this.inviteErrorMessage = '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    for (const email of parts) {
      if (!emailRegex.test(email)) {
        this.inviteErrorMessage = `Adresse e-mail invalide : ${email}`;
        continue;
      }
      if (this.multiInviteEmails.includes(email)) {
        continue;
      }
      if (this.multiInviteEmails.length >= this.maxAllowedInvitations) {
        this.inviteErrorMessage = this.i18n.t('INVITE_QUOTA_EXCEEDED_WARNING');
        break;
      }
      this.multiInviteEmails.push(email);
    }
    this.multiEmailInput = '';
    this.cdr.markForCheck();
  }

  removeMultiEmail(index: number): void {
    if (index >= 0 && index < this.multiInviteEmails.length) {
      this.multiInviteEmails.splice(index, 1);
      this.inviteErrorMessage = '';
      this.cdr.markForCheck();
    }
  }

  onMultiEmailKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      this.addMultiEmail();
    }
  }

  sendDuelInvite(): void {
    const email = this.duelInviteEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.inviteErrorMessage = 'Veuillez saisir une adresse e-mail valide.';
      return;
    }
    this.sendInvitationsInternal([email]);
  }

  sendMultiInvites(): void {
    if (this.multiEmailInput.trim()) {
      this.addMultiEmail();
    }
    if (this.multiInviteEmails.length === 0) {
      this.inviteErrorMessage = 'Veuillez ajouter au moins une adresse e-mail.';
      return;
    }
    if (this.multiInviteEmails.length > this.maxAllowedInvitations) {
      this.inviteErrorMessage = this.i18n.t('INVITE_QUOTA_EXCEEDED_WARNING');
      return;
    }
    this.sendInvitationsInternal(this.multiInviteEmails);
  }

  private sendInvitationsInternal(emails: string[]): void {
    if (!this.activeRoom) return;
    const identifier = this.activeRoomCode || this.activeRoom.race?.id || this.activeRoom.id;
    if (!identifier) return;

    this.isSendingInvites = true;
    this.inviteErrorMessage = '';
    this.inviteSuccessMessage = '';

    const isScheduled = (this.activeRoom.race?.startMode === 'scheduled' || (this.activeRoom as any).startMode === 'scheduled');
    const includeCal = isScheduled && this.includeCalendarInvite;

    this.rowerService.sendRoomInvitations(
      identifier,
      this.activeUserId,
      emails,
      includeCal,
      this.i18n.getCurrentLang()
    ).subscribe({
      next: (res) => {
        this.isSendingInvites = false;
        if (res.success) {
          this.inviteSuccessMessage = `${this.i18n.t('INVITE_SUCCESS_MSG')} (${res.count} envoyée(s))`;
          if (this.isDuelRoom) {
            this.duelInviteEmail = '';
          } else {
            this.multiInviteEmails = [];
            this.multiEmailInput = '';
          }
          this.showFeedback(this.inviteSuccessMessage);
        } else {
          this.inviteErrorMessage = res.error || 'Erreur lors de l\'envoi des invitations.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSendingInvites = false;
        this.inviteErrorMessage = err?.error?.error || err?.error?.message || 'Erreur lors de l\'envoi des invitations.';
        this.cdr.markForCheck();
      }
    });
  }

  get whatsappShareUrl(): string {
    const text = encodeURIComponent(this.fullInviteMessage);
    return `https://api.whatsapp.com/send?text=${text}`;
  }

  get smsShareUrl(): string {
    const text = encodeURIComponent(this.fullInviteMessage);
    return `sms:?body=${text}`;
  }

  get mailtoShareUrl(): string {
    const subject = encodeURIComponent(`Invitation Régate Rower Race : ${this.activeRoom?.race?.title || 'Course'}`);
    const body = encodeURIComponent(this.fullInviteMessage);
    return `mailto:?subject=${subject}&body=${body}`;
  }

  selectInputText(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (target && typeof target.select === 'function') {
      target.select();
    }
  }

  refreshMyRooms(): void {
    const knownCodes = this.savedSalons.map((s) => s.code).filter(Boolean);
    if (!this.activeUserId && knownCodes.length === 0) return;

    this.isLoadingRooms = true;
    this.rowerService.listPrivateRaces(this.activeUserId, knownCodes).subscribe({
      next: (res) => {
        this.isLoadingRooms = false;
        this.liveRoomsMap.clear();
        const serverRaces = res?.races || [];
        for (const item of serverRaces) {
          if (item?.race?.id && item.code) {
            this.liveRoomsMap.set(item.race.id, item);
            this.rememberSalon(item);
          }
        }
        // Prune locally stored salons that no longer exist on backend
        if (knownCodes.length > 0) {
          const activeIds = new Set(serverRaces.map((r) => r.race.id));
          this.savedSalons = this.savedSalons.filter((s) => activeIds.has(s.id));
          this.persistSavedSalons();
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingRooms = false;
        this.cdr.markForCheck();
      }
    });
  }

  private rememberSalon(payload: PrivateRacePayload, forceHost?: boolean): void {
    const code = payload.code || payload.race?.code;
    if (!code || !payload.race?.id) return;

    const isHost =
      forceHost ??
      Boolean(payload.race.hostUserId && payload.race.hostUserId === this.activeUserId);

    const entry: SavedPrivateSalon = {
      id: payload.race.id,
      code,
      pinCode: payload.pinCode || payload.race.pinCode,
      title: payload.race.title,
      targetDistance: payload.race.targetDistance,
      isHost,
      savedAt: new Date().toISOString()
    };

    const existingIdx = this.savedSalons.findIndex((s) => s.id === entry.id);
    if (existingIdx >= 0) {
      this.savedSalons[existingIdx] = {
        ...this.savedSalons[existingIdx],
        ...entry,
        isHost: this.savedSalons[existingIdx].isHost || entry.isHost
      };
    } else {
      this.savedSalons = [entry, ...this.savedSalons].slice(0, 15);
    }
    this.persistSavedSalons();
  }

  private removeSavedSalonLocal(raceId: string): void {
    this.savedSalons = this.savedSalons.filter((s) => s.id !== raceId);
    this.liveRoomsMap.delete(raceId);
    this.persistSavedSalons();
  }

  private loadSavedSalonsFromStorage(): void {
    try {
      const raw = localStorage.getItem(SAVED_SALONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.savedSalons = parsed.filter((item) => item && item.id && item.code);
      }
    } catch {
      this.savedSalons = [];
    }
  }

  private persistSavedSalons(): void {
    try {
      localStorage.setItem(SAVED_SALONS_STORAGE_KEY, JSON.stringify(this.savedSalons));
    } catch {
      // Ignore storage quota errors
    }
  }

  private showFeedback(msg: string): void {
    this.feedbackMessage = msg;
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
    }
    this.feedbackTimer = setTimeout(() => {
      this.feedbackMessage = '';
      this.cdr.markForCheck();
    }, 3200);
  }

  private async writeClipboard(text: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below for HTTP LAN contexts
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  private applyPrefilledDuelChallenge(): void {
    this.activeTab = 'create';
    this.selectGameMode('duel_1v1');
    if (this.prefilledDuelLogin) {
      this.duelTargetLogin = this.prefilledDuelLogin;
    }
    if (!this.duelSlotStartLocal) {
      this.duelSlotStartLocal = this.getDefaultDuelSlotLocal();
    }
    this.duelChallengeError = '';
    this.duelChallengeSuccess = '';
    this.prefilledDuelHandled.emit();
    this.cdr.markForCheck();
  }

  getDefaultDuelSlotLocal(): string {
    const d = new Date(Date.now() + 26 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private computeDuelSlotIsoRange(): { slotStart: string; slotEnd: string } | null {
    if (!this.duelSlotStartLocal) return null;
    const startMs = new Date(this.duelSlotStartLocal).getTime();
    if (!Number.isFinite(startMs)) return null;
    const durMin = Math.min(240, Math.max(15, Number(this.duelSlotDurationMinutes) || 60));
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(startMs + durMin * 60 * 1000).toISOString();
    return { slotStart: startIso, slotEnd: endIso };
  }

  searchAvailableDuelPlayers(): void {
    const range = this.computeDuelSlotIsoRange();
    if (!range) {
      this.duelChallengeError = 'Veuillez sélectionner une date et heure de créneau valide pour rechercher un joueur.';
      this.cdr.markForCheck();
      return;
    }
    this.isSearchingAvailablePlayers = true;
    this.duelChallengeError = '';
    this.rowerService.getAvailableDuelPlayers({
      slotStart: range.slotStart,
      slotEnd: range.slotEnd,
      durationMinutes: this.duelSlotDurationMinutes,
      requesterId: this.activeUserId || undefined,
      league: this.duelFindLeague,
      country: this.duelFindCountry.trim() || undefined,
      gender: this.duelFindGender
    }).subscribe({
      next: (res) => {
        this.isSearchingAvailablePlayers = false;
        this.hasSearchedAvailablePlayers = true;
        this.availableDuelPlayers = res?.players || [];
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSearchingAvailablePlayers = false;
        this.hasSearchedAvailablePlayers = true;
        this.duelChallengeError = err?.error?.message || 'Erreur lors de la recherche de joueurs disponibles.';
        this.cdr.markForCheck();
      }
    });
  }

  selectAvailableOpponent(login: string): void {
    this.duelTargetLogin = login;
    this.duelChallengeError = '';
    this.cdr.markForCheck();
  }

  onSendDuelChallenge(): void {
    if (this.isSendingDuelChallenge) return;
    if (!this.isRegisteredUser && !this.isUserAdmin) {
      this.duelChallengeError = 'Vous devez être connecté avec un compte abonné pour envoyer un défi en duel.';
      this.cdr.markForCheck();
      return;
    }
    const targetLogin = this.duelTargetLogin.trim();
    if (!targetLogin) {
      this.duelChallengeError = 'Veuillez saisir le login de l\'abonné à défier.';
      this.cdr.markForCheck();
      return;
    }
    const range = this.computeDuelSlotIsoRange();
    if (!range) {
      this.duelChallengeError = 'Veuillez choisir un créneau horaire valide dans le futur.';
      this.cdr.markForCheck();
      return;
    }

    this.isSendingDuelChallenge = true;
    this.duelChallengeError = '';
    this.duelChallengeSuccess = '';

    this.rowerService.createDuelChallenge({
      challengerId: this.activeUserId,
      challengedLogin: targetLogin,
      slotStart: range.slotStart,
      slotEnd: range.slotEnd,
      durationMinutes: Number(this.duelSlotDurationMinutes) || 60,
      targetDistance: Math.min(100000, Math.max(100, Math.round(Number(this.targetDistance) || 2000))),
      timezone: this.selectedTimezone || 'Europe/Paris',
      title: this.roomTitle.trim() || undefined
    }).subscribe({
      next: (res) => {
        this.isSendingDuelChallenge = false;
        if (res?.success) {
          this.duelChallengeSuccess = res.message || `Défi envoyé à ${targetLogin} ! Un e-mail a été transmis.`;
          this.duelTargetLogin = '';
          this.refreshMyDuels();
          this.refreshMyRooms();
          this.activeTab = 'duels';
          this.showFeedback('⚔️ Défi en duel envoyé !');
        } else {
          this.duelChallengeError = res?.message || 'Impossible d\'envoyer le défi.';
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSendingDuelChallenge = false;
        this.duelChallengeError = err?.error?.message || err?.error?.error || 'Ce joueur n\'est pas disponible sur ce créneau.';
        this.cdr.markForCheck();
      }
    });
  }

  refreshMyDuels(): void {
    if (!this.activeUserId) return;
    this.isLoadingDuelChallenges = true;
    this.rowerService.getMyDuelChallenges(this.activeUserId).subscribe({
      next: (res) => {
        this.isLoadingDuelChallenges = false;
        if (res?.success) {
          this.receivedDuelChallenges = res.received || [];
          this.sentDuelChallenges = res.sent || [];
          this.blockedDuelSlots = res.blockedSlots || [];
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingDuelChallenges = false;
        this.cdr.markForCheck();
      }
    });
  }

  respondToDuel(challenge: DuelChallenge, action: 'accept' | 'refuse'): void {
    if (!challenge?.id || !this.activeUserId || this.duelActionBusyId) return;
    this.duelActionBusyId = challenge.id;
    this.duelManageError = '';
    this.duelManageMessage = '';

    this.rowerService.respondToDuelChallenge(challenge.id, this.activeUserId, action).subscribe({
      next: (res) => {
        this.duelActionBusyId = '';
        this.duelManageMessage = res?.message || (action === 'accept' ? 'Défi accepté !' : 'Défi refusé.');
        if (this.activeRoom) {
          if (this.activeRoom.duelChallenge && this.activeRoom.duelChallenge.id === challenge.id) {
            this.activeRoom.duelChallenge.status = res.challenge?.status || (action === 'accept' ? 'ACCEPTED' : 'REFUSED');
          }
          if ((this.activeRoom.race as any)?.duelChallenge && (this.activeRoom.race as any).duelChallenge.id === challenge.id) {
            (this.activeRoom.race as any).duelChallenge.status = res.challenge?.status || (action === 'accept' ? 'ACCEPTED' : 'REFUSED');
          }
        }
        this.refreshMyDuels();
        this.refreshMyRooms();
        if (action === 'refuse' && this.activeRoom) {
          setTimeout(() => {
            this.leaveToPublicRace();
          }, 1500);
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.duelActionBusyId = '';
        this.duelManageError = err?.error?.message || err?.error?.error || 'Impossible de répondre à ce défi.';
        this.cdr.markForCheck();
      }
    });
  }

  cancelDuel(challenge: DuelChallenge): void {
    if (!challenge?.id || !this.activeUserId || this.duelActionBusyId) return;
    this.duelActionBusyId = challenge.id;
    this.duelManageError = '';
    this.duelManageMessage = '';

    this.rowerService.cancelDuelChallenge(challenge.id, this.activeUserId).subscribe({
      next: (res) => {
        this.duelActionBusyId = '';
        this.duelManageMessage = res?.message || 'Duel annulé et créneau libéré.';
        this.refreshMyDuels();
        this.refreshMyRooms();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.duelActionBusyId = '';
        this.duelManageError = err?.error?.message || err?.error?.error || 'Impossible d\'annuler ce duel.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteDuel(challenge: DuelChallenge): void {
    if (!challenge?.id || !this.activeUserId || this.duelActionBusyId) return;
    this.duelActionBusyId = challenge.id;
    this.duelManageError = '';
    this.duelManageMessage = '';

    this.rowerService.deleteDuelChallenge(challenge.id, this.activeUserId).subscribe({
      next: (res) => {
        this.duelActionBusyId = '';
        this.duelManageMessage = res?.message || 'Défi supprimé avec succès.';
        this.refreshMyDuels();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.duelActionBusyId = '';
        this.duelManageError = err?.error?.message || err?.error?.error || 'Impossible de supprimer ce duel.';
        this.cdr.markForCheck();
      }
    });
  }

  isDuelWithin24h(slotStart: string): boolean {
    const startMs = new Date(slotStart).getTime();
    if (!Number.isFinite(startMs)) return false;
    return startMs - Date.now() <= 24 * 60 * 60 * 1000;
  }

  getDuelStatusLabel(status: string): string {
    switch (status) {
      case 'PENDING': return '⏳ En attente (exp. 72h)';
      case 'ACCEPTED': return '🔒 Accepté (créneau bloqué)';
      case 'REFUSED': return '❌ Refusé';
      case 'CANCELLED': return '🚫 Annulé';
      case 'EXPIRED': return '⌛ Expiré (72h)';
      case 'FORFEIT': return '🏳️ Forfait (-10 pts)';
      case 'COMPLETED': return '🏁 Terminé';
      default: return status;
    }
  }

  openDuelSalon(challenge: DuelChallenge): void {
    const code = challenge.roomCode || challenge.roomId;
    if (!code) return;
    this.isActionBusy = true;
    this.rowerService.getPrivateRace(code).subscribe({
      next: (room) => {
        this.isActionBusy = false;
        this.rememberSalon(room, challenge.challengerUserId === this.activeUserId);
        this.roomSelected.emit({ payload: room, pushUrl: true });
        this.activeTab = 'share';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isActionBusy = false;
        this.duelManageError = err?.error?.message || 'Le salon associé à ce duel est inaccessible ou fermé.';
        this.cdr.markForCheck();
      }
    });
  }
}

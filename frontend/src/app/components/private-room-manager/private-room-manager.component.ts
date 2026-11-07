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
import { PrivateRacePayload, SavedPrivateSalon } from '../../models/rower-data.model';
import {
  parseRoomInviteInput,
  buildShareableRoomUrl,
  buildRoomInviteMessage
} from '../../utils/room-link.util';

export type PrivateModalTab = 'create' | 'share' | 'join';

const SAVED_SALONS_STORAGE_KEY = 'rower_saved_private_salons';

@Component({
  selector: 'app-private-room-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './private-room-manager.component.html',
  styleUrls: ['./private-room-manager.component.css']
})
export class PrivateRoomManagerComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('dialogEl') dialogRef?: ElementRef<HTMLDialogElement>;

  @Input() isOpen = false;
  @Input() initialTab: PrivateModalTab = 'create';
  @Input() activeRoom: PrivateRacePayload | null = null;
  @Input() activeUserId = '';
  @Input() activeUserName = '';
  @Input() isUserAdmin = false;
  @Input() isSubscriber = false;
  @Input() isRegisteredUser = false;
  @Input() activeRacersCount = 0;
  @Input() externalError = '';

  @Output() modalClose = new EventEmitter<void>();
  @Output() openModalRequest = new EventEmitter<PrivateModalTab>();
  @Output() roomSelected = new EventEmitter<{ payload: PrivateRacePayload; pushUrl: boolean }>();
  @Output() roomUpdated = new EventEmitter<PrivateRacePayload>();
  @Output() roomClosedOrLeft = new EventEmitter<{ closedOnServer: boolean; raceId?: string }>();
  @Output() botsToggled = new EventEmitter<boolean>();
  @Output() requestAccountModal = new EventEmitter<'login' | 'register'>();

  activeTab: PrivateModalTab = 'create';

  // Create form fields
  roomTitle = '';
  targetDistance = 2000;
  maxParticipants = 8;
  startMode: 'manual' | 'scheduled' = 'manual';
  scheduledDateTime = '';
  botCount = 0;
  botMaxPace = 120; // 2:00 / 500m
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

  // Share & host action state
  feedbackMessage = '';
  actionError = '';
  isActionBusy = false;
  canNativeShare = false;

  // Saved / My Rooms list
  savedSalons: SavedPrivateSalon[] = [];
  liveRoomsMap: Map<string, PrivateRacePayload> = new Map();
  isLoadingRooms = false;

  private feedbackTimer?: ReturnType<typeof setTimeout>;
  private socketSub?: Subscription;
  private modalPollSub?: Subscription;

  constructor(
    private rowerService: RowerService,
    public i18n: I18nService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    this.loadSavedSalonsFromStorage();
    if (!this.roomTitle) {
      this.roomTitle = this.defaultRoomTitle();
    }
    this.socketSub = this.socketService.onPrivateRoomUpdate().subscribe((update) => {
      if (this.activeRoom && (update.raceId === this.activeRoom.race?.id || update.raceId === this.activeRoom.code)) {
        this.refreshActiveRoom();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
    if (this.modalPollSub) {
      this.modalPollSub.unsubscribe();
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
      this.cdr.markForCheck();
    }

    if (changes['initialTab'] && this.initialTab) {
      this.activeTab = this.resolveTab(this.initialTab);
    }

    if (changes['isOpen']) {
      if (this.isOpen) {
        this.activeTab = this.resolveTab(this.initialTab);
        this.actionError = '';
        if (this.externalError) {
          this.joinError = this.externalError;
        }
        if (!this.roomTitle.trim()) {
          this.roomTitle = this.defaultRoomTitle();
        }
        this.refreshMyRooms();
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
    setTimeout(() => {
      const dialog = this.dialogRef?.nativeElement;
      if (!dialog) return;
      if (open) {
        if (!dialog.open) {
          if (typeof dialog.showModal === 'function') {
            try {
              dialog.showModal();
            } catch {
              dialog.setAttribute('open', '');
            }
          } else {
            dialog.setAttribute('open', '');
          }
        }
      } else if (dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
      this.cdr.markForCheck();
    }, 0);
  }

  onNativeDialogClose(): void {
    if (this.isOpen) {
      this.modalClose.emit();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialogRef?.nativeElement;
    if (dialog && event.target === dialog) {
      this.closeModal();
    }
  }

  closeModal(): void {
    this.syncDialogState(false);
    this.modalClose.emit();
  }

  switchTab(tab: PrivateModalTab): void {
    if (tab === 'share' && !this.activeRoom) return;
    this.activeTab = tab;
    this.actionError = '';
    if (tab === 'join') {
      this.refreshMyRooms();
    }
    this.cdr.markForCheck();
  }

  onTabKeydown(event: KeyboardEvent): void {
    const availableTabs: PrivateModalTab[] = this.activeRoom
      ? ['create', 'share', 'join']
      : ['create', 'join'];
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

  get canManageActiveRoom(): boolean {
    if (!this.activeRoom) return false;
    if (this.isUserAdmin) return true;
    const hostId = this.activeRoom.race.hostUserId;
    if (!hostId || hostId === 'anonymous') return true;
    return hostId === this.activeUserId;
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

  get shareUrl(): string {
    const code = this.activeRoomCode;
    if (!code) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return buildShareableRoomUrl(origin, code);
  }

  get fullInviteMessage(): string {
    if (!this.activeRoom) return '';
    return buildRoomInviteMessage({
      headerLabel: this.i18n.t('INVITE_MSG_HEADER'),
      title: this.activeRoom.race.title,
      targetDistance: this.activeRoom.race.targetDistance,
      urlLabel: this.i18n.t('SHARE_SECTION_URL'),
      shareUrl: this.shareUrl,
      codeLabel: this.i18n.t('SHARE_SECTION_CODE'),
      code: this.activeRoomCode,
      pinLabel: this.i18n.t('SHARE_SECTION_PIN'),
      pinCode: this.activeRoomPin
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

  onCreateRoomSubmit(): void {
    if (this.isCreating) return;

    if (!this.isUserAdmin && !this.isSubscriber) {
      this.createGeneralError = "La création de salon privé est réservée aux abonnés. Connectez-vous avec votre compte abonné ou inscrivez-vous.";
      this.cdr.markForCheck();
      return;
    }

    if (!this.validateCreateTitle()) return;

    this.createGeneralError = '';
    this.isCreating = true;

    const clampedDist = Math.min(100000, Math.max(100, Math.round(Number(this.targetDistance) || 2000)));
    const clampedMax = Math.min(30, Math.max(2, Math.round(Number(this.maxParticipants) || 8)));

    this.rowerService
      .createPrivateRace({
        title: this.roomTitle.trim(),
        targetDistance: clampedDist,
        maxParticipants: clampedMax,
        hostUserId: this.activeUserId || 'anonymous',
        hostUserName: this.activeUserName || undefined,
        startMode: this.startMode,
        scheduledStartTime: this.startMode === 'scheduled' && this.scheduledDateTime ? this.scheduledDateTime : undefined,
        botCount: Number(this.botCount) || 0,
        botMaxPace: Number(this.botMaxPace) || 120,
        requireApproval: this.requireApproval
      })
      .subscribe({
        next: (created) => {
          this.isCreating = false;
          this.rememberSalon(created, true);
          this.roomSelected.emit({ payload: created, pushUrl: true });
          this.activeTab = 'share';
          this.showFeedback(this.i18n.t('PRIVATE_ROOM_BADGE') + ' : ' + (created.code || ''));
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.isCreating = false;
          this.createGeneralError = err?.error?.error || err?.error?.message || 'Erreur lors de la création du salon.';
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

    const obs =
      parsed.kind === 'pin'
        ? this.rowerService.getRaceByPin(parsed.value)
        : this.rowerService.getPrivateRace(parsed.value);

    obs.subscribe({
      next: (room) => {
        this.isJoining = false;
        this.joinInput = '';
        this.rememberSalon(room);
        this.roomSelected.emit({ payload: room, pushUrl: true });
        this.activeTab = 'share';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isJoining = false;
        this.joinError =
          err?.status === 404
            ? this.i18n.t('JOIN_ERR_NOT_FOUND')
            : (err?.error?.error || this.i18n.t('JOIN_ERR_NOT_FOUND'));
        this.cdr.markForCheck();
      }
    });
  }

  openSavedSalon(salon: SavedPrivateSalon): void {
    this.actionError = '';
    this.rowerService.getPrivateRace(salon.code).subscribe({
      next: (room) => {
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

  onToggleBots(): void {
    if (!this.activeRoom) return;
    if (this.activeRoom.race.isBotDuel && !this.isRegisteredUser) {
      this.actionError = "En mode duel 1v1 contre un bot, seul un utilisateur inscrit avec un compte peut ajouter ou retirer un bot.";
      this.cdr.markForCheck();
      return;
    }
    const nextState = !this.activeRoom.race.hasBots;
    this.botsToggled.emit(nextState);
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
}

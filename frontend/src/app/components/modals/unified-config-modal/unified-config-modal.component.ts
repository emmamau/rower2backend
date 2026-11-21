import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../services/i18n.service';
import { NextRaceInfo, PrivateRacePayload } from '../../../models/rower-data.model';
import { PrivateModalTab } from '../../private-room-manager/private-room-manager.component';

@Component({
  selector: 'app-unified-config-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unified-config-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class UnifiedConfigModalComponent {
  @Input() isUnifiedConfigOpen = false;
  @Input() isConfigRaceOpen = false;
  @Input() isAdminConfigOpen = false;
  @Input() isUserAdmin = false;
  @Input() isSubscriber = false;
  @Input() currentSubscriberTier = 'free';
  @Input() unifiedConfigActiveTab: 'public' | 'active' = 'public';
  @Input() adminConfig = {
    targetDistance: 2000,
    maxParticipants: 20,
    maxDurationMinutes: 55,
    privateMaxDurationMinutes: 55,
    defaultBotsCount: 3,
    defaultBotsPace: 120,
    countdownAfterLastJoinSeconds: 15,
    lobbyWaitMinutes: 15,
  };
  @Input() adminConfigMessage = '';
  @Input() adminConfigError = '';
  @Input() isAdminConfigSubmitting = false;
  @Input() configTargetDistance = 10000;
  @Input() configIntervalMinutes = 15;
  @Input() activePrivateRoom: PrivateRacePayload | null = null;
  @Input() isOrganizerOfActiveRoom = false;
  @Input() nextRaceInfo: NextRaceInfo | null = null;

  // Bot Duel modal
  @Input() isBotDuelModalOpen = false;
  @Input() botDuelName = '';
  @Input() botDuelDistance = 2000;
  @Input() botDuelError = '';
  @Input() isCreatingBotDuel = false;

  get maxDistanceAllowed(): number {
    if (this.isUserAdmin) return 100000;
    const rawTier = String(this.currentSubscriberTier || (this.isSubscriber ? 'intermediate' : 'free')).toLowerCase().trim();
    if (rawTier === 'pro' || rawTier === 'elite_pro' || rawTier === 'premium') return 10000;
    if (rawTier === 'club' || rawTier === 'standard' || rawTier === 'intermediate') return 5000;
    return 2000;
  }

  @Output() unifiedConfigActiveTabChange = new EventEmitter<'public' | 'active'>();
  @Output() configTargetDistanceChange = new EventEmitter<number>();
  @Output() configIntervalMinutesChange = new EventEmitter<number>();
  @Output() botDuelNameChange = new EventEmitter<string>();
  @Output() botDuelDistanceChange = new EventEmitter<number>();

  @Output() closeUnifiedConfigModalRequest = new EventEmitter<void>();
  @Output() saveAdminConfigRequest = new EventEmitter<void>();
  @Output() saveRaceConfigRequest = new EventEmitter<void>();
  @Output() openPrivateModalRequest = new EventEmitter<PrivateModalTab | undefined>();
  @Output() openSubscriptionModalRequest = new EventEmitter<void>();
  @Output() closeBotDuelModalRequest = new EventEmitter<void>();
  @Output() startBotDuelRequest = new EventEmitter<void>();
  @Output() setBotDuelPresetDistanceRequest = new EventEmitter<number>();

  constructor(public i18n: I18nService) {}
}

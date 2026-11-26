import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../../services/i18n.service';

@Component({
  selector: 'app-subscription-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscription-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class SubscriptionModalComponent {
  @Input() isSubscriptionModalOpen = false;
  @Input() subscriptionStatus: any = null;
  @Input() subscriptionLoading = false;
  @Input() subscriptionTiers: any[] = [];
  @Input() pioneerMode = true;
  @Input() subscriptionSuccessMessage = '';
  @Input() subscriptionError = '';

  @Output() closeSubscriptionModalRequest = new EventEmitter<void>();
  @Output() subscribeToTierRequest = new EventEmitter<string>();

  constructor(public i18n: I18nService) {}

  subscribeToTier(tierId: string): void {
    this.subscribeToTierRequest.emit(tierId);
  }

  get userTier(): 'free' | 'competitor' | 'club_elite' {
    const raw = String(this.subscriptionStatus?.tier || '').toLowerCase().trim();
    if (raw === 'competitor' || raw === 'intermediate' || raw === 'standard' || raw === 'club') return 'competitor';
    if (raw === 'club_elite' || raw === 'premium' || raw === 'pro' || raw === 'elite_pro') return 'club_elite';
    return 'free';
  }

  isCurrentTier(tierId: string): boolean {
    const clean = String(tierId || '').toLowerCase().trim();
    const current = this.userTier;
    if (clean === 'free') return current === 'free';
    if (clean === 'competitor' || clean === 'intermediate') return current === 'competitor';
    if (clean === 'club_elite' || clean === 'premium') return current === 'club_elite';
    return false;
  }

  isTierActive(tierId: string): boolean {
    if (this.pioneerMode) return true;
    const clean = String(tierId || '').toLowerCase().trim();
    const tier = (this.subscriptionTiers || []).find((t: any) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code === clean ||
        (clean === 'competitor' && (code === 'intermediate' || code === 'standard' || code === 'club')) ||
        (clean === 'club_elite' && (code === 'premium' || code === 'pro' || code === 'elite_pro')) ||
        (clean === 'intermediate' && code === 'standard') ||
        (clean === 'premium' && code === 'elite_pro');
    });
    if (!tier) return true;
    return tier.isActive !== false;
  }

  hasPaidTierActive(): boolean {
    if (this.pioneerMode) return true;
    if (this.isTierActive('competitor') || this.isTierActive('club_elite')) {
      return true;
    }
    return (this.subscriptionTiers || []).some((t: any) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code !== 'free' && t.isActive === true;
    });
  }
}

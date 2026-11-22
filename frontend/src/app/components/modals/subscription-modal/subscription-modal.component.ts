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
  @Input() subscriptionSuccessMessage = '';
  @Input() subscriptionError = '';

  @Output() closeSubscriptionModalRequest = new EventEmitter<void>();
  @Output() subscribeToTierRequest = new EventEmitter<string>();

  constructor(public i18n: I18nService) {}

  subscribeToTier(tierId: string): void {
    this.subscribeToTierRequest.emit(tierId);
  }

  isTierActive(tierId: string): boolean {
    if (tierId === 'free') return true;
    const clean = String(tierId || '').toLowerCase().trim();
    const tier = (this.subscriptionTiers || []).find((t: any) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code === clean || (clean === 'intermediate' && code === 'standard') || (clean === 'premium' && code === 'elite_pro');
    });
    if (!tier) return true;
    return tier.isActive !== false;
  }
}

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

  private findTier(tierId: string): any | null {
    const clean = String(tierId || '').toLowerCase().trim();
    return (this.subscriptionTiers || []).find((t: any) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code === clean ||
        (clean === 'competitor' && (code === 'intermediate' || code === 'standard' || code === 'club')) ||
        (clean === 'club_elite' && (code === 'premium' || code === 'pro' || code === 'elite_pro')) ||
        (clean === 'intermediate' && (code === 'standard' || code === 'competitor')) ||
        (clean === 'premium' && (code === 'elite_pro' || code === 'club_elite'));
    }) || null;
  }

  /** Accès Pionnier gratuit proposé pour cette offre. */
  isPioneerTier(tierId: string): boolean {
    const clean = String(tierId || '').toLowerCase().trim();
    if (clean === 'free') return false;
    const tier = this.findTier(tierId);
    if (!tier) return this.pioneerMode;
    return tier.isPioneerEnabled === true;
  }

  /** Souscription payante autorisée pour cette offre. */
  isPaidTier(tierId: string): boolean {
    const clean = String(tierId || '').toLowerCase().trim();
    if (clean === 'free') return true;
    const tier = this.findTier(tierId);
    if (!tier) return true;
    return (tier.isPaidEnabled ?? tier.isActive) !== false;
  }

  /** Offre disponible : Découverte toujours, sinon payant OU Pionnier. */
  isTierActive(tierId: string): boolean {
    const clean = String(tierId || '').toLowerCase().trim();
    if (clean === 'free') return true;
    return this.isPioneerTier(tierId) || this.isPaidTier(tierId);
  }

  hasPaidTierActive(): boolean {
    return this.isTierActive('competitor') || this.isTierActive('club_elite');
  }
}

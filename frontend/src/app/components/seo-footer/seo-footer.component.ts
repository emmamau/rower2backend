import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';
import { PrivateModalTab } from '../private-room-manager/private-room-manager.component';

@Component({
  selector: 'app-seo-footer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './seo-footer.component.html',
  encapsulation: ViewEncapsulation.None
})
export class SeoFooterComponent {
  @Input() siteView: 'home' | 'regatta' | 'cockpit' = 'home';
  @Input() isMobileOrTablet = false;
  @Input() isMobileFullscreenOnly = false;
  @Input() isMobileSeoGuideOpen = false;
  @Input() activeSeoLang: 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt' = 'fr';
  @Input() activeViewMode: 'canvas' | 'cockpit' = 'canvas';
  @Input() isPrivateModalOpen = false;
  @Input() isStandingsOpen = false;
  @Input() isHistoryOpen = false;
  @Input() canAccessCockpit = true;
  @Input() hasActivePrivateRoom = false;

  @Output() toggleMobileSeoGuideRequest = new EventEmitter<Event>();
  @Output() seoLangChange = new EventEmitter<'fr' | 'en' | 'de' | 'es' | 'it' | 'pt'>();
  @Output() openPrivateModalRequest = new EventEmitter<PrivateModalTab | undefined>();
  @Output() openSubscriptionModalRequest = new EventEmitter<void>();
  @Output() openStatisticsModalRequest = new EventEmitter<void>();
  @Output() openLegalTermsRequest = new EventEmitter<void>();
  @Output() switchViewModeRequest = new EventEmitter<'canvas' | 'cockpit'>();
  @Output() openStandingsModalRequest = new EventEmitter<void>();
  @Output() openHistoryModalRequest = new EventEmitter<void>();

  constructor(public i18n: I18nService) {}

  toggleMobileSeoGuide(event: Event): void {
    this.toggleMobileSeoGuideRequest.emit(event);
  }

  setSeoLang(lang: 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt'): void {
    this.seoLangChange.emit(lang);
  }
}

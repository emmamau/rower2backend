import { Component, OnInit, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  AdminPublicRaceSettings,
  AdminUserItem,
  AdminUserDetailsResponse,
  AdminActiveRoomItem,
  AdminSystemMetricsResponse,
  SubscriptionPlanItem,
  AdminStatsResponse,
  AdminStatsTimelineItem
} from '../../services/admin.service';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css']
})
export class AdminDashboardComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  activeTab: 'public' | 'users' | 'rooms' | 'plans' | 'system' | 'stats' = 'public';

  // Feedback notifications
  feedbackMessage = '';
  errorMessage = '';

  // Onglet 6 : Statistiques & Analyse
  statsPeriod: 'day' | 'week' | 'month' = 'day';
  statsLimit = 30;
  isLoadingStats = false;
  statsData: AdminStatsResponse | null = null;
  statsActiveMetric: 'all' | 'users' | 'subscribers' | 'races' | 'duels' | 'distance' = 'all';

  // Onglet 1 : Courses Publiques
  publicSettings: AdminPublicRaceSettings = {
    isEnabled: true,
    raceDistanceM: 1000,
    maxDurationSec: 600,
    maxPlayers: 6,
    botCount: 2,
    interRaceDelaySec: 120,
    overtakeThresholdM: 5,
    inactivityAbandonSec: 60
  };
  isPublicLoading = false;
  isPublicSubmitting = false;

  // Onglet 2 : Utilisateurs
  usersList: AdminUserItem[] = [];
  searchQuery = '';
  filterRole = '';
  filterTier = '';
  filterStatus = '';
  currentPage = 1;
  pageSize = 20;
  totalPages = 1;
  totalUsers = 0;
  isLoadingUsers = false;

  // Modales Utilisateurs
  userToRevoke: AdminUserItem | null = null;
  isRevokeModalOpen = false;

  userToReset: AdminUserItem | null = null;
  newPasswordInput = '';
  isPasswordModalOpen = false;

  // Modale Rôle Utilisateur
  userToEditRole: AdminUserItem | null = null;
  pendingNewRole: 'ADMIN' | 'USER' = 'USER';
  isRoleModalOpen = false;

  // Modale Quotas Salons Utilisateur
  userToEditQuotas: AdminUserItem | null = null;
  editConcurrentRooms: number | null = null;
  editWeeklyRooms: number | null = null;
  isQuotaModalOpen = false;
  isSavingQuotas = false;

  // Modale Fiche Utilisateur Détaillée
  selectedUserDetail: AdminUserDetailsResponse['user'] | null = null;
  isSelectedUserModalOpen = false;
  isLoadingUserDetails = false;

  // Modale Suppression Utilisateur
  userToDelete: AdminUserItem | null = null;
  isDeleteUserModalOpen = false;
  isDeletingUser = false;

  // Purge des comptes invités orphelins
  isPurgeModalOpen = false;
  isPurgingUsers = false;
  purgeIncludeWithRaces = false;

  // Onglet 3 : Salons
  activeRoomsList: AdminActiveRoomItem[] = [];
  roomsHistoryList: any[] = [];
  isLoadingRooms = false;
  isTerminatingRoom = false;
  isPurgingRooms = false;

  // Onglet 4 : Offres & Quotas
  plansList: SubscriptionPlanItem[] = [];
  isLoadingPlans = false;
  isPlanModalOpen = false;
  editingPlan: SubscriptionPlanItem = {
    code: '',
    name: '',
    description: '',
    priceMonthly: 0,
    priceYearly: 0,
    maxBotsPerRace: 1,
    maxRaceDistanceM: 2000,
    maxPlayersPerRoom: 2,
    maxConcurrentRooms: 1,
    maxRoomsPerWeek: 5,
    canCreateDuel1v1: true,
    canScheduleRaces: false,
    isActive: true
  };
  isEditingExistingPlan = false;

  // Onglet 5 : Supervision & Système
  systemMetrics: AdminSystemMetricsResponse['metrics'] | null = null;
  isLoadingMetrics = false;
  isTriggeringLeague = false;

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef,
    public i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.loadPublicSettings();
    this.loadPlans();
  }

  setTab(tab: 'public' | 'users' | 'rooms' | 'plans' | 'system' | 'stats'): void {
    this.activeTab = tab;
    this.clearMessages();
    if (tab === 'public') {
      this.loadPublicSettings();
    } else if (tab === 'users') {
      if (this.plansList.length === 0) {
        this.loadPlans();
      }
      this.loadUsers(1);
    } else if (tab === 'rooms') {
      this.loadRooms();
    } else if (tab === 'plans') {
      this.loadPlans();
    } else if (tab === 'system') {
      this.loadSystemMetrics();
    } else if (tab === 'stats') {
      this.loadStats();
    }
  }

  clearMessages(): void {
    this.feedbackMessage = '';
    this.errorMessage = '';
  }

  onClose(): void {
    this.close.emit();
  }

  private formatAdminError(err: any, fallbackKey: string): string {
    if (err?.error?.code || err?.error?.message || (typeof err?.error === 'string' && err.error.trim())) {
      return this.i18n.translateError(err);
    }
    return this.i18n.t(fallbackKey);
  }

  // ---------------------------------------------------------------------------
  // 1. Courses Publiques
  // ---------------------------------------------------------------------------

  loadPublicSettings(): void {
    this.isPublicLoading = true;
    this.adminService.getPublicRaceSettings().subscribe({
      next: (res) => {
        this.isPublicLoading = false;
        if (res.success && res.settings) {
          this.publicSettings = { ...res.settings };
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPublicLoading = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_PUBLIC');
        this.cdr.markForCheck();
      }
    });
  }

  savePublicSettings(): void {
    this.isPublicSubmitting = true;
    this.clearMessages();
    this.adminService.updatePublicRaceSettings(this.publicSettings).subscribe({
      next: (res) => {
        this.isPublicSubmitting = false;
        if (res.success) {
          this.feedbackMessage = `✓ ${this.i18n.t('ADMIN_PUBLIC_SAVED_OK')}`;
          this.publicSettings = { ...res.settings };
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPublicSubmitting = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_SAVE_PUBLIC');
        this.cdr.markForCheck();
      }
    });
  }

  toggleMasterPublicRaces(): void {
    const target = !this.publicSettings.isEnabled;
    this.clearMessages();
    this.adminService.togglePublicRaces(target).subscribe({
      next: (res) => {
        if (res.success) {
          this.publicSettings.isEnabled = res.isEnabled;
          this.feedbackMessage = res.message;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_TOGGLE_PUBLIC');
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Gestion des Utilisateurs
  // ---------------------------------------------------------------------------

  loadUsers(page: number = 1): void {
    this.currentPage = page;
    this.isLoadingUsers = true;
    this.clearMessages();
    this.adminService.getUsers({
      search: this.searchQuery,
      role: this.filterRole,
      tier: this.filterTier,
      status: this.filterStatus,
      page: this.currentPage,
      limit: this.pageSize
    }).subscribe({
      next: (res) => {
        this.isLoadingUsers = false;
        if (res.success) {
          this.usersList = res.users;
          this.totalUsers = res.total;
          this.totalPages = res.totalPages || 1;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingUsers = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_USERS');
        this.cdr.markForCheck();
      }
    });
  }

  openRevokeModal(user: AdminUserItem): void {
    this.userToRevoke = user;
    this.isRevokeModalOpen = true;
  }

  closeRevokeModal(): void {
    this.isRevokeModalOpen = false;
    this.userToRevoke = null;
  }

  confirmRevokeToggle(): void {
    if (!this.userToRevoke) return;
    const targetState = !this.userToRevoke.isRevoked;
    this.adminService.revokeUser(this.userToRevoke.id, targetState).subscribe({
      next: (res) => {
        if (res.success && this.userToRevoke) {
          this.userToRevoke.isRevoked = targetState;
          this.feedbackMessage = res.message;
        }
        this.closeRevokeModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_REVOKE_USER');
        this.closeRevokeModal();
        this.cdr.markForCheck();
      }
    });
  }

  openPasswordModal(user: AdminUserItem): void {
    this.userToReset = user;
    this.newPasswordInput = '';
    this.isPasswordModalOpen = true;
  }

  closePasswordModal(): void {
    this.isPasswordModalOpen = false;
    this.userToReset = null;
    this.newPasswordInput = '';
  }

  confirmPasswordReset(): void {
    if (!this.userToReset || !this.newPasswordInput || this.newPasswordInput.length < 4) {
      alert(this.i18n.t('ADMIN_PWD_ERR_MIN'));
      return;
    }

    this.adminService.resetUserPassword(this.userToReset.id, this.newPasswordInput).subscribe({
      next: (res) => {
        this.feedbackMessage = res.message;
        this.closePasswordModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_RESET_PWD');
        this.closePasswordModal();
        this.cdr.markForCheck();
      }
    });
  }

  openRoleModal(user: AdminUserItem, newRole: 'ADMIN' | 'USER'): void {
    if (user.role === newRole) return;
    this.userToEditRole = user;
    this.pendingNewRole = newRole;
    this.isRoleModalOpen = true;
  }

  closeRoleModal(): void {
    this.isRoleModalOpen = false;
    this.userToEditRole = null;
  }

  confirmRoleChange(): void {
    if (!this.userToEditRole) return;
    const user = this.userToEditRole;
    const targetRole = this.pendingNewRole;

    this.adminService.updateUserRole(user.id, targetRole).subscribe({
      next: (res) => {
        if (res.success) {
          user.role = targetRole;
          this.feedbackMessage = res.message;
          this.syncOwnProfileIfAffected(user.id, { role: targetRole });
        }
        this.closeRoleModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_UPDATE_ROLE');
        this.closeRoleModal();
        this.cdr.markForCheck();
      }
    });
  }

  changeUserPlan(user: AdminUserItem, newPlan: string): void {
    const cleanPlan = (newPlan || 'free').trim().toLowerCase();
    if (user.subscriptionTier?.toLowerCase() === cleanPlan) return;
    this.adminService.updateUserPlan(user.id, cleanPlan).subscribe({
      next: (res) => {
        if (res.success) {
          user.subscriptionTier = cleanPlan;
          this.feedbackMessage = res.message;
          this.syncOwnProfileIfAffected(user.id, { plan: cleanPlan });
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_UPDATE_PLAN');
        this.cdr.markForCheck();
      }
    });
  }

  openQuotaModal(user: AdminUserItem): void {
    this.userToEditQuotas = user;
    this.editConcurrentRooms = user.customConcurrentRooms !== undefined ? user.customConcurrentRooms : null;
    this.editWeeklyRooms = user.customWeeklyRooms !== undefined ? user.customWeeklyRooms : null;
    this.isQuotaModalOpen = true;
  }

  closeQuotaModal(): void {
    this.isQuotaModalOpen = false;
    this.userToEditQuotas = null;
    this.editConcurrentRooms = null;
    this.editWeeklyRooms = null;
    this.isSavingQuotas = false;
  }

  confirmQuotaSave(): void {
    if (!this.userToEditQuotas) return;
    const user = this.userToEditQuotas;
    this.isSavingQuotas = true;

    const payload = {
      customConcurrentRooms: this.editConcurrentRooms === null || this.editConcurrentRooms === undefined || (this.editConcurrentRooms as any) === ''
        ? null
        : Math.max(0, Number(this.editConcurrentRooms)),
      customWeeklyRooms: this.editWeeklyRooms === null || this.editWeeklyRooms === undefined || (this.editWeeklyRooms as any) === ''
        ? null
        : Math.max(0, Number(this.editWeeklyRooms))
    };

    this.adminService.updateUserRoomQuotas(user.id, payload).subscribe({
      next: (res) => {
        this.isSavingQuotas = false;
        if (res.success && res.user) {
          user.customConcurrentRooms = res.user.customConcurrentRooms;
          user.customWeeklyRooms = res.user.customWeeklyRooms;
          this.feedbackMessage = res.message;
        }
        this.closeQuotaModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isSavingQuotas = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_UPDATE_QUOTAS');
        this.closeQuotaModal();
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Fiche Utilisateur Détaillée & Suppression
  // ---------------------------------------------------------------------------

  openUserDetailsModal(user: AdminUserItem): void {
    this.selectedUserDetail = null;
    this.isLoadingUserDetails = true;
    this.isSelectedUserModalOpen = true;
    this.clearMessages();

    this.adminService.getUserDetails(user.id).subscribe({
      next: (res) => {
        this.isLoadingUserDetails = false;
        if (res.success && res.user) {
          this.selectedUserDetail = res.user;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingUserDetails = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_USER_DETAILS');
        this.cdr.markForCheck();
      }
    });
  }

  closeUserDetailsModal(): void {
    this.isSelectedUserModalOpen = false;
    this.selectedUserDetail = null;
  }

  openDeleteUserModal(user: AdminUserItem): void {
    this.userToDelete = user;
    this.isDeleteUserModalOpen = true;
    this.clearMessages();
  }

  closeDeleteUserModal(): void {
    this.isDeleteUserModalOpen = false;
    this.userToDelete = null;
    this.isDeletingUser = false;
  }

  confirmDeleteUser(): void {
    if (!this.userToDelete) return;
    const target = this.userToDelete;
    this.isDeletingUser = true;
    this.clearMessages();

    this.adminService.deleteUser(target.id).subscribe({
      next: (res) => {
        this.isDeletingUser = false;
        if (res.success) {
          this.feedbackMessage = res.message || this.i18n.t('ADMIN_USER_DELETE_SUCCESS');
          this.usersList = this.usersList.filter(u => u.id !== target.id);
          this.totalUsers = Math.max(0, this.totalUsers - 1);
          if (this.selectedUserDetail?.id === target.id) {
            this.closeUserDetailsModal();
          }
        }
        this.closeDeleteUserModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isDeletingUser = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_DELETE_USER');
        this.closeDeleteUserModal();
        this.cdr.markForCheck();
      }
    });
  }

  openPurgeModal(): void {
    this.isPurgeModalOpen = true;
    this.purgeIncludeWithRaces = false;
    this.clearMessages();
  }

  closePurgeModal(): void {
    this.isPurgeModalOpen = false;
    this.isPurgingUsers = false;
  }

  confirmPurgeUsers(): void {
    this.isPurgingUsers = true;
    this.clearMessages();
    this.adminService.purgeAnonymousUsers(this.purgeIncludeWithRaces).subscribe({
      next: (res) => {
        this.isPurgingUsers = false;
        this.closePurgeModal();
        if (res.success) {
          this.feedbackMessage = res.message || this.i18n.t('ADMIN_PURGE_SUCCESS');
          this.loadUsers(1);
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPurgingUsers = false;
        this.closePurgeModal();
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_PURGE_USERS');
        this.cdr.markForCheck();
      }
    });
  }

  getDefaultConcurrent(tier?: string): number {
    const t = (tier || 'free').toLowerCase();
    if (t === 'premium' || t === 'pro' || t === 'elite_pro') return 5;
    if (t === 'intermediate' || t === 'standard' || t === 'club') return 3;
    return 1;
  }

  getDefaultWeekly(tier?: string): number {
    const t = (tier || 'free').toLowerCase();
    if (t === 'premium' || t === 'pro' || t === 'elite_pro') return 15;
    if (t === 'intermediate' || t === 'standard' || t === 'club') return 10;
    return 5;
  }

  private syncOwnProfileIfAffected(affectedUserId: string, updates: { role?: string; plan?: string }): void {
    if (typeof localStorage === 'undefined') return;
    const myId = localStorage.getItem('rower_user_id') || '';
    const myLogin = localStorage.getItem('rower_user_login') || '';
    const isMe = affectedUserId === myId || affectedUserId === myLogin;
    if (isMe) {
      if (updates.role) {
        localStorage.setItem('rower_user_role', updates.role);
        localStorage.setItem('rower_is_admin', String(updates.role === 'ADMIN'));
      }
      if (updates.plan) {
        localStorage.setItem('rower_is_subscriber', String(updates.plan.toLowerCase() !== 'free'));
      }
    }
  }

  get availablePlanOptions(): { code: string; label: string }[] {
    const list: { code: string; label: string }[] = [];
    const seen = new Set<string>();

    // 1. Offres définies en base (plansList)
    for (const p of this.plansList) {
      if (p.code) {
        const lower = p.code.toLowerCase();
        // Ignorer le code doublon 'standard' (alias historique de intermediate/club)
        if (lower === 'standard') continue;
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({
            code: lower,
            label: `${p.name} (${p.code})`
          });
        }
      }
    }

    // 2. Offres standards en fallback si non chargées ou complémentaires
    const defaults = [
      { code: 'free', label: `${this.i18n.t('SUB_FREE_TITLE')} (FREE)` },
      { code: 'intermediate', label: `${this.i18n.t('SUB_CLUB_TITLE')} (INTERMEDIATE)` },
      { code: 'premium', label: `${this.i18n.t('SUB_PRO_TITLE')} (PREMIUM)` }
    ];

    for (const d of defaults) {
      if (!seen.has(d.code)) {
        seen.add(d.code);
        list.push(d);
      }
    }

    return list;
  }

  // ---------------------------------------------------------------------------
  // 3. Offres & Quotas
  // ---------------------------------------------------------------------------

  loadPlans(): void {
    this.isLoadingPlans = true;
    this.clearMessages();
    this.adminService.getPlans().subscribe({
      next: (res) => {
        this.isLoadingPlans = false;
        if (res.success && res.plans) {
          this.plansList = res.plans;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingPlans = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_PLANS');
        this.cdr.markForCheck();
      }
    });
  }

  openCreatePlanModal(): void {
    this.isEditingExistingPlan = false;
    this.editingPlan = {
      code: '',
      name: '',
      description: '',
      priceMonthly: 0,
      priceYearly: 0,
      maxBotsPerRace: 1,
      maxRaceDistanceM: 2000,
      maxPlayersPerRoom: 2,
      maxConcurrentRooms: 1,
      maxRoomsPerWeek: 5,
      canCreateDuel1v1: true,
      canScheduleRaces: false,
      isActive: true
    };
    this.isPlanModalOpen = true;
  }

  openEditPlanModal(plan: SubscriptionPlanItem): void {
    this.isEditingExistingPlan = true;
    this.editingPlan = { ...plan };
    this.isPlanModalOpen = true;
  }

  closePlanModal(): void {
    this.isPlanModalOpen = false;
  }

  savePlan(): void {
    if (!this.editingPlan.code || !this.editingPlan.name) {
      alert(this.i18n.t('ADMIN_PLAN_ERR_REQUIRED'));
      return;
    }

    if (this.isEditingExistingPlan && this.editingPlan.id) {
      this.adminService.updatePlan(this.editingPlan.id, this.editingPlan).subscribe({
        next: (res) => {
          this.feedbackMessage = res.message;
          this.closePlanModal();
          this.loadPlans();
        },
        error: (err) => {
          this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_EDIT_PLAN');
          this.closePlanModal();
        }
      });
    } else {
      this.adminService.createPlan(this.editingPlan).subscribe({
        next: (res) => {
          this.feedbackMessage = res.message;
          this.closePlanModal();
          this.loadPlans();
        },
        error: (err) => {
          this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_CREATE_PLAN');
          this.closePlanModal();
        }
      });
    }
  }

  togglePlanStatus(plan: SubscriptionPlanItem, targetState?: boolean): void {
    if (!plan || (!plan.id && !plan.code)) return;
    const planIdentifier = plan.id || plan.code;
    const currentActive = Boolean(plan.isActive);
    const newActive = targetState !== undefined ? targetState : !currentActive;

    this.adminService.togglePlan(planIdentifier, newActive).subscribe({
      next: (res) => {
        this.feedbackMessage = res.message;
        plan.isActive = newActive;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_TOGGLE_PLAN');
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Salons (Supervision temps réel & Historique)
  // ---------------------------------------------------------------------------

  loadRooms(): void {
    this.isLoadingRooms = true;
    this.clearMessages();

    this.adminService.getActiveRooms().subscribe({
      next: (res) => {
        this.isLoadingRooms = false;
        if (res.success) {
          this.activeRoomsList = res.rooms || [];
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingRooms = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_ROOMS');
        this.cdr.markForCheck();
      }
    });

    this.adminService.getRoomsHistory(20).subscribe({
      next: (res) => {
        if (res.success) {
          this.roomsHistoryList = res.rooms || [];
        }
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  terminateRoom(room: AdminActiveRoomItem): void {
    const code = room.code || room.id;
    if (!code) return;
    this.isTerminatingRoom = true;
    this.clearMessages();

    this.adminService.terminateRoom(code).subscribe({
      next: (res) => {
        this.isTerminatingRoom = false;
        if (res.success) {
          this.feedbackMessage = res.message;
          this.activeRoomsList = this.activeRoomsList.filter(r => r.code !== code && r.id !== code);
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isTerminatingRoom = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_TERMINATE_ROOM');
        this.cdr.markForCheck();
      }
    });
  }

  purgeInactiveRooms(): void {
    this.isPurgingRooms = true;
    this.clearMessages();

    this.adminService.purgeInactiveRooms().subscribe({
      next: (res) => {
        this.isPurgingRooms = false;
        if (res.success) {
          this.feedbackMessage = res.message;
          this.loadRooms();
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPurgingRooms = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_PURGE_ROOMS');
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Supervision Globale & Système
  // ---------------------------------------------------------------------------

  loadSystemMetrics(): void {
    this.isLoadingMetrics = true;
    this.clearMessages();

    this.adminService.getSystemMetrics().subscribe({
      next: (res) => {
        this.isLoadingMetrics = false;
        if (res.success && res.metrics) {
          this.systemMetrics = res.metrics;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingMetrics = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_METRICS');
        this.cdr.markForCheck();
      }
    });
  }

  triggerLeagueCycle(): void {
    this.isTriggeringLeague = true;
    this.clearMessages();

    this.adminService.triggerLeagueCycle().subscribe({
      next: (res) => {
        this.isTriggeringLeague = false;
        if (res.success) {
          this.feedbackMessage = res.message;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isTriggeringLeague = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_TRIGGER_LEAGUE');
        this.cdr.markForCheck();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Statistiques & Analyse de la Plateforme
  // ---------------------------------------------------------------------------

  loadStats(): void {
    this.isLoadingStats = true;
    this.clearMessages();

    this.adminService.getPlatformStats(this.statsPeriod, this.statsLimit).subscribe({
      next: (res) => {
        this.isLoadingStats = false;
        if (res.success) {
          this.statsData = res;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingStats = false;
        this.errorMessage = this.formatAdminError(err, 'ADMIN_ERR_LOAD_STATS');
        this.cdr.markForCheck();
      }
    });
  }

  setStatsPeriod(period: 'day' | 'week' | 'month'): void {
    if (this.statsPeriod === period && this.statsData) return;
    this.statsPeriod = period;
    this.statsLimit = period === 'day' ? 30 : 12;
    this.loadStats();
  }

  getMaxTimelineValue(metricKey: keyof AdminStatsTimelineItem): number {
    if (!this.statsData || !this.statsData.timeline.length) return 1;
    let max = 0;
    for (const item of this.statsData.timeline) {
      const val = Number(item[metricKey] || 0);
      if (val > max) max = val;
    }
    return max > 0 ? max : 1;
  }

  getBarHeightPercent(val: number, max: number): number {
    if (!val || val <= 0) return 4;
    const pct = Math.round((val / max) * 100);
    return Math.max(6, Math.min(100, pct));
  }

  exportStatsCsv(): void {
    if (!this.statsData || !this.statsData.timeline.length) return;
    const header = [
      'Période',
      'Date_Début',
      'Date_Fin',
      'Nouveaux_Utilisateurs',
      'Nouveaux_Abonnés_Payants',
      'Courses_Publiques',
      'Salons_Privés',
      'Duels_Terminés',
      'Participants',
      'Distance_Km'
    ].join(';');

    const rows = this.statsData.timeline.map((item) =>
      [
        `"${item.label}"`,
        `"${item.startDate}"`,
        `"${item.endDate}"`,
        item.newUsers,
        item.newSubscribers,
        item.publicRaces,
        item.privateRooms,
        item.duelsCompleted,
        item.participants,
        item.distanceKm
      ].join(';')
    );

    const csvContent = '\uFEFF' + [header, ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `rowerrace-stats-${this.statsPeriod}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  exportStatsJson(): void {
    if (!this.statsData) return;
    const jsonString = JSON.stringify(this.statsData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `rowerrace-stats-${this.statsPeriod}-${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

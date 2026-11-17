import { Component, OnInit, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  AdminPublicRaceSettings,
  AdminUserItem,
  SubscriptionPlanItem
} from '../../services/admin.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css']
})
export class AdminDashboardComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  activeTab: 'public' | 'users' | 'plans' = 'public';

  // Feedback notifications
  feedbackMessage = '';
  errorMessage = '';

  // Onglet 1 : Courses Publiques
  publicSettings: AdminPublicRaceSettings = {
    isEnabled: true,
    raceDistanceM: 1000,
    maxDurationSec: 600,
    maxPlayers: 6,
    botCount: 2,
    interRaceDelaySec: 120
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

  // Onglet 3 : Offres & Quotas
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

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadPublicSettings();
  }

  setTab(tab: 'public' | 'users' | 'plans'): void {
    this.activeTab = tab;
    this.clearMessages();
    if (tab === 'public') {
      this.loadPublicSettings();
    } else if (tab === 'users') {
      this.loadUsers();
    } else if (tab === 'plans') {
      this.loadPlans();
    }
  }

  clearMessages(): void {
    this.feedbackMessage = '';
    this.errorMessage = '';
  }

  onClose(): void {
    this.close.emit();
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
        this.errorMessage = err.error?.message || 'Erreur lors de la lecture des paramètres publics.';
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
          this.feedbackMessage = '✓ Paramètres des courses publiques enregistrés et appliqués à chaud !';
          this.publicSettings = { ...res.settings };
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isPublicSubmitting = false;
        this.errorMessage = err.error?.message || 'Erreur lors de la sauvegarde.';
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
        this.errorMessage = err.error?.message || 'Erreur lors de la bascule.';
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
        this.errorMessage = err.error?.message || 'Erreur lors du chargement des utilisateurs.';
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
        this.errorMessage = err.error?.message || 'Erreur lors du changement de statut de révocation.';
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
      alert('Un mot de passe d\'au moins 4 caractères est requis.');
      return;
    }

    this.adminService.resetUserPassword(this.userToReset.id, this.newPasswordInput).subscribe({
      next: (res) => {
        this.feedbackMessage = res.message;
        this.closePasswordModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Erreur réinitialisation mot de passe.';
        this.closePasswordModal();
        this.cdr.markForCheck();
      }
    });
  }

  changeUserRole(user: AdminUserItem, newRole: 'ADMIN' | 'USER'): void {
    if (user.role === newRole) return;
    this.adminService.updateUserRole(user.id, newRole).subscribe({
      next: (res) => {
        if (res.success) {
          user.role = newRole;
          this.feedbackMessage = res.message;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Erreur mise à jour rôle.';
        this.cdr.markForCheck();
      }
    });
  }

  changeUserPlan(user: AdminUserItem, newPlan: string): void {
    if (user.subscriptionTier === newPlan) return;
    this.adminService.updateUserPlan(user.id, newPlan).subscribe({
      next: (res) => {
        if (res.success) {
          user.subscriptionTier = newPlan;
          this.feedbackMessage = res.message;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Erreur mise à jour offre.';
        this.cdr.markForCheck();
      }
    });
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
        this.errorMessage = err.error?.message || 'Erreur chargement des offres.';
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
      alert('Le code et le nom de l\'offre sont obligatoires.');
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
          this.errorMessage = err.error?.message || 'Erreur lors de la modification de l\'offre.';
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
          this.errorMessage = err.error?.message || 'Erreur lors de la création de l\'offre.';
          this.closePlanModal();
        }
      });
    }
  }
}

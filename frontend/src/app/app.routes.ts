import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./app').then((m) => m.AppComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./app').then((m) => m.AppComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./app').then((m) => m.AppComponent)
  },
  {
    path: 'admin',
    loadComponent: () => import('./components/admin-dashboard/admin-dashboard.component').then((m) => m.AdminDashboardComponent)
  },
  {
    path: 'r/:code',
    loadComponent: () => import('./app').then((m) => m.AppComponent)
  },
  {
    path: 'salon/:code',
    loadComponent: () => import('./app').then((m) => m.AppComponent)
  },
  { path: '**', redirectTo: '' }
];

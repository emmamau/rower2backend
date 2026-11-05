import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', children: [] },
  { path: 'r/:code', children: [] },
  { path: 'salon/:code', children: [] },
  { path: '**', redirectTo: '' }
];

import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'trades',
    loadComponent: () =>
      import('./pages/trades/trades').then((m) => m.TradesComponent),
  },
  {
    path: 'journal',
    loadComponent: () =>
      import('./pages/journal/journal').then((m) => m.JournalComponent),
  },
  {
    path: 'watchlist',
    loadComponent: () =>
      import('./pages/watchlist/watchlist').then((m) => m.WatchlistComponent),
  },
];

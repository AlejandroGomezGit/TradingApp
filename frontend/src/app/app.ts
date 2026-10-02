import { Component, signal, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatChipsModule } from '@angular/material/chips';
import { ApiService, MarketClock } from './services/api';
import { SocketService } from './services/socket';
import { interval } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, CommonModule,
    MatSidenavModule, MatToolbarModule, MatListModule,
    MatIconModule, MatButtonModule, MatBadgeModule, MatChipsModule,
  ],
  template: `
    <mat-sidenav-container class="sidenav-container">
      <mat-sidenav mode="side" opened class="sidenav">
        <div class="brand">
          <mat-icon>smart_toy</mat-icon>
          <span>Trading Agent</span>
        </div>

        <div class="market-status" [class.open]="clock()?.is_open">
          <span class="dot"></span>
          {{ clock()?.is_open ? 'Mercado Abierto' : 'Mercado Cerrado' }}
        </div>

        <mat-nav-list>
          <a mat-list-item routerLink="/dashboard" routerLinkActive="active-link">
            <mat-icon matListItemIcon>dashboard</mat-icon>
            <span matListItemTitle>Dashboard</span>
          </a>
          <a mat-list-item routerLink="/trades" routerLinkActive="active-link">
            <mat-icon matListItemIcon>swap_horiz</mat-icon>
            <span matListItemTitle>Operaciones</span>
          </a>
          <a mat-list-item routerLink="/journal" routerLinkActive="active-link">
            <mat-icon matListItemIcon>menu_book</mat-icon>
            <span matListItemTitle>Diario</span>
          </a>
          <a mat-list-item routerLink="/watchlist" routerLinkActive="active-link">
            <mat-icon matListItemIcon>playlist_add_check</mat-icon>
            <span matListItemTitle>Watchlist</span>
          </a>
        </mat-nav-list>

        <div class="sidenav-footer">
          <div class="connection-dot" [class.connected]="wsConnected()"></div>
          {{ wsConnected() ? 'Tiempo real' : 'Desconectado' }}
        </div>
      </mat-sidenav>

      <mat-sidenav-content class="content">
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .sidenav-container { height: 100vh; }

    .sidenav {
      width: 220px;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      flex-direction: column;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 20px 16px;
      font-size: 17px;
      font-weight: 700;
      color: #60a5fa;
      border-bottom: 1px solid #1e293b;
      mat-icon { color: #60a5fa; }
    }

    .market-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      font-size: 12px;
      color: #94a3b8;
      .dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #dc2626;
      }
      &.open .dot { background: #16a34a; }
      &.open { color: #86efac; }
    }

    mat-nav-list {
      flex: 1;
      padding-top: 8px;
    }

    a[mat-list-item] {
      color: #94a3b8 !important;
      border-radius: 8px;
      margin: 2px 8px;
      mat-icon { color: #64748b; }
      &:hover { background: #1e293b !important; color: #e2e8f0 !important; }
    }

    .active-link {
      background: #1e40af !important;
      color: #bfdbfe !important;
      mat-icon { color: #93c5fd !important; }
    }

    .sidenav-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      font-size: 11px;
      color: #64748b;
      border-top: 1px solid #1e293b;
    }

    .connection-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #dc2626;
      &.connected { background: #16a34a; }
    }

    .content { background: #f1f5f9; }
  `],
})
export class App implements OnInit {
  clock = signal<MarketClock | null>(null);
  wsConnected = signal(false);

  constructor(private api: ApiService, private socketService: SocketService) {}

  ngOnInit(): void {
    this.fetchClock();
    interval(60000).subscribe(() => this.fetchClock());
    this.wsConnected.set(this.socketService.connected);
    this.socketService.on('connect').subscribe(() => this.wsConnected.set(true));
    this.socketService.on('disconnect').subscribe(() => this.wsConnected.set(false));
  }

  private fetchClock(): void {
    this.api.getMarketClock().subscribe({
      next: (clock) => this.clock.set(clock),
      error: () => {},
    });
  }
}

import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { ApiService, Trade } from '../../services/api';

@Component({
  selector: 'app-trades',
  standalone: true,
  imports: [
    CommonModule, CurrencyPipe, DatePipe,
    MatCardModule, MatTableModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule, MatButtonModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1>Operaciones</h1>
          <p class="subtitle">Historial de trades ejecutados por el agente</p>
        </div>
        <button mat-icon-button (click)="loadTrades()"><mat-icon>refresh</mat-icon></button>
      </div>

      @if (loading()) {
        <div class="loading-center"><mat-spinner diameter="48"></mat-spinner></div>
      } @else {
        <div class="stats-row">
          <mat-card class="stat-card">
            <mat-icon class="stat-icon blue">arrow_upward</mat-icon>
            <div class="stat-val">{{ stats()['total_buys'] || 0 }}</div>
            <div class="stat-label">Compras</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon red">arrow_downward</mat-icon>
            <div class="stat-val">{{ stats()['total_sells'] || 0 }}</div>
            <div class="stat-label">Ventas</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon green">check_circle</mat-icon>
            <div class="stat-val">{{ stats()['filled_orders'] || 0 }}</div>
            <div class="stat-label">Ejecutadas</div>
          </mat-card>
          <mat-card class="stat-card">
            <mat-icon class="stat-icon orange">cancel</mat-icon>
            <div class="stat-val">{{ stats()['cancelled_orders'] || 0 }}</div>
            <div class="stat-label">Canceladas</div>
          </mat-card>
        </div>

        <mat-card>
          <mat-card-header>
            <mat-card-title>Historial de Órdenes</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (trades().length === 0) {
              <div class="empty-state">
                <mat-icon>swap_horiz</mat-icon>
                <p>No hay operaciones registradas aún</p>
              </div>
            } @else {
              <table mat-table [dataSource]="trades()" class="full-width">
                <ng-container matColumnDef="date">
                  <th mat-header-cell *matHeaderCellDef>Fecha</th>
                  <td mat-cell *matCellDef="let t">{{ t.created_at | date:'short' }}</td>
                </ng-container>
                <ng-container matColumnDef="symbol">
                  <th mat-header-cell *matHeaderCellDef>Symbol</th>
                  <td mat-cell *matCellDef="let t"><strong>{{ t.symbol }}</strong></td>
                </ng-container>
                <ng-container matColumnDef="side">
                  <th mat-header-cell *matHeaderCellDef>Tipo</th>
                  <td mat-cell *matCellDef="let t">
                    <span class="side-badge" [class.buy]="t.side === 'buy'" [class.sell]="t.side === 'sell'">
                      {{ t.side === 'buy' ? 'COMPRA' : 'VENTA' }}
                    </span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="qty">
                  <th mat-header-cell *matHeaderCellDef>Cantidad</th>
                  <td mat-cell *matCellDef="let t">{{ t.qty }}</td>
                </ng-container>
                <ng-container matColumnDef="limit_price">
                  <th mat-header-cell *matHeaderCellDef>Precio Límite</th>
                  <td mat-cell *matCellDef="let t">{{ t.limit_price | currency }}</td>
                </ng-container>
                <ng-container matColumnDef="filled_price">
                  <th mat-header-cell *matHeaderCellDef>Precio Ejecución</th>
                  <td mat-cell *matCellDef="let t">{{ t.filled_price ? (t.filled_price | currency) : '—' }}</td>
                </ng-container>
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Estado</th>
                  <td mat-cell *matCellDef="let t">
                    <span class="status-chip status-{{ t.status }}">{{ t.status }}</span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="reasoning">
                  <th mat-header-cell *matHeaderCellDef>Razonamiento</th>
                  <td mat-cell *matCellDef="let t" class="reasoning-cell">{{ t.reasoning }}</td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns;"></tr>
              </table>
            }
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 26px; font-weight: 700; color: #0f172a; }
    .subtitle { margin: 4px 0 0; color: #64748b; }
    .loading-center { display: flex; justify-content: center; padding: 80px; }

    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
    .stat-card { padding: 16px; border-radius: 12px !important; display: flex; flex-direction: column; gap: 4px; }
    .stat-icon { font-size: 24px; width: 24px; height: 24px; }
    .stat-icon.blue { color: #3b82f6; } .stat-icon.red { color: #dc2626; }
    .stat-icon.green { color: #16a34a; } .stat-icon.orange { color: #f59e0b; }
    .stat-val { font-size: 28px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 12px; color: #64748b; }

    .full-width { width: 100%; }
    .side-badge { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; }
    .side-badge.buy { background: #dcfce7; color: #15803d; }
    .side-badge.sell { background: #fee2e2; color: #dc2626; }

    .status-chip { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .status-filled { background: #dcfce7; color: #15803d; }
    .status-pending { background: #fef9c3; color: #ca8a04; }
    .status-cancelled { background: #f1f5f9; color: #64748b; }
    .status-rejected { background: #fee2e2; color: #dc2626; }
    .reasoning-cell { font-size: 12px; color: #64748b; max-width: 300px; }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #94a3b8;
      mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; }
    }
  `],
})
export class TradesComponent implements OnInit {
  trades = signal<Trade[]>([]);
  stats = signal<Record<string, number>>({});
  loading = signal(true);
  columns = ['date', 'symbol', 'side', 'qty', 'limit_price', 'filled_price', 'status', 'reasoning'];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadTrades();
  }

  loadTrades(): void {
    this.loading.set(true);
    this.api.getTrades(100).subscribe({
      next: (trades) => {
        this.trades.set(trades);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getTradeStats().subscribe({
      next: (stats) => this.stats.set(stats),
      error: () => {},
    });
  }
}

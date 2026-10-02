import {
  Component, OnInit, OnDestroy, signal, computed,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Chart, registerables } from 'chart.js';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, Account, Position, PortfolioSnapshot, Heartbeat } from '../../services/api';
import { SocketService } from '../../services/socket';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, CurrencyPipe, DatePipe, DecimalPipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatTableModule, MatChipsModule,
    MatTooltipModule, MatSnackBarModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <p class="subtitle">Portfolio en tiempo real</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="triggerResearch()">
            <mat-icon>search</mat-icon> Research
          </button>
          <button mat-flat-button color="primary" (click)="triggerTrading()">
            <mat-icon>bolt</mat-icon> Tradear
          </button>
          <button mat-stroked-button (click)="triggerJournal()">
            <mat-icon>edit_note</mat-icon> Diario
          </button>
          <button mat-icon-button (click)="loadData()" matTooltip="Refrescar">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="48"></mat-spinner>
        </div>
      } @else {
        <div class="kpi-grid">
          <mat-card class="kpi-card">
            <mat-icon class="kpi-icon blue">account_balance_wallet</mat-icon>
            <div class="kpi-value">{{ account()?.portfolio_value | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="kpi-label">Portfolio Total</div>
          </mat-card>
          <mat-card class="kpi-card">
            <mat-icon class="kpi-icon green">payments</mat-icon>
            <div class="kpi-value">{{ account()?.cash | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="kpi-label">Cash Disponible</div>
          </mat-card>
          <mat-card class="kpi-card">
            <mat-icon class="kpi-icon"
              [class.green]="dailyPnl() >= 0"
              [class.red]="dailyPnl() < 0">
              {{ dailyPnl() >= 0 ? 'trending_up' : 'trending_down' }}
            </mat-icon>
            <div class="kpi-value"
              [class.text-green]="dailyPnl() >= 0"
              [class.text-red]="dailyPnl() < 0">
              {{ dailyPnl() >= 0 ? '+' : '' }}{{ dailyPnl() | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="kpi-label">P&amp;L del Día</div>
          </mat-card>
          <mat-card class="kpi-card">
            <mat-icon class="kpi-icon purple">donut_small</mat-icon>
            <div class="kpi-value">{{ positions().length }}</div>
            <div class="kpi-label">Posiciones Abiertas</div>
          </mat-card>
        </div>

        <mat-card class="chart-card">
          <mat-card-header>
            <mat-card-title>Evolución del Portfolio (30 días)</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="chart-wrapper">
              <canvas id="portfolioChart"></canvas>
            </div>
          </mat-card-content>
        </mat-card>

        <div class="bottom-grid">
          <mat-card>
            <mat-card-header>
              <mat-card-title>Posiciones Abiertas</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @if (positions().length === 0) {
                <div class="empty-state">
                  <mat-icon>inbox</mat-icon>
                  <p>Sin posiciones abiertas</p>
                </div>
              } @else {
                <table mat-table [dataSource]="positions()" class="full-width">
                  <ng-container matColumnDef="symbol">
                    <th mat-header-cell *matHeaderCellDef>Symbol</th>
                    <td mat-cell *matCellDef="let p"><strong>{{ p.symbol }}</strong></td>
                  </ng-container>
                  <ng-container matColumnDef="qty">
                    <th mat-header-cell *matHeaderCellDef>Cantidad</th>
                    <td mat-cell *matCellDef="let p">{{ p.qty }}</td>
                  </ng-container>
                  <ng-container matColumnDef="avg_price">
                    <th mat-header-cell *matHeaderCellDef>Entrada</th>
                    <td mat-cell *matCellDef="let p">{{ p.avg_entry_price | currency }}</td>
                  </ng-container>
                  <ng-container matColumnDef="current_price">
                    <th mat-header-cell *matHeaderCellDef>Actual</th>
                    <td mat-cell *matCellDef="let p">{{ p.current_price | currency }}</td>
                  </ng-container>
                  <ng-container matColumnDef="market_value">
                    <th mat-header-cell *matHeaderCellDef>Valor</th>
                    <td mat-cell *matCellDef="let p">{{ p.market_value | currency }}</td>
                  </ng-container>
                  <ng-container matColumnDef="pnl">
                    <th mat-header-cell *matHeaderCellDef>P&amp;L</th>
                    <td mat-cell *matCellDef="let p"
                        [class.text-green]="p.unrealized_pl >= 0"
                        [class.text-red]="p.unrealized_pl < 0">
                      {{ p.unrealized_pl >= 0 ? '+' : '' }}{{ p.unrealized_pl | currency }}
                      ({{ p.unrealized_plpc * 100 | number:'1.2-2' }}%)
                    </td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="positionColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: positionColumns;"></tr>
                </table>
              }
            </mat-card-content>
          </mat-card>

          <mat-card>
            <mat-card-header>
              <mat-card-title>Actividad del Agente</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @for (hb of heartbeats().slice(0, 8); track hb.id) {
                <div class="heartbeat-item">
                  <mat-icon class="hb-icon"
                    [class.hb-ok]="hb.status === 'completed'"
                    [class.hb-err]="hb.status === 'failed'"
                    [class.hb-run]="hb.status === 'started'">
                    {{ hb.status === 'completed' ? 'check_circle' : hb.status === 'failed' ? 'error' : 'pending' }}
                  </mat-icon>
                  <div class="hb-info">
                    <div class="hb-routine">{{ hb.routine }}</div>
                    <div class="hb-time">{{ hb.created_at | date:'short' }}</div>
                  </div>
                  <span class="status-chip status-{{ hb.status }}">{{ hb.status }}</span>
                </div>
              }
              @if (heartbeats().length === 0) {
                <div class="empty-state">
                  <mat-icon>sensors</mat-icon>
                  <p>Sin actividad reciente</p>
                </div>
              }
            </mat-card-content>
          </mat-card>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 26px; font-weight: 700; color: #0f172a; }
    .subtitle { margin: 4px 0 0; color: #64748b; }
    .actions { display: flex; gap: 8px; align-items: center; }
    .loading-center { display: flex; justify-content: center; padding: 80px; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
    mat-card.kpi-card { padding: 20px; border-radius: 12px !important; }
    .kpi-icon { font-size: 28px; width: 28px; height: 28px; margin-bottom: 8px; }
    .kpi-icon.blue { color: #3b82f6; }
    .kpi-icon.green { color: #16a34a; }
    .kpi-icon.red { color: #dc2626; }
    .kpi-icon.purple { color: #7c3aed; }
    .kpi-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .kpi-label { font-size: 13px; color: #64748b; margin-top: 4px; }
    .text-green { color: #16a34a !important; }
    .text-red { color: #dc2626 !important; }

    .chart-card { margin-bottom: 20px; border-radius: 12px !important; }
    .chart-wrapper { height: 240px; padding: 8px 0; }

    .bottom-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
    .full-width { width: 100%; }

    .heartbeat-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .hb-icon { font-size: 20px; width: 20px; height: 20px; color: #94a3b8; }
    .hb-icon.hb-ok { color: #16a34a; }
    .hb-icon.hb-err { color: #dc2626; }
    .hb-icon.hb-run { color: #f59e0b; }
    .hb-info { flex: 1; }
    .hb-routine { font-weight: 600; font-size: 13px; text-transform: capitalize; }
    .hb-time { font-size: 11px; color: #94a3b8; }
    .status-chip { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .status-completed { background: #dcfce7; color: #15803d; }
    .status-failed { background: #fee2e2; color: #dc2626; }
    .status-started { background: #fef9c3; color: #ca8a04; }
    .status-skipped { background: #f1f5f9; color: #64748b; }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 32px; color: #94a3b8;
      mat-icon { font-size: 40px; width: 40px; height: 40px; margin-bottom: 8px; }
      p { margin: 0; }
    }
  `],
})
export class DashboardComponent implements OnInit, OnDestroy {
  account = signal<Account | null>(null);
  positions = signal<Position[]>([]);
  history = signal<PortfolioSnapshot[]>([]);
  heartbeats = signal<Heartbeat[]>([]);
  loading = signal(true);
  positionColumns = ['symbol', 'qty', 'avg_price', 'current_price', 'market_value', 'pnl'];
  private destroy$ = new Subject<void>();
  private chart: Chart | null = null;

  dailyPnl = computed(() => {
    const h = this.history();
    return h.length > 0 ? (h[h.length - 1].daily_pnl ?? 0) : 0;
  });

  constructor(
    private api: ApiService,
    private socketService: SocketService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.socketService.on('portfolio:update').pipe(takeUntil(this.destroy$)).subscribe(() => this.loadData());
    this.socketService.on('trading:complete').pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.snackBar.open('Sesión de trading completada', 'OK', { duration: 3000 });
      this.loadData();
    });
  }

  loadData(): void {
    this.loading.set(true);
    forkJoin({
      account: this.api.getAccount(),
      positions: this.api.getPositions(),
      history: this.api.getPortfolioHistory(30),
      heartbeats: this.api.getHeartbeats(),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ account, positions, history, heartbeats }) => {
        this.account.set(account);
        this.positions.set(positions);
        this.history.set(history);
        this.heartbeats.set(heartbeats);
        this.loading.set(false);
        setTimeout(() => this.buildChart(), 50);
      },
      error: () => this.loading.set(false),
    });
  }

  private buildChart(): void {
    const ctx = document.getElementById('portfolioChart') as HTMLCanvasElement;
    if (!ctx) return;
    if (this.chart) this.chart.destroy();
    const data = this.history();
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((d) =>
          new Date(d.date).toLocaleDateString('es-CO', { month: 'short', day: 'numeric' })
        ),
        datasets: [{
          label: 'Portfolio',
          data: data.map((d) => d.portfolio_value),
          fill: true,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          tension: 0.4,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: (v) => `$${Number(v).toLocaleString()}` }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  triggerResearch(): void {
    this.api.triggerResearch().subscribe({
      next: () => this.snackBar.open('Research iniciado', 'OK', { duration: 2000 }),
      error: () => this.snackBar.open('Error al iniciar research', 'OK', { duration: 2000 }),
    });
  }

  triggerTrading(): void {
    this.api.triggerTrading().subscribe({
      next: () => this.snackBar.open('Sesión de trading iniciada', 'OK', { duration: 2000 }),
      error: () => this.snackBar.open('Error al iniciar trading', 'OK', { duration: 2000 }),
    });
  }

  triggerJournal(): void {
    this.api.triggerJournal().subscribe({
      next: () => this.snackBar.open('Diario generado', 'OK', { duration: 2000 }),
      error: () => this.snackBar.open('Error al generar diario', 'OK', { duration: 2000 }),
    });
  }

  ngOnDestroy(): void {
    if (this.chart) this.chart.destroy();
    this.destroy$.next();
    this.destroy$.complete();
  }
}

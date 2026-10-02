import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';
import { ApiService, WatchlistItem } from '../../services/api';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatCardModule, MatTableModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    MatSlideToggleModule, MatSnackBarModule, MatDialogModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1>Watchlist</h1>
          <p class="subtitle">Símbolos que monitorea el agente</p>
        </div>
        <button mat-icon-button (click)="loadWatchlist()"><mat-icon>refresh</mat-icon></button>
      </div>

      <div class="layout">
        <mat-card class="add-card">
          <mat-card-header>
            <mat-card-title>Agregar Símbolo</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <form [formGroup]="addForm" (ngSubmit)="addSymbol()">
              <mat-form-field appearance="outline" class="full-field">
                <mat-label>Símbolo (ej: TSLA)</mat-label>
                <input matInput formControlName="symbol" placeholder="TSLA" maxlength="10">
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-field">
                <mat-label>Descripción</mat-label>
                <input matInput formControlName="description" placeholder="Tesla Inc.">
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-field">
                <mat-label>Máx. Asignación (%)</mat-label>
                <input matInput type="number" formControlName="max_allocation_pct" min="1" max="25">
              </mat-form-field>
              <button mat-flat-button color="primary" type="submit"
                [disabled]="addForm.invalid || saving()">
                @if (saving()) {
                  <mat-spinner diameter="18"></mat-spinner>
                } @else {
                  <ng-container><mat-icon>add</mat-icon> Agregar</ng-container>
                }
              </button>
            </form>
          </mat-card-content>
        </mat-card>

        <mat-card class="list-card">
          <mat-card-header>
            <mat-card-title>Símbolos Monitoreados</mat-card-title>
            <mat-card-subtitle>Total asignación máx: {{ totalAllocation() }}%</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            @if (loading()) {
              <div class="loading-center"><mat-spinner diameter="40"></mat-spinner></div>
            } @else if (watchlist().length === 0) {
              <div class="empty-state">
                <mat-icon>playlist_add</mat-icon>
                <p>Lista vacía — agrega tu primer símbolo</p>
              </div>
            } @else {
              <table mat-table [dataSource]="watchlist()" class="full-width">
                <ng-container matColumnDef="symbol">
                  <th mat-header-cell *matHeaderCellDef>Symbol</th>
                  <td mat-cell *matCellDef="let item"><strong>{{ item.symbol }}</strong></td>
                </ng-container>
                <ng-container matColumnDef="description">
                  <th mat-header-cell *matHeaderCellDef>Descripción</th>
                  <td mat-cell *matCellDef="let item" class="desc-cell">{{ item.description }}</td>
                </ng-container>
                <ng-container matColumnDef="max_allocation_pct">
                  <th mat-header-cell *matHeaderCellDef>Máx. %</th>
                  <td mat-cell *matCellDef="let item">
                    <div class="alloc-bar-wrapper">
                      <span>{{ item.max_allocation_pct }}%</span>
                      <div class="alloc-bar">
                        <div class="alloc-fill" [style.width.%]="item.max_allocation_pct * 4"></div>
                      </div>
                    </div>
                  </td>
                </ng-container>
                <ng-container matColumnDef="active">
                  <th mat-header-cell *matHeaderCellDef>Activo</th>
                  <td mat-cell *matCellDef="let item">
                    <mat-slide-toggle
                      [checked]="item.active"
                      (change)="toggleActive(item, $event.checked)">
                    </mat-slide-toggle>
                  </td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let item">
                    <button mat-icon-button color="warn" (click)="deleteItem(item)" matTooltip="Eliminar">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns;"
                    [class.inactive-row]="!row.active"></tr>
              </table>
            }
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 26px; font-weight: 700; color: #0f172a; }
    .subtitle { margin: 4px 0 0; color: #64748b; }

    .layout { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
    .add-card, .list-card { border-radius: 12px !important; }
    .full-field { width: 100%; margin-bottom: 12px; }
    .full-width { width: 100%; }

    .loading-center { display: flex; justify-content: center; padding: 40px; }
    .desc-cell { font-size: 13px; color: #64748b; max-width: 250px; }

    .alloc-bar-wrapper { display: flex; align-items: center; gap: 8px; }
    .alloc-bar { flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
    .alloc-fill { height: 100%; background: #3b82f6; border-radius: 3px; }

    .inactive-row { opacity: 0.45; }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: #94a3b8;
      mat-icon { font-size: 40px; width: 40px; height: 40px; margin-bottom: 8px; }
    }
  `],
})
export class WatchlistComponent implements OnInit {
  watchlist = signal<WatchlistItem[]>([]);
  loading = signal(true);
  saving = signal(false);
  columns = ['symbol', 'description', 'max_allocation_pct', 'active', 'actions'];

  totalAllocation = () =>
    this.watchlist()
      .filter((w) => w.active)
      .reduce((sum, w) => sum + w.max_allocation_pct, 0);

  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private snackBar = inject(MatSnackBar);

  addForm = this.fb.group({
    symbol: ['', [Validators.required, Validators.maxLength(10)]],
    description: [''],
    max_allocation_pct: [5, [Validators.required, Validators.min(1), Validators.max(25)]],
  });

  ngOnInit(): void {
    this.loadWatchlist();
  }

  loadWatchlist(): void {
    this.loading.set(true);
    this.api.getWatchlist().subscribe({
      next: (items) => { this.watchlist.set(items); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  addSymbol(): void {
    if (this.addForm.invalid) return;
    this.saving.set(true);
    const value = this.addForm.value;
    this.api.addToWatchlist({
      symbol: (value.symbol ?? '').toUpperCase(),
      description: value.description ?? '',
      max_allocation_pct: value.max_allocation_pct ?? 5,
    }).subscribe({
      next: () => {
        this.snackBar.open('Símbolo agregado', 'OK', { duration: 2000 });
        this.addForm.reset({ max_allocation_pct: 5 });
        this.saving.set(false);
        this.loadWatchlist();
      },
      error: () => {
        this.snackBar.open('Error — ¿ya existe este símbolo?', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
    });
  }

  toggleActive(item: WatchlistItem, active: boolean): void {
    this.api.updateWatchlistItem(item.id, { active }).subscribe({
      next: (updated) => {
        this.watchlist.update((list) =>
          list.map((w) => (w.id === updated.id ? updated : w))
        );
      },
      error: () => this.snackBar.open('Error al actualizar', 'OK', { duration: 2000 }),
    });
  }

  deleteItem(item: WatchlistItem): void {
    if (!confirm(`¿Eliminar ${item.symbol} del watchlist?`)) return;
    this.api.deleteFromWatchlist(item.id).subscribe({
      next: () => {
        this.watchlist.update((list) => list.filter((w) => w.id !== item.id));
        this.snackBar.open('Símbolo eliminado', 'OK', { duration: 2000 });
      },
      error: () => this.snackBar.open('Error al eliminar', 'OK', { duration: 2000 }),
    });
  }
}

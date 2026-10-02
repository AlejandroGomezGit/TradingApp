import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Account {
  cash: number;
  portfolio_value: number;
  equity: number;
  buying_power: number;
  currency: string;
}

export interface Position {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  side: string;
}

export interface Trade {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  limit_price: number;
  filled_price: number | null;
  status: string;
  alpaca_order_id: string;
  reasoning: string;
  created_at: string;
}

export interface JournalEntry {
  id: number;
  date: string;
  portfolio_value: number;
  cash: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  research_summary: string;
  trades_summary: string;
  reflection: string;
  created_at: string;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  description: string;
  max_allocation_pct: number;
  active: boolean;
}

export interface PortfolioSnapshot {
  date: string;
  portfolio_value: number;
  cash: number;
  equity: number;
  daily_pnl: number;
}

export interface MarketClock {
  is_open: boolean;
  next_open: string;
  next_close: string;
  timestamp: string;
}

export interface Heartbeat {
  id: number;
  routine: string;
  status: string;
  message: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  getAccount(): Observable<Account> {
    return this.http.get<Account>(`${this.base}/portfolio/account`);
  }

  getPositions(): Observable<Position[]> {
    return this.http.get<Position[]>(`${this.base}/portfolio/positions`);
  }

  getMarketClock(): Observable<MarketClock> {
    return this.http.get<MarketClock>(`${this.base}/portfolio/clock`);
  }

  getPortfolioHistory(days = 30): Observable<PortfolioSnapshot[]> {
    return this.http.get<PortfolioSnapshot[]>(`${this.base}/portfolio/history?days=${days}`);
  }

  getHeartbeats(): Observable<Heartbeat[]> {
    return this.http.get<Heartbeat[]>(`${this.base}/portfolio/heartbeats`);
  }

  getTrades(limit = 50): Observable<Trade[]> {
    return this.http.get<Trade[]>(`${this.base}/trades?limit=${limit}`);
  }

  getTradeStats(): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(`${this.base}/trades/stats`);
  }

  getJournalEntries(limit = 30): Observable<JournalEntry[]> {
    return this.http.get<JournalEntry[]>(`${this.base}/journal?limit=${limit}`);
  }

  getJournalEntry(date: string): Observable<JournalEntry> {
    return this.http.get<JournalEntry>(`${this.base}/journal/${date}`);
  }

  getWatchlist(): Observable<WatchlistItem[]> {
    return this.http.get<WatchlistItem[]>(`${this.base}/watchlist`);
  }

  addToWatchlist(item: Partial<WatchlistItem>): Observable<WatchlistItem> {
    return this.http.post<WatchlistItem>(`${this.base}/watchlist`, item);
  }

  updateWatchlistItem(id: number, item: Partial<WatchlistItem>): Observable<WatchlistItem> {
    return this.http.patch<WatchlistItem>(`${this.base}/watchlist/${id}`, item);
  }

  deleteFromWatchlist(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/watchlist/${id}`);
  }

  triggerResearch(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/agent/research`, {});
  }

  triggerTrading(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/agent/trade`, {});
  }

  triggerJournal(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/agent/journal`, {});
  }
}

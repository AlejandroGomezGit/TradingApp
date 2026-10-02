/**
 * Backtesting Engine — Fase 1
 *
 * Simula la estrategia composite sobre datos históricos OHLCV.
 * Sin órdenes reales. Aplica todas las reglas de riesgo en simulación.
 */

import { Bar } from '../types';

export interface BacktestConfig {
  initialCapital: number;
  maxPositionPct: number;       // e.g. 0.02 = 2%
  stopLossPct: number;          // e.g. 0.04 = 4%
  emergencyStopPct: number;     // e.g. 0.06 = 6%
  trailingTriggerPct: number;   // e.g. 0.03 = 3%
  trailingStopPct: number;      // e.g. 0.03 = 3%
  maxOpenPositions: number;
  minConfidence: number;        // e.g. 0.65
  slippage: number;             // e.g. 0.001 = 0.1% per trade
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100_000,
  maxPositionPct: 0.02,
  stopLossPct: 0.04,
  emergencyStopPct: 0.06,
  trailingTriggerPct: 0.03,
  trailingStopPct: 0.03,
  maxOpenPositions: 3,
  minConfidence: 0.65,
  slippage: 0.001,
};

export interface BacktestPosition {
  symbol: string;
  entryPrice: number;
  qty: number;
  entryDate: string;
  peakPrice: number;
  stopLossPrice: number;
}

export type SignalAction = 'buy' | 'sell' | 'hold';

export interface Signal {
  date: string;
  symbol: string;
  action: SignalAction;
  confidence: number;
  price: number;
  reasoning: string;
}

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  exitReason: 'signal' | 'stop_loss' | 'emergency_stop' | 'trailing_stop' | 'end_of_data';
}

export interface EquityCurvePoint {
  date: string;
  equity: number;
  cash: number;
  positionsValue: number;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private cash: number;
  private positions: Map<string, BacktestPosition>;
  private trades: BacktestTrade[];
  private equityCurve: EquityCurvePoint[];

  constructor(config: Partial<BacktestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cash = this.config.initialCapital;
    this.positions = new Map();
    this.trades = [];
    this.equityCurve = [];
  }

  /**
   * Process a single signal on a given date.
   * Returns the trade executed (if any).
   */
  processSignal(signal: Signal, currentBar: Bar): BacktestTrade | null {
    const { symbol, action, confidence, price } = signal;
    const date = signal.date;

    if (confidence < this.config.minConfidence && action !== 'sell') return null;

    if (action === 'buy') {
      return this.executeBuy(symbol, date, price, currentBar);
    } else if (action === 'sell') {
      return this.executeSell(symbol, date, price, 'signal');
    }

    return null;
  }

  /**
   * Check all open positions for stop-loss / trailing-stop exits.
   * Call this on every bar (before processing signals).
   */
  checkExits(date: string, prices: Record<string, number>): BacktestTrade[] {
    const exits: BacktestTrade[] = [];

    for (const [symbol, pos] of this.positions.entries()) {
      const price = prices[symbol];
      if (price === undefined) continue;

      // Update peak price for trailing stop
      if (price > pos.peakPrice) {
        pos.peakPrice = price;
      }

      const pnlPct = (price - pos.entryPrice) / pos.entryPrice;
      const dropFromPeak = (pos.peakPrice - price) / pos.peakPrice;

      // Emergency stop: -6%
      if (pnlPct <= -this.config.emergencyStopPct) {
        const trade = this.executeSell(symbol, date, price, 'emergency_stop');
        if (trade) exits.push(trade);
        continue;
      }

      // Hard stop-loss: -4%
      if (pnlPct <= -this.config.stopLossPct) {
        const trade = this.executeSell(symbol, date, price, 'stop_loss');
        if (trade) exits.push(trade);
        continue;
      }

      // Trailing stop: trigger at +3%, trail -3% from peak
      if (pnlPct >= this.config.trailingTriggerPct && dropFromPeak >= this.config.trailingStopPct) {
        const trade = this.executeSell(symbol, date, price, 'trailing_stop');
        if (trade) exits.push(trade);
        continue;
      }
    }

    return exits;
  }

  /**
   * Close all remaining positions at end of backtest.
   */
  closeAll(date: string, prices: Record<string, number>): BacktestTrade[] {
    const exits: BacktestTrade[] = [];
    for (const [symbol] of this.positions.entries()) {
      const price = prices[symbol];
      if (price === undefined) continue;
      const trade = this.executeSell(symbol, date, price, 'end_of_data');
      if (trade) exits.push(trade);
    }
    return exits;
  }

  /**
   * Record equity curve snapshot for a given date.
   */
  recordEquity(date: string, prices: Record<string, number>): void {
    let positionsValue = 0;
    for (const [symbol, pos] of this.positions.entries()) {
      const price = prices[symbol] ?? pos.entryPrice;
      positionsValue += pos.qty * price;
    }
    this.equityCurve.push({
      date,
      equity: this.cash + positionsValue,
      cash: this.cash,
      positionsValue,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private executeBuy(
    symbol: string,
    date: string,
    price: number,
    bar: Bar,
  ): BacktestTrade | null {
    // Max positions check
    if (this.positions.size >= this.config.maxOpenPositions) return null;
    if (this.positions.has(symbol)) return null;

    const portfolio = this.getPortfolioValue({});
    const maxValue = portfolio * this.config.maxPositionPct;
    const entryPrice = price * (1 + this.config.slippage); // simulate slippage
    const qty = Math.floor(maxValue / entryPrice);

    if (qty <= 0) return null;

    const cost = qty * entryPrice;
    if (cost > this.cash) return null;

    this.cash -= cost;
    const stopLossPrice = entryPrice * (1 - this.config.stopLossPct);

    this.positions.set(symbol, {
      symbol,
      entryPrice,
      qty,
      entryDate: date,
      peakPrice: entryPrice,
      stopLossPrice,
    });

    return null; // Buy trades are only recorded when closed
  }

  private executeSell(
    symbol: string,
    date: string,
    price: number,
    reason: BacktestTrade['exitReason'],
  ): BacktestTrade | null {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const exitPrice = price * (1 - this.config.slippage);
    const proceeds = pos.qty * exitPrice;
    this.cash += proceeds;

    const pnl = (exitPrice - pos.entryPrice) * pos.qty;
    const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;

    const trade: BacktestTrade = {
      symbol,
      entryDate: pos.entryDate,
      exitDate: date,
      entryPrice: pos.entryPrice,
      exitPrice,
      qty: pos.qty,
      pnl,
      pnlPct,
      exitReason: reason,
    };

    this.positions.delete(symbol);
    this.trades.push(trade);
    return trade;
  }

  private getPortfolioValue(prices: Record<string, number>): number {
    let value = this.cash;
    for (const [symbol, pos] of this.positions.entries()) {
      const price = prices[symbol] ?? pos.entryPrice;
      value += pos.qty * price;
    }
    return value;
  }

  // ─── Results ──────────────────────────────────────────────────────────────

  getResults(): {
    trades: BacktestTrade[];
    equityCurve: EquityCurvePoint[];
    openPositions: BacktestPosition[];
    finalCash: number;
  } {
    return {
      trades: this.trades,
      equityCurve: this.equityCurve,
      openPositions: Array.from(this.positions.values()),
      finalCash: this.cash,
    };
  }
}

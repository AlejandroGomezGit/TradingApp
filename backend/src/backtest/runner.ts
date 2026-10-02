/**
 * Backtest Runner — Fase 1
 *
 * Entry point: npx tsx src/backtest/runner.ts
 *
 * Descarga datos históricos de Alpaca, construye señales usando los mismos
 * indicadores que usa el bot en vivo, y calcula métricas de performance.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { alpacaService } from '../services/alpaca.service';
import { logger } from '../middleware/logger';
import { Bar } from '../types';
import { BacktestEngine, BacktestConfig, DEFAULT_CONFIG, Signal } from './engine';
import { calculateMetrics, printMetrics } from './metrics';

// ─── Symbols to backtest ────────────────────────────────────────────────────

const SYMBOLS: string[] = (process.env.DEFAULT_SYMBOLS || 'SPY,QQQ,NVDA')
  .split(',')
  .map((s) => s.trim());

const INITIAL_CAPITAL = parseFloat(process.env.BACKTEST_CAPITAL || '100000');
const LOOKBACK_DAYS = parseInt(process.env.BACKTEST_LOOKBACK || '365');

// ─── Technical indicator helpers (standalone, no DB) ─────────────────────────

function ema(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => 0);
  const k = 2 / (period + 1);
  const result: number[] = [];
  result.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function rsi(bars: Bar[], period = 14): number {
  if (bars.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const ch = bars[i].c - bars[i - 1].c;
    if (ch > 0) gains += ch; else losses += Math.abs(ch);
  }
  const rs = (gains / period) / (losses / period || 0.0001);
  return 100 - 100 / (1 + rs);
}

function macdHistogram(bars: Bar[]): number {
  if (bars.length < 35) return 0;
  const closes = bars.map((b) => b.c);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[ema12.length - ema26.length + i] - ema26[i]);
  }
  const signalLine = ema(macdLine, 9);
  const last = macdLine[macdLine.length - 1] ?? 0;
  const sig = signalLine[signalLine.length - 1] ?? 0;
  return last - sig;
}

function bollingerPercentB(bars: Bar[], period = 20): number {
  if (bars.length < period) return 0.5;
  const slice = bars.slice(-period);
  const mid = slice.reduce((s, b) => s + b.c, 0) / period;
  const std = Math.sqrt(slice.reduce((s, b) => s + Math.pow(b.c - mid, 2), 0) / period);
  const upper = mid + 2 * std;
  const lower = mid - 2 * std;
  const price = bars[bars.length - 1].c;
  return (price - lower) / (upper - lower);
}

function sma(bars: Bar[], period: number): number {
  if (bars.length < period) return 0;
  return bars.slice(-period).reduce((s, b) => s + b.c, 0) / period;
}

// ─── Signal generator ─────────────────────────────────────────────────────────

function generateSignal(symbol: string, bars: Bar[], date: string): Signal {
  const currentPrice = bars[bars.length - 1].c;
  const rsiValue = rsi(bars);
  const macdHist = macdHistogram(bars);
  const percentB = bollingerPercentB(bars);
  const sma20 = sma(bars, 20);
  const sma50 = sma(bars, 50);
  const closes = bars.map((b) => b.c);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema9v = ema9[ema9.length - 1] ?? 0;
  const ema21v = ema21[ema21.length - 1] ?? 0;

  // ── Composite scoring (same logic as live composite.ts) ──────────────────

  let buyScore = 0;
  let sellScore = 0;
  const reasons: string[] = [];

  // RSI
  if (rsiValue < 35) { buyScore += 0.3; reasons.push(`RSI oversold(${rsiValue.toFixed(0)})`); }
  else if (rsiValue > 70) { sellScore += 0.3; reasons.push(`RSI overbought(${rsiValue.toFixed(0)})`); }

  // MACD
  if (macdHist > 0) { buyScore += 0.25; reasons.push('MACD bullish'); }
  else { sellScore += 0.25; reasons.push('MACD bearish'); }

  // Bollinger
  if (percentB < 0.2 && rsiValue < 40) { buyScore += 0.2; reasons.push('BB lower band+oversold'); }
  if (percentB > 0.8) { sellScore += 0.2; reasons.push('BB upper band'); }

  // EMA crossover
  if (ema9v > ema21v) { buyScore += 0.15; reasons.push('EMA9>EMA21'); }
  else { sellScore += 0.1; }

  // SMA trend
  if (sma20 > sma50) { buyScore += 0.1; reasons.push('SMA20>SMA50'); }
  else { sellScore += 0.1; }

  const confidence = buyScore - sellScore;

  if (buyScore >= 0.65) {
    return { date, symbol, action: 'buy', confidence: buyScore, price: currentPrice, reasoning: reasons.join(', ') };
  }
  if (sellScore >= 0.55) {
    return { date, symbol, action: 'sell', confidence: sellScore, price: currentPrice, reasoning: reasons.join(', ') };
  }
  return { date, symbol, action: 'hold', confidence: Math.abs(confidence), price: currentPrice, reasoning: 'Mixed signals → hold' };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

async function runBacktest(): Promise<void> {
  console.log('\n🔍 Fetching historical data from Alpaca...');
  console.log(`   Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`   Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`   Capital: $${INITIAL_CAPITAL.toLocaleString()}\n`);

  // Fetch bars (Alpaca returns up to 10000 bars with '1Day' timeframe)
  const barsMap: Record<string, Bar[]> = {};
  for (const symbol of SYMBOLS) {
    try {
      const bars = await alpacaService.getBars(symbol, '1Day', LOOKBACK_DAYS);
      barsMap[symbol] = bars;
      console.log(`  ✓ ${symbol}: ${bars.length} bars`);
    } catch (e) {
      console.warn(`  ✗ ${symbol}: failed to fetch (${e})`);
      barsMap[symbol] = [];
    }
  }

  // Collect all trading dates (union of all symbols)
  const allDates = new Set<string>();
  for (const bars of Object.values(barsMap)) {
    for (const bar of bars) allDates.add(bar.t.split('T')[0]);
  }
  const sortedDates = Array.from(allDates).sort();

  console.log(`\n📊 Running simulation on ${sortedDates.length} trading days...`);

  const config: BacktestConfig = {
    ...DEFAULT_CONFIG,
    initialCapital: INITIAL_CAPITAL,
  };

  const engine = new BacktestEngine(config);

  // Need at least 35 bars of context to compute all indicators
  const MIN_BARS = 35;

  for (const date of sortedDates) {
    // Build current prices snapshot
    const prices: Record<string, number> = {};
    for (const [symbol, bars] of Object.entries(barsMap)) {
      const barForDate = bars.find((b) => b.t.startsWith(date));
      if (barForDate) prices[symbol] = barForDate.c;
    }

    // Check exits first (stop-loss, trailing)
    engine.checkExits(date, prices);

    // Generate signals for each symbol
    for (const symbol of SYMBOLS) {
      const bars = barsMap[symbol];
      const dateIdx = bars.findIndex((b) => b.t.startsWith(date));
      if (dateIdx < MIN_BARS) continue; // not enough history yet

      const barsUpToDate = bars.slice(0, dateIdx + 1);
      const signal = generateSignal(symbol, barsUpToDate, date);
      engine.processSignal(signal, bars[dateIdx]);
    }

    // Record equity
    engine.recordEquity(date, prices);
  }

  // Close all remaining positions
  const lastDate = sortedDates[sortedDates.length - 1];
  const lastPrices: Record<string, number> = {};
  for (const [symbol, bars] of Object.entries(barsMap)) {
    const last = bars[bars.length - 1];
    if (last) lastPrices[symbol] = last.c;
  }
  engine.closeAll(lastDate, lastPrices);

  // Final equity snapshot
  engine.recordEquity(lastDate + '_close', lastPrices);

  // ── Calculate and print metrics ──────────────────────────────────────────
  const { trades, equityCurve } = engine.getResults();
  const metrics = calculateMetrics(trades, equityCurve, INITIAL_CAPITAL);
  printMetrics(metrics);

  // Print individual trades
  if (trades.length > 0) {
    console.log('📋 Trade Log:');
    console.log('─'.repeat(100));
    console.log(
      'Symbol'.padEnd(10) +
      'Entry'.padEnd(12) + 'Exit'.padEnd(12) +
      'Entry$'.padEnd(10) + 'Exit$'.padEnd(10) +
      'Qty'.padEnd(8) + 'P&L'.padEnd(12) + 'Exit Reason'
    );
    console.log('─'.repeat(100));
    for (const t of trades) {
      const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
      console.log(
        t.symbol.padEnd(10) +
        t.entryDate.padEnd(12) + t.exitDate.padEnd(12) +
        `$${t.entryPrice.toFixed(2)}`.padEnd(10) +
        `$${t.exitPrice.toFixed(2)}`.padEnd(10) +
        String(t.qty).padEnd(8) +
        pnlStr.padEnd(12) +
        t.exitReason
      );
    }
    console.log('─'.repeat(100));
  }

  // ── Assessment ───────────────────────────────────────────────────────────
  console.log('\n🎯 Phase 1 Assessment:');
  const passThreshold = metrics.sharpeRatio >= 0.5 && metrics.winRate >= 0.45 && metrics.maxDrawdown >= -0.20;
  if (passThreshold) {
    console.log('  ✅ Strategy PASSES Fase 1 thresholds:');
    console.log('     Sharpe ≥ 0.5, Win Rate ≥ 45%, Max Drawdown ≤ -20%');
    console.log('  → Ready to proceed to Fase 2 (Paper Trading)');
  } else {
    console.log('  ⚠️  Strategy does NOT meet all thresholds:');
    if (metrics.sharpeRatio < 0.5) console.log(`     ✗ Sharpe: ${metrics.sharpeRatio} (need ≥ 0.5)`);
    if (metrics.winRate < 0.45) console.log(`     ✗ Win Rate: ${metrics.winRatePct} (need ≥ 45%)`);
    if (metrics.maxDrawdown < -0.20) console.log(`     ✗ Max Drawdown: ${metrics.maxDrawdownPct} (need ≥ -20%)`);
    console.log('  → Tune strategy parameters before proceeding to Fase 2');
  }
  console.log('');
}

runBacktest().catch((err) => {
  logger.error('Backtest failed', { error: err });
  console.error(err);
  process.exit(1);
});

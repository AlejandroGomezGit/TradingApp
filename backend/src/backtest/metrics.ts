/**
 * Backtest Metrics — Fase 1
 *
 * Calcula: Sharpe ratio, max drawdown, win rate, profit factor,
 * average trade duration, Calmar ratio, y más.
 */

import { BacktestTrade, EquityCurvePoint } from './engine';

export interface BacktestMetrics {
  // Core performance
  totalReturn: number;          // e.g. 0.15 = +15%
  totalReturnPct: string;       // formatted
  cagr: number | null;          // Compound Annual Growth Rate
  sharpeRatio: number;          // annualized, risk-free = 0
  calmarRatio: number | null;   // CAGR / maxDrawdown
  maxDrawdown: number;          // e.g. -0.12 = -12%
  maxDrawdownPct: string;

  // Trade stats
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;              // e.g. 0.60 = 60%
  winRatePct: string;
  profitFactor: number;         // gross wins / gross losses
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageTradeDurationDays: number;

  // Exit analysis
  exitsByReason: Record<BacktestTrade['exitReason'], number>;

  // P&L
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  initialCapital: number;
  finalEquity: number;
}

export function calculateMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityCurvePoint[],
  initialCapital: number,
): BacktestMetrics {
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  // ─── Trade-level stats ────────────────────────────────────────────────────
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl <= 0);
  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));

  const winRate = trades.length > 0 ? winners.length / trades.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const averageWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const averageLoss = losers.length > 0 ? -grossLoss / losers.length : 0;
  const largestWin = winners.length > 0 ? Math.max(...winners.map((t) => t.pnl)) : 0;
  const largestLoss = losers.length > 0 ? Math.min(...losers.map((t) => t.pnl)) : 0;

  // Average trade duration in days
  const durations = trades.map((t) => {
    const entry = new Date(t.entryDate).getTime();
    const exit = new Date(t.exitDate).getTime();
    return (exit - entry) / (1000 * 60 * 60 * 24);
  });
  const averageTradeDurationDays =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  // ─── Max drawdown ─────────────────────────────────────────────────────────
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = (point.equity - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  // ─── Sharpe ratio (annualized) ────────────────────────────────────────────
  // Daily returns from equity curve
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const curr = equityCurve[i].equity;
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }

  let sharpeRatio = 0;
  if (dailyReturns.length > 1) {
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    // Annualize: * sqrt(252)
    sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;
  }

  // ─── CAGR ────────────────────────────────────────────────────────────────
  let cagr: number | null = null;
  if (equityCurve.length >= 2) {
    const startDate = new Date(equityCurve[0].date);
    const endDate = new Date(equityCurve[equityCurve.length - 1].date);
    const years = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (years > 0) {
      cagr = Math.pow(finalEquity / initialCapital, 1 / years) - 1;
    }
  }

  // ─── Calmar ratio ─────────────────────────────────────────────────────────
  const calmarRatio = cagr !== null && maxDrawdown < 0 ? cagr / Math.abs(maxDrawdown) : null;

  // ─── Exit breakdown ───────────────────────────────────────────────────────
  const exitsByReason = trades.reduce(
    (acc, t) => {
      acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1;
      return acc;
    },
    {} as Record<BacktestTrade['exitReason'], number>
  );

  return {
    totalReturn,
    totalReturnPct: `${(totalReturn * 100).toFixed(2)}%`,
    cagr,
    sharpeRatio: parseFloat(sharpeRatio.toFixed(3)),
    calmarRatio: calmarRatio !== null ? parseFloat(calmarRatio.toFixed(3)) : null,
    maxDrawdown,
    maxDrawdownPct: `${(maxDrawdown * 100).toFixed(2)}%`,
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,
    winRatePct: `${(winRate * 100).toFixed(1)}%`,
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    averageWin,
    averageLoss,
    largestWin,
    largestLoss,
    averageTradeDurationDays: parseFloat(averageTradeDurationDays.toFixed(1)),
    exitsByReason,
    grossProfit,
    grossLoss,
    netProfit: grossProfit - grossLoss,
    initialCapital,
    finalEquity,
  };
}

export function printMetrics(metrics: BacktestMetrics): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  BACKTEST RESULTS — Fase 1');
  console.log('═'.repeat(60));
  console.log(`  Total Return:        ${metrics.totalReturnPct}`);
  if (metrics.cagr !== null) {
    console.log(`  CAGR:                ${(metrics.cagr * 100).toFixed(2)}%`);
  }
  console.log(`  Sharpe Ratio:        ${metrics.sharpeRatio}`);
  if (metrics.calmarRatio !== null) {
    console.log(`  Calmar Ratio:        ${metrics.calmarRatio}`);
  }
  console.log(`  Max Drawdown:        ${metrics.maxDrawdownPct}`);
  console.log('─'.repeat(60));
  console.log(`  Total Trades:        ${metrics.totalTrades}`);
  console.log(`  Win Rate:            ${metrics.winRatePct} (${metrics.winningTrades}W / ${metrics.losingTrades}L)`);
  console.log(`  Profit Factor:       ${metrics.profitFactor}`);
  console.log(`  Avg Win:             $${metrics.averageWin.toFixed(2)}`);
  console.log(`  Avg Loss:            $${metrics.averageLoss.toFixed(2)}`);
  console.log(`  Largest Win:         $${metrics.largestWin.toFixed(2)}`);
  console.log(`  Largest Loss:        $${metrics.largestLoss.toFixed(2)}`);
  console.log(`  Avg Trade Duration:  ${metrics.averageTradeDurationDays} days`);
  console.log('─'.repeat(60));
  console.log(`  Gross Profit:        $${metrics.grossProfit.toFixed(2)}`);
  console.log(`  Gross Loss:          $${metrics.grossLoss.toFixed(2)}`);
  console.log(`  Net Profit:          $${metrics.netProfit.toFixed(2)}`);
  console.log(`  Initial Capital:     $${metrics.initialCapital.toFixed(2)}`);
  console.log(`  Final Equity:        $${metrics.finalEquity.toFixed(2)}`);
  console.log('─'.repeat(60));
  console.log('  Exit Reasons:');
  for (const [reason, count] of Object.entries(metrics.exitsByReason)) {
    console.log(`    ${reason.padEnd(20)} ${count}`);
  }
  console.log('═'.repeat(60) + '\n');
}

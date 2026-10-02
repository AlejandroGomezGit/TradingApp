/**
 * RiskManager — gatekeeper de TODAS las órdenes.
 *
 * DOS BUCKETS con reglas separadas:
 *
 * CONSERVATIVE (SPY, QQQ, NVDA, AAPL, MSFT, META, AMZN, XLK, SOXX):
 * 1. Position sizing: máximo 2% del portafolio total por trade
 * 2. Máximo 3 posiciones abiertas simultáneas en este bucket
 * 3. Solo limit orders, nunca market orders
 * 4. Stop-loss fijo de -4% desde la entrada
 * 5. Trailing stop de -3% cuando la posición sube +3%
 * 6. Cierre inmediato si posición cae -6% (emergency stop)
 * 7. Circuit breaker diario: si P&L del día < -5% del capital → parar todo
 * 8. Exposición máxima al bucket: 80% del portafolio
 *
 * VOLATILE (BTC/USD, ETH/USD, SOL/USD, TSLA, ARKK):
 * 1. Position sizing: máximo 1% del portafolio total por trade (~$1,000)
 * 2. Máximo 3 posiciones abiertas simultáneas en este bucket
 * 3. Solo limit orders
 * 4. Stop-loss fijo de -8% (crypto necesita más espacio)
 * 5. Trailing stop de -5% cuando la posición sube +5%
 * 6. Cierre inmediato si posición cae -15% (emergency stop)
 * 7. Circuit breaker propio: si P&L del bucket < -10% → parar volatile
 * 8. Exposición máxima al bucket: 20% del portafolio ($20,000)
 * 9. Correlation guard: no BTC+ETH, BTC+SOL, ETH+SOL en largo simultáneo
 */

import { Account, Position } from '../types';
import { TradeDecision } from '../types';
import { WatchlistItem } from '../types';
import { logger } from '../middleware/logger';

// ─── Conservative bucket constants ───────────────────────────────────────────

const CONS_MAX_POSITION_PCT   = 0.02;   // 2% of total portfolio per trade
const CONS_MAX_OPEN_POSITIONS = 3;
const CONS_STOP_LOSS_PCT      = 0.04;   // -4% hard stop
const CONS_EMERGENCY_STOP_PCT = 0.06;   // -6% → close immediately
const CONS_TRAILING_TRIGGER   = 0.03;   // activate trailing at +3%
const CONS_TRAILING_STOP_PCT  = 0.03;   // trail at -3% from peak
const CONS_CIRCUIT_BREAKER    = 0.05;   // -5% daily P&L → halt ALL orders
const CONS_MAX_BUCKET_PCT     = 0.80;   // conservative bucket cap: 80% of portfolio

// ─── Volatile bucket constants ────────────────────────────────────────────────

const VOL_MAX_POSITION_PCT    = 0.01;   // 1% of total portfolio per trade (~$1,000)
const VOL_MAX_OPEN_POSITIONS  = 3;
const VOL_STOP_LOSS_PCT       = 0.08;   // -8% hard stop (crypto needs room)
const VOL_EMERGENCY_STOP_PCT  = 0.15;   // -15% → close immediately
const VOL_TRAILING_TRIGGER    = 0.05;   // activate trailing at +5%
const VOL_TRAILING_STOP_PCT   = 0.05;   // trail at -5% from peak
const VOL_CIRCUIT_BREAKER     = 0.10;   // -10% on volatile bucket → halt volatile only
const VOL_MAX_BUCKET_PCT      = 0.20;   // volatile bucket cap: 20% of portfolio

// ─── Shared constants ─────────────────────────────────────────────────────────

const BUY_LIMIT_SLIPPAGE  = 0.001;   // ask + 0.1%
const SELL_LIMIT_SLIPPAGE = 0.001;   // bid - 0.1%

// Crypto symbols that trade 24/7 and use fractional shares
export const CRYPTO_SYMBOLS = new Set(['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'AVAX/USD']);

// Volatile bucket symbols
export const VOLATILE_SYMBOLS = new Set(['BTC/USD', 'ETH/USD', 'SOL/USD', 'TSLA', 'ARKK', 'DOGE/USD']);

// Correlated pairs — never long both at the same time (volatile only)
const CORRELATED_PAIRS: [string, string][] = [
  ['BTC/USD', 'ETH/USD'],
  ['BTC/USD', 'SOL/USD'],
  ['ETH/USD', 'SOL/USD'],
];

// Alias for backward compat
const MAX_POSITION_PCT    = CONS_MAX_POSITION_PCT;
const MAX_OPEN_POSITIONS  = CONS_MAX_OPEN_POSITIONS;
const STOP_LOSS_PCT       = CONS_STOP_LOSS_PCT;
const EMERGENCY_STOP_PCT  = CONS_EMERGENCY_STOP_PCT;
const TRAILING_TRIGGER_PCT = CONS_TRAILING_TRIGGER;
const TRAILING_STOP_PCT   = CONS_TRAILING_STOP_PCT;
const CIRCUIT_BREAKER_PCT = CONS_CIRCUIT_BREAKER;

// ─── Circuit breaker state (in-memory; resets each day on process restart) ──

interface DailyState {
  date: string;
  halted: boolean;           // conservative circuit breaker (halts ALL orders)
  volatileHalted: boolean;   // volatile circuit breaker (halts volatile orders only)
  startingValue: number | null;
  volatileStartingValue: number | null;  // sum of volatile positions market value at open
}

const dailyState: DailyState = {
  date: new Date().toISOString().split('T')[0],
  halted: false,
  volatileHalted: false,
  startingValue: null,
  volatileStartingValue: null,
};

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function resetIfNewDay(): void {
  const today = todayKey();
  if (dailyState.date !== today) {
    dailyState.date = today;
    dailyState.halted = false;
    dailyState.volatileHalted = false;
    dailyState.startingValue = null;
    dailyState.volatileStartingValue = null;
    logger.info('[RiskManager] New trading day — circuit breaker reset');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RiskEvaluation {
  approved: boolean;
  reason?: string;
  adjustedQty?: number;
  adjustedLimitPrice?: number;
}

export interface TrailingStopCheck {
  symbol: string;
  shouldClose: boolean;
  reason: string;
  suggestedLimitPrice: number;
}

export interface EmergencyCloseCheck {
  symbol: string;
  shouldClose: boolean;
  reason: string;
}

export class RiskManager {
  /**
   * Initialize the daily starting portfolio value (call once at session start).
   */
  static recordStartingValue(portfolioValue: number): void {
    resetIfNewDay();
    if (dailyState.startingValue === null) {
      dailyState.startingValue = portfolioValue;
      logger.info('[RiskManager] Starting portfolio value recorded', { portfolioValue });
    }
  }

  /**
   * Check circuit breaker: returns true if trading should be halted.
   */
  static isCircuitBreakerTripped(account: Account): boolean {
    resetIfNewDay();
    if (dailyState.halted) return true;

    if (dailyState.startingValue === null) return false;

    const pnlPct = (account.portfolio_value - dailyState.startingValue) / dailyState.startingValue;

    if (pnlPct <= -CIRCUIT_BREAKER_PCT) {
      dailyState.halted = true;
      logger.warn('[RiskManager] CIRCUIT BREAKER TRIPPED', {
        dailyPnlPct: (pnlPct * 100).toFixed(2) + '%',
        startingValue: dailyState.startingValue,
        currentValue: account.portfolio_value,
      });
      return true;
    }

    return false;
  }

  /**
   * Main evaluation gate. Call before placing any order.
   * Bucket is derived from the watchlist item — volatile gets different thresholds.
   */
  static evaluate(
    decision: TradeDecision,
    account: Account,
    positions: Position[],
    watchlist: WatchlistItem[],
    currentPrice: number,
  ): RiskEvaluation {
    resetIfNewDay();

    // Hold decisions always pass
    if (decision.action === 'hold') return { approved: true };

    // ── Determine bucket ───────────────────────────────────────────────────
    const watchItem = watchlist.find((w) => w.symbol === decision.symbol);
    const isVolatile = watchItem?.bucket === 'volatile' || VOLATILE_SYMBOLS.has(decision.symbol);

    // ── Circuit breaker (main — halts ALL orders) ──────────────────────────
    if (RiskManager.isCircuitBreakerTripped(account)) {
      return { approved: false, reason: 'Circuit breaker active — daily P&L limit reached' };
    }

    // ── Volatile circuit breaker (halts volatile orders only) ─────────────
    if (isVolatile && dailyState.volatileHalted) {
      return { approved: false, reason: 'Volatile circuit breaker active — volatile bucket P&L limit reached' };
    }

    // ── Sell validations ───────────────────────────────────────────────────
    if (decision.action === 'sell') {
      const position = positions.find((p) => p.symbol === decision.symbol);
      if (!position) {
        return { approved: false, reason: `No open position for ${decision.symbol}` };
      }
      if (decision.qty && decision.qty > position.qty) {
        return {
          approved: false,
          reason: `Cannot sell ${decision.qty} — only own ${position.qty}`,
        };
      }
      const adjustedLimitPrice = parseFloat(
        (currentPrice * (1 - SELL_LIMIT_SLIPPAGE)).toFixed(2)
      );
      return { approved: true, adjustedQty: decision.qty, adjustedLimitPrice };
    }

    // ── Buy validations ────────────────────────────────────────────────────

    // Pick constants based on bucket
    const maxPositionPct    = isVolatile ? VOL_MAX_POSITION_PCT    : CONS_MAX_POSITION_PCT;
    const maxOpenPositions  = isVolatile ? VOL_MAX_OPEN_POSITIONS  : CONS_MAX_OPEN_POSITIONS;
    const maxBucketPct      = isVolatile ? VOL_MAX_BUCKET_PCT      : CONS_MAX_BUCKET_PCT;

    // 1. Max open positions per bucket
    //    Only count DISTINCT symbols — adding to an existing position doesn't open a new slot.
    const bucketPositions = isVolatile
      ? positions.filter((p) => VOLATILE_SYMBOLS.has(p.symbol))
      : positions.filter((p) => !VOLATILE_SYMBOLS.has(p.symbol));

    const existingPosition = positions.find((p) => p.symbol === decision.symbol);
    const isAddingToExisting = !!existingPosition;

    // Count distinct symbols excluding the current one (adding to it doesn't use a new slot)
    const distinctBucketSymbols = new Set(bucketPositions.map((p) => p.symbol));
    distinctBucketSymbols.delete(decision.symbol); // not a new slot if we already have it

    if (!isAddingToExisting && distinctBucketSymbols.size >= maxOpenPositions) {
      return {
        approved: false,
        reason: `Max ${maxOpenPositions} ${isVolatile ? 'volatile' : 'conservative'} positions already open (${[...distinctBucketSymbols].join(', ')})`,
      };
    }

    // 3. Bucket exposure cap
    const bucketValue = bucketPositions.reduce((sum, p) => sum + p.market_value, 0);
    const maxBucketValue = account.portfolio_value * maxBucketPct;
    if (bucketValue >= maxBucketValue) {
      return {
        approved: false,
        reason: `${isVolatile ? 'Volatile' : 'Conservative'} bucket at capacity: $${bucketValue.toFixed(0)} of $${maxBucketValue.toFixed(0)} max`,
      };
    }

    // 4. Correlation guard (volatile only — crypto pairs)
    if (isVolatile) {
      const correlatedPair = CORRELATED_PAIRS.find(
        ([a, b]) =>
          (a === decision.symbol && positions.some((p) => p.symbol === b)) ||
          (b === decision.symbol && positions.some((p) => p.symbol === a))
      );
      if (correlatedPair) {
        return {
          approved: false,
          reason: `Correlation guard: ${correlatedPair[0]} and ${correlatedPair[1]} are correlated — avoid simultaneous longs`,
        };
      }
    }

    // 5. Position sizing
    const maxOrderValue = account.portfolio_value * maxPositionPct;
    const requestedPrice = decision.limit_price ?? currentPrice;
    const isCrypto = CRYPTO_SYMBOLS.has(decision.symbol);

    let qty: number;
    if (isCrypto) {
      // Crypto uses fractional amounts (up to 6 decimal places)
      const rawQty = decision.qty ?? maxOrderValue / requestedPrice;
      qty = Math.floor(rawQty * 1e6) / 1e6;  // round to 6 decimals
    } else {
      qty = decision.qty ?? Math.floor(maxOrderValue / requestedPrice);
      // Cap to enforce position % rule
      const cappedQty = Math.floor(maxOrderValue / requestedPrice);
      if (qty > cappedQty) {
        logger.info('[RiskManager] Reducing qty to enforce position limit', {
          bucket: isVolatile ? 'volatile' : 'conservative',
          requested: qty,
          capped: cappedQty,
          pct: `${(maxPositionPct * 100).toFixed(0)}%`,
        });
        qty = cappedQty;
      }
    }

    if (!isCrypto && qty <= 0) {
      return {
        approved: false,
        reason: `Order size too small: $${maxOrderValue.toFixed(2)} / $${requestedPrice.toFixed(2)} = ${qty} shares`,
      };
    }
    if (isCrypto && qty <= 0.000001) {
      return {
        approved: false,
        reason: `Crypto order too small: $${maxOrderValue.toFixed(2)} / $${requestedPrice.toFixed(2)} = ${qty}`,
      };
    }

    const orderValue = qty * requestedPrice;

    // 6. Buying power check
    if (orderValue > account.buying_power) {
      return { approved: false, reason: `Insufficient buying power ($${account.buying_power.toFixed(2)})` };
    }

    // 7. Watchlist max allocation check (per-symbol cap)
    //    When adding to an existing position, check that TOTAL (existing + new) stays within cap.
    if (watchItem) {
      const maxByAlloc = account.portfolio_value * (watchItem.max_allocation_pct / 100);
      const existingValue = existingPosition ? existingPosition.market_value : 0;
      const availableAlloc = maxByAlloc - existingValue;

      if (availableAlloc <= 0) {
        return {
          approved: false,
          reason: `${decision.symbol} already at max allocation (${watchItem.max_allocation_pct}%): existing $${existingValue.toFixed(0)} >= max $${maxByAlloc.toFixed(0)}`,
        };
      }

      if (orderValue > availableAlloc) {
        if (isCrypto) {
          const newQty = Math.floor((availableAlloc / requestedPrice) * 1e6) / 1e6;
          if (newQty <= 0.000001) {
            return { approved: false, reason: `Would exceed max allocation (${watchItem.max_allocation_pct}%) — only $${availableAlloc.toFixed(0)} room left` };
          }
          logger.info('[RiskManager] Trimming crypto qty to fit allocation', { symbol: decision.symbol, newQty, availableAlloc });
          qty = newQty;
        } else {
          const newQty = Math.floor(availableAlloc / requestedPrice);
          if (newQty <= 0) {
            return { approved: false, reason: `Would exceed max allocation (${watchItem.max_allocation_pct}%) — only $${availableAlloc.toFixed(0)} room left` };
          }
          logger.info('[RiskManager] Trimming qty to fit allocation', { symbol: decision.symbol, newQty, availableAlloc });
          qty = newQty;
        }
      }
    }

    // 8. Buy limit: ask + 0.1%
    const adjustedLimitPrice = parseFloat(
      (currentPrice * (1 + BUY_LIMIT_SLIPPAGE)).toFixed(isCrypto ? 2 : 2)
    );

    logger.info('[RiskManager] Order approved', {
      symbol: decision.symbol,
      bucket: isVolatile ? 'volatile' : 'conservative',
      action: decision.action,
      qty,
      limitPrice: adjustedLimitPrice,
      orderValue: (qty * adjustedLimitPrice).toFixed(2),
      portfolioPct: ((qty * adjustedLimitPrice) / account.portfolio_value * 100).toFixed(2) + '%',
    });

    return { approved: true, adjustedQty: qty, adjustedLimitPrice };
  }

  /**
   * Check and trip the volatile circuit breaker.
   * Call from volatile-scan with current volatile positions P&L.
   */
  static checkVolatileCircuitBreaker(positions: Position[]): boolean {
    resetIfNewDay();
    if (dailyState.volatileHalted) return true;

    const volatilePositions = positions.filter((p) => VOLATILE_SYMBOLS.has(p.symbol));
    const totalVolatilePnl = volatilePositions.reduce((sum, p) => sum + p.unrealized_pl, 0);
    const totalVolatileValue = volatilePositions.reduce((sum, p) => sum + p.market_value, 0);

    if (totalVolatileValue === 0) return false;

    const pnlPct = totalVolatilePnl / totalVolatileValue;
    if (pnlPct <= -VOL_CIRCUIT_BREAKER) {
      dailyState.volatileHalted = true;
      logger.warn('[RiskManager] VOLATILE CIRCUIT BREAKER TRIPPED', {
        pnlPct: (pnlPct * 100).toFixed(2) + '%',
        threshold: `-${VOL_CIRCUIT_BREAKER * 100}%`,
        affectedSymbols: volatilePositions.map((p) => p.symbol),
      });
      return true;
    }
    return false;
  }

  /**
   * Check all open positions for emergency close and trailing stop conditions.
   * Uses bucket-appropriate thresholds: volatile gets wider stops (-8%/-15%/-5% trail).
   * Call during midday-review, volatile-scan, and before each trading session.
   */
  static checkPositionExits(positions: Position[]): {
    emergencyClose: EmergencyCloseCheck[];
    trailingStop: TrailingStopCheck[];
  } {
    const emergencyClose: EmergencyCloseCheck[] = [];
    const trailingStop: TrailingStopCheck[] = [];

    for (const pos of positions) {
      const pnlPct = pos.unrealized_plpc; // already a decimal (e.g. -0.06 = -6%)
      const isVolatile = VOLATILE_SYMBOLS.has(pos.symbol);

      const stopLossPct     = isVolatile ? VOL_STOP_LOSS_PCT      : CONS_STOP_LOSS_PCT;
      const emergencyStopPct = isVolatile ? VOL_EMERGENCY_STOP_PCT : CONS_EMERGENCY_STOP_PCT;
      const trailingTrigger  = isVolatile ? VOL_TRAILING_TRIGGER   : CONS_TRAILING_TRIGGER;
      const trailingStopPct  = isVolatile ? VOL_TRAILING_STOP_PCT  : CONS_TRAILING_STOP_PCT;

      // Emergency close
      if (pnlPct <= -emergencyStopPct) {
        emergencyClose.push({
          symbol: pos.symbol,
          shouldClose: true,
          reason: `Emergency stop (${isVolatile ? 'volatile' : 'conservative'}): ${(pnlPct * 100).toFixed(2)}% loss (threshold: -${emergencyStopPct * 100}%)`,
        });
        continue;
      }

      // Hard stop-loss
      if (pnlPct <= -stopLossPct) {
        emergencyClose.push({
          symbol: pos.symbol,
          shouldClose: true,
          reason: `Stop-loss (${isVolatile ? 'volatile' : 'conservative'}): ${(pnlPct * 100).toFixed(2)}% loss (threshold: -${stopLossPct * 100}%)`,
        });
        continue;
      }

      // Trailing stop
      if (pnlPct >= trailingTrigger) {
        const trailStopPrice = pos.current_price * (1 - trailingStopPct);
        const impliedPeak = pos.avg_entry_price * (1 + pnlPct + trailingStopPct);
        const dropFromPeak = (impliedPeak - pos.current_price) / impliedPeak;

        if (dropFromPeak >= trailingStopPct) {
          trailingStop.push({
            symbol: pos.symbol,
            shouldClose: true,
            reason: `Trailing stop (${isVolatile ? 'volatile' : 'conservative'}): dropped ${(dropFromPeak * 100).toFixed(2)}% from peak while up ${(pnlPct * 100).toFixed(2)}%`,
            suggestedLimitPrice: parseFloat((trailStopPrice * (1 - SELL_LIMIT_SLIPPAGE)).toFixed(2)),
          });
        }
      }
    }

    if (emergencyClose.length > 0) {
      logger.warn('[RiskManager] Emergency closes required', {
        symbols: emergencyClose.map((e) => e.symbol),
      });
    }
    if (trailingStop.length > 0) {
      logger.info('[RiskManager] Trailing stops triggered', {
        symbols: trailingStop.map((t) => t.symbol),
      });
    }

    return { emergencyClose, trailingStop };
  }

  /**
   * Calculate confidence-based position size.
   * Bucket-aware: volatile positions are sized from a 1% max instead of 2%.
   */
  static calculatePositionSize(
    portfolioValue: number,
    price: number,
    confidence: number,
    bucket: 'conservative' | 'volatile' = 'conservative',
  ): number {
    const maxPct = bucket === 'volatile' ? VOL_MAX_POSITION_PCT : CONS_MAX_POSITION_PCT;
    const maxValue = portfolioValue * maxPct;
    const scaledValue = maxValue * Math.min(confidence, 1.0);
    const isCrypto = price > 1000;  // rough heuristic for crypto (BTC etc.)
    if (isCrypto) {
      return Math.floor((scaledValue / price) * 1e6) / 1e6;
    }
    return Math.max(1, Math.floor(scaledValue / price));
  }

  static get constants() {
    return {
      // Conservative
      CONS_MAX_POSITION_PCT,
      CONS_MAX_OPEN_POSITIONS,
      CONS_STOP_LOSS_PCT,
      CONS_EMERGENCY_STOP_PCT,
      CONS_TRAILING_TRIGGER,
      CONS_TRAILING_STOP_PCT,
      CONS_CIRCUIT_BREAKER,
      CONS_MAX_BUCKET_PCT,
      // Volatile
      VOL_MAX_POSITION_PCT,
      VOL_MAX_OPEN_POSITIONS,
      VOL_STOP_LOSS_PCT,
      VOL_EMERGENCY_STOP_PCT,
      VOL_TRAILING_TRIGGER,
      VOL_TRAILING_STOP_PCT,
      VOL_CIRCUIT_BREAKER,
      VOL_MAX_BUCKET_PCT,
      // Backward compat aliases
      MAX_POSITION_PCT,
      MAX_OPEN_POSITIONS,
      STOP_LOSS_PCT,
      EMERGENCY_STOP_PCT,
      TRAILING_TRIGGER_PCT,
      TRAILING_STOP_PCT,
      CIRCUIT_BREAKER_PCT,
    };
  }
}

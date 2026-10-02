import { alpacaService } from './alpaca.service';
import { getTradeDecisions } from './claude.service';
import { RiskManager } from './risk.service';
import { query } from '../db/connection';
import { logger } from '../middleware/logger';
import { Account, Position, ResearchData, TradeDecision, WatchlistItem } from '../types';
// config import no longer needed — RiskManager owns all thresholds

export async function validateDecision(
  decision: TradeDecision,
  account: Account,
  positions: Position[],
  watchlist: WatchlistItem[],
  currentPrice: number,
): Promise<{ valid: boolean; reason?: string; adjustedQty?: number; adjustedLimitPrice?: number }> {
  const result = RiskManager.evaluate(decision, account, positions, watchlist, currentPrice);
  return {
    valid: result.approved,
    reason: result.reason,
    adjustedQty: result.adjustedQty,
    adjustedLimitPrice: result.adjustedLimitPrice,
  };
}

export async function executeTradingSession(
  research: ResearchData[],
  watchlist: WatchlistItem[]
): Promise<TradeDecision[]> {
  const clock = await alpacaService.getMarketClock();
  if (!clock.is_open) {
    logger.info('Market is closed, skipping trading session', {
      next_open: clock.next_open,
    });
    return [];
  }

  const [account, positions] = await Promise.all([
    alpacaService.getAccount(),
    alpacaService.getPositions(),
  ]);

  logger.info('Account state', {
    cash: account.cash,
    portfolio_value: account.portfolio_value,
    positions: positions.length,
  });

  // RiskManager: check all positions for emergency stops and trailing stops
  const { emergencyClose, trailingStop } = RiskManager.checkPositionExits(positions);
  const allExits = [
    ...emergencyClose.filter((e) => e.shouldClose),
    ...trailingStop.filter((t) => t.shouldClose),
  ];
  for (const exit of allExits) {
    logger.warn('Risk exit triggered, closing position', { symbol: exit.symbol, reason: exit.reason });
    try {
      const pos = positions.find((p) => p.symbol === exit.symbol);
      await alpacaService.closePosition(exit.symbol);
      await query(
        `INSERT INTO trades (symbol, side, qty, limit_price, status, reasoning)
         VALUES ($1, 'sell', $2, $3, 'filled', $4)`,
        [exit.symbol, pos?.qty ?? 0, pos?.current_price ?? 0, exit.reason]
      );
    } catch (e) {
      logger.error('Failed to close position', { symbol: exit.symbol, error: e });
    }
  }

  // Circuit breaker check
  if (RiskManager.isCircuitBreakerTripped(account)) {
    logger.warn('Circuit breaker active — skipping new orders for today');
    return [];
  }

  // Refresh positions after exits
  const currentPositions = await alpacaService.getPositions();

  const decisions = await getTradeDecisions(account, currentPositions, research, watchlist);
  const executedDecisions: TradeDecision[] = [];

  for (const decision of decisions) {
    if (decision.action === 'hold') {
      logger.info('Hold decision', { symbol: decision.symbol, reason: decision.reasoning });
      continue;
    }

    const currentPrice = currentPositions.find((p) => p.symbol === decision.symbol)?.current_price
      ?? decision.limit_price
      ?? 0;

    const { valid, reason, adjustedQty, adjustedLimitPrice } = await validateDecision(
      decision,
      account,
      currentPositions,
      watchlist,
      currentPrice,
    );
    if (!valid) {
      logger.warn('Decision rejected by RiskManager', { decision, reason });
      continue;
    }

    // Apply risk-adjusted values
    const finalQty = adjustedQty ?? decision.qty!;
    const finalPrice = adjustedLimitPrice ?? decision.limit_price!;

    try {
      const { orderId, status } = await alpacaService.placeOrder({
        symbol: decision.symbol,
        qty: finalQty,
        side: decision.action as 'buy' | 'sell',
        limitPrice: finalPrice,
      });

      await query(
        `INSERT INTO trades (symbol, side, qty, limit_price, status, alpaca_order_id, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          decision.symbol,
          decision.action,
          finalQty,
          finalPrice,
          status,
          orderId,
          decision.reasoning,
        ]
      );

      executedDecisions.push({ ...decision, qty: finalQty, limit_price: finalPrice });
      logger.info('Order executed', { symbol: decision.symbol, action: decision.action, orderId });
    } catch (error) {
      logger.error('Failed to place order', { decision, error });
    }
  }

  return executedDecisions;
}

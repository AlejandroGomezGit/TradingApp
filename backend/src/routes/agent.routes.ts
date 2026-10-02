import { Router } from 'express';
import {
  morningScan,
  strategyEval,
  placeOrders,
  middayReview,
  eveningScan,
  endOfDayJournal,
} from '../scheduler';
import { runResearch } from '../services/research.service';
import { query } from '../db/connection';
import { alpacaService } from '../services/alpaca.service';
import { RiskManager } from '../services/risk.service';
import { WatchlistItem } from '../types';

const router = Router();

// ─── Triggers de rutinas ─────────────────────────────────────────────────────

router.post('/morning', async (_req, res) => {
  try {
    await morningScan();
    res.json({ success: true, message: 'morning-scan triggered' });
  } catch (error) {
    res.status(500).json({ error: 'morning-scan failed', details: String(error) });
  }
});

router.post('/strategy', async (_req, res) => {
  try {
    await strategyEval();
    res.json({ success: true, message: 'strategy-eval triggered' });
  } catch (error) {
    res.status(500).json({ error: 'strategy-eval failed', details: String(error) });
  }
});

router.post('/orders', async (_req, res) => {
  try {
    await placeOrders();
    res.json({ success: true, message: 'place-orders triggered' });
  } catch (error) {
    res.status(500).json({ error: 'place-orders failed', details: String(error) });
  }
});

router.post('/midday', async (_req, res) => {
  try {
    await middayReview();
    res.json({ success: true, message: 'midday-review triggered' });
  } catch (error) {
    res.status(500).json({ error: 'midday-review failed', details: String(error) });
  }
});

router.post('/evening', async (_req, res) => {
  try {
    await eveningScan();
    res.json({ success: true, message: 'evening-scan triggered' });
  } catch (error) {
    res.status(500).json({ error: 'evening-scan failed', details: String(error) });
  }
});

router.post('/journal', async (_req, res) => {
  try {
    await endOfDayJournal();
    res.json({ success: true, message: 'journal-entry triggered' });
  } catch (error) {
    res.status(500).json({ error: 'journal-entry failed', details: String(error) });
  }
});

// ─── Research ────────────────────────────────────────────────────────────────

router.post('/research', async (_req, res) => {
  try {
    const watchlist = await query<WatchlistItem>('SELECT * FROM watchlist WHERE active = true ORDER BY symbol');
    const research = await runResearch(watchlist);
    res.json({
      success: true,
      symbols: research.map((r) => ({
        symbol: r.symbol,
        trend: r.technicals.trend,
        rsi: r.technicals.rsi.toFixed(1),
        sma20: r.technicals.sma20.toFixed(2),
        sma50: r.technicals.sma50.toFixed(2),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Research failed', details: String(error) });
  }
});

router.get('/research/:symbol', async (req, res) => {
  try {
    const symbol = req.params['symbol'].toUpperCase();
    const bars = await alpacaService.getBars(symbol, '1Day', 60);
    const news = await alpacaService.getNews([symbol], 5);
    res.json({ symbol, bars: bars.length, news: news.length, latest: bars[bars.length - 1] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch symbol data', details: String(error) });
  }
});

// ─── Órdenes manuales ────────────────────────────────────────────────────────

/**
 * POST /api/agent/order/buy
 * Body: { symbol: "NVDA", qty: 2 }
 * Pasa por RiskManager antes de ejecutar.
 */
router.post('/order/buy', async (req, res) => {
  try {
    const { symbol, qty } = req.body as { symbol: string; qty?: number };
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const [account, positions, watchlist, snapshot] = await Promise.all([
      alpacaService.getAccount(),
      alpacaService.getPositions(),
      query<WatchlistItem>('SELECT * FROM watchlist WHERE active = true'),
      alpacaService.getSnapshots([symbol.toUpperCase()]),
    ]);

    const currentPrice = snapshot[symbol.toUpperCase()]?.latestTrade?.p ?? 0;
    if (!currentPrice) return res.status(400).json({ error: `No price found for ${symbol}` });

    const decision = {
      symbol: symbol.toUpperCase(),
      action: 'buy' as const,
      qty: qty ?? RiskManager.calculatePositionSize(account.portfolio_value, currentPrice, 0.7),
      limit_price: parseFloat((currentPrice * 1.001).toFixed(2)),
      reasoning: 'Manual buy via API',
      confidence: 0.7,
    };

    RiskManager.recordStartingValue(account.portfolio_value);
    const risk = RiskManager.evaluate(decision, account, positions, watchlist, currentPrice);

    if (!risk.approved) {
      return res.status(400).json({ approved: false, reason: risk.reason });
    }

    const { orderId, status } = await alpacaService.placeOrder({
      symbol: decision.symbol,
      qty: risk.adjustedQty!,
      side: 'buy',
      limitPrice: risk.adjustedLimitPrice!,
    });

    res.json({
      success: true,
      orderId,
      status,
      symbol: decision.symbol,
      qty: risk.adjustedQty,
      limitPrice: risk.adjustedLimitPrice,
    });
  } catch (error) {
    res.status(500).json({ error: 'Buy order failed', details: String(error) });
  }
});

/**
 * POST /api/agent/order/sell
 * Body: { symbol: "NVDA" }  → cierra la posición completa
 */
router.post('/order/sell', async (req, res) => {
  try {
    const { symbol } = req.body as { symbol: string };
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const positions = await alpacaService.getPositions();
    const pos = positions.find((p) => p.symbol === symbol.toUpperCase());
    if (!pos) return res.status(400).json({ error: `No open position for ${symbol}` });

    await alpacaService.closePosition(symbol.toUpperCase());
    res.json({ success: true, symbol: symbol.toUpperCase(), qty: pos.qty, pnl: pos.unrealized_pl });
  } catch (error) {
    res.status(500).json({ error: 'Sell order failed', details: String(error) });
  }
});

/**
 * DELETE /api/agent/orders  → cancela todas las órdenes pendientes
 */
router.delete('/orders', async (_req, res) => {
  try {
    await alpacaService.cancelAllOrders();
    res.json({ success: true, message: 'All open orders cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Cancel orders failed', details: String(error) });
  }
});

// ─── Estado del bot ──────────────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
  try {
    const [account, positions, clock] = await Promise.all([
      alpacaService.getAccount(),
      alpacaService.getPositions(),
      alpacaService.getMarketClock(),
    ]);

    const circuitBreaker = RiskManager.isCircuitBreakerTripped(account);

    res.json({
      market: { is_open: clock.is_open, next_open: clock.next_open },
      portfolio: {
        value: account.portfolio_value,
        cash: account.cash,
        equity: account.equity,
        buying_power: account.buying_power,
      },
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avg_entry: p.avg_entry_price,
        current: p.current_price,
        pnl: p.unrealized_pl,
        pnl_pct: (p.unrealized_plpc * 100).toFixed(2) + '%',
      })),
      risk: {
        circuit_breaker: circuitBreaker,
        open_positions: positions.length,
        max_positions: RiskManager.constants.MAX_OPEN_POSITIONS,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Status check failed', details: String(error) });
  }
});

export default router;

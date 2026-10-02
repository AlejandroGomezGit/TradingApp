import cron from 'node-cron';
import { query } from '../db/connection';
import { alpacaService } from '../services/alpaca.service';
import { coinGeckoService } from '../services/coingecko.service';
import { runResearch } from '../services/research.service';
import { executeTradingSession } from '../services/trading.service';
import { writeJournalEntry, savePortfolioSnapshot, logHeartbeat } from '../services/journal.service';
import { sendDailyReport } from '../services/email.service';
import { RiskManager, VOLATILE_SYMBOLS, CRYPTO_SYMBOLS } from '../services/risk.service';
import { logger } from '../middleware/logger';
import { ResearchData, TradeDecision, WatchlistItem } from '../types';
import { Server as SocketServer } from 'socket.io';

// ─── Shared state between routines ──────────────────────────────────────────
let lastResearch: ResearchData[] = [];
let lastTrades: TradeDecision[] = [];

async function getActiveWatchlist(): Promise<WatchlistItem[]> {
  return query<WatchlistItem>('SELECT * FROM watchlist WHERE active = true ORDER BY symbol');
}

async function getVolatileWatchlist(): Promise<WatchlistItem[]> {
  return query<WatchlistItem>("SELECT * FROM watchlist WHERE active = true AND bucket = 'volatile' ORDER BY symbol");
}

// ─── ROUTINE 1: Morning Scan (8:00 AM Colombia = 9:00 AM ET) ─────────────────
//   Fetch Fear & Greed, top movers, noticias
async function morningScan(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting morning-scan');
  await logHeartbeat('morning-scan', 'started');

  try {
    // morning-scan is a PRE-MARKET routine — runs at 9:00 ET, before the 9:30 open.
    // Do NOT check clock.is_open here; it will always be false at 9:00 ET.
    // We still record the starting portfolio value for the circuit breaker.
    const account = await alpacaService.getAccount();
    RiskManager.recordStartingValue(account.portfolio_value);

    // Fetch macro sentiment
    const [fearGreed, trendingCoins] = await Promise.all([
      coinGeckoService.getFearAndGreed(),
      coinGeckoService.getTrendingCoins(),
    ]);

    logger.info('[CRON] Morning scan complete', {
      fearGreed: `${fearGreed.value} (${fearGreed.label})`,
      signal: fearGreed.signal,
      topTrending: trendingCoins.slice(0, 3).map((c) => c.symbol),
    });

    io?.emit('morning-scan:complete', {
      timestamp: new Date().toISOString(),
      fearGreed,
      trendingCoins: trendingCoins.slice(0, 5),
      portfolio: {
        value: account.portfolio_value,
        cash: account.cash,
      },
    });

    await logHeartbeat('morning-scan', 'completed', `F&G: ${fearGreed.value} (${fearGreed.label})`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] morning-scan failed', { error: errMsg, stack: error instanceof Error ? error.stack : undefined });
    await logHeartbeat('morning-scan', 'failed', errMsg);
  }
}

// ─── ROUTINE 2: Strategy Eval (9:00 AM Colombia = 10:00 AM ET) ───────────────
//   Corre todos los indicadores y señales
async function strategyEval(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting strategy-eval');
  await logHeartbeat('strategy-eval', 'started');

  try {
    const clock = await alpacaService.getMarketClock();
    if (!clock.is_open) {
      logger.info('[CRON] Market closed, skipping strategy-eval');
      await logHeartbeat('strategy-eval', 'skipped', 'Market closed');
      return;
    }

    const watchlist = await getActiveWatchlist();
    lastResearch = await runResearch(watchlist);

    await logHeartbeat('strategy-eval', 'completed', `Evaluated ${lastResearch.length} symbols`);
    logger.info('[CRON] strategy-eval complete', { symbols: lastResearch.length });

    io?.emit('strategy-eval:complete', {
      timestamp: new Date().toISOString(),
      symbols: lastResearch.map((r) => ({
        symbol: r.symbol,
        trend: r.technicals.trend,
        rsi: r.technicals.rsi,
        sma20: r.technicals.sma20,
        sma50: r.technicals.sma50,
        macdHistogram: (r.technicals as Record<string, unknown> & { macd?: { histogram: number } }).macd?.histogram,
        bollingerPercentB: (r.technicals as Record<string, unknown> & { bollinger?: { percentB: number } }).bollinger?.percentB,
      })),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] strategy-eval failed', { error: errMsg, stack: error instanceof Error ? error.stack : undefined });
    await logHeartbeat('strategy-eval', 'failed', errMsg);
  }
}

// ─── ROUTINE 3: Place Orders (9:15 AM Colombia = 10:15 AM ET) ────────────────
//   Ejecuta órdenes que pasen el risk check
async function placeOrders(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting place-orders');
  await logHeartbeat('place-orders', 'started');

  try {
    if (lastResearch.length === 0) {
      const watchlist = await getActiveWatchlist();
      lastResearch = await runResearch(watchlist);
    }

    const watchlist = await getActiveWatchlist();
    lastTrades = await executeTradingSession(lastResearch, watchlist);
    await savePortfolioSnapshot();

    await logHeartbeat('place-orders', 'completed', `Placed ${lastTrades.length} orders`);
    logger.info('[CRON] place-orders complete', { trades: lastTrades.length });

    const account = await alpacaService.getAccount();
    io?.emit('orders:complete', {
      timestamp: new Date().toISOString(),
      trades: lastTrades,
      account: { portfolio_value: account.portfolio_value, cash: account.cash },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] place-orders failed', { error: errMsg, stack: error instanceof Error ? error.stack : undefined });
    await logHeartbeat('place-orders', 'failed', errMsg);
  }
}

// ─── ROUTINE 4: Midday Review (12:00 PM Colombia = 1:00 PM ET) ───────────────
//   Revisa posiciones, ajusta trailing stops
async function middayReview(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting midday-review');
  await logHeartbeat('midday-review', 'started');

  try {
    const [positions, account] = await Promise.all([
      alpacaService.getPositions(),
      alpacaService.getAccount(),
    ]);

    // Check circuit breaker
    const circuitBreakerTripped = RiskManager.isCircuitBreakerTripped(account);
    if (circuitBreakerTripped) {
      logger.warn('[CRON] Circuit breaker active — cancelling all orders');
      await alpacaService.cancelAllOrders();
      await logHeartbeat('midday-review', 'completed', 'Circuit breaker — all orders cancelled');
      return;
    }

    // Check stops on all open positions
    const { emergencyClose, trailingStop } = RiskManager.checkPositionExits(positions);

    // Emergency closes
    for (const exit of emergencyClose) {
      try {
        await alpacaService.closePosition(exit.symbol);
        logger.warn('[CRON] Emergency close executed', { symbol: exit.symbol, reason: exit.reason });
        await logHeartbeat('midday-review', 'action', `Emergency close: ${exit.symbol} — ${exit.reason}`);
      } catch (e) {
        logger.error('[CRON] Failed to emergency close', { symbol: exit.symbol, error: e });
      }
    }

    // Trailing stop closes
    for (const trail of trailingStop) {
      if (!trail.shouldClose) continue;
      try {
        await alpacaService.closePosition(trail.symbol);
        logger.info('[CRON] Trailing stop close executed', { symbol: trail.symbol, reason: trail.reason });
        await logHeartbeat('midday-review', 'action', `Trailing stop: ${trail.symbol} — ${trail.reason}`);
      } catch (e) {
        logger.error('[CRON] Failed trailing stop close', { symbol: trail.symbol, error: e });
      }
    }

    await savePortfolioSnapshot();
    await logHeartbeat('midday-review', 'completed', `Reviewed ${positions.length} positions`);

    io?.emit('midday-review:complete', {
      timestamp: new Date().toISOString(),
      positions: positions.length,
      emergencyCloses: emergencyClose.filter((e) => e.shouldClose).length,
      trailingStops: trailingStop.filter((t) => t.shouldClose).length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] midday-review failed', { error: errMsg, stack: error instanceof Error ? error.stack : undefined });
    await logHeartbeat('midday-review', 'failed', errMsg);
  }
}

// ─── ROUTINE 5: Evening Scan (6:00 PM Colombia = 7:00 PM ET) ─────────────────
//   Busca oportunidades overnight (pre-market signals)
async function eveningScan(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting evening-scan');
  await logHeartbeat('evening-scan', 'started');

  try {
    const watchlist = await getActiveWatchlist();
    // Re-run research with end-of-day data
    const research = await runResearch(watchlist);

    // Find strong buy signals for tomorrow's open
    const opportunities = research
      .filter((r) => r.technicals.trend === 'bullish' && r.technicals.rsi < 55)
      .map((r) => ({
        symbol: r.symbol,
        trend: r.technicals.trend,
        rsi: r.technicals.rsi.toFixed(1),
        macdHistogram: r.technicals.macd?.histogram?.toFixed(4),
        sentiment: (r as unknown as { sentiment?: { fearGreed?: { value: number } } }).sentiment?.fearGreed?.value,
      }));

    logger.info('[CRON] evening-scan complete', {
      opportunities: opportunities.length,
      symbols: opportunities.map((o) => o.symbol),
    });

    await logHeartbeat('evening-scan', 'completed', `Found ${opportunities.length} opportunities`);

    io?.emit('evening-scan:complete', {
      timestamp: new Date().toISOString(),
      opportunities,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] evening-scan failed', { error: errMsg, stack: error instanceof Error ? error.stack : undefined });
    await logHeartbeat('evening-scan', 'failed', errMsg);
  }
}

// ─── ROUTINE 6: End-of-Day Journal (4:15 PM Colombia = 5:15 PM ET) ───────────
async function endOfDayJournal(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting journal-entry');
  await logHeartbeat('journal-entry', 'started');

  try {
    if (lastResearch.length === 0) {
      const watchlist = await getActiveWatchlist();
      lastResearch = await runResearch(watchlist);
    }

    await writeJournalEntry(lastResearch, lastTrades);
    await savePortfolioSnapshot();

    // Email is best-effort: a missing Gmail password or SMTP error must NOT
    // kill the whole journal routine (that would prevent the daily reset).
    try {
      const [journalRow] = await query<{
        date: string;
        portfolio_value: number;
        cash: number;
        daily_pnl: number;
        daily_pnl_pct: number;
        research_summary: string;
        trades_summary: string;
        reflection: string;
        positions_snapshot: unknown;
      }>(`SELECT * FROM journal_entries WHERE date = CURRENT_DATE`);

      if (journalRow) {
        await sendDailyReport({
          date: journalRow.date,
          portfolio_value: journalRow.portfolio_value,
          cash: journalRow.cash,
          daily_pnl: journalRow.daily_pnl,
          daily_pnl_pct: journalRow.daily_pnl_pct,
          research_summary: journalRow.research_summary,
          trades_summary: journalRow.trades_summary,
          reflection: journalRow.reflection,
          positions_snapshot: [],
        });
      }
    } catch (emailError) {
      // Non-critical: log but do not re-throw so the routine can finish cleanly
      logger.error('[CRON] journal-entry email step failed (non-critical)', {
        error: emailError instanceof Error ? emailError.message : String(emailError),
        stack: emailError instanceof Error ? emailError.stack : undefined,
      });
    }

    // Reset daily state
    lastResearch = [];
    lastTrades = [];

    await logHeartbeat('journal-entry', 'completed');
    logger.info('[CRON] journal-entry complete');

    io?.emit('journal:complete', { timestamp: new Date().toISOString() });
  } catch (error) {
    // Always include error.message so Winston doesn't log an empty {} object
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] journal-entry failed', {
      error: errMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await logHeartbeat('journal-entry', 'failed', errMsg);
  }
}

// ─── ROUTINE 7: Volatile Scan (cada hora, 24/7 para crypto) ──────────────────
//   Revisa posiciones volátiles, stops, y señales de ai-decisions.json
async function volatileScan(io?: SocketServer): Promise<void> {
  logger.info('[CRON] Starting volatile-scan');
  await logHeartbeat('volatile-scan', 'started');

  try {
    const [positions, account] = await Promise.all([
      alpacaService.getPositions(),
      alpacaService.getAccount(),
    ]);

    const volatilePositions = positions.filter((p) => VOLATILE_SYMBOLS.has(p.symbol));
    const cryptoPositions   = volatilePositions.filter((p) => CRYPTO_SYMBOLS.has(p.symbol));
    const stockPositions    = volatilePositions.filter((p) => !CRYPTO_SYMBOLS.has(p.symbol));

    // ── Check volatile circuit breaker ──────────────────────────────────
    const volatileHalted = RiskManager.checkVolatileCircuitBreaker(positions);
    if (volatileHalted) {
      logger.warn('[CRON] volatile-scan: volatile circuit breaker active — skipping new orders, checking stops only');
    }

    // ── Check stops on volatile positions (applies even if circuit breaker on) ──
    const { emergencyClose, trailingStop } = RiskManager.checkPositionExits(volatilePositions);

    for (const exit of [...emergencyClose, ...trailingStop]) {
      if (!exit.shouldClose) continue;
      try {
        await alpacaService.closePosition(exit.symbol);
        logger.warn('[CRON] volatile-scan: position closed', { symbol: exit.symbol, reason: exit.reason });
        await logHeartbeat('volatile-scan', 'action', `Closed ${exit.symbol}: ${exit.reason}`);
      } catch (e) {
        logger.error('[CRON] volatile-scan: failed to close position', { symbol: exit.symbol, error: e });
      }
    }

    // ── Read ai-decisions.json for volatile signals ──────────────────────
    if (!volatileHalted) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const decisionsPath = path.join(process.cwd(), 'data', 'ai-decisions.json');
        const raw = await fs.readFile(decisionsPath, 'utf8');
        const decisionsFile = JSON.parse(raw) as {
          generated_at: string;
          valid_until: string;
          decisions: Array<{
            symbol: string;
            action: string;
            qty?: number;
            limit_price?: number;
            reasoning: string;
            confidence: number;
            bucket?: string;
          }>;
        };

        // Same-day logic: decisions generated today (ET) are valid until 21:00 UTC
        const now = new Date();
        const generatedAt = new Date(decisionsFile.generated_at);
        const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const etGen = new Date(generatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const sameDay = etNow.getFullYear() === etGen.getFullYear()
          && etNow.getMonth() === etGen.getMonth()
          && etNow.getDate() === etGen.getDate();
        const endOfTradingDay = new Date(now);
        endOfTradingDay.setUTCHours(21, 0, 0, 0);
        const effectiveExpiry = sameDay ? endOfTradingDay : new Date(decisionsFile.valid_until);
        if (now > effectiveExpiry) {
          logger.info('[CRON] volatile-scan: ai-decisions.json expired, skipping new orders');
        } else {
          const volatileDecisions = decisionsFile.decisions.filter(
            (d) => d.bucket === 'volatile' || VOLATILE_SYMBOLS.has(d.symbol)
          );

          const watchlist = await getVolatileWatchlist();
          const currentPositions = await alpacaService.getPositions();

          for (const d of volatileDecisions) {
            if (d.action === 'hold' || d.confidence < 0.65) continue;
            if (d.action !== 'buy' && d.action !== 'sell') continue;

            const isCrypto = CRYPTO_SYMBOLS.has(d.symbol);

            // For stock volatile assets, only trade during market hours
            if (!isCrypto) {
              const clock = await alpacaService.getMarketClock();
              if (!clock.is_open) continue;
            }

            // Get current price (snapshot or limit_price from decision)
            const currentPrice = d.limit_price ?? 0;
            if (currentPrice <= 0) {
              logger.warn('[CRON] volatile-scan: no price for symbol, skipping', { symbol: d.symbol });
              continue;
            }

            const decision = {
              symbol: d.symbol,
              action: d.action as 'buy' | 'sell',
              qty: d.qty,
              limit_price: d.limit_price,
              reasoning: d.reasoning,
              confidence: d.confidence,
              bucket: 'volatile' as const,
            };

            const result = RiskManager.evaluate(decision, account, currentPositions, watchlist, currentPrice);
            if (!result.approved) {
              logger.info('[CRON] volatile-scan: decision rejected', { symbol: d.symbol, reason: result.reason });
              continue;
            }

            try {
              const { orderId, status } = await alpacaService.placeOrder({
                symbol: d.symbol,
                qty: result.adjustedQty ?? d.qty ?? 1,
                side: d.action as 'buy' | 'sell',
                limitPrice: result.adjustedLimitPrice ?? d.limit_price ?? currentPrice,
              });
              logger.info('[CRON] volatile-scan: order placed', { symbol: d.symbol, action: d.action, orderId, status });
              await query(
                `INSERT INTO trades (symbol, side, qty, limit_price, status, alpaca_order_id, reasoning)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [d.symbol, d.action, result.adjustedQty, result.adjustedLimitPrice, status, orderId, d.reasoning]
              );
            } catch (e) {
              logger.error('[CRON] volatile-scan: failed to place order', { symbol: d.symbol, error: e });
            }
          }
        }
      } catch (fsErr) {
        logger.warn('[CRON] volatile-scan: could not read ai-decisions.json', { error: fsErr });
      }
    }

    await savePortfolioSnapshot();
    await logHeartbeat('volatile-scan', 'completed',
      `${volatilePositions.length} volatile positions | ${cryptoPositions.length} crypto | ${stockPositions.length} volatile stocks`
    );

    io?.emit('volatile-scan:complete', {
      timestamp: new Date().toISOString(),
      volatilePositions: volatilePositions.length,
      emergencyCloses: emergencyClose.filter((e) => e.shouldClose).length,
      trailingStops: trailingStop.filter((t) => t.shouldClose).length,
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('[CRON] volatile-scan failed', { error: errMsg });
    await logHeartbeat('volatile-scan', 'failed', errMsg);
  }
}

// ─── Scheduler bootstrap ─────────────────────────────────────────────────────

export function startScheduler(io?: SocketServer): void {
  /**
   * All times in America/New_York (ET).
   * Colombia (UTC-5) is always 1 hour behind ET (ET = UTC-4 or UTC-5 depending on DST).
   *
   * Cron format: minute hour day-of-month month day-of-week
   *
   * Brief schedule (Colombia time → ET):
   *   08:00 CO → 09:00 ET → morning-scan
   *   09:00 CO → 10:00 ET → strategy-eval
   *   09:15 CO → 10:15 ET → place-orders
   *   12:00 CO → 13:00 ET → midday-review
   *   18:00 CO → 19:00 ET → evening-scan
   *   16:15 CO → 17:15 ET → journal-entry (after market close)
   */

  // 9:00 AM ET (8:00 AM Colombia) Mon-Fri → morning-scan
  cron.schedule('0 9 * * 1-5', () => morningScan(io), { timezone: 'America/New_York' });

  // 10:00 AM ET (9:00 AM Colombia) Mon-Fri → strategy-eval
  cron.schedule('0 10 * * 1-5', () => strategyEval(io), { timezone: 'America/New_York' });

  // 10:15 AM ET (9:15 AM Colombia) Mon-Fri → place-orders
  cron.schedule('15 10 * * 1-5', () => placeOrders(io), { timezone: 'America/New_York' });

  // 1:00 PM ET (12:00 PM Colombia) Mon-Fri → midday-review
  cron.schedule('0 13 * * 1-5', () => middayReview(io), { timezone: 'America/New_York' });

  // 7:00 PM ET (6:00 PM Colombia) Mon-Fri → evening-scan
  cron.schedule('0 19 * * 1-5', () => eveningScan(io), { timezone: 'America/New_York' });

  // 5:15 PM ET (4:15 PM Colombia) Mon-Fri → journal-entry (after close)
  cron.schedule('15 17 * * 1-5', () => endOfDayJournal(io), { timezone: 'America/New_York' });

  // Portfolio snapshot every hour during market hours (9-17 ET)
  cron.schedule('0 9-17 * * 1-5', async () => {
    try {
      await savePortfolioSnapshot();
      const account = await alpacaService.getAccount();
      io?.emit('portfolio:update', {
        timestamp: new Date().toISOString(),
        portfolio_value: account.portfolio_value,
        cash: account.cash,
        equity: account.equity,
      });
    } catch (error) {
      logger.error('[CRON] Hourly snapshot failed', { error });
    }
  }, { timezone: 'America/New_York' });

  // Volatile scan every hour, 24/7 (crypto never sleeps)
  // Runs at :30 each hour to avoid colliding with other routines
  cron.schedule('30 * * * *', () => volatileScan(io));

  logger.info('[CRON] Scheduler started', {
    routines: [
      '09:00 ET (08:00 CO) — morning-scan',
      '10:00 ET (09:00 CO) — strategy-eval',
      '10:15 ET (09:15 CO) — place-orders',
      '13:00 ET (12:00 CO) — midday-review',
      '17:15 ET (16:15 CO) — journal-entry',
      '19:00 ET (18:00 CO) — evening-scan',
      'Hourly (09–17 ET)   — portfolio snapshot',
      'Cada hora :30       — volatile-scan (crypto 24/7)',
    ],
  });
}

// Manual trigger exports for API routes and Claude Scheduled Tasks
export { morningScan, strategyEval, placeOrders, middayReview, eveningScan, endOfDayJournal, volatileScan };

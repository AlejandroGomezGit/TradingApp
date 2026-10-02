import { alpacaService } from './alpaca.service';
import { generateJournalReflection } from './claude.service';
import { query, queryOne } from '../db/connection';
import { logger } from '../middleware/logger';
import { JournalEntry, PortfolioSnapshot, ResearchData, TradeDecision } from '../types';

export async function savePortfolioSnapshot(): Promise<void> {
  const account = await alpacaService.getAccount();
  const today = new Date().toISOString().split('T')[0];

  const yesterday = await queryOne<PortfolioSnapshot>(
    `SELECT portfolio_value FROM portfolio_snapshots
     WHERE date = (CURRENT_DATE - INTERVAL '1 day')::DATE`
  );

  const dailyPnl = yesterday
    ? account.portfolio_value - (yesterday.portfolio_value as unknown as number)
    : 0;

  const positions = await alpacaService.getPositions();

  await query(
    `INSERT INTO portfolio_snapshots (date, portfolio_value, cash, equity, daily_pnl, positions_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (date) DO UPDATE SET
       portfolio_value = EXCLUDED.portfolio_value,
       cash = EXCLUDED.cash,
       equity = EXCLUDED.equity,
       daily_pnl = EXCLUDED.daily_pnl,
       positions_count = EXCLUDED.positions_count`,
    [today, account.portfolio_value, account.cash, account.equity, dailyPnl, positions.length]
  );

  logger.info('Portfolio snapshot saved', {
    date: today,
    portfolio_value: account.portfolio_value,
    daily_pnl: dailyPnl,
  });
}

export async function writeJournalEntry(
  research: ResearchData[],
  tradesPlaced: TradeDecision[]
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const [account, positions] = await Promise.all([
    alpacaService.getAccount(),
    alpacaService.getPositions(),
  ]);

  const yesterday = await queryOne<PortfolioSnapshot>(
    `SELECT portfolio_value FROM portfolio_snapshots
     WHERE date = (CURRENT_DATE - INTERVAL '1 day')::DATE`
  );

  const dailyPnl = yesterday
    ? account.portfolio_value - (yesterday.portfolio_value as unknown as number)
    : 0;
  const dailyPnlPct = yesterday
    ? (dailyPnl / (yesterday.portfolio_value as unknown as number)) * 100
    : 0;

  const researchSummary = research
    .map(
      (r) =>
        `${r.symbol}: ${r.technicals.trend} | SMA20=$${r.technicals.sma20.toFixed(2)} SMA50=$${r.technicals.sma50.toFixed(2)} RSI=${r.technicals.rsi.toFixed(0)} | ${r.news.length} noticias`
    )
    .join('\n');

  const tradesSummary =
    tradesPlaced.length > 0
      ? tradesPlaced
          .map(
            (t) =>
              `${t.action.toUpperCase()} ${t.symbol}: ${t.qty} acciones @ $${t.limit_price?.toFixed(2)} (${t.reasoning})`
          )
          .join('\n')
      : 'Sin operaciones ejecutadas hoy.';

  const reflection = await generateJournalReflection({
    account,
    positions,
    tradesPlaced,
    research,
    previousPnl: yesterday ? (yesterday.portfolio_value as unknown as number) : undefined,
  });

  const entry: JournalEntry = {
    date: today,
    portfolio_value: account.portfolio_value,
    cash: account.cash,
    daily_pnl: dailyPnl,
    daily_pnl_pct: dailyPnlPct,
    research_summary: researchSummary,
    trades_summary: tradesSummary,
    reflection,
    positions_snapshot: positions,
  };

  await query(
    `INSERT INTO journal_entries
       (date, portfolio_value, cash, daily_pnl, daily_pnl_pct, research_summary, trades_summary, reflection, positions_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (date) DO UPDATE SET
       portfolio_value = EXCLUDED.portfolio_value,
       cash = EXCLUDED.cash,
       daily_pnl = EXCLUDED.daily_pnl,
       daily_pnl_pct = EXCLUDED.daily_pnl_pct,
       research_summary = EXCLUDED.research_summary,
       trades_summary = EXCLUDED.trades_summary,
       reflection = EXCLUDED.reflection,
       positions_snapshot = EXCLUDED.positions_snapshot`,
    [
      entry.date,
      entry.portfolio_value,
      entry.cash,
      entry.daily_pnl,
      entry.daily_pnl_pct,
      entry.research_summary,
      entry.trades_summary,
      entry.reflection,
      JSON.stringify(entry.positions_snapshot),
    ]
  );

  logger.info('Journal entry written', { date: today });
}

export async function logHeartbeat(routine: string, status: string, message?: string): Promise<void> {
  await query(
    `INSERT INTO agent_heartbeats (routine, status, message) VALUES ($1, $2, $3)`,
    [routine, status, message || null]
  );
}

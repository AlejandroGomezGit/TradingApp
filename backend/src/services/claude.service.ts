import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../middleware/logger';
import { Account, Position, ResearchData, TradeDecision, WatchlistItem } from '../types';

// ─── AI Decisions file (written by the Cowork Scheduled Task) ───────────────
//
// The Scheduled Task runs at 09:07 CO time (10:07 ET), after strategy-eval
// and before place-orders, and writes a JSON file with its analysis.
// This lets Claude make decisions without the bot needing an API key at runtime.

const AI_DECISIONS_PATH = path.join(process.cwd(), 'data', 'ai-decisions.json');

interface AIDecisionsFile {
  generated_at: string;    // ISO timestamp
  valid_until: string;     // ISO timestamp — bot ignores the file if expired
  analyst_notes: string;   // Free-text market context for the logs
  decisions: TradeDecision[];
}

function readAIDecisions(): AIDecisionsFile | null {
  try {
    if (!fs.existsSync(AI_DECISIONS_PATH)) return null;

    const raw = fs.readFileSync(AI_DECISIONS_PATH, 'utf-8');
    const parsed: AIDecisionsFile = JSON.parse(raw);

    const generatedAt = new Date(parsed.generated_at);
    const now = new Date();

    // Decisions are valid until end of trading day (21:00 UTC = 17:00 ET),
    // even if valid_until was set to a shorter window by the Scheduled Task.
    // We compare calendar dates in ET timezone.
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etGenerated = new Date(generatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const sameDay =
      etNow.getFullYear() === etGenerated.getFullYear() &&
      etNow.getMonth() === etGenerated.getMonth() &&
      etNow.getDate() === etGenerated.getDate();

    // End of trading day in ET = 21:00 UTC
    const endOfTradingDay = new Date(now);
    endOfTradingDay.setUTCHours(21, 0, 0, 0);

    const effectiveExpiry = sameDay
      ? endOfTradingDay              // generated today → valid until 21:00 UTC
      : new Date(parsed.valid_until); // old file → use whatever it says

    if (effectiveExpiry < now) {
      logger.warn('[AI-Decisions] File expired — ignoring', {
        valid_until: parsed.valid_until,
        effective_expiry: effectiveExpiry.toISOString(),
        generated_at: parsed.generated_at,
      });
      return null;
    }

    logger.info('[AI-Decisions] Loaded decisions from Scheduled Task', {
      generated_at: parsed.generated_at,
      effective_expiry: effectiveExpiry.toISOString(),
      count: parsed.decisions.length,
      analyst_notes: parsed.analyst_notes,
    });
    return parsed;
  } catch (e) {
    logger.error('[AI-Decisions] Failed to read file', {
      error: e instanceof Error ? e.message : String(e),
      path: AI_DECISIONS_PATH,
    });
    return null;
  }
}

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are an autonomous AI trading agent managing a paper portfolio.

RULES (NEVER VIOLATE):
- Never recommend investing more than the symbol's max_allocation_pct of total portfolio value in a single position
- Always recommend limit orders, never market orders
- If a position has dropped 8%+ from entry price, recommend closing it (stop-loss)
- Always keep at least 20% of portfolio in cash
- Only recommend trades when the market is open
- Consider both technical signals AND recent news sentiment

DECISION FRAMEWORK:
Before each trade decision:
1. Check current cash balance and existing positions
2. Review the technical trend (SMA20 vs SMA50, RSI)
3. Evaluate recent news sentiment
4. Calculate position size respecting the allocation limit
5. Assess risk/reward ratio

RESPONSE FORMAT:
You MUST respond with a valid JSON array of TradeDecision objects:
[
  {
    "symbol": "AAPL",
    "action": "buy" | "sell" | "hold",
    "qty": 10,
    "limit_price": 185.50,
    "reasoning": "Clear explanation of the decision",
    "confidence": 0.75
  }
]

For "hold" decisions, qty and limit_price can be omitted.
Confidence should be between 0.0 and 1.0.
Only recommend trades with confidence >= 0.6.`;

export async function getTradeDecisions(
  account: Account,
  positions: Position[],
  research: ResearchData[],
  watchlist: WatchlistItem[]
): Promise<TradeDecision[]> {
  // ── Priority 1: Decisions written by the Cowork Scheduled Task ─────────────
  // The Scheduled Task (Claude in Cowork) runs before place-orders, analyzes
  // the market with full context, and writes decisions to ai-decisions.json.
  // This is the preferred source — no API key needed at bot runtime.
  const aiFileDecisions = readAIDecisions();
  if (aiFileDecisions) {
    return aiFileDecisions.decisions;
  }

  // ── Priority 2: Live Claude API (if key is configured) ────────────────────
  if (!config.anthropic.apiKey) {
    logger.warn('No Anthropic API key and no AI decisions file — using rule-based fallback');
    return getRuleBasedDecisions(account, positions, research, watchlist);
  }

  const positionsMap = Object.fromEntries(positions.map((p) => [p.symbol, p]));

  const prompt = `
PORTFOLIO STATE:
- Cash: $${account.cash.toFixed(2)}
- Portfolio Value: $${account.portfolio_value.toFixed(2)}
- Buying Power: $${account.buying_power.toFixed(2)}
- Open Positions: ${JSON.stringify(positions, null, 2)}

WATCHLIST LIMITS:
${watchlist.map((w) => `- ${w.symbol}: max ${w.max_allocation_pct}% of portfolio`).join('\n')}

MARKET RESEARCH:
${research
  .map(
    (r) => `
### ${r.symbol}
- Current Price: $${r.snapshot?.latestTrade?.p?.toFixed(2) ?? 'N/A'}
- Daily Change: ${r.snapshot?.dailyBar && r.snapshot?.prevDailyBar
    ? (((r.snapshot.dailyBar.c - r.snapshot.prevDailyBar.c) / r.snapshot.prevDailyBar.c) * 100).toFixed(2)
    : 'N/A'}%
- SMA20: $${r.technicals.sma20.toFixed(2)} | SMA50: $${r.technicals.sma50.toFixed(2)}
- RSI: ${r.technicals.rsi.toFixed(1)}
- Trend: ${r.technicals.trend}
- Current Position: ${positionsMap[r.symbol] ? `${positionsMap[r.symbol].qty} shares @ $${positionsMap[r.symbol].avg_entry_price.toFixed(2)} (P&L: ${(positionsMap[r.symbol].unrealized_plpc * 100).toFixed(2)}%)` : 'None'}
- Recent News (${r.news.length} items):
${r.news
  .slice(0, 3)
  .map((n) => `  * ${n.headline}`)
  .join('\n')}
`
  )
  .join('\n')}

STOP-LOSS CHECK:
${positions
  .filter((p) => p.unrealized_plpc < -0.08)
  .map((p) => `- ${p.symbol}: DOWN ${(p.unrealized_plpc * 100).toFixed(2)}% — CLOSE IMMEDIATELY`)
  .join('\n') || 'No stop-loss triggers.'}

Based on this data, provide your trading decisions as a JSON array.`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in Claude response');
    }

    const decisions: TradeDecision[] = JSON.parse(jsonMatch[0]);
    logger.info('Claude decisions received', {
      count: decisions.length,
      decisions: decisions.map((d) => `${d.symbol}:${d.action}`),
    });
    return decisions;
  } catch (error) {
    logger.error('Claude API error, falling back to rule-based', {
      error: error instanceof Error ? error.message : String(error),
    });
    return getRuleBasedDecisions(account, positions, research, watchlist);
  }
}

export async function generateJournalReflection(params: {
  account: Account;
  positions: Position[];
  tradesPlaced: TradeDecision[];
  research: ResearchData[];
  previousPnl?: number;
}): Promise<string> {
  if (!config.anthropic.apiKey) {
    return `Sesión completada. Portfolio: $${params.account.portfolio_value.toFixed(2)}. Trades ejecutados: ${params.tradesPlaced.length}.`;
  }

  const prompt = `Write a concise trading journal reflection (3-5 sentences) for today's session:
- Portfolio Value: $${params.account.portfolio_value.toFixed(2)}
- Daily P&L: ${params.previousPnl !== undefined ? `$${(params.account.portfolio_value - params.previousPnl).toFixed(2)}` : 'N/A'}
- Trades Placed: ${params.tradesPlaced.length}
- Decisions: ${params.tradesPlaced.map((t) => `${t.symbol} ${t.action}`).join(', ') || 'No trades'}
- Market Sentiment: ${params.research.map((r) => `${r.symbol}(${r.technicals.trend})`).join(', ')}

Be analytical, mention specific symbols, and note what to watch tomorrow.`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  } catch {
    return `Sesión completada. Portfolio: $${params.account.portfolio_value.toFixed(2)}.`;
  }
}

// Fallback: simple rule-based decisions when Claude is not available
function getRuleBasedDecisions(
  account: Account,
  positions: Position[],
  research: ResearchData[],
  watchlist: WatchlistItem[]
): TradeDecision[] {
  const decisions: TradeDecision[] = [];

  // Stop-loss triggers first
  for (const position of positions) {
    if (position.unrealized_plpc < -0.08) {
      decisions.push({
        symbol: position.symbol,
        action: 'sell',
        qty: position.qty,
        limit_price: parseFloat((position.current_price * 0.998).toFixed(2)),
        reasoning: `Stop-loss triggered: down ${(position.unrealized_plpc * 100).toFixed(2)}%`,
        confidence: 1.0,
      });
    }
  }

  // Simple trend-following for buy signals
  const cashReserve = account.portfolio_value * (config.trading.cashReservePct / 100);
  const availableCash = account.cash - cashReserve;

  for (const r of research) {
    const hasPosition = positions.find((p) => p.symbol === r.symbol);
    if (hasPosition) continue;

    const watchItem = watchlist.find((w) => w.symbol === r.symbol);
    if (!watchItem) continue;

    if (
      r.technicals.trend === 'bullish' &&
      r.technicals.rsi < 65 &&
      r.technicals.rsi > 40 &&
      availableCash > 1000
    ) {
      const currentPrice = r.snapshot?.latestTrade?.p || r.bars[r.bars.length - 1]?.c || 0;
      const maxInvestment = account.portfolio_value * (watchItem.max_allocation_pct / 100);
      const investment = Math.min(maxInvestment, availableCash * 0.5);
      const qty = Math.floor(investment / currentPrice);

      if (qty > 0 && currentPrice > 0) {
        decisions.push({
          symbol: r.symbol,
          action: 'buy',
          qty,
          limit_price: parseFloat((currentPrice * 1.002).toFixed(2)),
          reasoning: `Rule-based: Bullish trend, SMA20 > SMA50, RSI=${r.technicals.rsi.toFixed(0)}`,
          confidence: 0.65,
        });
      }
    }
  }

  return decisions;
}

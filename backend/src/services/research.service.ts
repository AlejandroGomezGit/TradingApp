import { alpacaService } from './alpaca.service';
import { coinGeckoService, FearGreedData, TrendingCoin } from './coingecko.service';
import { logger } from '../middleware/logger';
import { Bar, ResearchData, WatchlistItem } from '../types';

// ─── Moving Averages ────────────────────────────────────────────────────────

function calculateSMA(bars: Bar[], period: number): number {
  if (bars.length < period) return 0;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.c, 0) / period;
}

function calculateEMA(bars: Bar[], period: number): number[] {
  if (bars.length < period) return bars.map(() => 0);
  const k = 2 / (period + 1);
  const closes = bars.map((b) => b.c);
  const emas: number[] = [];

  // Seed with SMA for the first value
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emas.push(seed);

  for (let i = period; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[emas.length - 1] * (1 - k));
  }

  return emas;
}

// ─── RSI ────────────────────────────────────────────────────────────────────

function calculateRSI(bars: Bar[], period = 14): number {
  if (bars.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = bars.length - period; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ───────────────────────────────────────────────────────────────────

export interface MACDResult {
  macdLine: number;       // EMA12 - EMA26
  signalLine: number;     // EMA9 of MACD
  histogram: number;      // MACD - Signal
  bullishCrossover: boolean;
}

function calculateMACD(bars: Bar[]): MACDResult {
  const empty: MACDResult = { macdLine: 0, signalLine: 0, histogram: 0, bullishCrossover: false };
  if (bars.length < 35) return empty;

  const ema12 = calculateEMA(bars, 12);
  const ema26 = calculateEMA(bars, 26);

  // Align: ema26 starts at index 25, ema12 starts at index 11
  // After calculateEMA the arrays have (bars.length - period + 1) elements each
  const len12 = ema12.length; // bars.length - 11
  const len26 = ema26.length; // bars.length - 25

  // Build MACD line over the overlapping tail
  const macdLine: number[] = [];
  for (let i = 0; i < len26; i++) {
    const e12 = ema12[len12 - len26 + i];
    const e26 = ema26[i];
    macdLine.push(e12 - e26);
  }

  // Signal = EMA9 of macdLine
  const signalBars = macdLine.map((c) => ({ c } as Bar));
  const signalEMAs = calculateEMA(signalBars, 9);
  const signal = signalEMAs[signalEMAs.length - 1] ?? 0;

  const currentMACD = macdLine[macdLine.length - 1] ?? 0;
  const prevMACD = macdLine[macdLine.length - 2] ?? 0;
  const prevSignal = signalEMAs[signalEMAs.length - 2] ?? 0;

  const bullishCrossover = prevMACD < prevSignal && currentMACD > signal;

  return {
    macdLine: currentMACD,
    signalLine: signal,
    histogram: currentMACD - signal,
    bullishCrossover,
  };
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number;
  middle: number;   // SMA20
  lower: number;
  bandwidth: number;
  percentB: number; // where price is relative to the bands (0 = lower, 1 = upper)
  nearLowerBand: boolean;
  nearUpperBand: boolean;
}

function calculateBollinger(bars: Bar[], period = 20, stdDev = 2): BollingerResult {
  const empty: BollingerResult = {
    upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5,
    nearLowerBand: false, nearUpperBand: false,
  };
  if (bars.length < period) return empty;

  const slice = bars.slice(-period);
  const middle = slice.reduce((s, b) => s + b.c, 0) / period;
  const variance = slice.reduce((s, b) => s + Math.pow(b.c - middle, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const currentPrice = bars[bars.length - 1].c;

  const bandwidth = (upper - lower) / middle;
  const percentB = (currentPrice - lower) / (upper - lower);

  return {
    upper,
    middle,
    lower,
    bandwidth,
    percentB,
    nearLowerBand: percentB < 0.2,   // price within 20% of lower band
    nearUpperBand: percentB > 0.8,
  };
}

// ─── ATR (Average True Range) ───────────────────────────────────────────────

function calculateATR(bars: Bar[], period = 14): number {
  if (bars.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const highLow = bars[i].h - bars[i].l;
    const highClose = Math.abs(bars[i].h - bars[i - 1].c);
    const lowClose = Math.abs(bars[i].l - bars[i - 1].c);
    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }

  const recent = trueRanges.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / period;
}

// ─── EMA Crossover ──────────────────────────────────────────────────────────

export interface EMACrossoverResult {
  ema9: number;
  ema21: number;
  bullishCrossover: boolean;  // ema9 just crossed above ema21
  trend: 'bullish' | 'bearish' | 'neutral';
}

function calculateEMACrossover(bars: Bar[]): EMACrossoverResult {
  const empty: EMACrossoverResult = { ema9: 0, ema21: 0, bullishCrossover: false, trend: 'neutral' };
  if (bars.length < 22) return empty;

  const ema9s = calculateEMA(bars, 9);
  const ema21s = calculateEMA(bars, 21);

  const ema9 = ema9s[ema9s.length - 1] ?? 0;
  const ema21 = ema21s[ema21s.length - 1] ?? 0;
  const prevEma9 = ema9s[ema9s.length - 2] ?? 0;
  const prevEma21 = ema21s[ema21s.length - 2] ?? 0;

  const bullishCrossover = prevEma9 < prevEma21 && ema9 > ema21;
  let trend: EMACrossoverResult['trend'] = 'neutral';
  if (ema9 > ema21) trend = 'bullish';
  else if (ema9 < ema21) trend = 'bearish';

  return { ema9, ema21, bullishCrossover, trend };
}

// ─── Composite trend signal ─────────────────────────────────────────────────

function determineTrend(
  sma20: number,
  sma50: number,
  rsi: number,
  macd: MACDResult,
  ema: EMACrossoverResult,
): 'bullish' | 'bearish' | 'neutral' {
  let score = 0;

  if (sma20 > sma50) score++;
  else score--;

  if (rsi > 45 && rsi < 70) score++;
  else if (rsi > 70) score--;
  else if (rsi < 35) score += 0.5; // oversold = potential reversal

  if (macd.histogram > 0) score++;
  else score--;

  if (ema.trend === 'bullish') score++;
  else if (ema.trend === 'bearish') score--;

  if (score >= 2) return 'bullish';
  if (score <= -2) return 'bearish';
  return 'neutral';
}

// ─── Extended ResearchData type ─────────────────────────────────────────────

export interface ExtendedTechnicals {
  sma20: number;
  sma50: number;
  rsi: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  macd: MACDResult;
  bollinger: BollingerResult;
  ema: EMACrossoverResult;
  atr: number;
  dynamicStopLoss: number;   // entry - 1.5 × ATR (used at order time)
}

export interface SentimentData {
  fearGreed: FearGreedData;
  trending: TrendingCoin[];
  isTrending: boolean;
}

export interface FullResearchData extends ResearchData {
  technicals: ExtendedTechnicals;
  sentiment: SentimentData;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runResearch(watchlist: WatchlistItem[]): Promise<FullResearchData[]> {
  const symbols = watchlist.filter((w) => w.active).map((w) => w.symbol);
  logger.info('Starting market research', { symbols });

  // Fetch all data in parallel
  const [barsMap, snapshots, news, fearGreed, trendingCoins] = await Promise.all([
    alpacaService.getMultiBars(symbols, '1Day', 60).catch((e) => {
      logger.error('Failed to fetch bars', { error: e.message });
      return {} as Record<string, Bar[]>;
    }),
    alpacaService.getSnapshots(symbols).catch((e) => {
      logger.error('Failed to fetch snapshots', { error: e.message });
      return {} as Record<string, import('../types').AlpacaSnapshot>;
    }),
    alpacaService.getNews(symbols, 10).catch((e) => {
      logger.error('Failed to fetch news', { error: e.message });
      return [];
    }),
    coinGeckoService.getFearAndGreed(),
    coinGeckoService.getTrendingCoins(),
  ]);

  const results: FullResearchData[] = [];

  for (const symbol of symbols) {
    const bars = barsMap[symbol] || [];

    // Technical indicators
    const sma20 = calculateSMA(bars, 20);
    const sma50 = calculateSMA(bars, 50);
    const rsi = calculateRSI(bars);
    const macd = calculateMACD(bars);
    const bollinger = calculateBollinger(bars);
    const ema = calculateEMACrossover(bars);
    const atr = calculateATR(bars);
    const trend = determineTrend(sma20, sma50, rsi, macd, ema);

    // Current price for dynamic stop-loss
    const currentPrice = bars[bars.length - 1]?.c ?? 0;
    const dynamicStopLoss = currentPrice > 0 ? currentPrice - 1.5 * atr : 0;

    // Symbol news
    const symbolNews = news.filter(
      (n) => n.symbols?.includes(symbol) || n.headline?.includes(symbol)
    );

    // Trending check (strip /USD suffix for crypto symbols)
    const baseSymbol = symbol.replace('/USD', '').replace('/USDT', '');
    const isTrending = trendingCoins.some(
      (c) => c.symbol.toUpperCase() === baseSymbol.toUpperCase()
    );

    const technicals: ExtendedTechnicals = {
      sma20, sma50, rsi, trend,
      macd, bollinger, ema, atr,
      dynamicStopLoss,
    };

    const sentiment: SentimentData = {
      fearGreed,
      trending: trendingCoins,
      isTrending,
    };

    results.push({
      symbol,
      bars,
      news: symbolNews,
      snapshot: snapshots[symbol],
      technicals,
      sentiment,
    });

    logger.info('Research completed', {
      symbol,
      sma20: sma20.toFixed(2),
      sma50: sma50.toFixed(2),
      rsi: rsi.toFixed(1),
      trend,
      macdHistogram: macd.histogram.toFixed(4),
      bollingerPercentB: bollinger.percentB.toFixed(2),
      ema9: ema.ema9.toFixed(2),
      ema21: ema.ema21.toFixed(2),
      atr: atr.toFixed(4),
      fearGreed: `${fearGreed.value} (${fearGreed.label})`,
      isTrending,
    });
  }

  return results;
}

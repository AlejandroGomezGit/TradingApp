export interface Trade {
  id?: number;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  limit_price: number;
  filled_price?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  alpaca_order_id?: string;
  reasoning: string;
  created_at?: Date;
  filled_at?: Date;
}

export interface Position {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  side: string;
}

export interface Account {
  id: string;
  cash: number;
  portfolio_value: number;
  equity: number;
  buying_power: number;
  currency: string;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
}

export interface NewsItem {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  symbols: string[];
  url: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface WatchlistItem {
  id?: number;
  symbol: string;
  description: string;
  max_allocation_pct: number;
  active: boolean;
  /** 'conservative' = reglas estándar | 'volatile' = crypto/high-risk con reglas propias */
  bucket: 'conservative' | 'volatile';
}

export interface JournalEntry {
  id?: number;
  date: string;
  portfolio_value: number;
  cash: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  research_summary: string;
  trades_summary: string;
  reflection: string;
  positions_snapshot: Position[];
  created_at?: Date;
}

export interface TradeDecision {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  qty?: number;
  limit_price?: number;
  reasoning: string;
  confidence: number;
  /** Bucket al que pertenece el símbolo (heredado de watchlist) */
  bucket?: 'conservative' | 'volatile';
}

export interface ResearchData {
  symbol: string;
  bars: Bar[];
  news: NewsItem[];
  snapshot?: AlpacaSnapshot;
  technicals: {
    sma20: number;
    sma50: number;
    rsi: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  };
}

export interface AlpacaSnapshot {
  symbol: string;
  latestTrade: { p: number; s: number; t: string };
  latestQuote: { ap: number; bp: number; as: number; bs: number; t: string };
  dailyBar: { o: number; h: number; l: number; c: number; v: number };
  prevDailyBar: { o: number; h: number; l: number; c: number; v: number };
}

export interface MarketClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface PortfolioSnapshot {
  id?: number;
  date: string;
  portfolio_value: number;
  cash: number;
  equity: number;
  daily_pnl: number;
  created_at?: Date;
}

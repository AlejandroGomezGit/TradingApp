import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../middleware/logger';
import {
  Account,
  Bar,
  MarketClock,
  NewsItem,
  Position,
  AlpacaSnapshot,
  Trade,
} from '../types';

// Crypto symbols that use different Alpaca endpoints
const CRYPTO_SYMBOLS = new Set(['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'AVAX/USD']);

/** ISO date string for N calendar days ago */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

class AlpacaService {
  private broker: AxiosInstance;
  private data: AxiosInstance;

  constructor() {
    const headers = {
      'APCA-API-KEY-ID': config.alpaca.keyId,
      'APCA-API-SECRET-KEY': config.alpaca.secretKey,
    };

    this.broker = axios.create({
      baseURL: config.alpaca.baseUrl,
      headers,
      timeout: 15000,
    });

    this.data = axios.create({
      baseURL: config.alpaca.dataUrl,
      headers,
      timeout: 15000,
    });
  }

  async getAccount(): Promise<Account> {
    const { data } = await this.broker.get('/v2/account');
    return {
      id: data.id,
      cash: parseFloat(data.cash),
      portfolio_value: parseFloat(data.portfolio_value),
      equity: parseFloat(data.equity),
      buying_power: parseFloat(data.buying_power),
      currency: data.currency,
    };
  }

  async getPositions(): Promise<Position[]> {
    const { data } = await this.broker.get('/v2/positions');
    return data.map((p: Record<string, string>) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      avg_entry_price: parseFloat(p.avg_entry_price),
      current_price: parseFloat(p.current_price),
      market_value: parseFloat(p.market_value),
      unrealized_pl: parseFloat(p.unrealized_pl),
      unrealized_plpc: parseFloat(p.unrealized_plpc),
      side: p.side,
    }));
  }

  async getMarketClock(): Promise<MarketClock> {
    const { data } = await this.broker.get('/v2/clock');
    return data as MarketClock;
  }

  async getBars(
    symbol: string,
    timeframe = '1Day',
    limit = 60
  ): Promise<Bar[]> {
    // Crypto uses a different endpoint
    if (CRYPTO_SYMBOLS.has(symbol)) {
      return this.getCryptoBarsForSymbol(symbol, timeframe, limit);
    }

    // Stock historical bars — SIP feed (default), with explicit date range
    // so Alpaca doesn't silently return nothing when limit is the only param.
    const start = daysAgo(120);  // 120 calendar days = ~85 trading days
    try {
      const { data } = await this.data.get(`/v2/stocks/${symbol}/bars`, {
        params: { timeframe, limit, adjustment: 'raw', sort: 'asc', start },
      });
      const bars = (data.bars || []) as Bar[];
      if (bars.length === 0) {
        logger.warn('getBars returned empty', { symbol, timeframe, start, hint: 'check API key data subscription' });
      }
      return bars;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('getBars failed', { symbol, error: msg });
      return [];
    }
  }

  /** Fetch historical bars for a single crypto symbol via the crypto endpoint */
  private async getCryptoBarsForSymbol(
    symbol: string,
    timeframe = '1Day',
    limit = 60
  ): Promise<Bar[]> {
    const start = daysAgo(120);
    try {
      const { data } = await this.data.get('/v1beta3/crypto/us/bars', {
        params: { symbols: symbol, timeframe, limit, sort: 'asc', start },
      });
      const barsMap = (data.bars || {}) as Record<string, Bar[]>;
      const bars = barsMap[symbol] || [];
      if (bars.length === 0) {
        logger.warn('getCryptoBars returned empty', { symbol, timeframe, start });
      }
      return bars;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('getCryptoBars failed', { symbol, error: msg });
      return [];
    }
  }

  async getMultiBars(
    symbols: string[],
    timeframe = '1Day',
    limit = 60
  ): Promise<Record<string, Bar[]>> {
    // ── STRATEGY: parallel individual fetches ─────────────────────────────
    // The Alpaca multi-symbol bulk endpoint uses `limit` as a TOTAL page cap
    // across all symbols — not per symbol. With 14 symbols and limit=60, each
    // symbol gets ~4 bars, which is not enough for RSI(14) or MACD(26).
    // Fetching individually in parallel guarantees `limit` bars per symbol.
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const bars = await this.getBars(symbol, timeframe, limit);
        return { symbol, bars };
      })
    );

    const barsMap: Record<string, Bar[]> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        barsMap[result.value.symbol] = result.value.bars;
      }
    }

    const summary = symbols.map((s) => `${s}:${(barsMap[s] || []).length}`).join(' ');
    logger.info('getMultiBars complete', { summary });

    return barsMap;
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, AlpacaSnapshot>> {
    const result: Record<string, AlpacaSnapshot> = {};

    const stockSymbols = symbols.filter((s) => !CRYPTO_SYMBOLS.has(s));
    const cryptoSymbols = symbols.filter((s) => CRYPTO_SYMBOLS.has(s));

    // Stock snapshots (IEX feed for real-time quotes)
    if (stockSymbols.length > 0) {
      try {
        const { data } = await this.data.get('/v2/stocks/snapshots', {
          params: { symbols: stockSymbols.join(','), feed: 'iex' },
        });
        Object.assign(result, data || {});
      } catch (err) {
        logger.warn('getSnapshots stocks failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Crypto snapshots (separate endpoint, no feed param)
    if (cryptoSymbols.length > 0) {
      try {
        const { data } = await this.data.get('/v1beta3/crypto/us/snapshots', {
          params: { symbols: cryptoSymbols.join(',') },
        });
        // Crypto snapshot response: { "snapshots": { "BTC/USD": {...} } }
        const snapshots = data.snapshots || data || {};
        Object.assign(result, snapshots);
      } catch (err) {
        logger.warn('getSnapshots crypto failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  async getNews(symbols: string[], limit = 5): Promise<NewsItem[]> {
    try {
      const { data } = await this.data.get('/v1beta1/news', {
        params: { symbols: symbols.join(','), limit, sort: 'desc' },
      });
      return (data.news || []) as NewsItem[];
    } catch {
      logger.warn('Could not fetch news', { symbols });
      return [];
    }
  }

  async placeOrder(params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    limitPrice: number;
  }): Promise<{ orderId: string; status: string }> {
    // Crypto trades 24/7 — Alpaca rejects 'day' TIF for crypto orders, must use 'gtc'
    const isCrypto = CRYPTO_SYMBOLS.has(params.symbol);
    const timeInForce = isCrypto ? 'gtc' : 'day';

    const { data } = await this.broker.post('/v2/orders', {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: 'limit',
      time_in_force: timeInForce,
      limit_price: params.limitPrice.toFixed(2),
    });
    logger.info('Order placed', {
      symbol: params.symbol,
      side: params.side,
      qty: params.qty,
      limitPrice: params.limitPrice,
      orderId: data.id,
    });
    return { orderId: data.id, status: data.status };
  }

  async getOrders(status = 'all', limit = 50): Promise<Trade[]> {
    const { data } = await this.broker.get('/v2/orders', {
      params: { status, limit, direction: 'desc' },
    });
    return data.map((o: Record<string, string | number>) => ({
      symbol: o.symbol as string,
      side: o.side as 'buy' | 'sell',
      qty: parseFloat(o.qty as string),
      limit_price: parseFloat((o.limit_price || '0') as string),
      filled_price: o.filled_avg_price
        ? parseFloat(o.filled_avg_price as string)
        : undefined,
      status: o.status as string,
      alpaca_order_id: o.id as string,
      reasoning: '',
      created_at: new Date(o.created_at as string),
    }));
  }

  async cancelAllOrders(): Promise<void> {
    await this.broker.delete('/v2/orders');
    logger.info('All open orders cancelled');
  }

  async closePosition(symbol: string): Promise<void> {
    await this.broker.delete(`/v2/positions/${symbol}`);
    logger.info('Position closed', { symbol });
  }
}

export const alpacaService = new AlpacaService();

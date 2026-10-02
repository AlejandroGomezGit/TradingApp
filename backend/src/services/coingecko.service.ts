import axios, { AxiosInstance } from 'axios';
import { logger } from '../middleware/logger';

export interface FearGreedData {
  value: number;          // 0–100
  label: string;          // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  signal: 'buy' | 'sell' | 'neutral';   // contrarian interpretation
}

export interface TrendingCoin {
  symbol: string;
  name: string;
  rank: number;
  priceChangePercent24h: number;
}

class CoinGeckoService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 10000,
      headers: process.env.COINGECKO_API_KEY
        ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
        : {},
    });
  }

  /**
   * Fetch the Crypto Fear & Greed Index.
   * < 25 → Extreme Fear → contrarian BUY signal
   * > 80 → Extreme Greed → contrarian SELL signal
   */
  async getFearAndGreed(): Promise<FearGreedData> {
    try {
      // CoinGecko Pro has a native endpoint; free tier uses alternative.me
      const { data } = await axios.get('https://api.alternative.me/fng/', {
        params: { limit: 1 },
        timeout: 8000,
      });

      const entry = data?.data?.[0];
      if (!entry) throw new Error('No Fear & Greed data returned');

      const value = parseInt(entry.value, 10);
      const label = entry.value_classification as string;

      let signal: FearGreedData['signal'] = 'neutral';
      if (value < 25) signal = 'buy';
      else if (value > 80) signal = 'sell';

      logger.info('Fear & Greed fetched', { value, label, signal });
      return { value, label, signal };
    } catch (error) {
      logger.warn('Fear & Greed fetch failed, returning neutral', { error });
      return { value: 50, label: 'Neutral', signal: 'neutral' };
    }
  }

  /**
   * Fetch trending coins by search volume (last 24h).
   * Used to confirm social momentum before entering a position.
   */
  async getTrendingCoins(): Promise<TrendingCoin[]> {
    try {
      const { data } = await this.client.get('/search/trending');
      const coins: TrendingCoin[] = (data?.coins || [])
        .slice(0, 10)
        .map((item: Record<string, Record<string, string | number>>, idx: number) => ({
          symbol: String(item.item?.symbol ?? '').toUpperCase(),
          name: String(item.item?.name ?? ''),
          rank: idx + 1,
          priceChangePercent24h: Number(((item.item?.data as unknown) as Record<string, unknown> | undefined)?.price_change_percentage_24h ?? 0),
        }));
      logger.info('Trending coins fetched', { count: coins.length });
      return coins;
    } catch (error) {
      logger.warn('Trending coins fetch failed', { error });
      return [];
    }
  }

  /**
   * Check if a given symbol (e.g. "BTC", "ETH") is currently trending.
   */
  async isSymbolTrending(tickerSymbol: string): Promise<boolean> {
    const trending = await this.getTrendingCoins();
    const baseSymbol = tickerSymbol.replace('/USD', '').replace('/USDT', '');
    return trending.some((c) => c.symbol === baseSymbol.toUpperCase());
  }
}

export const coinGeckoService = new CoinGeckoService();

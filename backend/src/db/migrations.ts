import { pool } from './connection';
import { logger } from '../middleware/logger';

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Watchlist
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL UNIQUE,
        description TEXT,
        max_allocation_pct DECIMAL(5,2) NOT NULL DEFAULT 8.0,
        active BOOLEAN NOT NULL DEFAULT true,
        bucket VARCHAR(20) NOT NULL DEFAULT 'conservative',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add bucket column if upgrading from old schema
    await client.query(`
      ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS bucket VARCHAR(20) NOT NULL DEFAULT 'conservative'
    `);

    // Trades
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
        qty DECIMAL(15,4) NOT NULL,
        limit_price DECIMAL(15,4) NOT NULL,
        filled_price DECIMAL(15,4),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        alpaca_order_id VARCHAR(100),
        reasoning TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        filled_at TIMESTAMPTZ
      )
    `);

    // Journal entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        portfolio_value DECIMAL(15,2),
        cash DECIMAL(15,2),
        daily_pnl DECIMAL(15,2),
        daily_pnl_pct DECIMAL(8,4),
        research_summary TEXT,
        trades_summary TEXT,
        reflection TEXT,
        positions_snapshot JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Portfolio snapshots (daily history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        portfolio_value DECIMAL(15,2) NOT NULL,
        cash DECIMAL(15,2) NOT NULL,
        equity DECIMAL(15,2) NOT NULL,
        daily_pnl DECIMAL(15,2),
        positions_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Agent heartbeats
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_heartbeats (
        id SERIAL PRIMARY KEY,
        routine VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed watchlist — conservative bucket
    await client.query(`
      INSERT INTO watchlist (symbol, description, max_allocation_pct, bucket) VALUES
        ('SPY',  'S&P 500 ETF — baseline market exposure',          15.0, 'conservative'),
        ('QQQ',  'Nasdaq-100 ETF — tech sector exposure',           10.0, 'conservative'),
        ('NVDA', 'GPU/AI infrastructure — high conviction holding',  8.0, 'conservative'),
        ('AAPL', 'Large cap tech — stability anchor',                8.0, 'conservative'),
        ('MSFT', 'Cloud/enterprise — AI infrastructure play',        8.0, 'conservative'),
        ('META', 'Social/AI — ad revenue + LLM ecosystem',           6.0, 'conservative'),
        ('AMZN', 'Cloud + e-commerce — AWS dominant',                6.0, 'conservative'),
        ('XLK',  'Technology sector ETF — broad tech exposure',      8.0, 'conservative'),
        ('SOXX', 'Semiconductor ETF — chip cycle play',              6.0, 'conservative')
      ON CONFLICT (symbol) DO UPDATE SET
        description = EXCLUDED.description,
        max_allocation_pct = EXCLUDED.max_allocation_pct,
        bucket = EXCLUDED.bucket
    `);

    // Seed watchlist — volatile bucket (crypto + high-beta stocks)
    await client.query(`
      INSERT INTO watchlist (symbol, description, max_allocation_pct, bucket) VALUES
        ('BTC/USD', 'Bitcoin — digital gold, macro hedge',            3.0, 'volatile'),
        ('ETH/USD', 'Ethereum — smart contract platform',             2.0, 'volatile'),
        ('SOL/USD', 'Solana — high-throughput L1, max volatility',    1.5, 'volatile'),
        ('TSLA',    'Tesla — high-beta EV + AI robotics play',        3.0, 'volatile'),
        ('ARKK',    'ARK Innovation ETF — disruptive tech basket',    2.0, 'volatile')
      ON CONFLICT (symbol) DO UPDATE SET
        description = EXCLUDED.description,
        max_allocation_pct = EXCLUDED.max_allocation_pct,
        bucket = EXCLUDED.bucket
    `);

    await client.query('COMMIT');
    logger.info('Database migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Migration failed', { error });
    throw error;
  } finally {
    client.release();
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Fatal migration error', { error: err });
    process.exit(1);
  });

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'alejandro',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trading',
  },
  alpaca: {
    keyId: process.env.ALPACA_API_KEY_ID || '',
    secretKey: process.env.ALPACA_API_SECRET_KEY || '',
    baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
    dataUrl: 'https://data.alpaca.markets',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: 'claude-sonnet-4-6',
  },
  email: {
    user: process.env.GMAIL_USER || 'alejandrogomezg49@gmail.com',
    appPassword: process.env.GMAIL_APP_PASSWORD || '',
    notifyEmail: process.env.NOTIFY_EMAIL || 'alejandrogomezg49@gmail.com',
  },
  trading: {
    maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || '8'),
    cashReservePct: parseFloat(process.env.CASH_RESERVE_PCT || '20'),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '8'),
    maxLimitSlippage: parseFloat(process.env.MAX_LIMIT_SLIPPAGE || '0.2'),
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  },
  timezone: 'America/New_York',
};

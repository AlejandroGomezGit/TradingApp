import { Router } from 'express';
import { alpacaService } from '../services/alpaca.service';
import { query } from '../db/connection';

const router = Router();

router.get('/account', async (_req, res) => {
  try {
    const account = await alpacaService.getAccount();
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

router.get('/positions', async (_req, res) => {
  try {
    const positions = await alpacaService.getPositions();
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

router.get('/clock', async (_req, res) => {
  try {
    const clock = await alpacaService.getMarketClock();
    res.json(clock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market clock' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const days = parseInt(req.query['days'] as string) || 30;
    const snapshots = await query(
      `SELECT * FROM portfolio_snapshots
       WHERE date >= CURRENT_DATE - $1::int
       ORDER BY date ASC`,
      [days]
    );
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch portfolio history' });
  }
});

router.get('/heartbeats', async (_req, res) => {
  try {
    const heartbeats = await query(
      `SELECT * FROM agent_heartbeats ORDER BY created_at DESC LIMIT 20`
    );
    res.json(heartbeats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch heartbeats' });
  }
});

export default router;

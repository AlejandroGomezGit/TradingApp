import { Router } from 'express';
import { alpacaService } from '../services/alpaca.service';
import { query } from '../db/connection';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query['limit'] as string) || 50;
    const trades = await query(
      `SELECT * FROM trades ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

router.get('/live', async (_req, res) => {
  try {
    const orders = await alpacaService.getOrders('all', 50);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch live orders' });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) FILTER (WHERE side = 'buy') as total_buys,
        COUNT(*) FILTER (WHERE side = 'sell') as total_sells,
        COUNT(*) FILTER (WHERE status = 'filled') as filled_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders,
        AVG(CASE WHEN filled_price IS NOT NULL THEN filled_price END) as avg_fill_price
      FROM trades
    `);
    res.json(stats[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trade stats' });
  }
});

export default router;

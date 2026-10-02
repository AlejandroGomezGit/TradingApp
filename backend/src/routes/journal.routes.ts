import { Router } from 'express';
import { query } from '../db/connection';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query['limit'] as string) || 30;
    const entries = await query(
      `SELECT id, date, portfolio_value, cash, daily_pnl, daily_pnl_pct,
              research_summary, trades_summary, reflection, created_at
       FROM journal_entries
       ORDER BY date DESC LIMIT $1`,
      [limit]
    );
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

router.get('/:date', async (req, res) => {
  try {
    const entries = await query(
      `SELECT * FROM journal_entries WHERE date = $1`,
      [req.params['date']]
    );
    if (!entries[0]) return res.status(404).json({ error: 'Journal entry not found' });
    return res.json(entries[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch journal entry' });
  }
});

export default router;

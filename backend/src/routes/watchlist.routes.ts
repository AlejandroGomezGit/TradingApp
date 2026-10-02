import { Router } from 'express';
import { query } from '../db/connection';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const items = await query('SELECT * FROM watchlist ORDER BY symbol');
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

router.post('/', async (req, res) => {
  const { symbol, description, max_allocation_pct } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  try {
    const result = await query(
      `INSERT INTO watchlist (symbol, description, max_allocation_pct)
       VALUES ($1, $2, $3) RETURNING *`,
      [symbol.toUpperCase(), description || '', max_allocation_pct || 5]
    );
    return res.status(201).json(result[0]);
  } catch (error) {
    return res.status(409).json({ error: 'Symbol already exists in watchlist' });
  }
});

router.patch('/:id', async (req, res) => {
  const { description, max_allocation_pct, active } = req.body;
  try {
    const result = await query(
      `UPDATE watchlist
       SET description = COALESCE($1, description),
           max_allocation_pct = COALESCE($2, max_allocation_pct),
           active = COALESCE($3, active),
           updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [description, max_allocation_pct, active, req.params['id']]
    );
    if (!result[0]) return res.status(404).json({ error: 'Not found' });
    return res.json(result[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update watchlist item' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM watchlist WHERE id = $1', [req.params['id']]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete watchlist item' });
  }
});

export default router;

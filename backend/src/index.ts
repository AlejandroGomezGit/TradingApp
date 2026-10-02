import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './middleware/logger';
import { pool } from './db/connection';
import { startScheduler } from './scheduler';

import portfolioRoutes from './routes/portfolio.routes';
import tradesRoutes from './routes/trades.routes';
import journalRoutes from './routes/journal.routes';
import watchlistRoutes from './routes/watchlist.routes';
import agentRoutes from './routes/agent.routes';

import fs from 'fs';
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: config.server.frontendUrl, methods: ['GET', 'POST'] },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.server.frontendUrl }));
app.use(express.json());

// Routes
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/agent', agentRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error', message: 'DB connection failed' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  logger.info('Dashboard connected', { id: socket.id });
  socket.on('disconnect', () => logger.info('Dashboard disconnected', { id: socket.id }));
});

// Start scheduler with socket reference
startScheduler(io);

httpServer.listen(config.server.port, () => {
  logger.info(`Trading Agent API running on http://localhost:${config.server.port}`);
  logger.info('Scheduler active — routines will fire on market days');
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await pool.end();
  process.exit(0);
});

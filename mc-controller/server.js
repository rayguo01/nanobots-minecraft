import 'dotenv/config';
import express from 'express';
import config from './config.js';
import authRouter from './routes/auth.js';
import botsRouter from './routes/bots.js';
import stateRouter from './routes/state.js';
import actionsRouter from './routes/actions.js';
import modesRouter from './routes/modes.js';
import messagesRouter from './routes/messages.js';
import tradesRouter from './routes/trades.js';
import { authenticate } from './middleware/authenticate.js';

const app = express();
app.use(express.json());

// Health (no auth)
app.get('/v1/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Auth routes (no auth required)
app.use('/v1/auth', authRouter);

// All subsequent routes require auth
app.use('/v1', authenticate);

// Bot management
app.use('/v1/bots', botsRouter);

// State queries (mounted on /bots/:id/...)
app.use('/v1/bots', stateRouter);

// Actions (mounted on /bots/:id/...)
app.use('/v1/bots', actionsRouter);

// Modes (mounted on /bots/:id/...)
app.use('/v1/bots', modesRouter);

// Messaging
app.use('/v1/messages', messagesRouter);

// Trading
app.use('/v1/trades', tradesRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`MC Controller v0.1.0 running on port ${config.port}`);
  console.log(`MC Server: ${config.mc.host}:${config.mc.port}`);
  console.log(`Endpoints: /v1/health, /v1/auth, /v1/bots, /v1/messages, /v1/trades`);
});

export default app;

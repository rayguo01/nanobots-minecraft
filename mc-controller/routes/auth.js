import { Router } from 'express';
import { registerAgent, generateToken } from '../core/auth.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/register', (req, res) => {
  const { agentId } = req.body;
  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ error: 'agentId is required' });
  }
  const result = registerAgent(agentId);
  res.json({ agentId, token: result.token, existing: result.existing });
});

router.post('/refresh', authenticate, (req, res) => {
  const token = generateToken(req.agentId);
  res.json({ token });
});

export default router;

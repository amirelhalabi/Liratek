import express from 'express';
import { authenticateJWT, requireRole, type AuthRequest } from '../middleware/auth.js';
import { emitEvent } from '../websocket/io.js';

const router = express.Router();

// Protected debug endpoint to validate websocket emission
// NOTE: This is intended for development/testing only.
router.post('/emit', authenticateJWT, requireRole(['admin']), (req: AuthRequest, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const event = typeof req.body?.event === 'string' ? req.body.event : 'debug:test';
  const payload = req.body?.payload ?? { at: new Date().toISOString(), userId: req.user?.userId };

  emitEvent(event, payload);
  res.json({ success: true, emitted: { event, payload } });
});

export default router;

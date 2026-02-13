import { Router, Request, Response } from 'express';
import { CustomerSessionService } from '@liratek/core';

const router = Router();
const sessionService = new CustomerSessionService();

/**
 * POST /api/sessions/start
 * Start a new customer visit session
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, customer_notes } = req.body;
    const username = (req as any).user?.username || 'unknown';

    const result = await sessionService.startSession({
      customer_name,
      customer_phone,
      customer_notes,
      started_by: username,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * GET /api/sessions/active
 * Get the currently active session
 */
router.get('/active', async (_req: Request, res: Response) => {
  try {
    const result = await sessionService.getActiveSession();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * GET /api/sessions/:id
 * Get session details with transactions
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    const result = await sessionService.getSessionDetails(sessionId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * PUT /api/sessions/:id
 * Update customer information for a session
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    const { customer_name, customer_phone, customer_notes } = req.body;
    const result = await sessionService.updateSession(sessionId, {
      customer_name,
      customer_phone,
      customer_notes,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * POST /api/sessions/:id/close
 * Close a customer session
 */
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    const username = (req as any).user?.username || 'unknown';
    const result = await sessionService.closeSession(sessionId, username);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * POST /api/sessions/link-transaction
 * Link a transaction to the active session
 */
router.post('/link-transaction', async (req: Request, res: Response) => {
  try {
    const { transactionType, transactionId, amountUsd, amountLbp } = req.body;
    
    if (!transactionType || !transactionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'transactionType and transactionId are required' 
      });
    }

    const result = await sessionService.linkTransactionToActiveSession(
      transactionType,
      transactionId,
      amountUsd || 0,
      amountLbp || 0
    );

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

/**
 * GET /api/sessions
 * List recent sessions
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const result = await sessionService.listSessions(limit, offset);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message ?? 'Unknown error' });
  }
});

export default router;

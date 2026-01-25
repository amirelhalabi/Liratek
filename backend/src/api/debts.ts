import express from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { getDebtService } from '../services/DebtService.js';

const router = express.Router();

// All debts routes require auth
router.use(authenticateJWT);

// GET /api/debts/debtors
router.get('/debtors', (_req, res) => {
  const service = getDebtService();
  const debtors = service.getDebtors();
  res.json({ success: true, debtors });
});

// GET /api/debts/clients/:clientId/history
router.get('/clients/:clientId/history', (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ success: false, error: 'Invalid clientId' });
    return;
  }

  const service = getDebtService();
  const history = service.getClientHistory(clientId);
  res.json({ success: true, history });
});

// GET /api/debts/clients/:clientId/total
router.get('/clients/:clientId/total', (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ success: false, error: 'Invalid clientId' });
    return;
  }

  const service = getDebtService();
  const total = service.getClientTotal(clientId);
  res.json({ success: true, total });
});

// POST /api/debts/repayments (admin)
router.post('/repayments', requireRole(['admin']), (req, res) => {
  const service = getDebtService();

  // Support both payload shapes:
  // - Electron/IPC style: { clientId, amountUSD, amountLBP, userId }
  // - REST/web style:     { client_id, amount_usd, amount_lbp, user_id }
  const body = (req.body ?? {}) as Record<string, unknown>;

  const normalized = {
    clientId: (body['clientId'] ?? body['client_id']) as number,
    amountUSD: Number(body['amountUSD'] ?? body['amount_usd'] ?? 0),
    amountLBP: Number(body['amountLBP'] ?? body['amount_lbp'] ?? 0),
    note: body['note'] as string | undefined,
    userId: (body['userId'] ?? body['user_id']) as number | undefined,
  };

  const result = service.addRepayment(normalized);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;

import express from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { getExpenseService } from '../services';

const router = express.Router();

// All expenses routes require auth
router.use(authenticateJWT);

// GET /api/expenses/today
router.get('/today', (_req, res) => {
  const service = getExpenseService();
  const expenses = service.getTodayExpenses();
  res.json({ success: true, expenses });
});

// POST /api/expenses (admin)
router.post('/', requireRole(['admin']), (req, res) => {
  const service = getExpenseService();
  const result = service.addExpense(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/expenses/:id (admin)
router.delete('/:id', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getExpenseService();
  const result = service.deleteExpense(id);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;

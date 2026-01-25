import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { getCurrencyService } from '../services';
import { logger } from '../server.js';

const router = express.Router();

// All currency routes require auth
router.use(authenticateJWT);

// GET /api/currencies - List all currencies
router.get('/', (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const currencies = currencyService.listCurrencies();
    res.json({ success: true, currencies });
  } catch (error) {
    logger.error({ error }, 'List currencies error');
    res.status(500).json({ success: false, error: 'Failed to fetch currencies' });
  }
});

// POST /api/currencies - Create a currency (admin only)
router.post('/', async (req, res): Promise<void> => {
  try {
    const currencyService = getCurrencyService();
    const result = currencyService.createCurrency(req.body);
    
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Create currency error');
    res.status(500).json({ success: false, error: 'Failed to create currency' });
  }
});

// PUT /api/currencies/:id - Update a currency (admin only)
router.put('/:id', async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid currency ID' });
      return;
    }
    
    const currencyService = getCurrencyService();
    const result = currencyService.updateCurrency(id, req.body);
    
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Update currency error');
    res.status(500).json({ success: false, error: 'Failed to update currency' });
  }
});

// DELETE /api/currencies/:id - Delete a currency (admin only)
router.delete('/:id', async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid currency ID' });
      return;
    }
    
    const currencyService = getCurrencyService();
    const result = currencyService.deleteCurrency(id);
    
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Delete currency error');
    res.status(500).json({ success: false, error: 'Failed to delete currency' });
  }
});

export default router;

/**
 * Rates API Endpoints
 * 
 * Handles exchange rate management
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getRateService } from '../services';
import { logger } from '../utils/logger';

const router = Router();
const rateService = getRateService();

// GET /api/rates
router.get('/', requireAuth, async (_req, res) => {
  try {
    const rates = rateService.listRates();
    res.json({ success: true, rates });
  } catch (error) {
    logger.error({ error }, 'List rates error');
    res.status(500).json({ success: false, error: 'Failed to list rates' });
  }
});

// POST /api/rates
router.post('/', requireAuth, async (req, res) => {
  try {
    const { from_code, to_code, rate } = req.body;

    if (!from_code || !to_code || rate === undefined) {
      res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: from_code, to_code, rate' 
      });
    }

    const result = rateService.setRate({ from_code, to_code, rate });

    if (result.success) {
      logger.info({ from_code, to_code, rate }, 'Exchange rate set');
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    logger.error({ error }, 'Set rate error');
    res.status(500).json({ success: false, error: 'Failed to set rate' });
  }
});

export default router;

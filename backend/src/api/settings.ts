import express from 'express';
import { getSettingsService } from '../services';
import { logger } from '../server.js';

const router = express.Router();

// GET /api/settings - Get all settings
router.get('/', async (_req, res): Promise<void> => {
  try {
    const settingsService = getSettingsService();
    const settings = await settingsService.getAllSettings();
    res.json({ success: true, settings });
  } catch (error) {
    logger.error({ error }, 'Get all settings error');
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/:key - Get a specific setting
router.get('/:key', async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const settingsService = getSettingsService();
    const setting = await settingsService.getSetting(key);
    
    if (!setting) {
      res.status(404).json({ success: false, error: 'Setting not found' });
      return;
    }
    
    res.json({ success: true, setting });
  } catch (error) {
    logger.error({ error }, 'Get setting error');
    res.status(500).json({ success: false, error: 'Failed to fetch setting' });
  }
});

// PUT /api/settings/:key - Update a setting
router.put('/:key', async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      res.status(400).json({ success: false, error: 'Value is required' });
      return;
    }
    
    const settingsService = getSettingsService();
    await settingsService.updateSetting(key, value);
    
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Update setting error');
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

export default router;

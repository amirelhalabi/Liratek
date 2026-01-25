import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { MaintenanceService } from '../services/MaintenanceService.js';
import { logger } from '../server.js';

const maintenanceService = new MaintenanceService();

const router = express.Router();

// All maintenance routes require auth
router.use(authenticateJWT);

// GET /api/maintenance/jobs - Get maintenance jobs
router.get('/jobs', (req, res): void => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const jobs = maintenanceService.getJobs(statusFilter);
    res.json({ success: true, jobs });
  } catch (error) {
    logger.error({ error }, 'Get maintenance jobs error');
    res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
  }
});

// POST /api/maintenance/jobs - Create or update maintenance job
router.post('/jobs', async (req, res): Promise<void> => {
  try {
    const result = maintenanceService.saveJob(req.body);
    
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Save maintenance job error');
    res.status(500).json({ success: false, error: 'Failed to save job' });
  }
});

// DELETE /api/maintenance/jobs/:id - Delete maintenance job
router.delete('/jobs/:id', async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid job ID' });
      return;
    }
    
    const result = maintenanceService.deleteJob(id);
    
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Delete maintenance job error');
    res.status(500).json({ success: false, error: 'Failed to delete job' });
  }
});

export default router;

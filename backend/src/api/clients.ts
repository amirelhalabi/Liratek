import express from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { getClientService } from '../services';

const router = express.Router();

// All clients routes require auth
router.use(authenticateJWT);

// GET /api/clients?search=...
router.get('/', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const service = getClientService();
  const clients = service.getClients(search);
  res.json({ success: true, clients });
});

// GET /api/clients/:id
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getClientService();
  const client = service.getClientById(id);
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  res.json({ success: true, client });
});

// POST /api/clients (admin)
router.post('/', requireRole(['admin']), (req, res) => {
  const service = getClientService();
  const result = service.createClient(req.body);
  res.status(result.success ? 201 : 400).json(result);
});

// PUT /api/clients/:id (admin)
router.put('/:id', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getClientService();
  const result = service.updateClient(id, req.body);
  res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/clients/:id (admin)
router.delete('/:id', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getClientService();
  const result = service.deleteClient(id);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;

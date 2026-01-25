import express from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { getInventoryService } from '../services/index.js';

const router = express.Router();

// All inventory routes require auth
router.use(authenticateJWT);

// GET /api/inventory/products?search=...
router.get('/products', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const service = getInventoryService();
  const products = service.getProducts(search);
  res.json({ success: true, products });
});

// GET /api/inventory/products/:id
router.get('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getInventoryService();
  try {
    const product = service.getProductById(id);
    res.json({ success: true, product });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Product not found' });
  }
});

// POST /api/inventory/products (admin)
router.post('/products', requireRole(['admin']), (req, res) => {
  const service = getInventoryService();
  const result = service.createProduct(req.body);
  res.status(result.success ? 201 : 400).json(result);
});

// PUT /api/inventory/products/:id (admin)
router.put('/products/:id', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getInventoryService();
  const result = service.updateProduct(id, req.body);
  res.status(result.success ? 200 : 400).json(result);
});

// DELETE /api/inventory/products/:id (admin)
router.delete('/products/:id', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const service = getInventoryService();
  const result = service.deleteProduct(id);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /api/inventory/products/:id/stock (admin)
router.post('/products/:id/stock', requireRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'Invalid id' });
    return;
  }

  const quantity = Number(req.body?.quantity);
  const delta = req.body?.delta != null ? Number(req.body.delta) : null;

  const service = getInventoryService();
  const result = delta != null && Number.isFinite(delta)
    ? service.adjustStockDelta(id, delta)
    : service.adjustStock(id, quantity);

  res.status(result.success ? 200 : 400).json(result);
});

export default router;

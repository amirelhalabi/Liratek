import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getBinanceService } from "../services/index.js";

const router = express.Router();

// All binance routes require auth
router.use(authenticateJWT);

// GET /api/binance/history
router.get("/history", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const service = getBinanceService();
  const history = service.getHistory(limit);
  res.json({ success: true, history });
});

// GET /api/binance/today-stats
router.get("/today-stats", (_req, res) => {
  const service = getBinanceService();
  const stats = service.getTodayStats();
  res.json({ success: true, stats });
});

// POST /api/binance/transactions (admin)
router.post("/transactions", requireRole(["admin"]), (req, res) => {
  const service = getBinanceService();
  const result = service.addTransaction(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;

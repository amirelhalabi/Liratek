import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import pino from 'pino';
import pinoHttp from 'pino-http';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
        credentials: true,
    },
});

// Register Socket.IO instance for use elsewhere without importing server.ts
import { setIO } from './websocket/io.js';
setIO(io);

// Logger
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
        },
    },
});

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ logger }));

// Import routes
import authRoutes from './api/auth.js';
import clientsRoutes from './api/clients.js';
import salesRoutes from './api/sales.js';
import inventoryRoutes from './api/inventory.js';
import dashboardRoutes from './api/dashboard.js';
import wsDebugRoutes from './api/ws-debug.js';
import debtsRoutes from './api/debts.js';
import exchangeRoutes from './api/exchange.js';
import expensesRoutes from './api/expenses.js';
import settingsRoutes from './api/settings.js';
import rechargeRoutes from './api/recharge.js';
import servicesRoutes from './api/services.js';
import maintenanceRoutes from './api/maintenance.js';
import currenciesRoutes from './api/currencies.js';
import closingRoutes from './api/closing.js';
import suppliersRoutes from './api/suppliers.js';
import ratesRoutes from './api/rates.js';
import usersRoutes from './api/users.js';
import activityRoutes from './api/activity.js';
import reportsRoutes from './api/reports.js';

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ws', wsDebugRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/recharge', rechargeRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/currencies', currenciesRoutes);
app.use('/api/closing', closingRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportsRoutes);

app.get('/api', (_req, res) => {
    res.json({ message: 'LiraTek API Server', version: '1.0.0' });
});

// WebSocket connection handling
io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, 'Client disconnected');
    });
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
    logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
    logger.info(`📡 WebSocket server ready`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    httpServer.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

export { app, io };

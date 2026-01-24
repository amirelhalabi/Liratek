import express from 'express';
import { getUserRepository } from '../database/repositories/UserRepository.js';
import { logger } from '../server.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const router = express.Router();
const JWT_SECRET: jwt.Secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] =
    (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '7d';

// POST /api/auth/login
router.post('/login', async (req, res): Promise<void> => {
    try {
        const { username, password } = req.body;

        // Allow empty string password (bootstrap admin) but require fields to exist
        if (!username || password === undefined || password === null) {
            res.status(400).json({ error: 'Username and password required' });
            return;
        }

        const userRepo = getUserRepository();
        const user = userRepo.findByUsername(username);

        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        // Verify password
        // Note: initial schema seeds admin with an empty password_hash.
        // Allow bootstrap login with an empty password in that case.
        const isValid = user.password_hash
            ? await bcrypt.compare(password, user.password_hash)
            : password === '';
        if (!isValid) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        logger.info({ userId: user.id, username: user.username }, 'User logged in');

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
            token,
        });
    } catch (error) {
        logger.error({ error }, 'Login error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auth/me
router.get('/me', async (req, res): Promise<void> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string };

        const userRepo = getUserRepository();
        const user = userRepo.findById(decoded.userId);

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
        });
    } catch (error) {
        logger.error({ error }, 'Get current user error');
        res.status(401).json({ error: 'Invalid token' });
    }
});

// POST /api/auth/logout
router.post('/logout', (_req, res): void => {
    // With JWT, logout is handled client-side by removing the token
    res.json({ success: true });
});

export default router;

import express from 'express';
import { getUserRepository, getAuthService } from '../services/index.js';
import { logger } from '../server.js';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET: jwt.Secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN: jwt.SignOptions['expiresIn'] =
    (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) || '7d';

// POST /api/auth/login
router.post('/login', async (req, res): Promise<void> => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || password === undefined || password === null) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    // Use AuthService with database session support
    const authService = getAuthService();
    const result = await authService.login(username, password, {
      rememberMe: rememberMe || false,
      deviceType: 'web',
      deviceInfo: req.headers['user-agent'] || 'Unknown',
      ipAddress: req.ip || req.socket.remoteAddress,
    });

    if (!result.success || !result.user || !result.token) {
      res.status(401).json({ error: result.error || 'Invalid credentials' });
      return;
    }

    // Create JWT that includes the session token
    const jwtToken = jwt.sign(
      { 
        userId: result.user.id, 
        role: result.user.role,
        sessionToken: result.token, // Link JWT to database session
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    logger.info(
      { userId: result.user.id, username: result.user.username, rememberMe },
      'User logged in with database session',
    );

    res.json({
      success: true,
      user: {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
      },
      token: jwtToken,
      sessionToken: result.token, // Also return session token separately
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
router.post('/logout', async (req, res): Promise<void> => {
    try {
        // Extract session token from JWT
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            try {
                const decoded = jwt.verify(token, JWT_SECRET) as { 
                    userId: number; 
                    role: string; 
                    sessionToken?: string;
                };

                // Delete session from database if sessionToken exists
                if (decoded.sessionToken) {
                    const authService = getAuthService();
                    await authService.logout(decoded.sessionToken);
                    logger.info({ userId: decoded.userId }, 'User logged out, session deleted');
                }
            } catch (error) {
                logger.warn({ error }, 'Failed to decode JWT during logout');
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Logout error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

-- Migration: Add sessions table for unified session management
-- Date: 2026-01-31
-- Purpose: Replace file-based sessions with database-backed sessions for both Electron and Web

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Core session fields
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,              -- Cryptographically secure random token (64 chars)
    
    -- Session metadata
    device_type TEXT DEFAULT 'unknown',      -- 'electron', 'web', 'mobile'
    device_info TEXT,                        -- User agent or device details (OS, browser, app version)
    ip_address TEXT,                         -- IP address (for web sessions, NULL for electron)
    
    -- Remember me functionality
    remember_me INTEGER DEFAULT 0,           -- 0 = 30 min session, 1 = 1 day session
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,            -- Calculated: created_at + duration based on remember_me
    
    -- Relations
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at);

-- Comments for clarity:
-- 1. token: 64-character cryptographically secure random token
-- 2. remember_me: 0 = session expires after 30 min of inactivity, 1 = session lasts 1 day regardless of activity
-- 3. last_activity_at: Updated on each authenticated request/action
-- 4. expires_at: Absolute expiration time (either 30 min or 1 day from creation)
-- 5. ON DELETE CASCADE: Deleting a user automatically deletes all their sessions

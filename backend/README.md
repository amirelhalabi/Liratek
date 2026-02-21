# Backend README

## Quick Start

## Docker (Production-like)

From `liratek/`:

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- SQLite DB is persisted in the `liratek_data` volume

Set `JWT_SECRET` in `docker-compose.yml` before deploying.

```bash
# Install dependencies (from project root)
yarn install

# Start development server
cd backend
yarn dev

# Build for production
yarn build

# Run production server
yarn start
```

## API Endpoints

### Authentication

- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user (requires auth)
- `POST /api/auth/logout` - User logout

### Health Check

- `GET /health` - Server health status

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=../liratek.db
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

## Testing

```bash
# Test auth endpoint
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# Test with token
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Project Structure

```
backend/
├── src/
│   ├── api/           # REST API routes
│   ├── database/      # Database repositories
│   ├── services/      # Business logic
│   ├── middleware/    # Express middleware
│   ├── utils/         # Utilities
│   └── server.ts      # Entry point
├── dist/              # Compiled output
└── package.json
```

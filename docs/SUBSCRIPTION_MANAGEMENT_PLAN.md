# Subscription Management System - Implementation Plan

## Overview

A comprehensive subscription management system using Google Sheets as the central database for client information, plan management, and API key validation.

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Shop App    │  │  Admin Page  │  │Subscription  │      │
│  │  (Electron)  │  │  (/admin)    │  │   Page       │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         │ API Key         │ Admin Auth      │ User Auth     │
│         │ in Headers      │                 │               │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                   ┌────────▼────────┐
                   │   Backend API   │
                   │  (Node.js/Express)│
                   │                 │
                   │  - API Key      │
                   │    Validation   │
                   │  - Plan         │
                   │    Enforcement  │
                   │  - Module       │
                   │    Access       │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │  Local Cache    │
                   │  (Memory/Redis) │
                   │  - API Keys     │
                   │  - Plans        │
                   │  - Status       │
                   │  (12h TTL)      │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │  MCP Server     │
                   │  (Google Sheets)│
                   │  - OAuth 2.0    │
                   │  - Read/Write   │
                   │  - Master Sheet │
                   └─────────────────┘
```

---

## Subscription Plans

### Plan 1: **Essentials** 🥉

**Target:** Small shops, basic operations

**Included Modules:**

- ✅ POS (Point of Sale)
- ✅ Inventory Management
- ✅ Debt Tracking
- ✅ Client Management

**Excluded Modules:**

- ❌ Exchange (Currency)
- ❌ Expenses
- ❌ Services (OMT/WHISH)
- ❌ Recharge
- ❌ Profits/Reports (Advanced)
- ❌ Session Management (Opening/Closing)
- ❌ Voice Bot
- ❌ Maintenance/Closing
- ❌ Custom Services

**Features:**

- Basic sales operations
- Stock tracking
- Customer debt management
- Client database

---

### Plan 2: **Professional** 🥇

**Target:** Established shops, full-featured operations

**Included Modules:**

- ✅ ALL Essentials modules PLUS:
- ✅ Exchange (Currency)
- ✅ Expenses
- ✅ Services (OMT/WHISH money transfer)
- ✅ Recharge (Mobile credit)
- ✅ Profits/Reports (Advanced analytics)
- ✅ Session Management (Opening/Closing day)
- ✅ Voice Bot (AI-powered)
- ✅ Maintenance/Closing
- ✅ Custom Services
- ✅ Settings (Full configuration)

**Features:**

- Everything in Essentials
- Multi-currency support
- Expense tracking
- Money transfer services
- Mobile recharge
- Advanced reporting
- Shift management
- Voice commands
- Priority support

---

## Google Sheets Structure

### Master Sheet: `LiraTek_Clients`

| Column                | Type     | Required | Description                                   |
| --------------------- | -------- | -------- | --------------------------------------------- |
| `shop_name`           | Text     | ✅       | Unique shop identifier                        |
| `plan`                | Text     | ✅       | "essentials" or "professional"                |
| `status`              | Text     | ✅       | "active", "expired", "grace_period", "paused" |
| `api_key`             | Text     | ✅       | Unique API key for authentication             |
| `huggingface_api_key` | Text     | ❌       | For Voice Bot (Professional only)             |
| `contact_email`       | Email    | ❌       | Primary contact email                         |
| `contact_phone`       | Text     | ❌       | WhatsApp/Phone support                        |
| `created_at`          | Date     | ✅       | Subscription start date                       |
| `expires_at`          | Date     | ❌       | For annual plans (null = indefinite)          |
| `last_login_at`       | DateTime | ❌       | Updated on each login                         |
| `last_synced_at`      | DateTime | ❌       | Last backend sync timestamp                   |
| `grace_period_ends`   | Date     | ❌       | Grace period expiration                       |
| `billing_cycle`       | Text     | ❌       | "monthly", "yearly", "lifetime"               |
| `notes`               | Text     | ❌       | Internal admin notes                          |

### Example Data

| shop_name        | plan         | status       | api_key       | huggingface_api_key | contact_email      | created_at | grace_period_ends |
| ---------------- | ------------ | ------------ | ------------- | ------------------- | ------------------ | ---------- | ----------------- |
| Abu Hassan Store | professional | active       | lsk_abc123xyz | hf_xyz789           | abu@example.com    | 2026-01-01 | null              |
| Maryam Shop      | essentials   | active       | lsk_def456uvw | null                | maryam@example.com | 2026-02-15 | null              |
| Test Shop        | professional | grace_period | lsk_ghi789rst | hf_rst123           | test@example.com   | 2025-12-01 | 2026-03-20        |

---

## API Key Management

### Generation

- Pre-generate API keys using format: `lsk_[random_32_chars]`
- Store in Google Sheets `api_key` column
- Provide to client for `.env` configuration

### Usage

- Client sets in `.env`: `LIRATEK_API_KEY=lsk_abc123xyz`
- Included in all API request headers: `Authorization: Bearer lsk_abc123xyz`
- Backend validates against cached sheet data

### Validation Flow

```
1. Request received with API key in header
2. Check local cache (12h TTL)
   ├─ Cache hit → Validate status
   └─ Cache miss → Sync from Google Sheets
3. Check API key exists and status is "active" or "grace_period"
4. Check plan permissions for requested module
5. Return 401/403 if invalid or 200 if valid
```

---

## Module Access Control

### Enforcement Strategy (Frontend + Backend)

#### Frontend Enforcement

- Hide/disable module navigation based on plan
- Show upgrade prompts for locked features
- Better UX, but not secure alone

#### Backend Enforcement

- Validate API key on every request
- Check plan permissions for module access
- Return 403 Forbidden for unauthorized access
- Security layer

### Module Permission Matrix

| Module          | Essentials | Professional |
| --------------- | ---------- | ------------ |
| POS             | ✅         | ✅           |
| Inventory       | ✅         | ✅           |
| Debts           | ✅         | ✅           |
| Clients         | ✅         | ✅           |
| Exchange        | ❌         | ✅           |
| Expenses        | ❌         | ✅           |
| Services        | ❌         | ✅           |
| Recharge        | ❌         | ✅           |
| Profits         | ❌         | ✅           |
| Session Mgmt    | ❌         | ✅           |
| Voice Bot       | ❌         | ✅           |
| Maintenance     | ❌         | ✅           |
| Custom Services | ❌         | ✅           |
| Settings        | ⚠️ Limited | ✅ Full      |

---

## Grace Period Handling

### Flow

```
Subscription expires
    ↓
Status changes to "grace_period"
    ↓
Grace period starts (7 days default)
    ↓
Client notified via email/SMS
    ↓
┌─────────────────┬─────────────────┐
│   Payment made  │  No payment     │
│                 │                 │
│   ↓             │   ↓             │
│   Status →      │   Status →      │
│   "active"      │   "expired"     │
│   Reset period  │   Full lockout  │
└─────────────────┴─────────────────┘
```

### Configuration

- **Default grace period:** 7 days
- **Configurable per client** in `grace_period_ends` column
- **Notifications:** Day 1, Day 3, Day 6 of grace period

---

## Sync Strategy

### Cache Invalidation

- **TTL:** 12 hours
- **Forced sync:** On admin plan change
- **Lazy sync:** On cache miss

### Sync Process

```typescript
// Pseudo-code
async function syncClientData() {
  const lastSync = await getLastSyncTimestamp();
  const now = Date.now();

  if (now - lastSync > 12 * 60 * 60 * 1000) {
    // Sync from Google Sheets
    const sheetData = await googleSheets.getAllClients();
    await cache.set("clients", sheetData, { ttl: "12h" });
    await updateLastSyncTimestamp(now);
  }
}
```

---

## Implementation Phases

### Phase 1: Google Sheets MCP Setup

- [ ] Create Google Cloud Project
- [ ] Enable Google Sheets API
- [ ] Configure OAuth 2.0 credentials
- [ ] Create master sheet template
- [ ] Test MCP server connection
- [ ] Document setup process

**Estimated:** 2-3 hours

---

### Phase 2: Backend Infrastructure

- [ ] Create Google Sheets service integration
- [ ] Implement API key validation middleware
- [ ] Build plan permission checker
- [ ] Add local caching layer (12h TTL)
- [ ] Create scheduled sync job (every 12h)
- [ ] Add API key generation utility

**Estimated:** 6-8 hours

---

### Phase 3: Admin Page

- [ ] Create `/admin` route
- [ ] Implement simple admin authentication
- [ ] Build client list view (read from sheets)
- [ ] Add client detail modal
- [ ] Implement search/filter
- [ ] Add manual sync trigger

**Estimated:** 4-6 hours

---

### Phase 4: Plan Enforcement

- [ ] Frontend: Module access control HOC
- [ ] Frontend: Hide/show modules by plan
- [ ] Backend: Route protection middleware
- [ ] Backend: Module permission validation
- [ ] Add plan upgrade prompts
- [ ] Test all module access scenarios

**Estimated:** 6-8 hours

---

### Phase 5: Subscriptions Page (Client-Facing)

- [ ] Create `/subscription` route
- [ ] Display current plan and features
- [ ] Show plan comparison table
- [ ] Implement upgrade/downgrade request flow
- [ ] Display billing history (manual entry for now)
- [ ] Add contact support for plan changes

**Estimated:** 4-6 hours

---

### Phase 6: Grace Period & Notifications

- [ ] Implement grace period logic
- [ ] Add expiration date checking
- [ ] Create notification system (email/SMS)
- [ ] Build grace period countdown UI
- [ ] Add payment confirmation workflow
- [ ] Test expiration scenarios

**Estimated:** 4-6 hours

---

### Phase 7: Testing & Documentation

- [ ] Write unit tests for validation
- [ ] Integration tests for API keys
- [ ] E2E tests for plan enforcement
- [ ] Document API key setup for clients
- [ ] Create admin user guide
- [ ] Record setup tutorial video

**Estimated:** 4-6 hours

---

## Technical Specifications

### API Endpoints

#### Authentication

```
POST /api/auth/validate-api-key
Headers: Authorization: Bearer <api_key>
Response: { valid: boolean, plan: string, shop_name: string }
```

#### Admin (Protected)

```
GET /api/admin/clients
Response: Array<Client>

GET /api/admin/clients/:shopName
Response: Client

POST /api/admin/clients/:shopName/sync
Response: { success: boolean, last_synced_at: string }
```

#### Client Subscription

```
GET /api/subscription/current
Response: { plan: string, status: string, features: string[], expires_at?: string }

GET /api/subscription/plans
Response: Array<Plan>

POST /api/subscription/change-plan
Body: { new_plan: string }
Response: { success: boolean, message: string }
```

### Environment Variables

#### Backend

```env
# Google Sheets
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
GOOGLE_SHEET_ID=xxx
GOOGLE_REFRESH_TOKEN=xxx

# Cache
CACHE_TTL_HOURS=12

# Grace Period
GRACE_PERIOD_DAYS=7
```

#### Client

```env
# Client API Key
LIRATEK_API_KEY=lsk_abc123xyz

# Optional: Custom backend URL
LIRATEK_BACKEND_URL=https://api.liratek.com
```

### Database Schema (Cache)

```typescript
interface ClientCache {
  shop_name: string;
  plan: "essentials" | "professional";
  status: "active" | "expired" | "grace_period" | "paused";
  api_key: string;
  huggingface_api_key?: string;
  contact_email?: string;
  contact_phone?: string;
  created_at: string;
  expires_at?: string;
  last_login_at?: string;
  last_synced_at: string;
  grace_period_ends?: string;
  billing_cycle?: "monthly" | "yearly" | "lifetime";
  notes?: string;
  cached_at: number; // Timestamp
}
```

---

## Security Considerations

### API Key Security

- Generate cryptographically secure keys (32+ chars)
- Store hashed in cache (optional)
- Rate limit per API key
- Log all API key usage
- Implement key rotation mechanism

### Google Sheets Security

- Use service account with minimal permissions
- Restrict sheet access to specific Google account
- Enable 2FA on Google account
- Regular backup of sheet data
- Audit log access

### Backend Security

- HTTPS only for production
- CORS restrictions
- Rate limiting per API key
- Input validation on all endpoints
- SQL injection prevention (parameterized queries)

---

## Testing Strategy

### Unit Tests

- API key generation
- Plan permission validation
- Cache invalidation logic
- Grace period calculations

### Integration Tests

- Google Sheets sync
- API key validation flow
- Module access control
- Admin page data fetching

### E2E Tests

- Full authentication flow
- Plan upgrade/downgrade
- Grace period expiration
- Admin client management

---

## Rollout Plan

### Step 1: Internal Testing

- Create test clients in sheet
- Test both plans thoroughly
- Validate all module restrictions
- Test grace period scenarios

### Step 2: Soft Launch

- Onboard 2-3 friendly clients
- Manual API key distribution
- Monitor for issues
- Collect feedback

### Step 3: Full Launch

- Prepare client onboarding docs
- Create API key setup guide
- Set up support channel
- Monitor analytics

---

## Future Enhancements

### Phase 8+ (Post-MVP)

- [ ] Automated billing integration (Stripe/PayPal)
- [ ] Usage analytics dashboard
- [ ] Multi-user support per shop
- [ ] Custom plan builder
- [ ] Automated email notifications
- [ ] Mobile app for admin
- [ ] Webhook integrations
- [ ] API usage limits per plan
- [ ] White-label options
- [ ] Reseller program support

---

## Success Metrics

### Technical

- API validation latency < 100ms
- Cache hit rate > 90%
- Sheet sync success rate > 99%
- Zero unauthorized access incidents

### Business

- Client onboarding time < 10 minutes
- Plan upgrade conversion rate
- Grace period payment rate > 70%
- Client retention rate

---

## Risks & Mitigations

| Risk                       | Impact | Likelihood | Mitigation                       |
| -------------------------- | ------ | ---------- | -------------------------------- |
| Google Sheets API downtime | High   | Low        | Local cache with 12h TTL         |
| API key leakage            | High   | Medium     | Key rotation, rate limiting      |
| Plan enforcement bypass    | High   | Low        | Backend validation on all routes |
| Sync conflicts             | Medium | Low        | Single source of truth (Sheets)  |
| Grace period abuse         | Medium | Medium     | Manual approval for extensions   |

---

## Conclusion

This subscription management system provides a scalable, secure, and maintainable solution for managing client access to LiraTek modules. By leveraging Google Sheets as the central database and implementing robust API key validation, we can effectively manage subscriptions while maintaining flexibility for future enhancements.

**Next Steps:**

1. Review and approve this plan
2. Begin Phase 1: Google Sheets MCP Setup
3. Schedule weekly progress reviews
4. Prepare client onboarding documentation

---

**Document Version:** 1.0  
**Created:** 2026-03-12  
**Author:** LiraTek Development Team  
**Status:** Ready for Implementation

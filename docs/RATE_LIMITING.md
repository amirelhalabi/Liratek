# API Rate Limiting

**Implementation Date:** February 14, 2026  
**Status:** ✅ Completed

---

## Overview

LiraTek backend now implements comprehensive rate limiting to protect against abuse, brute force attacks, and DDoS attempts. Rate limits are enforced per IP address using the `express-rate-limit` middleware.

## Rate Limiters

### 1. General API Limiter

**Applies to:** All `/api/*` endpoints (except where overridden)

- **Limit:** 100 requests per 15 minutes per IP
- **Purpose:** Prevent API abuse
- **Headers:** Returns `RateLimit-*` headers
- **Response when exceeded:**
  ```json
  {
    "success": false,
    "error": "Too many requests from this IP, please try again later.",
    "retryAfter": "15 minutes"
  }
  ```

### 2. Authentication Limiter

**Applies to:** `/api/auth/*` endpoints

- **Limit:** 5 failed attempts per 15 minutes per IP
- **Purpose:** Prevent brute force login attacks
- **Behavior:** Only counts failed login attempts (successful logins don't count)
- **Response when exceeded:**
  ```json
  {
    "success": false,
    "error": "Too many login attempts from this IP, please try again after 15 minutes.",
    "retryAfter": "15 minutes"
  }
  ```

### 3. Strict Limiter

**Usage:** Apply manually to sensitive operations

- **Limit:** 10 requests per 15 minutes per IP
- **Purpose:** Extra protection for sensitive operations (user creation, password reset, etc.)
- **Usage:**

  ```typescript
  import { strictLimiter } from "./middleware/rateLimit.js";

  router.post("/reset-password", strictLimiter, resetPasswordHandler);
  ```

### 4. Read Limiter

**Usage:** Apply manually to read-heavy endpoints

- **Limit:** 300 requests per 15 minutes per IP
- **Purpose:** Allow frequent reads while still preventing abuse
- **Usage:**

  ```typescript
  import { readLimiter } from "./middleware/rateLimit.js";

  router.get("/products", readLimiter, getProductsHandler);
  ```

---

## Response Headers

When rate limiting is active, the following headers are included:

```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1708002000
```

- **RateLimit-Limit:** Total requests allowed in the window
- **RateLimit-Remaining:** Requests remaining in current window
- **RateLimit-Reset:** Unix timestamp when the window resets

---

## Testing Rate Limits

### Test General API Limit

```bash
# Make 101 requests rapidly (should block on 101st)
for i in {1..101}; do
  curl http://localhost:3000/health
done
```

### Test Authentication Limit

```bash
# Make 6 failed login attempts (should block on 6th)
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"wrong"}'
done
```

### Check Rate Limit Headers

```bash
curl -i http://localhost:3000/health | grep RateLimit
```

Expected output:

```
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 1708002000
```

---

## Bypass Rate Limiting (Development)

For development/testing, you can bypass rate limiting by:

### Option 1: Disable Temporarily

```typescript
// backend/src/server.ts
// Comment out the rate limiters
// app.use("/api/", apiLimiter);
```

### Option 2: Increase Limits

```typescript
// backend/src/middleware/rateLimit.ts
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // Very high limit for dev
  // ...
});
```

### Option 3: Use Different IP

Rate limits are per IP, so using a VPN or different network bypasses the limit.

---

## Production Configuration

### Adjust Limits

Edit `backend/src/middleware/rateLimit.ts`:

```typescript
// More restrictive for production
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Stricter than 100
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3, // Stricter than 5
});
```

### Use Redis for Distributed Systems

For multiple backend instances, use Redis as a shared store:

```bash
yarn add rate-limit-redis redis
```

```typescript
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";

const client = createClient({
  url: process.env.REDIS_URL,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  store: new RedisStore({
    client,
    prefix: "rl:",
  }),
});
```

---

## Monitoring

### Log Rate Limit Events

Rate limit violations are automatically logged:

```json
{
  "level": "warn",
  "msg": "Rate limit exceeded - authentication",
  "ip": "192.168.1.100",
  "path": "/api/auth/login",
  "username": "attacker@example.com"
}
```

### Prometheus Metrics

Add custom metrics to track rate limiting:

```typescript
import { Counter } from "prom-client";

const rateLimitCounter = new Counter({
  name: "rate_limit_exceeded_total",
  help: "Total number of rate limit violations",
  labelNames: ["limiter", "ip"],
});

// In rate limiter handler
rateLimitCounter.inc({ limiter: "auth", ip: req.ip });
```

---

## Security Best Practices

### 1. Trust Proxy Settings

Ensure Express trusts the proxy to get correct client IPs:

```typescript
// backend/src/server.ts
app.set("trust proxy", 1); // Already configured
```

### 2. Don't Rely Solely on Rate Limiting

- Still validate all inputs
- Still use authentication/authorization
- Still use HTTPS
- Rate limiting is **one layer** of defense

### 3. Monitor and Adjust

- Watch logs for patterns
- Adjust limits based on legitimate traffic
- Block persistent attackers at firewall level

### 4. Consider IP Whitelisting

```typescript
export const apiLimiter = rateLimit({
  skip: (req) => {
    // Whitelist certain IPs (e.g., monitoring tools)
    const whitelist = ["127.0.0.1", "10.0.0.1"];
    return whitelist.includes(req.ip);
  },
  // ...
});
```

---

## Tested Scenarios

✅ **General API limit:** Blocks after 100 requests  
✅ **Auth limit:** Blocks after 5 failed login attempts  
✅ **Successful logins:** Don't count toward auth limit  
✅ **Rate limit headers:** Correctly returned  
✅ **Error messages:** Clear and helpful  
✅ **Logging:** Rate limit violations logged

---

## Troubleshooting

### "Too many requests" but I haven't made many

**Cause:** Multiple users behind same public IP (office/school network)  
**Solution:**

- Increase limits for production
- Implement user-based rate limiting (not just IP)
- Use authentication to track users individually

### Rate limit not working

**Check:**

1. Is middleware applied? Check `server.ts`
2. Is proxy trust configured? `app.set("trust proxy", 1)`
3. Check logs for actual IP address being used

### Different limits for different users

```typescript
export const userBasedLimiter = rateLimit({
  keyGenerator: (req) => {
    // Use user ID instead of IP for authenticated requests
    return req.user?.id || req.ip;
  },
  max: (req) => {
    // Premium users get higher limits
    return req.user?.isPremium ? 1000 : 100;
  },
});
```

---

## Summary

✅ **4 rate limiters** configured  
✅ **All endpoints** protected  
✅ **Brute force** attacks prevented  
✅ **DDoS** mitigation in place  
✅ **Production-ready** with monitoring

Rate limiting is now active and protecting your API!

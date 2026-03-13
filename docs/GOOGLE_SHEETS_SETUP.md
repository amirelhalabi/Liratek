# Google Sheets Setup Guide (Service Account)

## Overview

We'll use a **Service Account** for backend authentication. This is simpler than OAuth and doesn't require Google verification.

---

## Step 1: Enable Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `LiraTek Subscriptions` (ID: `789056080983`)
3. Go to **APIs & Services** → **Library**
4. Search for **"Google Sheets API"**
5. Click **"Enable"**

---

## Step 2: Create Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"Service account"**
3. Fill in:
   - **Service account name:** `liratek-subscriptions`
   - **Service account ID:** auto-generated
   - **Description:** Backend access to client subscription sheet
4. Click **"Create and continue"**
5. **Grant this service account access to project:** Skip (click Done)

---

## Step 3: Generate Service Account Key

1. Click on the newly created service account email
2. Go to **"Keys"** tab
3. Click **"Add key"** → **"Create new key"**
4. Select **JSON** format
5. Click **"Create"**
6. A JSON file will download automatically (e.g., `liratek-subscriptions-abc123.json`)

**⚠️ IMPORTANT:** Save this file securely! It contains your private key.

---

## Step 4: Share Google Sheet with Service Account

1. Open the downloaded JSON file
2. Copy the `client_email` value (looks like: `liratek-subscriptions@project-id.iam.gserviceaccount.com`)
3. Go to your Google Sheet: `LiraTek_Clients_Master`
4. Click **"Share"** button (top right)
5. Paste the service account email
6. Set permission to **"Editor"** (so we can update last_login timestamps)
7. Click **"Done"**

---

## Step 5: Configure Environment Variables

### 5.1 Move Service Account Key

1. Create directory: `backend/config/`
2. Move the downloaded JSON file to: `backend/config/google-service-account.json`
3. Add to `.gitignore`:

```
# backend/.gitignore
config/google-service-account.json
```

### 5.2 Update backend/.env

Add these lines to `backend/.env`:

```env
# Google Sheets Service Account
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/google-service-account.json
GOOGLE_SHEET_ID=1qKYmPNH73H8FUONmozuKD1MSyjcqshiF8YFp5WmD6IQ

# Cache Configuration
CACHE_TTL_HOURS=12

# Grace Period
GRACE_PERIOD_DAYS=7
```

**Note:** We're using your existing sheet ID from `tbd-inenvfile.md`.

---

## Step 6: Verify Setup

### Test Connection

Run this command:

```bash
cd backend
node scripts/test-google-sheets.js
```

Expected output:

```
🔍 Testing Google Sheets Connection...

📊 Reading from Google Sheets...
✅ Connected to Google Sheets
✅ Found sheet with 2 clients

📋 Columns found:
   A. shop_name
   B. plan
   C. status
   D. api_key
   ...

✅ Test successful!
🎉 Google Sheets is ready to use!
```

---

## Troubleshooting

### Error: "Permission denied"

- Ensure you shared the sheet with the service account email
- Check service account has "Editor" permission
- Verify sheet ID is correct

### Error: "File not found"

- Check `backend/config/google-service-account.json` exists
- Verify path in `.env` is correct

### Error: "No data found"

- Ensure sheet has a tab named exactly `Clients`
- Check data starts from row 2 (row 1 is headers)

---

## Security Best Practices

1. **Never commit service account key** - Already in `.gitignore`
2. **Restrict sheet access** - Only share with service account
3. **Rotate keys periodically** - Generate new key every 6 months
4. **Monitor API usage** - Check Google Cloud Console logs
5. **Use separate Google account** - Don't use personal account for production

---

## Migration from OAuth (if you started OAuth setup)

If you previously set up OAuth credentials:

1. You can delete the OAuth credentials from Google Cloud Console
2. Remove these from `.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `GOOGLE_REFRESH_TOKEN`
3. Follow this guide for Service Account setup instead

---

## Next Steps

After verifying the connection:

1. ✅ Proceed to Phase 2: Backend Infrastructure
2. ✅ API key validation middleware
3. ✅ Plan enforcement
4. ✅ Admin page

---

**Setup Time:** 10-15 minutes  
**Difficulty:** Easy  
**Status:** Ready to begin

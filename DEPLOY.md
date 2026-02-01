# Deployment Guide

## Quick Deploy to Railway (Recommended)

Railway keeps your data persistent and is the easiest option.

### Steps:
1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Add environment variables:
   - `ANTHROPIC_API_KEY` - Your API key
   - `DASHBOARD_PASSWORD` - Choose a strong password
6. Deploy!

Your app will be live at `https://your-app.up.railway.app`

---

## Deploy to Vercel

Vercel requires a cloud database since it's serverless.

### Option A: With Turso (SQLite in the cloud)

1. Create a [Turso](https://turso.tech) account (free tier available)
2. Create a database
3. Get your database URL and auth token
4. Update `src/db/database.js` to use libsql instead of sql.js
5. Deploy to Vercel with environment variables

### Option B: Frontend Only (No AI Pipeline)

For a simpler deployment without the AI pipeline:
1. Push to GitHub
2. Import to Vercel
3. Add environment variables:
   - `DASHBOARD_PASSWORD`
4. The scan features will work, but pipeline (AI) features require API key

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For AI features | Get from console.anthropic.com |
| `DASHBOARD_PASSWORD` | Yes | Password to access dashboard |
| `PORT` | No | Server port (default: 3000) |

---

## Local Development

```bash
# Install dependencies
npm install

# Start the dashboard
npm run web
# or
./start.sh

# Access at http://localhost:3000
```

---

## Security Notes

1. **Change the default password** before deploying
2. **Never commit your API key** - use environment variables
3. Sessions expire after 24 hours

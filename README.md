# Meta Ads MCP Server for Claude

Connects Claude directly to your Meta Ads account. No n8n needed.

## What Claude Can Do
- 📊 Read all campaigns and performance data
- ⏸️ Pause / activate campaigns and ad sets
- 💰 Edit budgets
- ➕ Create new campaigns
- 📈 Get insights (ROAS, CPC, CTR, spend, etc.)

## Deploy to Railway (Free)

### 1. Push to GitHub
- Create a new repo on github.com
- Upload these 2 files: `index.js` and `package.json`

### 2. Deploy on Railway
- Go to railway.app → New Project → Deploy from GitHub
- Select your repo → Railway auto-deploys it

### 3. Add Environment Variables in Railway
Go to your project → Variables → Add:
```
META_ACCESS_TOKEN=your_token_here
META_AD_ACCOUNT_ID=act_XXXXXXXXXX
```

### 4. Get Your Railway URL
- Go to Settings → Networking → Generate Domain
- Your URL will look like: `https://meta-ads-mcp-xxxx.railway.app`

### 5. Connect to Claude
- Go to claude.ai → Settings → Connectors
- Click "Add Custom Connector"  
- Enter: `https://your-railway-url.railway.app/sse`
- Done! ✅

## Available Tools
| Tool | Description |
|------|-------------|
| get_campaigns | List all campaigns |
| get_campaign_performance | Detailed metrics for one campaign |
| get_all_performance | Overview of all campaigns |
| pause_campaign | Pause a campaign |
| activate_campaign | Resume a campaign |
| update_campaign_budget | Change daily/lifetime budget |
| create_campaign | Create a new campaign |
| get_adsets | List ad sets in a campaign |
| pause_adset | Pause an ad set |
| activate_adset | Activate an ad set |
| get_ads | List ads in an ad set |
| get_account_summary | Account spend & balance |

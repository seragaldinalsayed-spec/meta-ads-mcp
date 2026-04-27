import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { randomUUID } from "crypto";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const META_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

// Store active SSE sessions
const sessions = new Map();

// ─── Helper ───────────────────────────────────────────────────────────────────
async function metaAPI(endpoint, method = "GET", body = null) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (method === "GET") url.searchParams.set("access_token", ACCESS_TOKEN);
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "GET") options.body = JSON.stringify({ ...body, access_token: ACCESS_TOKEN });
  const res = await fetch(url.toString(), options);
  return res.json();
}

// ─── Tools ────────────────────────────────────────────────────────────────────
const tools = [
  {
    name: "get_campaigns",
    description: "Get all Meta Ads campaigns with status, budget, and basic info",
    inputSchema: {
      type: "object",
      properties: {
        status_filter: { type: "string", enum: ["ALL", "ACTIVE", "PAUSED", "ARCHIVED"], description: "Default: ALL" },
      },
    },
  },
  {
    name: "get_campaign_performance",
    description: "Get detailed performance metrics for one campaign (ROAS, CPC, CTR, spend, conversions)",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        date_preset: { type: "string", enum: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"], description: "Default: last_7d" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "get_all_performance",
    description: "Get performance overview for ALL campaigns. Call this before analyzing or scaling.",
    inputSchema: {
      type: "object",
      properties: {
        date_preset: { type: "string", enum: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"], description: "Default: last_7d" },
      },
    },
  },
  {
    name: "get_account_summary",
    description: "Get account spending, balance, currency and limits",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_adsets",
    description: "Get all ad sets inside a campaign",
    inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "get_ads",
    description: "Get all ads inside an ad set",
    inputSchema: { type: "object", properties: { adset_id: { type: "string" } }, required: ["adset_id"] },
  },
  {
    name: "analyze_and_suggest_scaling",
    description: "Reads ALL campaign data, analyzes ROAS/CPC/CTR, and returns a full scaling plan with recommendations. Always present results to user and ask approval before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "this_month"], description: "Default: last_7d" },
        scale_up_percentage: { type: "number", description: "% to increase budget for winners. Default: 20" },
        scale_down_percentage: { type: "number", description: "% to decrease budget for losers. Default: 20" },
        min_roas_to_scale_up: { type: "number", description: "Min ROAS to scale up. Default: 2.0" },
        max_cpc_threshold: { type: "number", description: "Max CPC before scaling down. Default: 5.0" },
      },
    },
  },
  {
    name: "propose_budget_change",
    description: "Propose a budget change for one campaign. Show proposal to user and wait for YES before executing.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        campaign_name: { type: "string" },
        current_daily_budget_cents: { type: "number" },
        proposed_daily_budget_cents: { type: "number" },
        reason: { type: "string" },
        key_metrics: { type: "string" },
      },
      required: ["campaign_id", "campaign_name", "proposed_daily_budget_cents", "reason"],
    },
  },
  {
    name: "execute_budget_change",
    description: "Apply budget change ONLY after user explicit approval. Never call without user saying YES.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        new_daily_budget_cents: { type: "number", description: "New daily budget in cents" },
      },
      required: ["campaign_id", "new_daily_budget_cents"],
    },
  },
  {
    name: "execute_bulk_budget_changes",
    description: "Apply budget changes to multiple campaigns. Only after user approves full plan.",
    inputSchema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              campaign_id: { type: "string" },
              campaign_name: { type: "string" },
              new_daily_budget_cents: { type: "number" },
            },
            required: ["campaign_id", "new_daily_budget_cents"],
          },
        },
      },
      required: ["changes"],
    },
  },
  {
    name: "pause_campaign",
    description: "Pause a running campaign",
    inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "activate_campaign",
    description: "Activate/resume a paused campaign",
    inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "pause_adset",
    description: "Pause an ad set",
    inputSchema: { type: "object", properties: { adset_id: { type: "string" } }, required: ["adset_id"] },
  },
  {
    name: "activate_adset",
    description: "Activate an ad set",
    inputSchema: { type: "object", properties: { adset_id: { type: "string" } }, required: ["adset_id"] },
  },
  {
    name: "create_campaign",
    description: "Create a new Meta Ads campaign",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string", enum: ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Default: PAUSED" },
        daily_budget: { type: "number", description: "In cents. e.g. 5000 = $50.00" },
        special_ad_categories: { type: "array", items: { type: "string" }, description: "Use [] if none" },
      },
      required: ["name", "objective"],
    },
  },
];

// ─── Tool Execution ───────────────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    case "get_campaigns": {
      const filter = args.status_filter || "ALL";
      let ep = `/${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time`;
      if (filter !== "ALL") ep += `&effective_status=["${filter}"]`;
      return await metaAPI(ep);
    }
    case "get_campaign_performance": {
      const preset = args.date_preset || "last_7d";
      const fields = "campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,actions,action_values,purchase_roas,cost_per_action_type";
      return await metaAPI(`/${args.campaign_id}/insights?fields=${fields}&date_preset=${preset}`);
    }
    case "get_all_performance": {
      const preset = args.date_preset || "last_7d";
      const fields = "campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,purchase_roas,actions";
      return await metaAPI(`/${AD_ACCOUNT_ID}/insights?fields=${fields}&date_preset=${preset}&level=campaign`);
    }
    case "get_account_summary":
      return await metaAPI(`/${AD_ACCOUNT_ID}?fields=name,account_status,currency,timezone_name,amount_spent,balance,spend_cap`);
    case "get_adsets":
      return await metaAPI(`/${args.campaign_id}/adsets?fields=id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal`);
    case "get_ads":
      return await metaAPI(`/${args.adset_id}/ads?fields=id,name,status,creative,created_time`);

    case "analyze_and_suggest_scaling": {
      const preset = args.date_preset || "last_7d";
      const scaleUp = args.scale_up_percentage || 20;
      const scaleDown = args.scale_down_percentage || 20;
      const minROAS = args.min_roas_to_scale_up || 2.0;
      const maxCPC = args.max_cpc_threshold || 5.0;

      const [campaignsRes, perfRes] = await Promise.all([
        metaAPI(`/${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,daily_budget,lifetime_budget`),
        metaAPI(`/${AD_ACCOUNT_ID}/insights?fields=campaign_id,campaign_name,impressions,clicks,spend,cpc,ctr,purchase_roas,actions&date_preset=${preset}&level=campaign`),
      ]);

      const campaigns = campaignsRes.data || [];
      const perfMap = {};
      for (const p of (perfRes.data || [])) perfMap[p.campaign_id] = p;

      const analysis = campaigns.map((c) => {
        const p = perfMap[c.id] || {};
        const roas = p.purchase_roas ? parseFloat(p.purchase_roas[0]?.value || 0) : 0;
        const cpc = parseFloat(p.cpc || 0);
        const ctr = parseFloat(p.ctr || 0);
        const spend = parseFloat(p.spend || 0);
        const impressions = parseInt(p.impressions || 0);
        const currentBudget = parseInt(c.daily_budget || 0);

        let recommendation = "✅ KEEP";
        let action = "No change needed";
        let proposedBudget = currentBudget;
        let priority = "LOW";

        if (c.status === "PAUSED") {
          recommendation = "⏸️ PAUSED"; action = "Review before reactivating";
        } else if (spend === 0 || impressions === 0) {
          recommendation = "🔍 REVIEW"; action = "No activity — check targeting/creative/bid"; priority = "HIGH";
        } else if (roas >= minROAS && cpc <= maxCPC && ctr >= 1.5) {
          recommendation = "🚀 SCALE UP";
          proposedBudget = Math.round(currentBudget * (1 + scaleUp / 100));
          action = `Strong ROAS ${roas.toFixed(2)}x & CPC $${cpc.toFixed(2)} — increase +${scaleUp}%`;
          priority = "HIGH";
        } else if (roas >= minROAS) {
          recommendation = "📈 SCALE UP (Moderate)";
          proposedBudget = Math.round(currentBudget * (1 + (scaleUp / 2) / 100));
          action = `Good ROAS ${roas.toFixed(2)}x — small increase +${scaleUp / 2}%`;
          priority = "MEDIUM";
        } else if (roas > 0 && roas < 1.0 && spend > 500) {
          recommendation = "⚠️ SCALE DOWN";
          proposedBudget = Math.round(currentBudget * (1 - scaleDown / 100));
          action = `Low ROAS ${roas.toFixed(2)}x — reduce -${scaleDown}%`;
          priority = "HIGH";
        } else if (cpc > maxCPC) {
          recommendation = "⚠️ SCALE DOWN";
          proposedBudget = Math.round(currentBudget * 0.8);
          action = `High CPC $${cpc.toFixed(2)} — reduce -20%`;
          priority = "MEDIUM";
        }

        return {
          campaign_id: c.id,
          campaign_name: c.name,
          status: c.status,
          recommendation,
          priority,
          action,
          metrics: { roas: roas > 0 ? `${roas.toFixed(2)}x` : "N/A", cpc: cpc > 0 ? `$${cpc.toFixed(2)}` : "N/A", ctr: `${ctr.toFixed(2)}%`, spend: `$${spend.toFixed(2)}`, impressions },
          budget: {
            current: `$${(currentBudget / 100).toFixed(2)}/day`,
            proposed: proposedBudget !== currentBudget ? `$${(proposedBudget / 100).toFixed(2)}/day` : "No change",
            difference: proposedBudget !== currentBudget ? `${proposedBudget > currentBudget ? "+" : ""}$${((proposedBudget - currentBudget) / 100).toFixed(2)}/day` : "$0",
            current_cents: currentBudget,
            proposed_cents: proposedBudget,
          },
        };
      });

      return {
        period: preset,
        total_campaigns: campaigns.length,
        needs_action: analysis.filter(c => c.recommendation.includes("SCALE") || c.recommendation.includes("REVIEW")).length,
        campaigns: analysis,
        instruction: "Show as a table. Ask user: 'Should I apply these changes? Say YES ALL or tell me which to skip.'",
      };
    }

    case "propose_budget_change": {
      const curr = ((args.current_daily_budget_cents || 0) / 100).toFixed(2);
      const prop = (args.proposed_daily_budget_cents / 100).toFixed(2);
      const diff = ((args.proposed_daily_budget_cents - (args.current_daily_budget_cents || 0)) / 100).toFixed(2);
      return {
        proposal: {
          campaign: args.campaign_name,
          campaign_id: args.campaign_id,
          from: `$${curr}/day`,
          to: `$${prop}/day`,
          difference: `${parseFloat(diff) > 0 ? "+" : ""}$${diff}/day`,
          reason: args.reason,
          metrics: args.key_metrics || "See analysis above",
        },
        status: "AWAITING_APPROVAL",
        message: `Budget change proposal for '${args.campaign_name}': $${curr}/day → $${prop}/day (${parseFloat(diff) > 0 ? "+" : ""}$${diff}/day). Reason: ${args.reason}. Reply YES to apply.`,
      };
    }

    case "execute_budget_change": {
      const result = await metaAPI(`/${args.campaign_id}`, "POST", { daily_budget: args.new_daily_budget_cents });
      return { success: !result.error, campaign_id: args.campaign_id, new_budget: `$${(args.new_daily_budget_cents / 100).toFixed(2)}/day`, api_response: result };
    }

    case "execute_bulk_budget_changes": {
      const results = [];
      for (const c of args.changes) {
        try {
          const res = await metaAPI(`/${c.campaign_id}`, "POST", { daily_budget: c.new_daily_budget_cents });
          results.push({ campaign: c.campaign_name || c.campaign_id, budget: `$${(c.new_daily_budget_cents / 100).toFixed(2)}/day`, status: res.success ? "✅" : "❌" });
        } catch (e) {
          results.push({ campaign: c.campaign_name || c.campaign_id, status: "❌ Error", error: e.message });
        }
      }
      return { completed: true, results };
    }

    case "pause_campaign": return await metaAPI(`/${args.campaign_id}`, "POST", { status: "PAUSED" });
    case "activate_campaign": return await metaAPI(`/${args.campaign_id}`, "POST", { status: "ACTIVE" });
    case "pause_adset": return await metaAPI(`/${args.adset_id}`, "POST", { status: "PAUSED" });
    case "activate_adset": return await metaAPI(`/${args.adset_id}`, "POST", { status: "ACTIVE" });
    case "create_campaign":
      return await metaAPI(`/${AD_ACCOUNT_ID}/campaigns`, "POST", {
        name: args.name, objective: args.objective,
        status: args.status || "PAUSED",
        daily_budget: args.daily_budget,
        special_ad_categories: args.special_ad_categories || [],
      });
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Message Handler ──────────────────────────────────────────────────────
async function handleMCPMessage(body) {
  const { method, params, id } = body;

  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "meta-ads-mcp", version: "2.0.0" } } };
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method === "tools/call") {
    try {
      if (!ACCESS_TOKEN) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: META_ACCESS_TOKEN not configured." }] } };
      const result = await executeTool(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }] } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (_, res) => res.json({ status: "ok", server: "Meta Ads MCP", version: "2.0.0" }));

// SSE endpoint - Claude connects here first
app.get("/sse", (req, res) => {
  const sessionId = randomUUID();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Store session
  sessions.set(sessionId, res);

  // Send endpoint info to client
  const messagesUrl = `/messages?sessionId=${sessionId}`;
  res.write(`event: endpoint\ndata: ${messagesUrl}\n\n`);

  // Keepalive
  const keepAlive = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

// Messages endpoint - Claude sends requests here
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const sseRes = sessions.get(sessionId);

  const response = await handleMCPMessage(req.body);

  if (response && sseRes) {
    sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  }

  res.status(202).json({ status: "accepted" });
});

// Direct POST fallback
app.post("/mcp", async (req, res) => {
  const response = await handleMCPMessage(req.body);
  res.json(response || { status: "ok" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Meta Ads MCP Server v2.0 on port ${PORT}`);
  console.log(`   Token: ${ACCESS_TOKEN ? "✅ Set" : "❌ Missing"}`);
  console.log(`   Account: ${AD_ACCOUNT_ID || "❌ Missing"}`);
});

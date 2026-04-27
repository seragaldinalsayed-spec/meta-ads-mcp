import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const META_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

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
    description: "Get all campaigns with status, budget, and basic info",
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
    description: "Get performance overview for ALL campaigns at once. Always call this before analyzing or scaling.",
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

  // ── SMART ANALYSIS & SCALING ─────────────────────────────────────────────
  {
    name: "analyze_and_suggest_scaling",
    description: `Fetches ALL campaign data + performance, analyzes each campaign intelligently, and returns a full scaling plan.
Analyzes: ROAS, CPC, CTR, spend, conversions, budget utilization.
Gives recommendation per campaign: SCALE UP / SCALE DOWN / PAUSE / KEEP / REVIEW.
IMPORTANT: After getting results, Claude MUST present the full plan to the user as a clear table and ask for approval before making any changes.`,
    inputSchema: {
      type: "object",
      properties: {
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "this_month"], description: "Date range for analysis. Default: last_7d" },
        scale_up_percentage: { type: "number", description: "% to increase budget for winning campaigns. Default: 20" },
        scale_down_percentage: { type: "number", description: "% to decrease budget for underperforming campaigns. Default: 20" },
        min_roas_to_scale_up: { type: "number", description: "Minimum ROAS to scale up. Default: 2.0" },
        max_cpc_to_scale_up: { type: "number", description: "Max CPC allowed for scale up. Default: 5.0" },
      },
    },
  },
  {
    name: "propose_budget_change",
    description: `Proposes a budget change for ONE campaign. Returns a formatted proposal for Claude to show the user.
Claude must always show this proposal and wait for explicit YES before executing.
NEVER call execute_budget_change without user approval.`,
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        campaign_name: { type: "string" },
        current_daily_budget_cents: { type: "number", description: "Current daily budget in cents" },
        proposed_daily_budget_cents: { type: "number", description: "Proposed new daily budget in cents" },
        reason: { type: "string", description: "Why this change is recommended" },
        key_metrics: { type: "string", description: "ROAS, CPC, CTR, spend summary" },
      },
      required: ["campaign_id", "campaign_name", "proposed_daily_budget_cents", "reason"],
    },
  },
  {
    name: "execute_budget_change",
    description: `ONLY call this after the user has explicitly approved the budget change.
Applies the actual budget update to the Meta Ads campaign.
Never call without prior user confirmation in the conversation.`,
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        new_daily_budget_cents: { type: "number", description: "New daily budget in cents (e.g. 5000 = $50.00)" },
        new_lifetime_budget_cents: { type: "number", description: "New lifetime budget in cents if applicable" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "execute_bulk_budget_changes",
    description: `Applies budget changes to MULTIPLE campaigns at once.
ONLY call after user has approved the full scaling plan.`,
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

  // ── STATUS ───────────────────────────────────────────────────────────────
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

  // ── CREATE ───────────────────────────────────────────────────────────────
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

// ─── Execution ────────────────────────────────────────────────────────────────
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
      const fields = "campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,purchase_roas,actions,cost_per_action_type";
      return await metaAPI(`/${AD_ACCOUNT_ID}/insights?fields=${fields}&date_preset=${preset}&level=campaign`);
    }

    case "get_account_summary":
      return await metaAPI(`/${AD_ACCOUNT_ID}?fields=name,account_status,currency,timezone_name,amount_spent,balance,spend_cap`);

    case "get_adsets":
      return await metaAPI(`/${args.campaign_id}/adsets?fields=id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal`);

    case "get_ads":
      return await metaAPI(`/${args.adset_id}/ads?fields=id,name,status,creative,created_time`);

    // ── SMART ANALYSIS ──
    case "analyze_and_suggest_scaling": {
      const preset = args.date_preset || "last_7d";
      const scaleUp = args.scale_up_percentage || 20;
      const scaleDown = args.scale_down_percentage || 20;
      const minROAS = args.min_roas_to_scale_up || 2.0;
      const maxCPC = args.max_cpc_to_scale_up || 5.0;

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
        let action = "Performance is acceptable, no change needed";
        let proposedBudget = currentBudget;
        let priority = "LOW";

        if (c.status === "PAUSED") {
          recommendation = "⏸️ PAUSED";
          action = "Campaign is paused — review before reactivating";
        } else if (spend === 0 || impressions === 0) {
          recommendation = "🔍 REVIEW";
          action = "No activity in this period — check targeting, creative, or bid";
          priority = "HIGH";
        } else if (roas >= minROAS && cpc <= maxCPC && ctr >= 1.5) {
          recommendation = "🚀 SCALE UP";
          proposedBudget = Math.round(currentBudget * (1 + scaleUp / 100));
          action = `Excellent: ROAS ${roas.toFixed(2)}x, CPC $${cpc.toFixed(2)}, CTR ${ctr.toFixed(2)}% → increase budget +${scaleUp}%`;
          priority = "HIGH";
        } else if (roas >= minROAS) {
          recommendation = "📈 SCALE UP (Moderate)";
          proposedBudget = Math.round(currentBudget * (1 + (scaleUp / 2) / 100));
          action = `Good ROAS ${roas.toFixed(2)}x but CTR is low → small increase +${scaleUp / 2}%`;
          priority = "MEDIUM";
        } else if (roas > 0 && roas < 1.0 && spend > 500) {
          recommendation = "⚠️ SCALE DOWN";
          proposedBudget = Math.round(currentBudget * (1 - scaleDown / 100));
          action = `Losing money: ROAS ${roas.toFixed(2)}x → reduce budget -${scaleDown}%, review creative`;
          priority = "HIGH";
        } else if (cpc > maxCPC) {
          recommendation = "⚠️ SCALE DOWN";
          proposedBudget = Math.round(currentBudget * 0.8);
          action = `High CPC $${cpc.toFixed(2)} → reduce budget -20%, optimize targeting`;
          priority = "MEDIUM";
        }

        return {
          campaign_id: c.id,
          campaign_name: c.name,
          status: c.status,
          recommendation,
          priority,
          action,
          metrics: {
            roas: roas > 0 ? `${roas.toFixed(2)}x` : "N/A",
            cpc: cpc > 0 ? `$${cpc.toFixed(2)}` : "N/A",
            ctr: ctr > 0 ? `${ctr.toFixed(2)}%` : "N/A",
            total_spend: `$${spend.toFixed(2)}`,
            impressions,
          },
          budget: {
            current: `$${(currentBudget / 100).toFixed(2)}/day`,
            proposed: proposedBudget !== currentBudget ? `$${(proposedBudget / 100).toFixed(2)}/day` : "No change",
            difference: proposedBudget !== currentBudget
              ? `${proposedBudget > currentBudget ? "+" : ""}$${((proposedBudget - currentBudget) / 100).toFixed(2)}/day`
              : "$0",
            current_cents: currentBudget,
            proposed_cents: proposedBudget,
          },
        };
      });

      return {
        analysis_period: preset,
        thresholds_used: { min_roas_to_scale_up: minROAS, max_cpc: maxCPC, scale_up_pct: `${scaleUp}%`, scale_down_pct: `${scaleDown}%` },
        total_campaigns: campaigns.length,
        needs_action: analysis.filter(c => c.recommendation.includes("SCALE") || c.recommendation.includes("REVIEW")).length,
        campaigns: analysis,
        next_step: "Present this as a table to the user. Ask: 'Should I apply all recommended budget changes? You can say YES ALL, or tell me which campaigns to skip.'",
      };
    }

    case "propose_budget_change": {
      const curr = (args.current_daily_budget_cents / 100).toFixed(2);
      const prop = (args.proposed_daily_budget_cents / 100).toFixed(2);
      const diff = ((args.proposed_daily_budget_cents - (args.current_daily_budget_cents || 0)) / 100).toFixed(2);
      const dir = args.proposed_daily_budget_cents > (args.current_daily_budget_cents || 0) ? "📈 INCREASE" : "📉 DECREASE";
      return {
        proposal: {
          campaign: args.campaign_name,
          campaign_id: args.campaign_id,
          change: dir,
          from: `$${curr}/day`,
          to: `$${prop}/day`,
          difference: `${parseFloat(diff) > 0 ? "+" : ""}$${diff}/day`,
          reason: args.reason,
          metrics: args.key_metrics || "See analysis above",
        },
        status: "AWAITING_USER_APPROVAL",
        message_for_user: `📋 Budget Change Proposal\n\nCampaign: ${args.campaign_name}\nChange: ${dir}\nFrom: $${curr}/day → To: $${prop}/day (${parseFloat(diff) > 0 ? "+" : ""}$${diff}/day)\nReason: ${args.reason}\n\n✅ Reply YES to apply this change.`,
      };
    }

    case "execute_budget_change": {
      const body = {};
      if (args.new_daily_budget_cents) body.daily_budget = args.new_daily_budget_cents;
      if (args.new_lifetime_budget_cents) body.lifetime_budget = args.new_lifetime_budget_cents;
      const result = await metaAPI(`/${args.campaign_id}`, "POST", body);
      return {
        success: !result.error,
        campaign_id: args.campaign_id,
        new_daily_budget: args.new_daily_budget_cents ? `$${(args.new_daily_budget_cents / 100).toFixed(2)}/day` : null,
        api_response: result,
      };
    }

    case "execute_bulk_budget_changes": {
      const results = [];
      for (const c of args.changes) {
        try {
          const res = await metaAPI(`/${c.campaign_id}`, "POST", { daily_budget: c.new_daily_budget_cents });
          results.push({
            campaign: c.campaign_name || c.campaign_id,
            new_budget: `$${(c.new_daily_budget_cents / 100).toFixed(2)}/day`,
            status: res.success ? "✅ Applied" : "❌ Failed",
          });
        } catch (e) {
          results.push({ campaign: c.campaign_name || c.campaign_id, status: "❌ Error", error: e.message });
        }
      }
      return { completed: true, total: args.changes.length, results };
    }

    case "pause_campaign":
      return await metaAPI(`/${args.campaign_id}`, "POST", { status: "PAUSED" });

    case "activate_campaign":
      return await metaAPI(`/${args.campaign_id}`, "POST", { status: "ACTIVE" });

    case "pause_adset":
      return await metaAPI(`/${args.adset_id}`, "POST", { status: "PAUSED" });

    case "activate_adset":
      return await metaAPI(`/${args.adset_id}`, "POST", { status: "ACTIVE" });

    case "create_campaign":
      return await metaAPI(`/${AD_ACCOUNT_ID}/campaigns`, "POST", {
        name: args.name,
        objective: args.objective,
        status: args.status || "PAUSED",
        daily_budget: args.daily_budget,
        special_ad_categories: args.special_ad_categories || [],
      });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Endpoints ────────────────────────────────────────────────────────────
app.get("/", (_, res) => res.json({ status: "ok", server: "Meta Ads MCP", version: "2.0.0" }));

app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  if (method === "initialize") return res.json({
    jsonrpc: "2.0", id,
    result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "meta-ads-mcp", version: "2.0.0" } },
  });

  if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools } });

  if (method === "tools/call") {
    try {
      if (!ACCESS_TOKEN) return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: META_ACCESS_TOKEN not set." }] } });
      const result = await executeTool(params.name, params.arguments || {});
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (err) {
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }] } });
    }
  }

  res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`event: endpoint\ndata: ${req.protocol}://${req.get("host")}/mcp\n\n`);
  const ka = setInterval(() => res.write(": keepalive\n\n"), 30000);
  req.on("close", () => clearInterval(ka));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Meta Ads MCP Server v2.0 on port ${PORT}`);
  console.log(`   Token: ${ACCESS_TOKEN ? "✅" : "❌ Set META_ACCESS_TOKEN"}`);
  console.log(`   Account: ${AD_ACCOUNT_ID || "❌ Set META_AD_ACCOUNT_ID"}`);
});

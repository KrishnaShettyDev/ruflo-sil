/**
 * MCP Server — exposes SIL as Model Context Protocol tools.
 *
 * Once registered with ruflo / Claude Code / Cursor, the host LLM can call:
 *   - sil_score              -> score one (original, suggested) pair
 *   - sil_score_batch        -> score many pairs at once
 *   - sil_score_pipeline     -> Recursive Semantic Drift over a multi-hop chain
 *   - sil_explain            -> human-readable explanation for the last score
 *   - sil_correct            -> propose an intent-preserving correction
 *   - sil_get_user_profile   -> retrieve a user's style profile
 *   - sil_update_user_sample -> add a writing sample to a user's profile
 *
 * Run via `claude mcp add sil -- npx @plutaslab/ruflo-sil mcp` or wire into
 * ruflo's MCP catalog.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SIL } from "../core/sil.js";
import { CascadeAnalyzer } from "../scorers/cascade.js";
import { ScoreRequestSchema } from "../types/index.js";

function makeSil(): SIL {
  const hf = process.env.HF_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;

  if (hf) {
    return SIL.hosted({
      hfApiKey: hf,
      anthropicApiKey: anthropic,
      openrouterApiKey: openrouter,
      enableJudge: Boolean(anthropic || openrouter),
      enableCorrector: Boolean(anthropic || openrouter),
    });
  }
  // Fallback: local mocks
  return SIL.local();
}

export async function startMcpServer() {
  const sil = makeSil();
  const cascade = new CascadeAnalyzer(sil);

  const server = new Server(
    { name: "ruflo-sil", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sil_score",
        description:
          "Score whether an AI-suggested rewrite preserves user intent. Returns a risk score (0-1), an action (pass/warn/block), per-category breakdown, and a human-readable explanation. Use BEFORE accepting any AI edit on user-authored text.",
        inputSchema: {
          type: "object",
          properties: {
            original: {
              type: "string",
              description: "The user's original text",
            },
            suggested: {
              type: "string",
              description: "The AI's suggested rewrite",
            },
            surface: {
              type: "string",
              enum: [
                "keyboard",
                "autocomplete",
                "email",
                "chat",
                "code",
                "document",
                "translation",
                "agent_pipeline",
              ],
              description: "Where the edit is happening",
            },
            userId: { type: "string" },
            context: { type: "array", items: { type: "string" } },
            generateCorrection: { type: "boolean" },
          },
          required: ["original", "suggested"],
        },
      },
      {
        name: "sil_score_batch",
        description:
          "Score multiple (original, suggested) pairs in parallel. Use for offline evaluation runs or batch audits.",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  original: { type: "string" },
                  suggested: { type: "string" },
                  surface: { type: "string" },
                },
                required: ["original", "suggested"],
              },
            },
          },
          required: ["items"],
        },
      },
      {
        name: "sil_score_pipeline",
        description:
          "Analyze Recursive Semantic Drift across a multi-hop AI pipeline. Returns per-hop risks, cumulative drift, and the drift pattern (linear / exponential / saturating / noisy).",
        inputSchema: {
          type: "object",
          properties: {
            pipelineId: { type: "string" },
            hops: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  agentId: { type: "string" },
                  input: { type: "string" },
                  output: { type: "string" },
                },
                required: ["agentId", "input", "output"],
              },
            },
            surface: { type: "string" },
          },
          required: ["pipelineId", "hops"],
        },
      },
      {
        name: "sil_correct",
        description:
          "Given an original and a corrupted suggestion, produce an intent-preserving correction.",
        inputSchema: {
          type: "object",
          properties: {
            original: { type: "string" },
            suggested: { type: "string" },
            surface: { type: "string" },
          },
          required: ["original", "suggested"],
        },
      },
      {
        name: "sil_get_user_profile",
        description: "Retrieve a user's accumulated style profile.",
        inputSchema: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
      },
      {
        name: "sil_update_user_sample",
        description: "Add a writing sample to a user's style profile.",
        inputSchema: {
          type: "object",
          properties: {
            userId: { type: "string" },
            sample: { type: "string" },
          },
          required: ["userId", "sample"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "sil_score": {
          const req = ScoreRequestSchema.parse(args);
          const result = await sil.score(req);
          return {
            content: [
              { type: "text", text: JSON.stringify(result, replacerForSets, 2) },
            ],
          };
        }
        case "sil_score_batch": {
          const items = (args as any).items as Array<any>;
          const results = await Promise.all(
            items.map((it) => sil.score(ScoreRequestSchema.parse(it))),
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(results, replacerForSets, 2) },
            ],
          };
        }
        case "sil_score_pipeline": {
          const report = await cascade.analyze(args as any);
          return {
            content: [
              { type: "text", text: JSON.stringify(report, replacerForSets, 2) },
            ],
          };
        }
        case "sil_correct": {
          const req = ScoreRequestSchema.parse({
            ...(args as any),
            generateCorrection: true,
          });
          const result = await sil.score(req);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    correction: result.correction,
                    explanation: result.explanation,
                    risk: result.overallRisk,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        case "sil_get_user_profile": {
          const profile = await sil.getUserProfile((args as any).userId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(profile, replacerForSets, 2),
              },
            ],
          };
        }
        case "sil_update_user_sample": {
          const profile = await sil.updateUserProfile(
            (args as any).userId,
            (args as any).sample,
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { updated: Boolean(profile), sampleCount: profile?.sampleCount ?? 0 },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: (err as Error).message },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[SIL] MCP server started on stdio");
}

function replacerForSets(_key: string, value: unknown) {
  if (value instanceof Set) return [...value];
  return value;
}

// Allow running directly: `tsx src/mcp/server.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((err) => {
    console.error("[SIL] MCP server failed:", err);
    process.exit(1);
  });
}

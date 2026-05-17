/**
 * Standalone HTTP API for SIL.
 *
 * Use when you want SIL outside ruflo — as a service called by your own
 * apps, browser extensions, Slack bots, etc.
 *
 * Endpoints:
 *   POST /v1/score             — single score
 *   POST /v1/score/batch       — batch scoring
 *   POST /v1/score/pipeline    — cascade / RSD analysis
 *   POST /v1/correct           — correction generation
 *   POST /v1/profile/:userId   — update user style profile
 *   GET  /v1/profile/:userId   — fetch user style profile
 *   GET  /healthz
 *   GET  /readyz
 *   WS   /v1/stream            — streaming scoring for keystroke-time use
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { SIL } from "../core/sil.js";
import { CascadeAnalyzer } from "../scorers/cascade.js";
import { ScoreRequestSchema } from "../types/index.js";

export interface ApiServerOptions {
  port?: number;
  host?: string;
  sil: SIL;
}

export async function buildServer(opts: ApiServerOptions) {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  const sil = opts.sil;
  const cascade = new CascadeAnalyzer(sil);

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  app.post("/v1/score", async (req, reply) => {
    try {
      const parsed = ScoreRequestSchema.parse(req.body);
      const result = await sil.score(parsed);
      return result;
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.post("/v1/score/batch", async (req, reply) => {
    try {
      const items = (req.body as any)?.items ?? [];
      if (!Array.isArray(items)) {
        reply.status(400);
        return { error: "items must be an array" };
      }
      const results = await Promise.all(
        items.map((it) => sil.score(ScoreRequestSchema.parse(it))),
      );
      return { results };
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.post("/v1/score/pipeline", async (req, reply) => {
    try {
      const report = await cascade.analyze(req.body as any);
      return report;
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.post("/v1/correct", async (req, reply) => {
    try {
      const parsed = ScoreRequestSchema.parse({
        ...(req.body as any),
        generateCorrection: true,
      });
      const result = await sil.score(parsed);
      return {
        correction: result.correction,
        explanation: result.explanation,
        risk: result.overallRisk,
      };
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.post("/v1/profile/:userId", async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const { sample } = req.body as { sample: string };
      const profile = await sil.updateUserProfile(userId, sample);
      return { updated: Boolean(profile), profile };
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });

  app.get("/v1/profile/:userId", async (req) => {
    const { userId } = req.params as { userId: string };
    const profile = await sil.getUserProfile(userId);
    return { profile };
  });

  // WebSocket streaming for typing-time use
  app.get("/v1/stream", { websocket: true }, (socket) => {
    socket.on("message", async (buf: Buffer) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === "score") {
          const result = await sil.score(ScoreRequestSchema.parse(msg.payload));
          socket.send(JSON.stringify({ type: "score_result", payload: result }));
        }
      } catch (err) {
        socket.send(
          JSON.stringify({ type: "error", message: (err as Error).message }),
        );
      }
    });
  });

  return app;
}

export async function startApiServer(opts: ApiServerOptions) {
  const app = await buildServer(opts);
  await app.listen({
    port: opts.port ?? 8787,
    host: opts.host ?? "0.0.0.0",
  });
  return app;
}

// Direct run
if (import.meta.url === `file://${process.argv[1]}`) {
  const sil =
    process.env.HF_API_KEY
      ? SIL.hosted({
          hfApiKey: process.env.HF_API_KEY,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          openrouterApiKey: process.env.OPENROUTER_API_KEY,
          enableJudge: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
          enableCorrector: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY),
        })
      : SIL.local();

  startApiServer({ sil, port: Number(process.env.PORT ?? 8787) }).catch(
    (err) => {
      console.error("server failed:", err);
      process.exit(1);
    },
  );
}

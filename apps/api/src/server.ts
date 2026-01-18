import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import path from "path";
import crypto from "crypto";

import { config } from "./config";
import { supabase, storageBucket } from "./lib/supabase";
import { signAccessToken, verifyAccessToken } from "./lib/jwt";
import { parseTelegramInitData } from "./lib/telegram";
import { callN8nWebhook } from "./lib/n8n";
import {
  getModel,
  inputItemSchema,
  validateInputCount
} from "@mini-app/shared";

export type AuthUser = {
  id: string;
  telegram_id: number;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const authHeaderSchema = z.string().min(1);

const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  const header = request.headers.authorization;
  if (!header) {
    return reply.code(401).send({ error: { code: "unauthorized", message: "Missing token" } });
  }
  if (!header.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
  }
  const token = authHeaderSchema.safeParse(header.slice(7));
  if (!token.success) {
    return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
  }
  try {
    const payload = await verifyAccessToken(token.data);
    request.user = { id: payload.sub, telegram_id: payload.telegram_id };
  } catch {
    return reply.code(401).send({ error: { code: "unauthorized", message: "Token invalid" } });
  }
};

const safeRandomPath = (userId: string, filename: string) => {
  const ext = path.extname(filename).slice(0, 10);
  const name = crypto.randomUUID();
  return `${userId}/${name}${ext}`;
};

export const buildServer = () => {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(helmet);
  app.register(rateLimit, { global: false });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/telegram", async (request, reply) => {
    const bodySchema = z.object({ initData: z.string().min(1) });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { code: "invalid_body", message: "Invalid initData" } });
      return;
    }

    try {
      const telegram = parseTelegramInitData(parsed.data.initData);
      const { data, error } = await supabase
        .from("users")
        .upsert(
          {
            telegram_id: telegram.telegram_id,
            updated_at: new Date().toISOString()
          },
          { onConflict: "telegram_id" }
        )
        .select("id, telegram_id, balance, promo_gen")
        .single();

      if (error || !data) {
        request.log.error({ error }, "Failed to upsert user");
        reply.code(500).send({ error: { code: "db_error", message: "User upsert failed" } });
        return;
      }

      const accessToken = await signAccessToken({
        sub: data.id,
        telegram_id: data.telegram_id
      });

      reply.send({
        accessToken,
        user: {
          id: data.id,
          telegram_id: data.telegram_id,
          balance: Number(data.balance),
          promo_gen: Number(data.promo_gen ?? 0)
        }
      });
    } catch (error) {
      request.log.error({ error }, "Telegram initData validation failed");
      reply.code(401).send({ error: { code: "unauthorized", message: "initData invalid" } });
    }
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: { code: "unauthorized", message: "Missing user" } });
      return;
    }
    const { data, error } = await supabase
      .from("users")
      .select("id, telegram_id, balance, promo_gen")
      .eq("id", request.user.id)
      .single();

    if (error || !data) {
      request.log.error({ error }, "Failed to load user");
      reply.code(500).send({ error: { code: "db_error", message: "User lookup failed" } });
      return;
    }

    reply.send({
      user: {
        id: data.id,
        telegram_id: data.telegram_id,
        balance: Number(data.balance),
        promo_gen: Number(data.promo_gen ?? 0)
      }
    });
  });

  app.post("/uploads/create-signed", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: { code: "unauthorized", message: "Missing user" } });
      return;
    }

    const bodySchema = z.object({
      files: z
        .array(
          z.object({
            filename: z.string().min(1),
            contentType: z.string().min(1),
            sizeBytes: z.number().positive()
          })
        )
        .max(8)
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { code: "invalid_body", message: "Invalid files" } });
      return;
    }

    const maxBytes = 30 * 1024 * 1024;
    for (const file of parsed.data.files) {
      if (file.sizeBytes > maxBytes) {
        reply.code(400).send({
          error: { code: "file_too_large", message: "File exceeds 30MB" }
        });
        return;
      }
    }

    const items = [] as { path: string; token: string }[];

    for (const file of parsed.data.files) {
      const objectPath = safeRandomPath(request.user.id, file.filename);
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .createSignedUploadUrl(objectPath);

      if (error || !data?.token) {
        request.log.error({ error }, "Signed upload failed");
        reply.code(500).send({ error: { code: "storage_error", message: "Signed upload failed" } });
        return;
      }

      items.push({ path: data.path ?? objectPath, token: data.token });
    }

    reply.send({ bucket: storageBucket, items });
  });

  app.post(
    "/generate",
    {
      preHandler: requireAuth,
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_MAX,
          timeWindow: config.RATE_LIMIT_WINDOW_MS
        }
      }
    },
    async (request, reply) => {
      if (!request.user) {
        reply.code(401).send({ error: { code: "unauthorized", message: "Missing user" } });
        return;
      }

      const bodySchema = z.object({
        model: z.string().min(1),
        prompt: z.string().min(1),
        params: z.record(z.unknown()).default({}),
        inputs: z.array(inputItemSchema).default([]),
        style: z.string().min(1).optional(),
        counter: z.number().int().min(1).max(6).optional(),
        prompt_ai: z.boolean().optional()
      });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: { code: "invalid_body", message: "Invalid payload" } });
        return;
      }

      const model = getModel(parsed.data.model);
      if (!model) {
        reply.code(400).send({ error: { code: "unknown_model", message: "Model not found" } });
        return;
      }

      let modelParams: Record<string, unknown>;
      try {
        modelParams = model.paramsSchema.parse(parsed.data.params) as Record<string, unknown>;
      } catch (error) {
        reply.code(400).send({
          error: {
            code: "invalid_params",
            message: error instanceof Error ? error.message : "Invalid params"
          }
        });
        return;
      }

      const inputValidation = validateInputCount(model, parsed.data.inputs);
      if (!inputValidation.ok) {
        reply.code(400).send({
          error: { code: "invalid_inputs", message: inputValidation.message }
        });
        return;
      }

      const baseCost = model.computeCost(modelParams);
      const counter = model.type === "image" ? (parsed.data.counter ?? 1) : 1;
      const cost = baseCost * counter;
      if (baseCost <= 0 || cost <= 0) {
        reply.code(400).send({
          error: { code: "invalid_cost", message: "Unable to calculate cost" }
        });
        return;
      }

      const rpcPayload = {
        p_telegram_id: request.user.telegram_id,
        p_model: parsed.data.model,
        p_type: model.type,
        p_prompt: parsed.data.prompt,
        p_params: modelParams,
        p_inputs: parsed.data.inputs,
        p_base_cost: baseCost,
        p_counter: counter
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc("create_job_and_debit", rpcPayload);
      const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (rpcError || !rpcRow) {
        request.log.error({ rpcError }, "RPC create_job_and_debit failed");
        reply.code(400).send({
          error: { code: "debit_failed", message: rpcError?.message ?? "Debit failed" }
        });
        return;
      }

      const jobId = (rpcRow as { job_id?: string; id?: string; jobId?: string }).job_id ||
        (rpcRow as { id?: string }).id ||
        (rpcRow as { jobId?: string }).jobId;
      const balance = (rpcRow as { balance?: number; new_balance?: number }).balance ??
        (rpcRow as { new_balance?: number }).new_balance ??
        null;
      const promoGen = (rpcRow as { promo_gen?: number }).promo_gen ?? null;
      const chargedCost = (rpcRow as { charged_cost?: number }).charged_cost ?? cost;

      if (!jobId) {
        reply.code(500).send({ error: { code: "rpc_invalid", message: "RPC missing job id" } });
        return;
      }

      const signedInputs = [] as { kind: string; signed_url: string }[];
      for (const input of parsed.data.inputs) {
        const { data, error } = await supabase.storage
          .from(storageBucket)
          .createSignedUrl(input.path, 3600);
        if (error || !data?.signedUrl) {
          request.log.error({ error }, "Failed to sign input url");
          await supabase
            .from("jobs")
            .update({
              status: "failed",
              error: { code: "signed_url_failed", message: "Failed to sign input" },
              finished_at: new Date().toISOString()
            })
            .eq("id", jobId);
          await supabase.rpc("refund_job", { job_id: jobId });
          reply.code(500).send({
            job: { id: jobId, status: "failed" },
            error: { code: "signed_url_failed", message: "Failed to sign input" }
          });
          return;
        }
        signedInputs.push({ kind: input.kind, signed_url: data.signedUrl });
      }

      const n8nPayload = {
        job_id: jobId,
        telegram_id: request.user.telegram_id,
        model: parsed.data.model,
        prompt: parsed.data.prompt,
        params: modelParams,
        inputs: signedInputs,
        style: parsed.data.style ?? "custom",
        counter,
        prompt_ai: parsed.data.prompt_ai ?? false
      };

      const n8nResponse = await callN8nWebhook(n8nPayload);
      if (n8nResponse.ok) {
        await supabase
          .from("jobs")
          .update({
            status: "succeeded",
            output_url: n8nResponse.output_url,
            finished_at: new Date().toISOString()
          })
          .eq("id", jobId);

        const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();

        reply.send({
          job: job ?? {
            id: jobId,
            status: "succeeded",
            cost: chargedCost,
            output_url: n8nResponse.output_url,
            created_at: new Date().toISOString()
          },
          user: { balance: balance ?? 0, promo_gen: promoGen ?? undefined }
        });
        return;
      }

      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error: n8nResponse.error,
          finished_at: new Date().toISOString()
        })
        .eq("id", jobId);

      const refund = await supabase.rpc("refund_job", { job_id: jobId });
      const refundRow = Array.isArray(refund.data) ? refund.data[0] : refund.data;
      const refundBalance = (refundRow as { balance?: number } | null)?.balance ?? balance ?? 0;
      const refundPromo = (refundRow as { promo_gen?: number } | null)?.promo_gen ?? promoGen ?? null;

      reply.code(500).send({
        job: { id: jobId, status: "failed" },
        error: n8nResponse.error,
        user: { balance: refundBalance, promo_gen: refundPromo ?? undefined }
      });
    }
  );

  app.get("/jobs", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: { code: "unauthorized", message: "Missing user" } });
      return;
    }

    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", request.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) {
      request.log.error({ error }, "Failed to load jobs");
      reply.code(500).send({ error: { code: "db_error", message: "Failed to load jobs" } });
      return;
    }

    reply.send({ items: data });
  });

  app.get("/jobs/:id", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: { code: "unauthorized", message: "Missing user" } });
      return;
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      reply.code(400).send({ error: { code: "invalid_id", message: "Invalid job id" } });
      return;
    }

    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", parsedParams.data.id)
      .eq("user_id", request.user.id)
      .single();

    if (error || !data) {
      reply.code(404).send({ error: { code: "not_found", message: "Job not found" } });
      return;
    }

    reply.send({ job: data });
  });

  return app;
};

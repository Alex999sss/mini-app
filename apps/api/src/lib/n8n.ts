import crypto from "crypto";

import { config } from "../config";

export type N8nSuccess = { ok: true; output_url: string; meta?: Record<string, unknown> };
export type N8nError = { ok: false; error: { code: string; message: string } };
export type N8nResponse = N8nSuccess | N8nError;

export const callN8nWebhook = async (payload: Record<string, unknown>): Promise<N8nResponse> => {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", config.N8N_SHARED_SECRET).update(body).digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.N8N_TIMEOUT_MS);

  try {
    const response = await fetch(config.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature
      },
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: "n8n_http_error",
          message: `n8n responded with ${response.status}`
        }
      };
    }

    const data = (await response.json()) as N8nResponse;
    if (typeof data?.ok !== "boolean") {
      return {
        ok: false,
        error: {
          code: "n8n_invalid_response",
          message: "n8n response format invalid"
        }
      };
    }
    return data;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "n8n_fetch_error",
        message: error instanceof Error ? error.message : "Unknown fetch error"
      }
    };
  } finally {
    clearTimeout(timeout);
  }
};

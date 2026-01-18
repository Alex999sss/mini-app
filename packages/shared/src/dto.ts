import type { InputKind, ModelId } from "./models";

export type UserDto = {
  id: string;
  telegram_id: number;
  balance: number;
  promo_gen: number;
};

export type AuthTelegramRequest = {
  initData: string;
};

export type AuthTelegramResponse = {
  accessToken: string;
  user: UserDto;
};

export type MeResponse = {
  user: UserDto;
};

export type CreateSignedUploadRequest = {
  files: {
    filename: string;
    contentType: string;
    sizeBytes: number;
  }[];
};

export type CreateSignedUploadResponse = {
  bucket: string;
  items: {
    path: string;
    token: string;
  }[];
};

export type GenerateInput = {
  kind: InputKind;
  path: string;
};

export type GenerateRequest = {
  model: ModelId;
  prompt: string;
  params: Record<string, unknown>;
  inputs: GenerateInput[];
  style?: string;
  counter?: number;
  prompt_ai?: boolean;
};

export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

export type JobDto = {
  id: string;
  user_id?: string;
  model: string;
  type: "image" | "video";
  prompt: string;
  params: Record<string, unknown>;
  inputs: GenerateInput[];
  status: JobStatus;
  cost: number;
  output_url?: string | null;
  error?: unknown;
  created_at: string;
  finished_at?: string | null;
};

export type GenerateResponseSuccess = {
  job: JobDto;
  user: { balance: number; promo_gen?: number };
};

export type GenerateError = {
  code: string;
  message: string;
};

export type GenerateResponseError = {
  job?: { id: string; status: "failed" };
  error: GenerateError;
  user?: { balance: number; promo_gen?: number };
};

export type JobsResponse = {
  items: JobDto[];
};

export type JobResponse = {
  job: JobDto;
};

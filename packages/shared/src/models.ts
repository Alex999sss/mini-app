import { z } from "zod";

export const modelIds = [
  "nano-banana-pro",
  "google/nano-banana",
  "bytedance/seedance-1.5-pro",
  "wan/2-6-text-to-video",
  "wan/2-6-image-to-video",
  "wan/2-6-video-to-video",
  "sora-2-pro-text-to-video",
  "sora-2-pro-image-to-video"
] as const;

export type ModelId = (typeof modelIds)[number];
export type ModelType = "image" | "video";
export type InputKind = "image" | "video";

export type InputRule = {
  kind: InputKind;
  min: number;
  max: number;
  maxSizeMB: number;
  mimeTypes: string[];
};

export type ParamField =
  | {
      key: string;
      label: string;
      type: "select";
      options: string[];
      required?: boolean;
      default?: string;
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: "boolean";
      default?: boolean;
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      required?: boolean;
      default?: number;
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: "string_list";
      separator?: string;
      maxItems?: number;
      default?: string[];
      help?: string;
    };

export type ModelDefinition = {
  id: ModelId;
  name: string;
  type: ModelType;
  description: string;
  promptRequired: boolean;
  inputs?: InputRule;
  params: ParamField[];
  paramsSchema: z.ZodTypeAny;
  computeCost: (params: unknown) => number;
};

const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const videoMimeTypes = ["video/mp4", "video/quicktime", "video/x-matroska"];

const aspectRatiosImage = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "auto"
] as const;

const aspectRatiosVideo = ["1:1", "21:9", "4:3", "3:4", "16:9", "9:16"] as const;

const nanoBananaProParams = z.object({
  aspect_ratio: z.enum(aspectRatiosImage).default("auto"),
  resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
  output_format: z.enum(["png", "jpg"]).default("png")
});

const nanoBananaParams = z.object({
  output_format: z.enum(["png", "jpeg"]).default("png"),
  image_size: z.enum([
    "1:1",
    "9:16",
    "16:9",
    "3:4",
    "4:3",
    "3:2",
    "2:3",
    "5:4",
    "4:5",
    "21:9",
    "auto"
  ]).default("1:1")
});

const seedanceParams = z.object({
  aspect_ratio: z.enum(aspectRatiosVideo).default("16:9"),
  resolution: z.enum(["480p", "720p"]).default("480p"),
  duration: z.enum(["4", "8", "12"]).default("4"),
  fixed_lens: z.boolean().default(false),
  generate_audio: z.boolean().default(false)
});

const wanParams = z.object({
  duration: z.enum(["5", "10", "15"]).default("5"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  multi_shots: z.boolean().default(false)
});

const wanV2vParams = z.object({
  duration: z.enum(["5", "10"]).default("5"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  multi_shots: z.boolean().default(false)
});

const soraParams = z.object({
  aspect_ratio: z.enum(["portrait", "landscape"]).default("portrait"),
  n_frames: z.enum(["10", "15"]).default("10"),
  size: z.enum(["standard", "high"]).default("standard"),
  remove_watermark: z.boolean().default(false),
  character_id_list: z.array(z.string()).max(5).default([])
});

const seedanceCostTable: Record<string, Record<string, Record<string, number>>> = {
  "480p": {
    "4": { noAudio: 10, audio: 15 },
    "8": { noAudio: 15, audio: 20 },
    "12": { noAudio: 17, audio: 27 }
  },
  "720p": {
    "4": { noAudio: 12, audio: 18 },
    "8": { noAudio: 18, audio: 34 },
    "12": { noAudio: 30, audio: 50 }
  }
};

const wanCostTable: Record<string, Record<string, number>> = {
  "720p": { "5": 50, "10": 90, "15": 110 },
  "1080p": { "5": 65, "10": 110, "15": 165 }
};

const soraCostTable: Record<string, Record<string, number>> = {
  standard: { "10": 85, "15": 140 },
  high: { "10": 180, "15": 350 }
};

const nanoBananaPro: ModelDefinition = {
  id: "nano-banana-pro",
  name: "Nano banana pro",
  type: "image",
  description: "Продвинутая генерация изображений с несколькими входами.",
  promptRequired: true,
  inputs: {
    kind: "image",
    min: 0,
    max: 8,
    maxSizeMB: 30,
    mimeTypes: imageMimeTypes
  },
  params: [
    {
      key: "aspect_ratio",
      label: "Соотношение сторон",
      type: "select",
      options: [...aspectRatiosImage],
      default: "auto"
    },
    {
      key: "resolution",
      label: "Разрешение",
      type: "select",
      options: ["1K", "2K", "4K"],
      default: "1K"
    },
    {
      key: "output_format",
      label: "Формат вывода",
      type: "select",
      options: ["png", "jpg"],
      default: "png"
    }
  ],
  paramsSchema: nanoBananaProParams,
  computeCost: (params) => {
    const parsed = nanoBananaProParams.parse(params);
    return parsed.resolution === "4K" ? 20 : 15;
  }
};

const nanoBanana: ModelDefinition = {
  id: "google/nano-banana",
  name: "Nano banana",
  type: "image",
  description: "Быстрая генерация изображений по тексту.",
  promptRequired: true,
  params: [
    {
      key: "output_format",
      label: "Формат вывода",
      type: "select",
      options: ["png", "jpeg"],
      default: "png"
    },
    {
      key: "image_size",
      label: "Размер изображения",
      type: "select",
      options: [
        "1:1",
        "9:16",
        "16:9",
        "3:4",
        "4:3",
        "3:2",
        "2:3",
        "5:4",
        "4:5",
        "21:9",
        "auto"
      ],
      default: "1:1"
    }
  ],
  paramsSchema: nanoBananaParams,
  computeCost: () => 7
};

const seedance: ModelDefinition = {
  id: "bytedance/seedance-1.5-pro",
  name: "Seedance 1.5 Pro",
  type: "video",
  description: "Видео по изображению с опциональным звуком.",
  promptRequired: true,
  inputs: {
    kind: "image",
    min: 0,
    max: 2,
    maxSizeMB: 10,
    mimeTypes: imageMimeTypes
  },
  params: [
    {
      key: "aspect_ratio",
      label: "Соотношение сторон",
      type: "select",
      options: [...aspectRatiosVideo],
      default: "16:9"
    },
    {
      key: "resolution",
      label: "Разрешение",
      type: "select",
      options: ["480p", "720p"],
      default: "480p"
    },
    {
      key: "duration",
      label: "Длительность (сек)",
      type: "select",
      options: ["4", "8", "12"],
      default: "4"
    },
    {
      key: "fixed_lens",
      label: "Фиксированный объектив",
      type: "boolean",
      default: false
    },
    {
      key: "generate_audio",
      label: "Генерировать звук",
      type: "boolean",
      default: false
    }
  ],
  paramsSchema: seedanceParams,
  computeCost: (params) => {
    const parsed = seedanceParams.parse(params);
    const byRes = seedanceCostTable[parsed.resolution];
    const byDur = byRes?.[parsed.duration];
    if (!byDur) {
      return 0;
    }
    return parsed.generate_audio ? byDur.audio : byDur.noAudio;
  }
};

const wanT2v: ModelDefinition = {
  id: "wan/2-6-text-to-video",
  name: "Wan 2.6 T2V",
  type: "video",
  description: "Текст-в-видео с режимом multi-shots.",
  promptRequired: true,
  params: [
    {
      key: "duration",
      label: "Длительность (сек)",
      type: "select",
      options: ["5", "10", "15"],
      default: "5"
    },
    {
      key: "resolution",
      label: "Разрешение",
      type: "select",
      options: ["720p", "1080p"],
      default: "720p"
    },
    {
      key: "multi_shots",
      label: "Multi-shots",
      type: "boolean",
      default: false
    }
  ],
  paramsSchema: wanParams,
  computeCost: (params) => {
    const parsed = wanParams.parse(params);
    const byRes = wanCostTable[parsed.resolution];
    return byRes?.[parsed.duration] ?? 0;
  }
};

const wanI2v: ModelDefinition = {
  id: "wan/2-6-image-to-video",
  name: "Wan 2.6 I2V",
  type: "video",
  description: "Изображение-в-видео с режимом multi-shots.",
  promptRequired: true,
  inputs: {
    kind: "image",
    min: 1,
    max: 1,
    maxSizeMB: 10,
    mimeTypes: imageMimeTypes
  },
  params: wanT2v.params,
  paramsSchema: wanParams,
  computeCost: wanT2v.computeCost
};

const wanV2v: ModelDefinition = {
  id: "wan/2-6-video-to-video",
  name: "Wan 2.6 V2V",
  type: "video",
  description: "Видео-в-видео с режимом multi-shots.",
  promptRequired: true,
  inputs: {
    kind: "video",
    min: 1,
    max: 3,
    maxSizeMB: 10,
    mimeTypes: videoMimeTypes
  },
  params: [
    {
      key: "duration",
      label: "Длительность (сек)",
      type: "select",
      options: ["5", "10"],
      default: "5"
    },
    {
      key: "resolution",
      label: "Разрешение",
      type: "select",
      options: ["720p", "1080p"],
      default: "720p"
    },
    {
      key: "multi_shots",
      label: "Multi-shots",
      type: "boolean",
      default: false
    }
  ],
  paramsSchema: wanV2vParams,
  computeCost: (params) => {
    const parsed = wanV2vParams.parse(params);
    const byRes = wanCostTable[parsed.resolution];
    return byRes?.[parsed.duration] ?? 0;
  }
};

const soraT2v: ModelDefinition = {
  id: "sora-2-pro-text-to-video",
  name: "Sora 2 Pro T2V",
  type: "video",
  description: "Текст-в-видео с опциональными ID персонажей.",
  promptRequired: true,
  params: [
    {
      key: "aspect_ratio",
      label: "Ориентация",
      type: "select",
      options: ["portrait", "landscape"],
      default: "portrait"
    },
    {
      key: "n_frames",
      label: "Кадры",
      type: "select",
      options: ["10", "15"],
      default: "10"
    },
    {
      key: "size",
      label: "Качество",
      type: "select",
      options: ["standard", "high"],
      default: "standard"
    },
    {
      key: "remove_watermark",
      label: "Убрать водяной знак",
      type: "boolean",
      default: false
    },
    {
      key: "character_id_list",
      label: "ID персонажей",
      type: "string_list",
      separator: ",",
      maxItems: 5,
      default: [],
      help: "ID через запятую"
    }
  ],
  paramsSchema: soraParams,
  computeCost: (params) => {
    const parsed = soraParams.parse(params);
    const bySize = soraCostTable[parsed.size];
    return bySize?.[parsed.n_frames] ?? 0;
  }
};

const soraI2v: ModelDefinition = {
  id: "sora-2-pro-image-to-video",
  name: "Sora 2 Pro I2V",
  type: "video",
  description: "Изображение-в-видео с опциональными ID персонажей.",
  promptRequired: true,
  inputs: {
    kind: "image",
    min: 1,
    max: 1,
    maxSizeMB: 10,
    mimeTypes: imageMimeTypes
  },
  params: soraT2v.params,
  paramsSchema: soraParams,
  computeCost: soraT2v.computeCost
};

export const models: Record<ModelId, ModelDefinition> = {
  "nano-banana-pro": nanoBananaPro,
  "google/nano-banana": nanoBanana,
  "bytedance/seedance-1.5-pro": seedance,
  "wan/2-6-text-to-video": wanT2v,
  "wan/2-6-image-to-video": wanI2v,
  "wan/2-6-video-to-video": wanV2v,
  "sora-2-pro-text-to-video": soraT2v,
  "sora-2-pro-image-to-video": soraI2v
};

export const listModels = (): ModelDefinition[] => Object.values(models);

export const getModel = (id: string): ModelDefinition | undefined =>
  (models as Record<string, ModelDefinition>)[id];

export const getDefaultParams = (model: ModelDefinition): Record<string, unknown> => {
  try {
    return model.paramsSchema.parse({}) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const getModelCost = (modelId: string, params: unknown): number => {
  const model = getModel(modelId);
  if (!model) {
    return 0;
  }
  return model.computeCost(params);
};

export const inputItemSchema = z.object({
  kind: z.enum(["image", "video"]),
  path: z.string().min(1)
});

export const validateInputCount = (model: ModelDefinition, inputs: { kind: InputKind; path: string }[]) => {
  if (!model.inputs) {
    if (inputs.length > 0) {
      return { ok: false, message: "Входные файлы для этой модели не поддерживаются." };
    }
    return { ok: true } as const;
  }
  const { min, max, kind } = model.inputs;
  const kindLabel = kind === "video" ? "видео" : "изображений";
  if (inputs.length < min || inputs.length > max) {
    return {
      ok: false,
      message: `Нужно ${min}-${max} ${kindLabel}.`
    } as const;
  }
  const wrongKind = inputs.find((item) => item.kind !== kind);
  if (wrongKind) {
    const wrongKindLabel = wrongKind.kind === "video" ? "видео" : "изображение";
    return {
      ok: false,
      message: `Неверный тип входных данных: ${wrongKindLabel}.`
    } as const;
  }
  return { ok: true } as const;
};

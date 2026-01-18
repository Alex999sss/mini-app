import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";

import {
  getDefaultParams,
  getModel,
  getModelCost,
  listModels
} from "@mini-app/shared";
import type {
  CreateSignedUploadResponse,
  GenerateRequest,
  GenerateResponseError,
  GenerateResponseSuccess,
  JobDto,
  JobsResponse,
  UserDto
} from "@mini-app/shared";
import { ApiError, apiFetch, getToken, setToken } from "./lib/api";
import { formatCredits, formatElapsed, formatTimestamp } from "./lib/format";
import { getInitData, sendDataToBot, setupTelegram } from "./lib/telegram";
import { supabase, storageBucket } from "./lib/supabase";

const modelList = listModels();
const imageModels = modelList.filter((model) => model.type === "image");
const videoModels = modelList.filter((model) => model.type === "video");

const inputKindLabels: Record<string, string> = {
  image: "фото",
  video: "видео"
};

const styleOptions: { value: string; label: string; icon?: string }[] = [
  { value: "custom", label: "Идею укажу сам", icon: "💡" },
  { value: "cinematic", label: "Кинематографичный" },
  { value: "neon", label: "Неон" },
  { value: "retro", label: "Ретро" },
  { value: "pastel", label: "Пастель" },
  { value: "watercolor", label: "Акварель" },
  { value: "comic", label: "Комикс" },
  { value: "cyberpunk", label: "Киберпанк" },
  { value: "minimal", label: "Минимализм" },
  { value: "glitch", label: "Глитч" }
];

const exampleBeforeFallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde68a"/>
      <stop offset="100%" stop-color="#fca5a5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#bg)"/>
  <circle cx="320" cy="240" r="120" fill="#fff7ed" opacity="0.85"/>
  <rect x="520" y="360" width="520" height="220" rx="28" fill="#fef3c7" opacity="0.85"/>
  <text x="80" y="120" font-size="72" font-family="Space Grotesk, sans-serif" fill="#7c2d12" opacity="0.9">BEFORE</text>
</svg>
`;

const exampleAfterFallbackSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a5f3fc"/>
      <stop offset="100%" stop-color="#c7d2fe"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#bg2)"/>
  <circle cx="420" cy="260" r="140" fill="#e0f2fe" opacity="0.85"/>
  <rect x="180" y="380" width="520" height="220" rx="28" fill="#f8fafc" opacity="0.9"/>
  <text x="760" y="120" font-size="72" font-family="Space Grotesk, sans-serif" fill="#1e293b" opacity="0.9">AFTER</text>
</svg>
`;

const exampleBeforeFallback = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(exampleBeforeFallbackSvg)}`;
const exampleAfterFallback = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(exampleAfterFallbackSvg)}`;
const exampleBucket = "photo";
const exampleBeforePath = "before.jpg";
const exampleAfterPath = "after.jpg";
const exampleBeforeSupabase =
  supabase.storage.from(exampleBucket).getPublicUrl(exampleBeforePath).data?.publicUrl ?? "";
const exampleAfterSupabase =
  supabase.storage.from(exampleBucket).getPublicUrl(exampleAfterPath).data?.publicUrl ?? "";

const statusLabels: Record<JobDto["status"], string> = {
  queued: "В очереди",
  processing: "В работе",
  succeeded: "Успешно",
  failed: "Ошибка"
};

const formatSizeMB = (bytes: number) => {
  const sizeMB = bytes / 1024 / 1024;
  if (!Number.isFinite(sizeMB)) {
    return "0";
  }
  if (sizeMB < 0.1) {
    return "<0.1";
  }
  return sizeMB.toFixed(1);
};

type View = "generate-photo" | "generate-video" | "result" | "history";

type FormValues = {
  modelId: string;
  prompt: string;
  params: Record<string, unknown>;
};

const formSchema = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1),
  params: z.record(z.unknown())
});

export const App = () => {
  const [view, setView] = useState<View>("generate-photo");
  const [user, setUser] = useState<UserDto | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<JobDto | null>(null);

  useEffect(() => {
    setupTelegram();

    const bootstrap = async () => {
      setAuthLoading(true);
      setAuthError(null);

      const token = getToken();
      if (token) {
        try {
          const me = await apiFetch<{ user: UserDto }>("/me");
          setUser(me.user);
          setAuthLoading(false);
          return;
        } catch {
          setToken(null);
        }
      }

      const initData = getInitData();
      if (!initData) {
        setAuthError("Откройте мини-приложение из чата с ботом, чтобы продолжить.");
        setAuthLoading(false);
        return;
      }

      try {
        const auth = await apiFetch<{ accessToken: string; user: UserDto }>("/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData })
        });
        setToken(auth.accessToken);
        setUser(auth.user);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ошибка авторизации";
        setAuthError(message);
      } finally {
        setAuthLoading(false);
      }
    };

    void bootstrap();
  }, []);

  const handleUserUpdate = (payload: { balance: number; promo_gen?: number }) => {
    setUser((prev) =>
      prev
        ? {
            ...prev,
            balance: payload.balance,
            promo_gen: payload.promo_gen ?? prev.promo_gen ?? 0
          }
        : prev
    );
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-sand text-slate-900 flex items-center justify-center">
        <div className="glass-card px-8 py-6 text-center animate-fade-up">
          <div className="text-lg font-semibold">Подключение...</div>
          <div className="text-sm text-slate-600 mt-2">Готовим рабочее пространство</div>
        </div>
      </div>
    );
  }

  if (authError || !user) {
    return (
      <div className="min-h-screen bg-sand text-slate-900 flex items-center justify-center px-6">
        <div className="glass-card max-w-md px-6 py-8 text-center animate-fade-up">
          <h1 className="text-2xl font-semibold">Доступ к мини-приложению закрыт</h1>
          <p className="text-sm text-slate-600 mt-3">{authError ?? "Требуется авторизация"}</p>
          <div className="mt-6 text-xs text-slate-500">Если вы в разработке, задайте VITE_DEV_INIT_DATA.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sand text-slate-900 relative overflow-hidden">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="max-w-5xl mx-auto px-4 py-8 relative">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="uppercase tracking-[0.3em] text-xs text-slate-500">Мини-приложение Telegram</p>
            <h1 className="text-3xl md:text-4xl font-semibold mt-2">Студия генерации</h1>
          </div>
          <div className="glass-card px-4 py-3 flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-slate-500">ID Telegram</div>
              <div className="font-semibold">{user.telegram_id}</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-xs text-slate-500">Баланс</div>
              <div className="font-semibold">{formatCredits(user.balance)}</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-xs text-slate-500">Бесплатные генерации</div>
              <div className="font-semibold">{user.promo_gen ?? 0}</div>
            </div>
          </div>
        </header>

        <nav className="mt-8 flex flex-wrap gap-3">
          <button
            className={clsx("chip", view === "generate-photo" && "chip-active")}
            onClick={() => setView("generate-photo")}
          >
            Генерация фото
          </button>
          <button
            className={clsx("chip", view === "generate-video" && "chip-active")}
            onClick={() => setView("generate-video")}
          >
            Генерация видео
          </button>
          <button className={clsx("chip", view === "history" && "chip-active")} onClick={() => setView("history")}>
            История
          </button>
        </nav>

        <main className="mt-6">
          {view === "generate-photo" && (
            <GenerateScreen
              mode="image"
              balance={user.balance}
              promoGen={user.promo_gen ?? 0}
              onResult={(job) => {
                setActiveJob(job);
                setView("result");
              }}
              onUserUpdate={handleUserUpdate}
            />
          )}
          {view === "generate-video" && (
            <GenerateScreen
              mode="video"
              balance={user.balance}
              promoGen={user.promo_gen ?? 0}
              onResult={(job) => {
                setActiveJob(job);
                setView("result");
              }}
              onUserUpdate={handleUserUpdate}
            />
          )}
          {view === "history" && (
            <HistoryScreen
              onSelect={(job) => {
                setActiveJob(job);
                setView("result");
              }}
            />
          )}
          {view === "result" && activeJob && (
            <ResultScreen
              job={activeJob}
              onBack={() => setView("history")}
            />
          )}
        </main>
        <ExampleSection />
      </div>
    </div>
  );
};

const GenerateScreen = ({
  mode,
  balance,
  promoGen,
  onResult,
  onUserUpdate
}: {
  mode: "image" | "video";
  balance: number;
  promoGen: number;
  onResult: (job: JobDto) => void;
  onUserUpdate: (payload: { balance: number; promo_gen?: number }) => void;
}) => {
  const models = mode === "image" ? imageModels : videoModels;
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const selectedModel = useMemo(() => getModel(selectedId), [selectedId]);
  const [files, setFiles] = useState<File[]>([]);
  const [style, setStyle] = useState(styleOptions[0]?.value ?? "custom");
  const [promptAi, setPromptAi] = useState(false);
  const [photoCount, setPhotoCount] = useState(1);
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewItems, setPreviewItems] = useState<{ name: string; url: string }[]>([]);
  const timerRef = useRef<number | null>(null);
  const getFormDefaults = (modelId: string) => {
    const model = getModel(modelId);
    if (!model) {
      return {};
    }
    const defaults = getDefaultParams(model);
    const result: Record<string, unknown> = { ...defaults };
    model.params.forEach((param) => {
      if (param.type === "string_list") {
        const value = defaults[param.key];
        if (Array.isArray(value)) {
          result[param.key] = value.join(param.separator ?? ",");
        }
      }
    });
    return result;
  };

  const normalizeParams = (raw: Record<string, unknown> | null | undefined) => {
    if (!selectedModel) {
      return raw;
    }
    const base = raw && typeof raw === "object" ? raw : {};
    const result: Record<string, unknown> = { ...base };
    selectedModel.params.forEach((param) => {
      if (param.type === "string_list") {
        const value = (base as Record<string, unknown>)[param.key];
        if (typeof value === "string") {
          result[param.key] = value
            .split(param.separator ?? ",")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, param.maxItems ?? 5);
        }
      }
    });
    return result;
  };

  const { register, handleSubmit, reset, watch } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      modelId: selectedId,
      prompt: "",
      params: getFormDefaults(selectedId)
    }
  });

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    reset({
      modelId: selectedId,
      prompt: "",
      params: getFormDefaults(selectedId)
    });
    setFiles([]);
    setErrorMessage(null);
    setStage("idle");
    setElapsed(0);
  }, [selectedId, selectedModel, reset]);

  useEffect(() => {
    if (stage === "uploading" || stage === "processing") {
      timerRef.current = window.setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
      return () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
        }
      };
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
  }, [stage]);

  const accept = useMemo(() => {
    if (!selectedModel?.inputs) {
      return undefined;
    }
    return selectedModel.inputs.mimeTypes.reduce((acc, type) => {
      acc[type] = [] as string[];
      return acc;
    }, {} as Record<string, string[]>);
  }, [selectedModel]);

  const maxFiles = selectedModel?.inputs?.max ?? 0;
  const minFiles = selectedModel?.inputs?.min ?? 0;
  const maxSizeMB = selectedModel?.inputs?.maxSizeMB ?? 0;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    disabled: !selectedModel?.inputs,
    accept,
    maxFiles: maxFiles || undefined,
    onDrop: (acceptedFiles) => {
      if (!selectedModel?.inputs) {
        return;
      }
      const maxBytes = maxSizeMB * 1024 * 1024;
      const filtered = acceptedFiles.filter((file) => file.size <= maxBytes);
      setFiles((prev) => {
        const merged = [...prev, ...filtered];
        const limit = maxFiles > 0 ? maxFiles : merged.length;
        const limited = merged.slice(0, limit);
        const droppedBySize = acceptedFiles.length - filtered.length;
        const droppedByCount = merged.length - limited.length;
        if (droppedBySize > 0 || droppedByCount > 0) {
          setErrorMessage(`Некоторые файлы превышают лимит ${maxSizeMB} МБ или количество.`);
        } else {
          setErrorMessage(null);
        }
        return limited;
      });
    }
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const params = watch("params");
  const baseCost = selectedModel ? getModelCost(selectedModel.id, normalizeParams(params)) : 0;
  const counter = mode === "image" ? photoCount : 1;
  const cost = baseCost * counter;
  const freeGen = mode === "image" ? promoGen : 0;
  const freeUsed = mode === "image" ? Math.min(counter, Math.max(0, freeGen)) : 0;
  const discountedCost = Math.max(cost - freeUsed * baseCost, 0);
  const payableCost = mode === "image" ? discountedCost : cost;
  const showDiscount = mode === "image" && baseCost > 0 && freeUsed > 0;
  const costLabel = showDiscount
    ? discountedCost === 0
      ? "Бесплатно"
      : formatCredits(discountedCost)
    : formatCredits(cost);
  const hasEnoughBalance = balance >= payableCost;

  useEffect(() => {
    if (!selectedModel?.inputs || selectedModel.inputs.kind !== "image" || files.length === 0) {
      setPreviewItems([]);
      return;
    }
    const next = files.map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file)
    }));
    setPreviewItems(next);
    return () => {
      next.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [files, selectedModel?.inputs?.kind]);

  const generateTitle = mode === "image" ? "Генерация фото" : "Генерация видео";
  const uploadLabel = selectedModel?.inputs
    ? selectedModel.inputs.kind === "image"
      ? "Прикрепите свои фото"
      : "Прикрепите свои видео"
    : "Входные файлы";

  const onSubmit = handleSubmit(async (data) => {
    if (!selectedModel) {
      return;
    }
    setErrorMessage(null);
    setJobId(null);

    if (selectedModel.inputs) {
      if (files.length < minFiles || files.length > maxFiles) {
        const kindLabel = inputKindLabels[selectedModel.inputs.kind] ?? selectedModel.inputs.kind;
        setErrorMessage(`Загрузите ${minFiles}-${maxFiles} файлов типа ${kindLabel}.`);
        return;
      }
    }

    let normalizedParams: Record<string, unknown> = {};
    try {
      const normalizedRaw = normalizeParams(data.params);
      normalizedParams = selectedModel.paramsSchema.parse(normalizedRaw) as Record<string, unknown>;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Некорректные параметры");
      return;
    }

    setStage("uploading");

    let inputs: GenerateRequest["inputs"] = [];
    if (selectedModel.inputs && files.length > 0) {
      try {
        const payload = {
          files: files.map((file) => ({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size
          }))
        };
        const signed = await apiFetch<CreateSignedUploadResponse>("/uploads/create-signed", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const uploads = await Promise.all(
          signed.items.map((item, index) =>
            supabase.storage
              .from(storageBucket)
              .uploadToSignedUrl(item.path, item.token, files[index])
          )
        );

        const failed = uploads.find((res) => res.error);
        if (failed?.error) {
          const details =
            typeof failed.error === "string"
              ? failed.error
              : (failed.error as { message?: string; error?: string; statusCode?: number }).message ||
                (failed.error as { error?: string }).error ||
                "Неизвестная ошибка";
          throw new Error(`Загрузка не удалась: ${details}`);
        }

        inputs = signed.items.map((item) => ({
          kind: selectedModel.inputs?.kind ?? "image",
          path: item.path
        }));
      } catch (error) {
        setStage("error");
        setErrorMessage(error instanceof Error ? error.message : "Загрузка не удалась");
        return;
      }
    }

    setStage("processing");

    const payload: GenerateRequest = {
      model: selectedModel.id,
      prompt: data.prompt,
      params: normalizedParams,
      inputs,
      style,
      counter: mode === "image" ? photoCount : 1,
      prompt_ai: promptAi
    };

    try {
      const response = await apiFetch<GenerateResponseSuccess>("/generate", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      onUserUpdate({ balance: response.user.balance, promo_gen: response.user.promo_gen });
      onResult(response.job);
    } catch (error) {
      setStage("error");
      if (error instanceof ApiError) {
        const apiData = error.data as GenerateResponseError | null;
        if (apiData?.job?.id) {
          setJobId(apiData.job.id);
        }
      }
      setErrorMessage(error instanceof Error ? error.message : "Генерация не удалась");
    }
  });

  if (stage === "processing" || stage === "uploading") {
    return (
      <section className="glass-card p-6 text-center animate-fade-up">
        <div className="text-sm uppercase tracking-[0.3em] text-slate-500">В работе</div>
        <h2 className="text-2xl font-semibold mt-3">Обрабатываем запрос</h2>
        <p className="text-slate-600 mt-2">Оставайтесь в приложении, пока n8n генерирует результат.</p>
        <div className="mt-6 text-4xl font-semibold">{formatElapsed(elapsed)}</div>
        <div className="mt-6 flex justify-center">
          <div className="loader" />
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <div className="glass-card p-6 animate-fade-up">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold">{generateTitle}</h2>
        </div>
        <form className="mt-6 space-y-6" onSubmit={onSubmit}>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="field">
              <span className="field-label">Модель</span>
              <select
                className="field-input"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <span className="field-help">{selectedModel?.description}</span>
            </label>

            <div className="space-y-4">
              {mode === "image" && (
                <label className="field">
                  <span className="field-label">Сколько сгенерировать фото</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={6}
                      step={1}
                      value={photoCount}
                      onChange={(event) => setPhotoCount(Number(event.target.value))}
                      className="w-full"
                    />
                    <div className="text-sm font-semibold">{photoCount}</div>
                  </div>
                </label>
              )}

              <label className="field">
                <div className="flex items-center justify-between gap-4">
                  <span className="field-label">Промпт</span>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={promptAi}
                      onChange={(event) => setPromptAi(event.target.checked)}
                    />
                    <span>Улучшить промпт</span>
                  </div>
                </div>
                <textarea className="field-input min-h-[120px]" {...register("prompt")} />
              </label>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Выбрать стили</span>
            <div className="mt-3 flex flex-wrap gap-2">
              {styleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={clsx("chip", style === option.value && "chip-active")}
                  onClick={() => setStyle(option.value)}
                >
                  {option.icon && <span className="mr-1">{option.icon}</span>}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {selectedModel && selectedModel.params.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              {selectedModel.params.map((param) => {
                if (param.type === "select") {
                  return (
                    <label key={param.key} className="field">
                      <span className="field-label">{param.label}</span>
                      <select className="field-input" {...register(`params.${param.key}`)}>
                        {param.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      {param.help && <span className="field-help">{param.help}</span>}
                    </label>
                  );
                }

                if (param.type === "boolean") {
                  return (
                    <label key={param.key} className="field field-inline">
                      <input type="checkbox" className="toggle" {...register(`params.${param.key}`)} />
                      <span className="field-label">{param.label}</span>
                    </label>
                  );
                }

                if (param.type === "number") {
                  return (
                    <label key={param.key} className="field">
                      <span className="field-label">{param.label}</span>
                      <input
                        type="number"
                        className="field-input"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        {...register(`params.${param.key}`, { valueAsNumber: true })}
                      />
                      {param.help && <span className="field-help">{param.help}</span>}
                    </label>
                  );
                }

                if (param.type === "string_list") {
                  return (
                    <label key={param.key} className="field">
                      <span className="field-label">{param.label}</span>
                      <input
                        type="text"
                        className="field-input"
                        placeholder="id1,id2"
                        {...register(`params.${param.key}`)}
                      />
                      {param.help && <span className="field-help">{param.help}</span>}
                    </label>
                  );
                }

                return null;
              })}
            </div>
          )}

          <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-4">
            <div className="field">
              <span className="field-label">{uploadLabel}</span>
              {selectedModel?.inputs ? (
                <div
                  {...getRootProps()}
                  className={clsx(
                    "dropzone",
                    isDragActive && "dropzone-active",
                    files.length > 0 && "dropzone-filled"
                  )}
                >
                  <input {...getInputProps()} />
                  <p className="text-sm text-slate-600">
                    {files.length > 0
                      ? `Готово файлов: ${files.length}`
                      : `Перетащите ${inputKindLabels[selectedModel.inputs.kind] ?? ""} сюда или нажмите для загрузки`}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Допустимо: {selectedModel.inputs.mimeTypes.join(", ")}, до {maxSizeMB} МБ каждый, {minFiles}-
                    {maxFiles} файлов.
                  </p>
                </div>
              ) : (
                <div className="dropzone dropzone-disabled">Файлы для этой модели не нужны.</div>
              )}

              {files.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3">
                      <span className="truncate">{file.name}</span>
                      <div className="flex items-center gap-3">
                        <span>{formatSizeMB(file.size)} МБ</span>
                        <button
                          type="button"
                          className="text-xs text-rose-600 hover:text-rose-700"
                          onClick={() => removeFile(index)}
                        >
                          Удалить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {selectedModel?.inputs?.kind === "image" && previewItems.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {previewItems.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="relative overflow-hidden rounded-xl border border-white/40">
                      <img src={item.url} alt={item.name} className="h-20 w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full bg-white/80 px-2 py-1 text-xs text-rose-600"
                        onClick={() => removeFile(index)}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field glass-soft p-4">
              <span className="field-label">Оценка стоимости</span>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                {showDiscount && (
                  <span className="text-sm text-slate-400 line-through">{formatCredits(cost)}</span>
                )}
                <span className={clsx("text-3xl font-semibold", !hasEnoughBalance && "text-rose-600")}>
                  {costLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Стоимость считается на клиенте и подтверждается сервером перед списанием.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="error-card">
              <div className="font-semibold">{errorMessage}</div>
              {jobId && <div className="text-xs text-slate-600 mt-1">ID задачи: {jobId}</div>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              className={clsx("btn-primary", !hasEnoughBalance && "opacity-50 cursor-not-allowed")}
              type="submit"
              disabled={!hasEnoughBalance}
            >
              Сгенерировать
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

const HistoryScreen = ({ onSelect }: { onSelect: (job: JobDto) => void }) => {
  const [filter, setFilter] = useState<"image" | "video">("image");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiFetch<JobsResponse>("/jobs")
  });
  const filteredItems = data?.items.filter((job) => job.type === filter) ?? [];

  if (isLoading) {
    return (
      <section className="glass-card p-6 animate-fade-up">Загружаем историю...</section>
    );
  }

  if (error) {
    return (
      <section className="glass-card p-6 animate-fade-up">
        <div className="text-lg font-semibold">Не удалось загрузить историю</div>
        <button className="btn-outline mt-4" onClick={() => refetch()}>
          Повторить
        </button>
      </section>
    );
  }

  return (
    <section className="glass-card p-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">История</h2>
        <button className="btn-outline" onClick={() => refetch()}>
          Обновить
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={clsx("chip", filter === "image" && "chip-active")}
          onClick={() => setFilter("image")}
        >
          Фото
        </button>
        <button
          className={clsx("chip", filter === "video" && "chip-active")}
          onClick={() => setFilter("video")}
        >
          Видео
        </button>
      </div>
      <div className="mt-6 space-y-3">
        {filteredItems.length ? (
          filteredItems.map((job) => {
            const model = getModel(job.model);
            return (
              <button
                key={job.id}
                className="history-item"
                onClick={() => job.output_url && onSelect(job)}
              >
                <div>
                  <div className="font-semibold">{model?.name ?? job.model}</div>
                  <div className="text-xs text-slate-500">{formatTimestamp(job.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className={clsx("status", `status-${job.status}`)}>
                    {statusLabels[job.status] ?? job.status}
                  </div>
                  <div className="text-sm text-slate-600">{formatCredits(job.cost)}</div>
                </div>
              </button>
            );
          })
        ) : (
          <div className="text-sm text-slate-600">Пока нет задач для выбранного типа.</div>
        )}
      </div>
    </section>
  );
};

const ExampleSection = () => {
  const [split, setSplit] = useState(50);
  const [beforeUrl, setBeforeUrl] = useState(exampleBeforeSupabase || exampleBeforeFallback);
  const [afterUrl, setAfterUrl] = useState(exampleAfterSupabase || exampleAfterFallback);
  const usingFallback =
    beforeUrl === exampleBeforeFallback || afterUrl === exampleAfterFallback;

  const handleBeforeError = () => {
    if (beforeUrl !== exampleBeforeFallback) {
      setBeforeUrl(exampleBeforeFallback);
    }
  };

  const handleAfterError = () => {
    if (afterUrl !== exampleAfterFallback) {
      setAfterUrl(exampleAfterFallback);
    }
  };

  return (
    <section className="glass-card mt-10 p-6 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold">Пример</h2>
        <div className="text-xs text-slate-500">Передвиньте линию для сравнения</div>
      </div>
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <img
          src={afterUrl}
          alt="Пример после"
          className="h-64 w-full object-cover"
          onError={handleAfterError}
        />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
          <img
            src={beforeUrl}
            alt="Пример до"
            className="h-full w-full object-cover"
            onError={handleBeforeError}
          />
        </div>
        <div className="absolute top-0 bottom-0" style={{ left: `calc(${split}% - 1px)` }}>
          <div className="h-full w-0.5 bg-white/80 shadow" />
          <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/80 text-xs font-semibold text-slate-600">
            &lt;&gt;
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          aria-label="Сравнить пример"
        />
      </div>
      {usingFallback && (
        <div className="mt-3 text-xs text-slate-500">
          Загрузите в bucket {exampleBucket} файлы {exampleBeforePath} и {exampleAfterPath}, чтобы заменить пример.
        </div>
      )}
    </section>
  );
};

const ResultScreen = ({ job, onBack }: { job: JobDto; onBack: () => void }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!job.output_url) {
      return;
    }
    await navigator.clipboard.writeText(job.output_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSend = () => {
    if (!job.output_url) {
      return;
    }
    sendDataToBot({ action: "send_document", output_url: job.output_url, job_id: job.id });
  };

  return (
    <section className="glass-card p-6 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold">Результат</h2>
        <button className="btn-outline" onClick={onBack}>
          Назад к истории
        </button>
      </div>

      <div className="mt-6 grid gap-6">
        <div className="preview">
          {job.type === "video" ? (
            <video src={job.output_url ?? ""} controls className="w-full rounded-xl" />
          ) : (
            <img src={job.output_url ?? ""} alt="Результат" className="w-full rounded-xl" />
          )}
        </div>

        <div className="glass-soft p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">URL результата</div>
            <div className="text-sm text-slate-700 break-all mt-1">{job.output_url}</div>
          </div>
          <button className="btn-outline" onClick={handleCopy}>
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={handleSend}>
            Отправить документом
          </button>
          <div className="text-xs text-slate-500">
            Telegram закроет мини-приложение после отправки.
          </div>
        </div>
      </div>
    </section>
  );
};

export default App;

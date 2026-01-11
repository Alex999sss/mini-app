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

const typeLabels: Record<string, string> = {
  image: "изображение",
  video: "видео"
};

const inputKindLabels: Record<string, string> = {
  image: "изображения",
  video: "видео"
};

const statusLabels: Record<JobDto["status"], string> = {
  queued: "В очереди",
  processing: "В работе",
  succeeded: "Успешно",
  failed: "Ошибка"
};

type View = "home" | "generate" | "result" | "history";

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
  const [view, setView] = useState<View>("home");
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

  const handleBalanceUpdate = (balance: number) => {
    setUser((prev) => (prev ? { ...prev, balance } : prev));
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
          <div className="glass-card px-4 py-3 flex items-center gap-4">
            <div>
              <div className="text-xs text-slate-500">ID Telegram</div>
              <div className="font-semibold">{user.telegram_id}</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-xs text-slate-500">Баланс</div>
              <div className="font-semibold">{formatCredits(user.balance)}</div>
            </div>
          </div>
        </header>

        <nav className="mt-8 flex flex-wrap gap-3">
          <button className={clsx("chip", view === "home" && "chip-active")} onClick={() => setView("home")}>
            Главная
          </button>
          <button
            className={clsx("chip", view === "generate" && "chip-active")}
            onClick={() => setView("generate")}
          >
            Новая генерация
          </button>
          <button className={clsx("chip", view === "history" && "chip-active")} onClick={() => setView("history")}>
            История
          </button>
        </nav>

        <main className="mt-6">
          {view === "home" && (
            <HomeScreen
              onGenerate={() => setView("generate")}
              onHistory={() => setView("history")}
            />
          )}
          {view === "generate" && (
            <GenerateScreen
              onBack={() => setView("home")}
              onResult={(job) => {
                setActiveJob(job);
                setView("result");
              }}
              onBalanceUpdate={handleBalanceUpdate}
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
      </div>
    </div>
  );
};

const HomeScreen = ({ onGenerate, onHistory }: { onGenerate: () => void; onHistory: () => void }) => {
  return (
    <section className="grid md:grid-cols-[1.4fr_1fr] gap-6">
      <div className="glass-card p-6 space-y-4 animate-fade-up">
        <h2 className="text-2xl font-semibold">Создайте новые визуалы</h2>
        <p className="text-slate-600">
          Выберите модель, загрузите файлы и запустите генерацию через защищенный backend.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={onGenerate}>
            Начать генерацию
          </button>
          <button className="btn-outline" onClick={onHistory}>
            Посмотреть историю
          </button>
        </div>
      </div>
      <div className="glass-card p-6 animate-fade-up delay-1">
        <h3 className="text-lg font-semibold">Последние модели</h3>
        <ul className="mt-4 space-y-3 text-sm text-slate-600">
          {modelList.slice(0, 4).map((model) => (
            <li key={model.id} className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{model.name}</span>
              <span className="text-xs uppercase tracking-wide">{typeLabels[model.type] ?? model.type}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

const GenerateScreen = ({
  onBack,
  onResult,
  onBalanceUpdate
}: {
  onBack: () => void;
  onResult: (job: JobDto) => void;
  onBalanceUpdate: (balance: number) => void;
}) => {
  const [selectedId, setSelectedId] = useState(modelList[0]?.id ?? "");
  const selectedModel = useMemo(() => getModel(selectedId), [selectedId]);
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
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

  const normalizeParams = (raw: Record<string, unknown>) => {
    if (!selectedModel) {
      return raw;
    }
    const result: Record<string, unknown> = { ...raw };
    selectedModel.params.forEach((param) => {
      if (param.type === "string_list") {
        const value = raw[param.key];
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
      const limited = filtered.slice(0, maxFiles);
      setFiles(limited);
      if (acceptedFiles.length > limited.length) {
        setErrorMessage(`Некоторые файлы превышают лимит ${maxSizeMB} МБ или количество.`);
      } else {
        setErrorMessage(null);
      }
    }
  });

  const params = watch("params");
  const cost = selectedModel ? getModelCost(selectedModel.id, normalizeParams(params)) : 0;

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
          throw new Error("Загрузка не удалась");
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
      inputs
    };

    try {
      const response = await apiFetch<GenerateResponseSuccess>("/generate", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      onBalanceUpdate(response.user.balance);
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
          <h2 className="text-2xl font-semibold">Новая генерация</h2>
          <button className="btn-outline" onClick={onBack}>
            Назад
          </button>
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
                {modelList.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <span className="field-help">{selectedModel?.description}</span>
            </label>

            <label className="field">
              <span className="field-label">Промпт</span>
              <textarea className="field-input min-h-[120px]" {...register("prompt")} />
            </label>
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
              <span className="field-label">Входные файлы</span>
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
                  {files.map((file) => (
                    <li key={file.name} className="flex justify-between">
                      <span>{file.name}</span>
                      <span>{Math.round(file.size / 1024 / 1024)} МБ</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="field glass-soft p-4">
              <span className="field-label">Оценка стоимости</span>
              <div className="text-3xl font-semibold mt-2">{formatCredits(cost)}</div>
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
            <button className="btn-primary" type="submit">
              Сгенерировать
            </button>
            <button className="btn-outline" type="button" onClick={onBack}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

const HistoryScreen = ({ onSelect }: { onSelect: (job: JobDto) => void }) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiFetch<JobsResponse>("/jobs")
  });

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
      <div className="mt-6 space-y-3">
        {data?.items.length ? (
          data.items.map((job) => {
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
          <div className="text-sm text-slate-600">Пока нет задач.</div>
        )}
      </div>
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

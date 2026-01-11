export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const getBaseUrl = () => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!baseUrl) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return baseUrl;
};

export const getToken = () => localStorage.getItem("access_token");
export const setToken = (token: string | null) => {
  if (token) {
    localStorage.setItem("access_token", token);
  } else {
    localStorage.removeItem("access_token");
  }
};

export const apiFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers
  });

  let data: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  }

  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `Request failed with ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
};

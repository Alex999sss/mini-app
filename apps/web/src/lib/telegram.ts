type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  sendData?: (data: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const getWebApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

const getInitDataFromUrl = () => {
  const searchParams = new URLSearchParams(window.location.search);
  let raw = searchParams.get("tgWebAppData");
  if (!raw && window.location.hash.startsWith("#")) {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    raw = hashParams.get("tgWebAppData");
  }
  if (!raw) {
    return "";
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const setupTelegram = () => {
  const webApp = getWebApp();
  webApp?.ready?.();
  webApp?.expand?.();
};

export const getInitData = () => {
  const webApp = getWebApp();
  return (
    webApp?.initData ||
    getInitDataFromUrl() ||
    (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) ||
    ""
  );
};

export const sendDataToBot = (payload: Record<string, unknown>) => {
  const webApp = getWebApp();
  if (!webApp?.sendData) {
    throw new Error("Telegram WebApp недоступен");
  }
  webApp.sendData(JSON.stringify(payload));
};

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

export const setupTelegram = () => {
  const webApp = getWebApp();
  webApp?.ready?.();
  webApp?.expand?.();
};

export const getInitData = () => {
  const webApp = getWebApp();
  return webApp?.initData || (import.meta.env.VITE_DEV_INIT_DATA as string | undefined) || "";
};

export const sendDataToBot = (payload: Record<string, unknown>) => {
  const webApp = getWebApp();
  if (!webApp?.sendData) {
    throw new Error("Telegram WebApp недоступен");
  }
  webApp.sendData(JSON.stringify(payload));
};

import { parse, validate } from "@tma.js/init-data-node";

import { config } from "../config";

export type TelegramUser = {
  telegram_id: number;
};

export const parseTelegramInitData = (initData: string): TelegramUser => {
  validate(initData, config.TELEGRAM_BOT_TOKEN);
  const data = parse(initData);
  const userId = data.user?.id;
  if (!userId) {
    throw new Error("Missing telegram user id");
  }
  return { telegram_id: userId };
};

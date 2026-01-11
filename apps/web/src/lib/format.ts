import dayjs from "dayjs";

export const formatElapsed = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const padded = remainder.toString().padStart(2, "0");
  return `${minutes}:${padded}`;
};

export const formatTimestamp = (iso: string) => dayjs(iso).format("YYYY-MM-DD HH:mm");

export const formatCredits = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value);

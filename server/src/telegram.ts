import { config } from "./config.js";
import type { StoredSmsMessage } from "./smsStore.js";

export async function sendLoginCodeTelegram(code: string): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("Telegram login code delivery is not configured");
  }

  await sendTelegramMessage([
    "Remote SIM Gateway login code:",
    "",
    code,
    "",
    "This code expires in 5 minutes."
  ].join("\n"));
}

export async function forwardIncomingSmsTelegram(message: StoredSmsMessage): Promise<boolean> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    return false;
  }

  await sendTelegramMessage([
    `From: ${message.from || "unknown"}`,
    `Time: ${formatSmsTime(message.receivedAt || message.timestamp)}`,
    "",
    message.body || ""
  ].join("\n"));

  return true;
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("Telegram Bot is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }

  const body = await response.json() as { ok?: boolean; description?: string };
  if (!body.ok) {
    throw new Error(body.description || "Telegram sendMessage failed");
  }
}

function formatSmsTime(value: string | number | null): string {
  const date = value ? new Date(value) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;

  const year = validDate.getFullYear();
  const month = pad(validDate.getMonth() + 1);
  const day = pad(validDate.getDate());
  const hour = pad(validDate.getHours());
  const minute = pad(validDate.getMinutes());
  const second = pad(validDate.getSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

import { config } from "./config.js";

export async function sendLoginCodeTelegram(code: string): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("Telegram login code delivery is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text: [
        "Remote SIM Gateway login code:",
        "",
        code,
        "",
        "This code expires in 5 minutes."
      ].join("\n"),
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

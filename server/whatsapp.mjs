import crypto from "crypto";

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

export function getWhatsAppConfig() {
  return {
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    webhookVerifyToken: String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "flymasters_whatsapp").trim(),
    otpTemplateName: String(process.env.WHATSAPP_OTP_TEMPLATE || "flymasters_otp").trim(),
    apiVersion: String(process.env.WHATSAPP_API_VERSION || "v21.0").trim(),
  };
}

export function isWhatsAppConfigured() {
  const cfg = getWhatsAppConfig();
  return Boolean(cfg.accessToken && cfg.phoneNumberId);
}

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function phoneDigits(value) {
  const normalized = normalizePhone(value);
  if (normalized.startsWith("91") && normalized.length === 12) return normalized.slice(2);
  return normalized;
}

export function phoneMessage(value) {
  const digits = phoneDigits(value);
  if (!digits) return "Enter your phone number";
  if (digits.length !== 10) return "Enter a 10-digit phone number";
  return "";
}

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

export function verifyOtpHash(code, storedHash) {
  if (!code || !storedHash) return false;
  const next = hashOtp(code);
  try {
    return crypto.timingSafeEqual(Buffer.from(next), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

export function otpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

export { OTP_EXPIRY_MINUTES, OTP_RESEND_SECONDS, OTP_MAX_ATTEMPTS };

export function validateWhatsAppSendPhone(value) {
  const to = normalizePhone(value);
  if (!to) return { ok: false, error: "No recipient phone number on this conversation." };
  if (to.length === 12 && to.startsWith("91")) return { ok: true, to };
  if (to.length >= 10 && to.length <= 15) return { ok: true, to };
  return { ok: false, error: `Invalid WhatsApp phone number: ${value}` };
}

async function graphRequest(path, body, phoneNumberId) {
  const cfg = getWhatsAppConfig();
  const senderPhoneId = String(phoneNumberId || cfg.phoneNumberId || "").trim();
  if (!cfg.accessToken || !senderPhoneId) {
    return { ok: false, dev: true, error: "WhatsApp API is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Railway." };
  }
  let res;
  try {
    res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${senderPhoneId}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[whatsapp] network error:", error.message || error);
    return { ok: false, error: "Could not reach WhatsApp API. Try again in a moment." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code;
    const message = data?.error?.message || `WhatsApp API error (${res.status})`;
    console.error("[whatsapp] send failed:", { code, message, to: body?.to, phoneNumberId: senderPhoneId });
    return { ok: false, error: message, code, data };
  }
  return { ok: true, data };
}

export async function verifyWhatsAppCredentials() {
  const cfg = getWhatsAppConfig();
  if (!cfg.accessToken || !cfg.phoneNumberId) {
    return { ok: false, configured: false, error: "WhatsApp credentials are missing." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: data?.error?.message || `WhatsApp credential check failed (${res.status})`,
      };
    }
    return {
      ok: true,
      configured: true,
      displayPhone: data?.display_phone_number || null,
      verifiedName: data?.verified_name || null,
    };
  } catch (error) {
    return { ok: false, configured: true, error: error.message || "Could not verify WhatsApp credentials." };
  }
}

export async function sendWhatsAppOtp(phone, code) {
  const cfg = getWhatsAppConfig();
  const to = normalizePhone(phone);
  if (!isWhatsAppConfigured()) {
    console.log(`[whatsapp:dev] OTP for +${to}: ${code}`);
    return { ok: true, dev: true, message: "OTP logged on server (WhatsApp not configured)." };
  }
  const result = await graphRequest("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.otpTemplateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  });
  if (!result.ok && /template/i.test(result.error || "")) {
    const fallback = await sendWhatsAppText(phone, `Your Fly Masters verification code is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`);
    return fallback.ok ? fallback : result;
  }
  return result;
}

export async function sendWhatsAppText(phone, message, phoneNumberId) {
  const validated = validateWhatsAppSendPhone(phone);
  if (!validated.ok) return validated;
  const to = validated.to;
  if (!isWhatsAppConfigured()) {
    console.log(`[whatsapp:dev] Message to +${to}: ${message}`);
    return { ok: true, dev: true, waMessageId: `dev-${Date.now()}` };
  }
  const result = await graphRequest(
    "/messages",
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: message },
    },
    phoneNumberId,
  );
  return result.ok
    ? { ok: true, waMessageId: result.data?.messages?.[0]?.id || null }
    : result;
}

export function parseIncomingWebhook(body) {
  const entries = body?.entry || [];
  const messages = [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      const businessPhoneId = String(value?.metadata?.phone_number_id || "").trim() || null;
      for (const item of value?.messages || []) {
        if (item.type === "text" && item.text?.body) {
          messages.push({
            kind: "message",
            waMessageId: item.id,
            from: normalizePhone(item.from),
            body: item.text.body,
            timestamp: item.timestamp,
            businessPhoneId,
          });
        }
      }
      for (const status of value?.statuses || []) {
        messages.push({
          kind: "status",
          waMessageId: status.id,
          status: status.status,
          recipient: normalizePhone(status.recipient_id),
          timestamp: status.timestamp,
          businessPhoneId,
        });
      }
    }
  }
  return messages;
}

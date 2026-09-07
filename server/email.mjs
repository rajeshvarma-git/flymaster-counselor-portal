import nodemailer from "nodemailer";

const GMAIL_USER = String(process.env.GMAIL_USER || "").trim();
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || "").trim();
const IS_DEV = process.env.NODE_ENV !== "production";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

export function isEmailConfigured() {
  return Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
}

export async function sendVerificationEmail(to, code) {
  const subject = "Your Fly Masters verification code";
  const text = [
    "Hello,",
    "",
    `Your verification code for Fly Masters counselor signup is: ${code}`,
    "",
    "This code expires in 10 minutes. If you did not request this, you can ignore this email.",
    "",
    "— Fly Masters",
  ].join("\n");

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a;margin:0 0 16px">Fly Masters</h2>
      <p style="color:#334155;line-height:1.5">Use this code to verify your email and finish creating your counselor account:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0284c7;margin:24px 0">${code}</p>
      <p style="color:#64748b;font-size:14px">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;

  const transport = getTransporter();
  if (!transport) {
    if (IS_DEV) {
      console.log(`[email-dev] Verification code for ${to}: ${code}`);
      return { dev: true };
    }
    throw new Error(
      "Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in your .env file.",
    );
  }

  await transport.sendMail({
    from: `"Fly Masters" <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
  return { dev: false };
}

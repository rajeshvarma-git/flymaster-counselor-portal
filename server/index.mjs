import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import pg from "pg";
import { sendVerificationEmail } from "./email.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT);
const IS_PRODUCTION = process.env.NODE_ENV === "production" || IS_RAILWAY;

function resolveDatabaseUrl() {
  const configured = String(process.env.DATABASE_URL || "").trim();
  if (configured) return configured;
  if (IS_PRODUCTION) return "";
  return "postgresql://flymasters:flymasters@127.0.0.1:5433/flymasters";
}

const DATABASE_URL = resolveDatabaseUrl();

if (IS_PRODUCTION) {
  if (!DATABASE_URL) {
    console.error(
      "Refusing to start: DATABASE_URL must be set in production.\n" +
        "Railway: add a Postgres plugin, then reference ${{Postgres.DATABASE_URL}} on this service.",
    );
    process.exit(1);
  }
  if (/127\.0\.0\.1|localhost/i.test(DATABASE_URL)) {
    console.error(
      "Refusing to start: DATABASE_URL points to localhost and cannot work on Railway.\n" +
        "Use your Railway Postgres reference or a cloud database URL.",
    );
    process.exit(1);
  }
  console.log("Production boot: DATABASE_URL is set, connecting to PostgreSQL…");
}

const JWT_SECRET = process.env.JWT_SECRET || "flymasters-counselor-dev-secret";
const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
const EMAIL_VERIFICATION_EXPIRY_MINUTES = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES || 10);

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl:
    IS_PRODUCTION && !/127\.0\.0\.1|localhost/.test(DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
});

async function ensureDatabase() {
  const parsed = new URL(DATABASE_URL.replace(/^postgresql:/, "http:"));
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("?")[0] || "flymasters";
  const adminUrl = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const admin = new pg.Client({
    connectionString: adminUrl,
    ssl:
    IS_PRODUCTION && !/127\.0\.0\.1|localhost/.test(DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await admin.connect();
  const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!found.rows.length) {
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, "\"\"")}"`);
  }
  await admin.end();
}

async function applySchema() {
  // Railway/managed Postgres already provides the database — skip local CREATE DATABASE.
  if (!IS_PRODUCTION) {
    await ensureDatabase();
  }
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = sql
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (const statement of statements) {
    await pool.query(statement);
  }
  try {
    await pool.query(`
      DELETE FROM counselor_attendance a
      WHERE a.ctid NOT IN (
        SELECT min(ctid) FROM counselor_attendance GROUP BY counselor_id, date
      )
    `);
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS counselor_attendance_one_per_day ON counselor_attendance (counselor_id, date)");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS counselor_salary_one_per_month ON counselor_salary_records (counselor_id, month, year)");
  } catch (error) {
    console.warn("Optional attendance/salary cleanup skipped:", error.message || error);
  }
}

function signUser(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Sign in again." });
  }
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
  };
}

const SHARED_STUDENT_COUNSELOR_ID = "local-counselor-1";

function mergeById(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (row?.id == null) continue;
      const key = String(row.id);
      const current = map.get(key);
      if (!current) {
        map.set(key, row);
        continue;
      }
      const currentUpdated = Date.parse(String(current.updated_at || current.created_at || "")) || 0;
      const nextUpdated = Date.parse(String(row.updated_at || row.created_at || "")) || 0;
      map.set(key, nextUpdated >= currentUpdated ? row : current);
    }
  }
  return [...map.values()];
}

function emailLocalKey(value) {
  return String(value || "").trim().toLowerCase().split("@")[0].replace(/[^a-z0-9]/g, "");
}

function isLeadConverted(row) {
  if (!row) return false;
  return row.lead_status === "converted" || row.lead_stage === "converted";
}

function pickPortalUserId(current, row) {
  if (isPortalStudent(row) && row.user_id) return String(row.user_id);
  if (isPortalStudent(current) && current.user_id) return String(current.user_id);
  if (row.entity_type === "student" && row.user_id) return String(row.user_id);
  if (current.entity_type === "student" && current.user_id) return String(current.user_id);
  return current.user_id || row.user_id;
}

function mergeStudents(...lists) {
  const byUser = new Map();
  const byEmail = new Map();
  const byEmailKey = new Map();

  const attach = (row) => {
    const uid = row.user_id ? String(row.user_id) : "";
    const email = String(row.email || "").trim().toLowerCase();
    const key = emailLocalKey(email);
    const current = (uid && byUser.get(uid))
      || (email && byEmail.get(email))
      || (key.length >= 4 && byEmailKey.get(key))
      || null;
    const converted = isLeadConverted(row) || isLeadConverted(current);
    const convertedRow = isLeadConverted(current) ? current : isLeadConverted(row) ? row : null;
    const merged = current
      ? {
          ...row,
          ...current,
          id: current.id || row.id,
          user_id: pickPortalUserId(current, row),
          first_name: current.first_name || row.first_name,
          last_name: current.last_name || row.last_name,
          email: current.email || row.email,
          phone: current.phone || row.phone,
          preferred_countries: (Array.isArray(current.preferred_countries) && current.preferred_countries.length)
            ? current.preferred_countries
            : (Array.isArray(row.preferred_countries) && row.preferred_countries.length ? row.preferred_countries : []),
          assigned_counselor_id: current.assigned_counselor_id || row.assigned_counselor_id,
          entity_type: converted || current.entity_type === "student" || row.entity_type === "student" ? "student" : "lead",
          lead_status: converted ? "converted" : (current.lead_status || row.lead_status),
          lead_stage: converted ? "converted" : (current.lead_stage || row.lead_stage),
          conversion_date: convertedRow?.conversion_date || current.conversion_date || row.conversion_date,
          lead_source: current.lead_source === "student_site" || row.lead_source === "student_site"
            ? "student_site"
            : (current.lead_source || row.lead_source),
          created_at: current.created_at || row.created_at,
        }
      : row;
    if (merged.user_id) byUser.set(String(merged.user_id), merged);
    const nextEmail = String(merged.email || "").trim().toLowerCase();
    if (nextEmail) byEmail.set(nextEmail, merged);
    const nextKey = emailLocalKey(nextEmail);
    if (nextKey.length >= 4) byEmailKey.set(nextKey, merged);
  };

  for (const list of lists) {
    for (const row of list || []) attach(row);
  }

  const seen = new Set();
  const out = [];
  for (const row of [...byUser.values(), ...byEmail.values()]) {
    const key = row.user_id ? `u:${row.user_id}` : `e:${String(row.email || "").trim().toLowerCase()}`;
    if (!key.endsWith(":") && seen.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sortByCreated(rows) {
  return [...(rows || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function sortNotifications(rows) {
  return [...(rows || [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function asNotification(row, fallbackUserId = "") {
  const type = row.type || row.notification_type || "info";
  const title = String(row.title || "Notification");
  let actionUrl = row.action_url || "";
  if (!actionUrl) {
    const lower = title.toLowerCase();
    if (type === "chat" || lower.includes("message")) actionUrl = "/counselor/chat";
    else if (lower.includes("document")) actionUrl = "/counselor/documents";
    else if (lower.includes("lead")) actionUrl = "/counselor/leads";
    else if (lower.includes("student")) actionUrl = "/counselor/students";
  }
  return {
    id: String(row.id),
    user_id: String(row.user_id || fallbackUserId),
    title,
    message: row.message || row.body || "",
    is_read: Boolean(row.is_read),
    created_at: row.created_at || new Date().toISOString(),
    type,
    category: row.category || (type === "chat" ? "chat" : row.notification_type ? "document" : "general"),
    action_url: actionUrl,
  };
}

async function notifyCounselor(userId, title, message, type = "info", actionUrl = "", category = "general") {
  if (!userId) return;
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    user_id: String(userId),
    title,
    message,
    type,
    category,
    action_url: actionUrl,
    created_at: now,
    is_read: false,
  };
  await jsonUpsert("notifications", row);
  if (isUuid(userId)) {
    await pool.query(
      "INSERT INTO notifications (id, user_id, title, message, is_read, created_at) VALUES ($1,$2,$3,$4,false,$5) ON CONFLICT (id) DO NOTHING",
      [row.id, userId, title, message, now],
    ).catch(() => {});
  }
}

async function syncChatNotifications(counselorId, conversations, messages, leads) {
  const existing = await jsonTable("notifications").catch(() => []);
  const seenMessageIds = new Set(
    existing
      .filter((row) => String(row.user_id) === String(counselorId) && row.source_message_id)
      .map((row) => String(row.source_message_id)),
  );

  for (const msg of messages || []) {
    if (String(msg.receiver_id) !== String(counselorId)) continue;
    if (msg.is_read) continue;
    if (seenMessageIds.has(String(msg.id))) continue;

    const conv = (conversations || []).find((row) => String(row.id) === String(msg.conversation_id));
    const studentId = conv?.student_id ? String(conv.student_id) : "";
    const lead = (leads || []).find((row) => String(row.user_id) === studentId);
    const studentName = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() || lead?.email || "A student";
    const preview = String(msg.message || "").trim();
    const shortPreview = preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
    const now = msg.created_at || new Date().toISOString();
    const notifId = `chat_${msg.id}`;

    await jsonUpsert("notifications", {
      id: notifId,
      user_id: String(counselorId),
      title: `New message from ${studentName}`,
      message: shortPreview || "Open Student Chat to read the message.",
      type: "chat",
      category: "chat",
      source_message_id: String(msg.id),
      action_url: studentId ? `/counselor/chat?student=${studentId}` : "/counselor/chat",
      created_at: now,
      is_read: false,
    });
    if (isUuid(counselorId)) {
      await pool.query(
        "INSERT INTO notifications (id, user_id, title, message, is_read, created_at) VALUES ($1,$2,$3,$4,false,$5) ON CONFLICT (id) DO NOTHING",
        [notifId, counselorId, `New message from ${studentName}`, shortPreview || "Open Student Chat to read the message.", now],
      ).catch(() => {});
    }
    seenMessageIds.add(String(msg.id));
  }
}

async function markNotificationReadForUser(userId, notificationId) {
  await pool.query("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2", [notificationId, userId]).catch(() => {});
  const notes = await jsonTable("notifications").catch(() => []);
  const found = notes.find((row) => String(row.id) === String(notificationId));
  if (found) await jsonUpsert("notifications", { ...found, is_read: true });
  const docNotes = await jsonTable("document_notifications").catch(() => []);
  const docFound = docNotes.find((row) => String(row.id) === String(notificationId));
  if (docFound) await jsonUpsert("document_notifications", { ...docFound, is_read: true });
}

function remapSharedCounselorId(value, counselorId) {
  if (value == null || value === "") return value;
  return String(value) === SHARED_STUDENT_COUNSELOR_ID ? counselorId : value;
}

const SELF_SERVE_SOURCES = ["student_site", "student_chat"];

function isPortalStudent(row) {
  const source = String(row.lead_source || "");
  return SELF_SERVE_SOURCES.includes(source);
}

async function resolveCounselorAliases(portalCounselorId) {
  const aliases = new Set([String(portalCounselorId)]);
  const found = await pool.query("SELECT id, email FROM counselor_users WHERE id = $1", [portalCounselorId]).catch(() => ({ rows: [] }));
  const email = String(found.rows[0]?.email || "").trim().toLowerCase();
  if (email) {
    const auth = await pool.query("SELECT id FROM auth_users WHERE lower(email) = $1", [email]).catch(() => ({ rows: [] }));
    if (auth.rows[0]?.id) aliases.add(String(auth.rows[0].id));
    const roles = await jsonTable("user_roles").catch(() => []);
    for (const role of roles.filter((row) => row.role === "counselor")) {
      const authRow = auth.rows.find((item) => String(item.id) === String(role.user_id));
      if (authRow && String(authRow.email || "").trim().toLowerCase() === email) {
        aliases.add(String(role.user_id));
      }
    }
    const counselors = await jsonTable("counselors").catch(() => []);
    for (const row of counselors) {
      const authMatch = auth.rows.some((item) => String(item.id) === String(row.user_id));
      if (authMatch) aliases.add(String(row.user_id));
    }
  }
  return aliases;
}

function normalizeAssignedCounselorId(assignedId, portalCounselorId, aliases) {
  const mapped = remapSharedCounselorId(assignedId, portalCounselorId);
  if (!mapped || !portalCounselorId) return mapped;
  return aliases.has(String(mapped)) ? String(portalCounselorId) : mapped;
}

function asLead(row, counselorId, counselorAliases = null) {
  const selfServe = isPortalStudent(row);
  const converted = isLeadConverted(row);
  const openStatus = selfServe ? "hot" : "warm";
  const aliases = counselorAliases || new Set([String(counselorId || "")]);
  return {
    ...row,
    id: String(row.id),
    user_id: row.user_id == null ? row.user_id : String(row.user_id),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    email: row.email || "",
    phone: row.phone || "",
    field_of_interest: row.field_of_interest || "",
    academic_score: row.academic_score || "",
    preferred_countries: Array.isArray(row.preferred_countries) ? row.preferred_countries : [],
    assigned_counselor_id: normalizeAssignedCounselorId(row.assigned_counselor_id, counselorId, aliases),
    entity_type: converted || row.entity_type === "student" ? "student" : "lead",
    lead_status: row.lead_status || (converted ? "converted" : openStatus),
    lead_stage: row.lead_stage || row.lead_status || (converted ? "converted" : openStatus),
  };
}

function asDocument(row) {
  const status = row.status === "pending" ? "uploaded" : (row.status || "uploaded");
  return {
    ...row,
    id: String(row.id),
    user_id: row.user_id == null ? row.user_id : String(row.user_id),
    document_type: row.document_type || "",
    file_name: row.file_name || "",
    file_path: row.file_path || "",
    file_size: Number(row.file_size || 0),
    mime_type: row.mime_type || "",
    status,
    archived: Boolean(row.archived),
    admin_comments: row.admin_comments || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
  };
}

function asApplication(row) {
  let status = row.status || "draft";
  if (status === "submitted") status = "pending_counselor";
  return {
    ...row,
    id: String(row.id),
    user_id: row.user_id == null ? row.user_id : String(row.user_id),
    university_name: row.university_name || "",
    course_name: row.course_name || "",
    country: row.country || "",
    city: row.city || "",
    intake_term: row.intake_term || "",
    priority_level: row.priority_level || "medium",
    status,
    notes: row.notes || "",
    counselor_comments: row.counselor_comments || "",
    created_at: row.created_at || null,
  };
}

function asShortlist(row, counselorId) {
  return {
    ...row,
    id: String(row.id),
    student_id: row.student_id == null ? row.student_id : String(row.student_id),
    student_email: row.student_email || row.email || "",
    counselor_id: remapSharedCounselorId(row.counselor_id, counselorId),
    university_name: row.university_name || "",
    course_name: row.course_name || "",
    location: row.location || "",
    counselor_notes: row.counselor_notes || "",
  };
}

function asConversation(row, counselorId) {
  return {
    ...row,
    id: String(row.id),
    student_id: String(row.student_id),
    counselor_id: remapSharedCounselorId(row.counselor_id, counselorId),
  };
}

function asMessage(row, counselorId) {
  return {
    ...row,
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_id: remapSharedCounselorId(row.sender_id, counselorId),
    receiver_id: remapSharedCounselorId(row.receiver_id, counselorId),
    is_read: Boolean(row.is_read),
  };
}

async function ensureAppRecords() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_records (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_app_records_table ON app_records(table_name)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_storage (
      path TEXT PRIMARY KEY,
      data_url TEXT NOT NULL
    )
  `);
}

async function jsonTable(tableName) {
  await ensureAppRecords();
  const result = await pool.query("SELECT id, data FROM app_records WHERE table_name = $1", [tableName]);
  return result.rows.map((row) => {
    const data = row.data && typeof row.data === "object" ? row.data : {};
    return { ...data, id: data.id || row.id };
  });
}

async function jsonUpsert(tableName, data) {
  const id = String(data.id || crypto.randomUUID());
  const payload = { ...data, id };
  await ensureAppRecords();
  await pool.query(
    `INSERT INTO app_records (id, table_name, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, table_name = EXCLUDED.table_name, updated_at = now()`,
    [id, tableName, JSON.stringify(payload)],
  );
  return payload;
}

function hashAuthPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyAuthPassword(password, stored) {
  if (!password || !stored) return false;
  if (String(stored).startsWith("scrypt:")) {
    const parts = String(stored).split(":");
    const salt = parts[1];
    const hash = parts[2];
    if (!salt || !hash) return false;
    const next = scryptSync(password, salt, 64);
    const prev = Buffer.from(hash, "hex");
    return next.length === prev.length && timingSafeEqual(next, prev);
  }
  return stored === password;
}

async function verifyPasswordHash(password, stored) {
  if (!password || !stored) return false;
  const value = String(stored);
  try {
    if (value.startsWith("$2")) return bcrypt.compare(password, value);
  } catch {
    /* fall through */
  }
  return verifyAuthPassword(password, value);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function hashVerificationCode(code) {
  return bcrypt.hash(code, 10);
}

async function consumeEmailVerificationCode(email, code) {
  const normalized = String(email || "").trim().toLowerCase();
  const input = String(code || "").trim();
  if (!normalized || !/^\d{6}$/.test(input)) {
    return { ok: false, error: "Enter the 6-digit verification code sent to your email." };
  }

  const found = await pool.query(
    `SELECT id, code_hash, expires_at, used_at
     FROM email_verifications
     WHERE lower(email) = $1 AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [normalized],
  );

  const now = Date.now();
  for (const row of found.rows) {
    if (row.used_at) continue;
    if (new Date(row.expires_at).getTime() < now) continue;
    const match = await bcrypt.compare(input, row.code_hash);
    if (!match) continue;
    await pool.query("UPDATE email_verifications SET used_at = now() WHERE id = $1", [row.id]);
    return { ok: true };
  }

  return { ok: false, error: "Invalid or expired verification code. Request a new code and try again." };
}

async function roleForAuthUser(userId) {
  if (!userId) return null;
  const roles = await jsonTable("user_roles");
  return roles.find((row) => String(row.user_id) === String(userId))?.role || null;
}

async function ensurePortalUserFromAuth(authRow, passwordPlain) {
  const email = String(authRow.email || "").trim().toLowerCase();
  const profiles = await jsonTable("profiles");
  const profile = profiles.find((item) => String(item.user_id) === String(authRow.id));
  const meta = authRow.user_metadata || {};
  const firstName = profile?.first_name || meta.first_name || "";
  const lastName = profile?.last_name || meta.last_name || "";
  const phone = profile?.phone || "";
  const hash = passwordPlain ? await bcrypt.hash(passwordPlain, 10) : (authRow.password || await bcrypt.hash(crypto.randomUUID(), 10));
  const id = isUuid(authRow.id) ? authRow.id : crypto.randomUUID();
  const created = await pool.query(
    `INSERT INTO counselor_users (id, email, password_hash, first_name, last_name, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = CASE WHEN $7 THEN EXCLUDED.password_hash ELSE counselor_users.password_hash END,
       first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), counselor_users.first_name),
       last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), counselor_users.last_name),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), counselor_users.phone)
     RETURNING *`,
    [id, email, hash, firstName, lastName, phone, Boolean(passwordPlain)],
  );
  return created.rows[0];
}

async function publishCounselorAccount(row, passwordPlain) {
  const email = String(row.email || "").trim().toLowerCase();
  if (!email) return;
  const now = new Date().toISOString();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      user_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  const existing = await pool.query("SELECT id FROM auth_users WHERE lower(email) = $1", [email]).catch(() => ({ rows: [] }));
  let authId = existing.rows[0]?.id ? String(existing.rows[0].id) : "";
  const meta = JSON.stringify({
    first_name: row.first_name || "",
    last_name: row.last_name || "",
  });
  if (!authId) {
    authId = String(row.id);
    await pool.query(
      `INSERT INTO auth_users (id, email, password, user_metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (email) DO UPDATE SET user_metadata = EXCLUDED.user_metadata`,
      [authId, email, hashAuthPassword(passwordPlain || crypto.randomUUID()), meta],
    );
  } else {
    await pool.query("UPDATE auth_users SET user_metadata = $2::jsonb WHERE id = $1", [authId, meta]);
  }
  const confirmed = await pool.query("SELECT id FROM auth_users WHERE lower(email) = $1", [email]);
  if (confirmed.rows[0]?.id) authId = String(confirmed.rows[0].id);

  const roles = await jsonTable("user_roles");
  const current = roles.find((item) => String(item.user_id) === authId);
  if (current?.role !== "admin" && current?.role !== "super_admin") {
    await jsonUpsert("user_roles", { id: current?.id || `role-${authId}`, user_id: authId, role: "counselor" });
  }

  const profiles = await jsonTable("profiles");
  const profile = profiles.find((item) => String(item.user_id) === authId) || { id: `profile-${authId}`, user_id: authId };
  await jsonUpsert("profiles", {
    ...profile,
    user_id: authId,
    first_name: row.first_name || profile.first_name || "",
    last_name: row.last_name || profile.last_name || "",
    phone: row.phone || profile.phone || "",
    country: profile.country || "India",
    created_at: profile.created_at || now,
    updated_at: now,
  });

  const counselors = await jsonTable("counselors");
  const counselor = counselors.find((item) => String(item.user_id) === authId || String(item.user_id) === String(row.id))
    || { id: `counselor-${authId}`, user_id: authId };
  await jsonUpsert("counselors", {
    ...counselor,
    user_id: authId,
    is_active: true,
    specializations: row.specializations?.length ? row.specializations : (counselor.specializations || []),
    created_at: counselor.created_at || now,
    updated_at: now,
  });
}

function emailsMatch(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const key = (value) => String(value || "").split("@")[0].replace(/[^a-z0-9]/g, "");
  const leftKey = key(a);
  const rightKey = key(b);
  return Boolean(leftKey && leftKey === rightKey && leftKey.length >= 4);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function resolveStudentUserId(studentId, emailHint = "") {
  const id = String(studentId || "");
  const hint = String(emailHint || "").trim();
  const directory = await studentDirectory();
  const byEmail = directory.find((person) => emailsMatch(person.email, hint));
  if (byEmail) return byEmail.user_id;
  const direct = directory.find((person) => person.user_id === id);
  if (direct) return direct.user_id;

  const jsonLeads = await jsonTable("student_leads");
  let sqlLeads = [];
  try {
    const found = await pool.query(
      "SELECT * FROM student_leads WHERE id::text = $1 OR user_id::text = $1 OR ($2 <> '' AND lower(email) = lower($2))",
      [id || "00000000-0000-0000-0000-000000000000", hint],
    );
    sqlLeads = found.rows;
  } catch {
    sqlLeads = [];
  }
  const lead = jsonLeads.find((row) => String(row.id) === id || String(row.user_id) === id || emailsMatch(row.email, hint))
    || sqlLeads.find((row) => emailsMatch(row.email, hint))
    || sqlLeads[0];
  const email = hint || lead?.email || (id.includes("@") ? id : "");
  const matched = directory.find((person) => emailsMatch(person.email, email) || emailsMatch(person.email, lead?.email));
  if (matched) return matched.user_id;
  return lead?.user_id || id;
}

function studentShortlistRecord(row, studentId, studentEmail = "") {
  const created = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || new Date().toISOString());
  return {
    id: String(row.id || crypto.randomUUID()),
    student_id: studentId,
    student_email: studentEmail || row.student_email || "",
    counselor_id: SHARED_STUDENT_COUNSELOR_ID,
    source_counselor_id: row.counselor_id || row.source_counselor_id || null,
    university_id: row.university_id || `uni-${row.id}`,
    university_name: row.university_name || "",
    course_name: row.course_name || "",
    location: row.location || "",
    counselor_notes: row.counselor_notes || "",
    status: !row.status || row.status === "draft" ? "recommended" : row.status,
    priority_level: row.priority_level || "medium",
    student_consent: Boolean(row.student_consent),
    student_consent_date: row.student_consent_date || null,
    shortlisted_at: row.shortlisted_at || created,
    created_at: created,
    updated_at: new Date().toISOString(),
  };
}

async function publishShortlist(row, options = {}) {
  const studentId = await resolveStudentUserId(row.student_id, row.student_email || row.email || "");
  const directory = await studentDirectory();
  const student = directory.find((person) => person.user_id === studentId)
    || directory.find((person) => emailsMatch(person.email, row.student_email || row.email));
  const payload = studentShortlistRecord(row, student?.user_id || studentId, student?.email || row.student_email || row.email || "");
  await jsonUpsert("university_shortlists", payload);
  if (row.id && payload.student_id && isUuid(payload.student_id) && String(payload.student_id) !== String(row.student_id)) {
    await pool.query("UPDATE university_shortlists SET student_id = $1 WHERE id = $2", [payload.student_id, row.id]).catch(() => null);
  }
  if (options.notify && studentId) {
    const now = new Date().toISOString();
    const title = "New university shortlist";
    const message = `Your counselor added ${payload.university_name}${payload.course_name ? ` — ${payload.course_name}` : ""} to your shortlist.`;
    await jsonUpsert("notifications", {
      id: crypto.randomUUID(),
      user_id: studentId,
      title,
      message,
      type: "info",
      action_url: "/student/shortlists",
      created_at: now,
      is_read: false,
    });
    await jsonUpsert("document_notifications", {
      id: crypto.randomUUID(),
      user_id: studentId,
      title,
      message,
      notification_type: "info",
      action_url: "/student/shortlists",
      created_at: now,
      is_read: false,
    });
  }
  return payload;
}

async function studentDirectory() {
  const profiles = await jsonTable("profiles");
  let users = [];
  try {
    const result = await pool.query("SELECT id, email, user_metadata FROM auth_users");
    users = result.rows;
  } catch {
    users = [];
  }
  return users.map((user) => {
    const profile = profiles.find((row) => String(row.user_id) === String(user.id));
    const meta = user.user_metadata || {};
    return {
      id: String(user.id),
      user_id: String(user.id),
      email: user.email || "",
      first_name: profile?.first_name || meta.first_name || "",
      last_name: profile?.last_name || meta.last_name || "",
      phone: profile?.phone || "",
      country: profile?.country || "",
    };
  });
}

async function syncCounselorNameToStudentChat(counselorId) {
  const found = await pool.query("SELECT first_name, last_name, phone FROM counselor_users WHERE id = $1", [counselorId]);
  const row = found.rows[0];
  if (!row) return;
  const profiles = await jsonTable("profiles");
  const existing = profiles.find((item) => String(item.user_id) === SHARED_STUDENT_COUNSELOR_ID)
    || profiles.find((item) => String(item.user_id) === String(counselorId));
  await jsonUpsert("profiles", {
    id: existing?.id || crypto.randomUUID(),
    user_id: SHARED_STUDENT_COUNSELOR_ID,
    first_name: row.first_name || existing?.first_name || "Counselor",
    last_name: row.last_name || existing?.last_name || "",
    phone: row.phone || existing?.phone || "",
    country: existing?.country || "India",
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function loadSharedChat(counselorId) {
  const [jsonLeads, jsonConversations, jsonMessages, jsonDocuments, jsonShortlists, jsonRoles, jsonDocNotes, jsonApplications, directory] = await Promise.all([
    jsonTable("student_leads"),
    jsonTable("private_conversations"),
    jsonTable("private_messages"),
    jsonTable("documents"),
    jsonTable("university_shortlists"),
    jsonTable("user_roles"),
    jsonTable("document_notifications"),
    jsonTable("applications"),
    studentDirectory(),
  ]);

  const studentIds = new Set(
    jsonRoles.filter((row) => row.role === "student").map((row) => String(row.user_id)),
  );

  const leads = jsonLeads.map((row) => {
    const person = directory.find((item) => item.user_id === String(row.user_id));
    return asLead({
      ...row,
      first_name: row.first_name || person?.first_name || "",
      last_name: row.last_name || person?.last_name || "",
      email: row.email || person?.email || "",
      phone: row.phone || person?.phone || "",
    }, counselorId);
  });
  const conversations = jsonConversations.map((row) => asConversation(row, counselorId));
  const messages = jsonMessages.map((row) => asMessage(row, counselorId));

  const addStudent = (person, source, createdAt) => {
    if (!person?.user_id) return;
    if (leads.some((lead) => String(lead.user_id) === person.user_id)) return;
    if (leads.some((lead) => emailsMatch(lead.email, person.email))) return;
    leads.push(asLead({
      id: person.id || person.user_id,
      user_id: person.user_id,
      email: person.email || "",
      first_name: person.first_name || "",
      last_name: person.last_name || "",
      phone: person.phone || "",
      assigned_counselor_id: SHARED_STUDENT_COUNSELOR_ID,
      lead_source: source,
      status: "assigned",
      entity_type: "lead",
      created_at: createdAt || new Date().toISOString(),
    }, counselorId));
  };

  for (const conversation of jsonConversations) {
    const studentId = String(conversation.student_id);
    const person = directory.find((item) => item.user_id === studentId) || { id: studentId, user_id: studentId };
    addStudent(person, "student_chat", conversation.created_at);
  }

  for (const person of directory) {
    if (!studentIds.has(person.user_id)) continue;
    addStudent(person, "student_site");
  }

  return {
    leads: mergeStudents(leads),
    conversations,
    messages,
    documents: jsonDocuments.map(asDocument),
    shortlists: jsonShortlists.map((row) => asShortlist(row, counselorId)),
    applications: jsonApplications.map(asApplication),
    notifications: jsonDocNotes
      .filter((row) => remapSharedCounselorId(row.user_id, counselorId) === counselorId)
      .map((row) => asNotification({
        ...row,
        user_id: counselorId,
        type: row.notification_type || "info",
        category: row.notification_type === "chat" ? "chat" : "document",
        action_url: row.action_url || (row.notification_type === "chat" ? "/counselor/chat" : "/counselor/documents"),
      }, counselorId)),
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message || "PostgreSQL is not connected" });
  }
});

app.post("/api/auth/send-verification-code", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const authFound = await pool.query("SELECT id FROM auth_users WHERE lower(email) = $1", [email]).catch(() => ({ rows: [] }));
    const authRow = authFound.rows[0];
    const role = await roleForAuthUser(authRow?.id);
    if (role === "admin" || role === "super_admin") {
      return res.status(403).json({ error: "This email is an admin account. Use the admin portal." });
    }

    const portalFound = await pool.query("SELECT id FROM counselor_users WHERE lower(email) = $1", [email]);
    if (portalFound.rows[0] || (authRow && role === "counselor")) {
      return res.status(400).json({ error: "This email already has a counselor account. Sign in instead." });
    }

    const recent = await pool.query(
      `SELECT created_at FROM email_verifications
       WHERE lower(email) = $1 AND created_at > now() - interval '1 minute'
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (recent.rows[0]) {
      return res.status(429).json({ error: "Please wait a minute before requesting another code." });
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [email, codeHash, expiresAt],
    );

    const sent = await sendVerificationEmail(email, code);
    res.json({
      ok: true,
      message: "Verification code sent. Check your inbox.",
      devHint: sent.dev ? "Email not configured — check the API server console for the code." : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not send verification code" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const verificationCode = String(req.body.verificationCode || "").trim();
    if (!email || password.length < 6) {
      return res.status(400).json({ error: "Email and a password of at least 6 characters are required." });
    }

    const authFound = await pool.query("SELECT * FROM auth_users WHERE lower(email) = $1", [email]).catch(() => ({ rows: [] }));
    const authRow = authFound.rows[0];
    const role = await roleForAuthUser(authRow?.id);
    if (role === "admin" || role === "super_admin") {
      return res.status(403).json({ error: "This email is an admin account. Use the admin portal." });
    }
    if (authRow && role !== "counselor") {
      return res.status(400).json({
        error: "This email is already in the admin portal. Ask an admin to set the role to Counselor, then sign in.",
      });
    }
    if (authRow && role === "counselor") {
      if (!verifyAuthPassword(password, authRow.password) && !(await verifyPasswordHash(password, authRow.password))) {
        return res.status(401).json({ error: "This counselor already exists. Sign in with the password from the admin portal." });
      }
      const row = await ensurePortalUserFromAuth(authRow, password);
      await publishCounselorAccount(row, password);
      return res.json({ token: signUser(row), user: publicUser(row) });
    }

    const verified = await consumeEmailVerificationCode(email, verificationCode);
    if (!verified.ok) {
      return res.status(400).json({ error: verified.error });
    }

    const hash = await bcrypt.hash(password, 10);
    const existing = await pool.query("SELECT * FROM counselor_users WHERE lower(email) = $1", [email]);
    let row;
    if (existing.rows[0]) {
      if (!(await verifyPasswordHash(password, existing.rows[0].password_hash))) {
        return res.status(401).json({ error: "This counselor already exists. Sign in instead." });
      }
      const updated = await pool.query(
        `UPDATE counselor_users SET first_name = $2, last_name = $3 WHERE email = $1 RETURNING *`,
        [email, firstName || existing.rows[0].first_name, lastName || existing.rows[0].last_name],
      );
      row = updated.rows[0];
    } else {
      const created = await pool.query(
        `INSERT INTO counselor_users (email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [email, hash, firstName, lastName],
      );
      row = created.rows[0];
    }
    await publishCounselorAccount(row, password);
    res.json({ token: signUser(row), user: publicUser(row) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create account" });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const portalFound = await pool.query("SELECT * FROM counselor_users WHERE lower(email) = $1", [email]);
    let row = portalFound.rows[0];
    const authFound = await pool.query("SELECT * FROM auth_users WHERE lower(email) = $1", [email]).catch(() => ({ rows: [] }));
    const authRow = authFound.rows[0];
    const role = await roleForAuthUser(authRow?.id);

    if (role === "admin" || role === "super_admin") {
      return res.status(403).json({ error: "This is an admin account. Sign in at the admin portal." });
    }

    const portalOk = row ? await verifyPasswordHash(password, row.password_hash) : false;
    const authOk = authRow ? (verifyAuthPassword(password, authRow.password) || await verifyPasswordHash(password, authRow.password)) : false;
    const isCounselor = role === "counselor" || Boolean(row);

    if (!portalOk && !(authOk && isCounselor)) {
      if (authRow && authOk && role !== "counselor") {
        return res.status(403).json({ error: "This email is not a counselor yet. Ask an admin to set the role to Counselor." });
      }
      return res.status(401).json({ error: "Wrong email or password." });
    }

    if (!row && authRow && isCounselor) {
      row = await ensurePortalUserFromAuth(authRow, password);
    }
    if (!row) return res.status(401).json({ error: "Wrong email or password." });

    if (portalOk && password && row.password_hash && !String(row.password_hash).startsWith("$2")) {
      await pool.query("UPDATE counselor_users SET password_hash = $2 WHERE id = $1", [row.id, await bcrypt.hash(password, 10)]);
    }

    await publishCounselorAccount(row, password);
    res.json({ token: signUser(row), user: publicUser(row) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not sign in" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const found = await pool.query("SELECT * FROM counselor_users WHERE id = $1", [req.user.id]);
  if (!found.rows[0]) return res.status(401).json({ error: "Account not found" });
  await publishCounselorAccount(found.rows[0]).catch((error) => console.warn("Counselor publish failed:", error.message));
  res.json({ user: publicUser(found.rows[0]) });
});

app.put("/api/profile", auth, async (req, res) => {
  try {
    const firstName = req.body.firstName == null ? null : String(req.body.firstName);
    const lastName = req.body.lastName == null ? null : String(req.body.lastName);
    let phone = req.body.phone == null ? "" : String(req.body.phone).trim();
    phone = phone.replace(/\D/g, "");
    if (phone.length === 12 && phone.startsWith("91")) phone = phone.slice(2);
    if (phone.length === 11 && phone.startsWith("0")) phone = phone.slice(1);
    if (req.body.phone !== undefined && (!phone || phone.length !== 10)) {
      return res.status(400).json({ error: "Enter a 10-digit phone number" });
    }
    const bio = req.body.bio == null ? null : String(req.body.bio);
    const specs = req.body.specializations === undefined
      ? null
      : Array.isArray(req.body.specializations)
        ? req.body.specializations
        : String(req.body.specializations).split(",").map((item) => item.trim()).filter(Boolean);
    const updated = await pool.query(
      `UPDATE counselor_users
       SET first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           phone = $4,
           bio = COALESCE($5, bio),
           specializations = COALESCE($6, specializations)
       WHERE id = $1
       RETURNING *`,
      [req.user.id, firstName, lastName, phone, bio, specs],
    );
    if (!updated.rows[0]) return res.status(404).json({ error: "Account not found" });
    await publishCounselorAccount(updated.rows[0]).catch((error) => console.warn("Counselor publish failed:", error.message));
    res.json({ user: publicUser(updated.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not save profile" });
  }
});

app.get("/api/state", auth, async (req, res) => {
  const id = req.user.id;
  const counselorAliases = await resolveCounselorAliases(id);
  await syncCounselorNameToStudentChat(id).catch(() => {});
  const shared = await loadSharedChat(id).catch(() => ({ leads: [], conversations: [], messages: [], documents: [], shortlists: [], notifications: [], applications: [] }));
  const [leads, conversations, messages, notifications, documents, shortlists, leave, attendance, salary, extras] = await Promise.all([
    pool.query("SELECT * FROM student_leads ORDER BY created_at DESC"),
    pool.query("SELECT * FROM private_conversations WHERE counselor_id = $1 ORDER BY last_message_at DESC NULLS LAST", [id]),
    pool.query(
      `SELECT m.* FROM private_messages m
       JOIN private_conversations c ON c.id = m.conversation_id
       WHERE c.counselor_id = $1
       ORDER BY m.created_at ASC`,
      [id],
    ),
    pool.query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC", [id]),
    pool.query("SELECT * FROM documents ORDER BY created_at DESC"),
    pool.query("SELECT * FROM university_shortlists WHERE counselor_id = $1 ORDER BY created_at DESC", [id]),
    pool.query("SELECT * FROM counselor_leave_requests WHERE counselor_id = $1 ORDER BY applied_on DESC", [id]),
    pool.query(
      `SELECT id, counselor_id, date::text AS date, clock_in::text AS clock_in, clock_out::text AS clock_out, total_hours, status
       FROM counselor_attendance WHERE counselor_id = $1 ORDER BY date DESC`,
      [id],
    ),
    pool.query("SELECT * FROM counselor_salary_records WHERE counselor_id = $1 ORDER BY year DESC, month DESC", [id]),
    pool.query("SELECT id, bio, specializations, phone FROM counselor_users WHERE id = $1", [id]),
  ]);

  const extra = extras.rows[0];
  const jsonLeads = shared.leads || [];
  const directory = await studentDirectory().catch(() => []);
  await Promise.all(shortlists.rows.map((row) => {
    const current = (shared.shortlists || []).find((item) => String(item.id) === String(row.id));
    const known = directory.find((person) =>
      person.user_id === String(current?.student_id || row.student_id)
      || emailsMatch(person.email, current?.student_email),
    );
    if (known && current?.student_email && emailsMatch(known.email, current.student_email)) return null;
    const lead = [...leads.rows, ...jsonLeads].find(
      (item) =>
        String(item.user_id) === String(row.student_id)
        || String(item.id) === String(row.student_id)
        || emailsMatch(item.email, current?.student_email),
    );
    return publishShortlist({
      ...row,
      student_email: (known && !emailsMatch(known.email, current?.student_email) ? known.email : null) || lead?.email || current?.student_email || "",
    }).catch(() => null);
  }));
  const mergedLeads = mergeStudents(
    leads.rows.map((row) => asLead(row, id, counselorAliases)),
    (shared.leads || []).map((row) => asLead(row, id, counselorAliases)),
  );
  const mergedConversations = sortByCreated(mergeById(
    conversations.rows.map((row) => asConversation(row, id)),
    shared.conversations,
  ));
  const mergedMessages = sortByCreated((() => {
    const sqlConversationIds = new Set(conversations.rows.map((row) => String(row.id)));
    const sqlOnly = messages.rows
      .filter((row) => sqlConversationIds.has(String(row.conversation_id)))
      .map((row) => asMessage(row, id));
    return mergeById(sqlOnly, shared.messages);
  })());

  await syncChatNotifications(id, mergedConversations, mergedMessages, mergedLeads).catch(() => {});

  const [jsonNotifications, jsonDocNotifications] = await Promise.all([
    jsonTable("notifications").catch(() => []),
    jsonTable("document_notifications").catch(() => []),
  ]);

  res.json({
    leads: mergedLeads,
    conversations: mergedConversations,
    messages: mergedMessages,
    notifications: sortNotifications(mergeById(
      notifications.rows.map((row) => asNotification(row, id)),
      jsonNotifications.filter((row) => String(row.user_id) === String(id)).map((row) => asNotification(row, id)),
      jsonDocNotifications
        .filter((row) => remapSharedCounselorId(row.user_id, id) === id)
        .map((row) => asNotification({
          ...row,
          user_id: id,
          type: row.notification_type || "info",
          category: row.notification_type === "chat" ? "chat" : "document",
          action_url: row.action_url || (row.notification_type === "chat" ? "/counselor/chat" : "/counselor/documents"),
        }, id)),
      (shared.notifications || []).map((row) => asNotification(row, id)),
    )),
    documents: mergeById(
      documents.rows.map(asDocument),
      shared.documents,
    ),
    shortlists: mergeById(
      shortlists.rows.map((row) => asShortlist(row, id)),
      shared.shortlists,
    ),
    applications: shared.applications || [],
    leave: leave.rows,
    attendance: attendance.rows.map((row) => ({
      ...row,
      clock_in: row.clock_in ? String(row.clock_in).slice(0, 8) : null,
      clock_out: row.clock_out ? String(row.clock_out).slice(0, 8) : null,
      date: String(row.date || "").slice(0, 10),
      total_hours: row.total_hours == null ? null : Number(row.total_hours),
    })),
    salary: salary.rows.map((row) => ({
      ...row,
      net_salary: Number(row.net_salary || 0),
    })),
    counselorExtras: extra
      ? [{ user_id: extra.id, bio: extra.bio || "", specializations: extra.specializations || [], phone: extra.phone || "" }]
      : [],
  });
});

app.post("/api/leads", auth, async (req, res) => {
  const studentId = crypto.randomUUID();
  const countries = String(req.body.countries || "").split(",").map((item) => item.trim()).filter(Boolean);
  const lead = await pool.query(
    `INSERT INTO student_leads (
      user_id, email, phone, first_name, last_name, preferred_countries, field_of_interest,
      lead_status, lead_stage, lead_source, assigned_counselor_id, entity_type, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'warm','warm','manual',$8,'lead','assigned')
    RETURNING *`,
    [studentId, req.body.email, req.body.phone || "", req.body.firstName, req.body.lastName, countries, req.body.field || "", req.user.id],
  );
  await pool.query(
    `INSERT INTO private_conversations (counselor_id, student_id, last_message_at)
     VALUES ($1, $2, now())`,
    [req.user.id, studentId],
  );
  const created = lead.rows[0];
  await jsonUpsert("student_leads", {
    ...created,
    user_id: studentId,
    assigned_counselor_id: SHARED_STUDENT_COUNSELOR_ID,
    preferred_countries: created.preferred_countries || [],
  }).catch(() => {});
  res.json(created);
});

app.patch("/api/leads/:id", auth, async (req, res) => {
  const allowed = [
    "lead_status", "lead_stage", "notes", "next_follow_up_date", "last_contact_date",
    "conversion_date", "entity_type", "assigned_counselor_id", "status",
  ];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(patch).length) return res.json({ ok: true });

  const counselorAliases = await resolveCounselorAliases(req.user.id);
  const [sqlLeads, jsonLeads] = await Promise.all([
    pool.query("SELECT * FROM student_leads WHERE id::text = $1", [req.params.id]).catch(() => ({ rows: [] })),
    jsonTable("student_leads").catch(() => []),
  ]);
  const current = jsonLeads.find((row) => String(row.id) === String(req.params.id)) || sqlLeads.rows[0];
  if (!current) return res.status(404).json({ error: "Lead not found." });

  const owned = counselorAliases.has(String(current.assigned_counselor_id || ""));
  if (!owned) return res.status(403).json({ error: "This lead is not assigned to you." });

  const converting = patch.lead_status === "converted" || patch.entity_type === "student"
    || patch.lead_stage === "converted";
  if (converting) {
    const stamp = new Date().toISOString();
    patch.entity_type = "student";
    patch.lead_status = "converted";
    patch.lead_stage = "converted";
    patch.conversion_date = patch.conversion_date || stamp;
    patch.last_contact_date = patch.last_contact_date || stamp;
    patch.assigned_counselor_id = req.user.id;
    patch.status = "assigned";
  }

  const sets = Object.keys(patch).map((key, index) => `${key} = $${index + 2}`);
  const values = Object.values(patch);
  await pool.query(`UPDATE student_leads SET ${sets.join(", ")} WHERE id = $1`, [req.params.id, ...values]).catch(() => {});
  await jsonUpsert("student_leads", { ...current, ...patch, id: current.id || req.params.id });
  res.json({ ok: true });
});

app.post("/api/leads/:id/claim", auth, async (req, res) => {
  await pool.query("UPDATE student_leads SET assigned_counselor_id = $2, status = 'assigned' WHERE id = $1", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post("/api/leave", auth, async (req, res) => {
  await pool.query(
    `INSERT INTO counselor_leave_requests (counselor_id, leave_type, start_date, end_date, reason, total_days, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
    [req.user.id, req.body.leave_type, req.body.start_date, req.body.end_date, req.body.reason, req.body.total_days],
  );
  res.json({ ok: true });
});

app.post("/api/attendance", auth, async (req, res) => {
  const date = String(req.body.date || "").slice(0, 10);
  const clockIn = String(req.body.clock_in || "").slice(0, 8);
  const existing = await pool.query(
    "SELECT id FROM counselor_attendance WHERE counselor_id = $1 AND date = $2",
    [req.user.id, date],
  );
  if (existing.rows[0]) return res.json({ ok: true, id: existing.rows[0].id });
  await pool.query(
    `INSERT INTO counselor_attendance (counselor_id, date, clock_in, status)
     VALUES ($1,$2,$3,'present')
     ON CONFLICT (counselor_id, date) DO NOTHING`,
    [req.user.id, date, clockIn],
  );
  res.json({ ok: true });
});

app.patch("/api/attendance/:id", auth, async (req, res) => {
  await pool.query(
    `UPDATE counselor_attendance SET clock_out = $2, total_hours = $3 WHERE id = $1`,
    [req.params.id, req.body.clock_out, req.body.total_hours],
  );
  res.json({ ok: true });
});

app.post("/api/shortlists", auth, async (req, res) => {
  try {
    const studentId = String(req.body.student_id || "").trim();
    const studentEmail = String(req.body.student_email || "").trim();
    const universityName = String(req.body.university_name || "").trim();
    const courseName = String(req.body.course_name || "").trim();
    const location = String(req.body.location || "").trim();
    if (!studentId || !universityName || !courseName) {
      return res.status(400).json({ error: "Student, university, and course are required." });
    }
    const resolvedId = await resolveStudentUserId(studentId, studentEmail);
    const directory = await studentDirectory();
    const portal = directory.find((person) => person.user_id === resolvedId)
      || directory.find((person) => emailsMatch(person.email, studentEmail));
    const portalId = portal?.user_id || (isUuid(resolvedId) ? resolvedId : "");
    const portalEmail = portal?.email || studentEmail;
    const rowId = crypto.randomUUID();
    let sqlRow = {
      id: rowId,
      student_id: portalId || studentId,
      counselor_id: req.user.id,
      university_name: universityName,
      course_name: courseName,
      location,
      counselor_notes: req.body.counselor_notes || "",
      created_at: new Date().toISOString(),
    };
    const sqlStudentId = portalId && isUuid(portalId) ? portalId : "";
    if (sqlStudentId) {
      const inserted = await pool.query(
        `INSERT INTO university_shortlists (id, student_id, counselor_id, university_name, course_name, location, counselor_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [rowId, sqlStudentId, req.user.id, universityName, courseName, location, req.body.counselor_notes || ""],
      );
      sqlRow = inserted.rows[0];
    }
    const payload = await publishShortlist({
      ...sqlRow,
      student_id: portalId || studentId,
      student_email: portalEmail,
      university_id: req.body.university_id || null,
      priority_level: req.body.priority_level || "medium",
    }, { notify: true });
    res.json({ ok: true, shortlist: asShortlist(payload, req.user.id) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not save shortlist" });
  }
});

app.patch("/api/documents/:id", auth, async (req, res) => {
  const status = String(req.body.status || "").trim();
  const comments = req.body.comments == null ? undefined : String(req.body.comments);
  if (!["uploaded", "approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ error: "Status must be approved or rejected." });
  }
  const now = new Date().toISOString();
  await pool.query("UPDATE documents SET status = $2 WHERE id = $1", [req.params.id, status]).catch(() => {});
  const docs = await jsonTable("documents");
  const found = docs.find((row) => String(row.id) === String(req.params.id));
  if (found) {
    const next = {
      ...found,
      status,
      admin_comments: comments !== undefined ? comments : found.admin_comments,
      reviewed_by: req.user.id,
      reviewed_at: now,
      updated_at: now,
    };
    await jsonUpsert("documents", next);
  await jsonUpsert("document_notifications", {
      id: crypto.randomUUID(),
      user_id: found.user_id,
      notification_type: status,
      title: status === "approved" ? "Document approved" : "Document rejected",
      message: comments
        || (status === "approved"
          ? `${found.document_type} was approved by your counselor.`
          : `${found.document_type} was rejected. Please upload a corrected file.`),
      created_at: now,
      is_read: false,
      action_url: "/student/documents",
    });
    await jsonUpsert("notifications", {
      id: crypto.randomUUID(),
      user_id: found.user_id,
      title: status === "approved" ? "Document approved" : "Document rejected",
      message: comments
        || (status === "approved"
          ? `${found.document_type} was approved by your counselor.`
          : `${found.document_type} was rejected. Please upload a corrected file.`),
      type: status === "approved" ? "success" : "error",
      action_url: "/student/documents",
      created_at: now,
      is_read: false,
    });
  }
  res.json({ ok: true });
});

app.get("/api/documents/:id/file", auth, async (req, res) => {
  const docs = await jsonTable("documents");
  const found = docs.find((row) => String(row.id) === String(req.params.id));
  if (!found?.file_path) return res.status(404).json({ error: "File not found" });
  const file = await pool.query("SELECT data_url FROM app_storage WHERE path = $1", [found.file_path]);
  if (!file.rows[0]?.data_url) return res.status(404).json({ error: "File not found" });
  res.json({ fileName: found.file_name || "document", dataUrl: file.rows[0].data_url });
});

app.patch("/api/applications/:id", auth, async (req, res) => {
  const status = String(req.body.status || "").trim();
  const comments = req.body.comments == null ? "" : String(req.body.comments);
  if (!["counselor_approved", "returned"].includes(status)) {
    return res.status(400).json({ error: "Approve or return the application to the student." });
  }
  const now = new Date().toISOString();
  const apps = await jsonTable("applications");
  const found = apps.find((row) => String(row.id) === String(req.params.id));
  if (!found) return res.status(404).json({ error: "Application not found" });
  const next = {
    ...found,
    status,
    counselor_comments: comments,
    reviewed_by: req.user.id,
    reviewed_at: now,
    updated_at: now,
  };
  await jsonUpsert("applications", next);
  const uni = found.university_name || "your application";
  await jsonUpsert("document_notifications", {
    id: crypto.randomUUID(),
    user_id: found.user_id,
    notification_type: status,
    title: status === "counselor_approved" ? "Application approved" : "Application returned",
    message: comments
      || (status === "counselor_approved"
        ? `${uni} was approved by your counselor. It was not sent to the university automatically.`
        : `${uni} was returned by your counselor. Update it and send it again.`),
    created_at: now,
    is_read: false,
  });
  res.json({ ok: true });
});

app.post("/api/notifications/read", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET is_read = true WHERE user_id = $1", [req.user.id]).catch(() => {});
  const [notes, docNotes] = await Promise.all([
    jsonTable("notifications").catch(() => []),
    jsonTable("document_notifications").catch(() => []),
  ]);
  await Promise.all([
    ...notes.filter((row) => String(row.user_id) === String(req.user.id)).map((row) => jsonUpsert("notifications", { ...row, is_read: true })),
    ...docNotes.filter((row) => remapSharedCounselorId(row.user_id, req.user.id) === String(req.user.id)).map((row) => jsonUpsert("document_notifications", { ...row, is_read: true })),
  ]);
  res.json({ ok: true });
});

app.post("/api/notifications/:id/read", auth, async (req, res) => {
  await markNotificationReadForUser(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.post("/api/conversations", auth, async (req, res) => {
  const studentId = String(req.body.studentId || "");
  const jsonConversations = await jsonTable("private_conversations");
  const shared = jsonConversations.find((row) => String(row.student_id) === studentId);
  if (shared) return res.json(asConversation(shared, req.user.id));

  const existing = await pool.query(
    "SELECT * FROM private_conversations WHERE counselor_id = $1 AND student_id = $2",
    [req.user.id, studentId],
  );
  if (existing.rows[0]) return res.json(asConversation(existing.rows[0], req.user.id));
  const created = await pool.query(
    `INSERT INTO private_conversations (counselor_id, student_id, last_message_at)
     VALUES ($1,$2,now()) RETURNING *`,
    [req.user.id, studentId],
  );
  res.json(asConversation(created.rows[0], req.user.id));
});

app.post("/api/messages", auth, async (req, res) => {
  const conversationId = String(req.body.conversationId || "");
  const receiverId = String(req.body.receiverId || "");
  const text = String(req.body.message || "").trim();
  if (!conversationId || !receiverId || !text) {
    return res.status(400).json({ error: "Message, conversation, and student are required." });
  }

  const now = new Date().toISOString();
  const jsonConversations = await jsonTable("private_conversations");
  const sharedConversation = jsonConversations.find((row) => String(row.id) === conversationId);
  const senderId = sharedConversation?.counselor_id || req.user.id;
  const row = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    sender_id: senderId,
    receiver_id: receiverId,
    message: text,
    is_read: false,
    created_at: now,
    updated_at: now,
  };

  await jsonUpsert("private_messages", row);
  if (sharedConversation) {
    await jsonUpsert("private_conversations", {
      ...sharedConversation,
      last_message_at: now,
      updated_at: now,
    });
  } else {
    try {
      await pool.query(
        `INSERT INTO private_messages (id, conversation_id, sender_id, receiver_id, message)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, conversationId, req.user.id, receiverId, text],
      );
      await pool.query("UPDATE private_conversations SET last_message_at = now() WHERE id = $1", [conversationId]);
    } catch {
      // Student-originated threads live in app_records, not the UUID counselor tables.
    }
  }

  await jsonUpsert("notifications", {
    id: crypto.randomUUID(),
    user_id: receiverId,
    title: "New message from your counselor",
    message: text.length > 140 ? `${text.slice(0, 137)}...` : text,
    type: "info",
    action_url: "/student/chat",
    created_at: now,
    is_read: false,
  });
  await jsonUpsert("document_notifications", {
    id: crypto.randomUUID(),
    user_id: receiverId,
    title: "New message from your counselor",
    message: text.length > 140 ? `${text.slice(0, 137)}...` : text,
    notification_type: "chat",
    action_url: "/student/chat",
    created_at: now,
    is_read: false,
  });

  res.json(asMessage(row, req.user.id));
});

app.patch("/api/messages/:id", auth, async (req, res) => {
  const messageId = String(req.params.id);
  const text = String(req.body.message || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Message text is required." });
  }

  const jsonMessages = await jsonTable("private_messages");
  const existing = jsonMessages.find((row) => String(row.id) === messageId);
  const sqlResult = await pool
    .query("SELECT * FROM private_messages WHERE id = $1", [messageId])
    .catch(() => ({ rows: [] }));
  const sqlRow = sqlResult.rows[0];

  if (!existing && !sqlRow) {
    return res.status(404).json({ error: "Message not found." });
  }

  const senderId = existing?.sender_id ?? sqlRow?.sender_id;
  if (remapSharedCounselorId(senderId, req.user.id) !== req.user.id) {
    return res.status(403).json({ error: "You can only edit your own messages." });
  }

  const now = new Date().toISOString();
  let updated = null;

  if (existing) {
    updated = { ...existing, message: text, updated_at: now };
    await jsonUpsert("private_messages", updated);
  }

  if (sqlRow) {
    const sqlUpdated = await pool.query(
      "UPDATE private_messages SET message = $1 WHERE id = $2 RETURNING *",
      [text, messageId],
    );
    updated = updated ? { ...updated, ...sqlUpdated.rows[0] } : { ...sqlRow, message: text, updated_at: now };
  }

  return res.json(asMessage(updated, req.user.id));
});

app.post("/api/conversations/:id/read", auth, async (req, res) => {
  await pool.query(
    "UPDATE private_messages SET is_read = true WHERE conversation_id = $1 AND receiver_id = $2",
    [req.params.id, req.user.id],
  ).catch(() => {});
  const messages = await jsonTable("private_messages");
  const unreadInThread = messages.filter(
    (row) => String(row.conversation_id) === String(req.params.id)
      && [req.user.id, SHARED_STUDENT_COUNSELOR_ID].includes(String(row.receiver_id)),
  );
  await Promise.all(unreadInThread.map((row) => jsonUpsert("private_messages", { ...row, is_read: true })));
  await Promise.all(unreadInThread.map((row) => markNotificationReadForUser(req.user.id, `chat_${row.id}`).catch(() => {})));
  res.json({ ok: true });
});

function catalogFilters({ q = "", country = "", university = "", degree = "", course = "" } = {}) {
  const clauses = [];
  const params = ["university_programs"];
  let index = 2;

  const exact = [
    ["country", country],
    ["university_name", university],
    ["degree", degree],
    ["course", course],
  ];
  for (const [field, value] of exact) {
    const text = String(value || "").trim();
    if (!text) continue;
    clauses.push(`lower(data->>'${field}') = lower($${index})`);
    params.push(text);
    index += 1;
  }

  const needle = String(q || "").trim().toLowerCase();
  if (needle) {
    clauses.push(`(
      lower(data->>'university_name') LIKE $${index} OR
      lower(data->>'program_name') LIKE $${index} OR
      lower(data->>'country') LIKE $${index} OR
      lower(data->>'course') LIKE $${index} OR
      lower(data->>'specialization') LIKE $${index} OR
      lower(data->>'location') LIKE $${index}
    )`);
    params.push(`%${needle}%`);
    index += 1;
  }

  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  return { where, params, nextIndex: index };
}

async function searchUniversityPrograms({
  q = "",
  country = "",
  university = "",
  degree = "",
  course = "",
  limit = 100,
  offset = 0,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { where, params } = catalogFilters({ q, country, university, degree, course });
  const listParams = [...params, safeLimit, safeOffset];
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, data
       FROM app_records
       WHERE table_name = $1
       ${where}
       ORDER BY lower(data->>'course'), lower(data->>'specialization'), lower(data->>'program_name')
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      listParams,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM app_records
       WHERE table_name = $1
       ${where}`,
      params,
    ),
  ]);
  return {
    rows: rowsResult.rows.map((row) => {
      const data = row.data && typeof row.data === "object" ? row.data : {};
      return { ...data, id: data.id || row.id };
    }),
    total: Number(countResult.rows[0]?.count || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function catalogCountries() {
  const result = await pool.query(
    `SELECT
       data->>'country' AS name,
       COUNT(DISTINCT data->>'university_name')::int AS university_count,
       COUNT(*)::int AS program_count
     FROM app_records
     WHERE table_name = $1 AND coalesce(data->>'country', '') <> ''
     GROUP BY data->>'country'
     ORDER BY lower(data->>'country')`,
    ["university_programs"],
  );
  return result.rows.map((row) => ({
    name: row.name || "Unknown",
    university_count: Number(row.university_count || 0),
    program_count: Number(row.program_count || 0),
  }));
}

async function catalogUniversities(country) {
  const result = await pool.query(
    `SELECT
       data->>'university_name' AS name,
       MAX(data->>'location') AS location,
       COUNT(*)::int AS program_count
     FROM app_records
     WHERE table_name = $1 AND lower(data->>'country') = lower($2)
     GROUP BY data->>'university_name'
     ORDER BY lower(data->>'university_name')`,
    ["university_programs", country],
  );
  return result.rows.map((row) => ({
    name: row.name || "Unknown",
    location: row.location || "",
    program_count: Number(row.program_count || 0),
  }));
}

async function catalogDegrees(country, university) {
  const result = await pool.query(
    `SELECT
       coalesce(nullif(data->>'degree', ''), 'Other') AS name,
       COUNT(*)::int AS program_count
     FROM app_records
     WHERE table_name = $1
       AND lower(data->>'country') = lower($2)
       AND lower(data->>'university_name') = lower($3)
     GROUP BY coalesce(nullif(data->>'degree', ''), 'Other')
     ORDER BY lower(coalesce(nullif(data->>'degree', ''), 'Other'))`,
    ["university_programs", country, university],
  );
  return result.rows.map((row) => ({
    name: row.name || "Other",
    program_count: Number(row.program_count || 0),
  }));
}

function checklistApplies(item, countries, degree) {
  const wanted = countries.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  const itemCountries = [item.country, ...(item.countries || [])]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const countryOk =
    !itemCountries.length ||
    itemCountries.includes("all") ||
    (wanted.length > 0 && itemCountries.some((value) => wanted.includes(value)));

  const itemDegrees = [item.degree_type, ...(item.degree_types || [])]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const degreeOk =
    !itemDegrees.length ||
    itemDegrees.includes("all") ||
    (degree ? itemDegrees.includes(String(degree).trim().toLowerCase()) : true);

  return countryOk && degreeOk;
}

async function counselorOwnsStudent(counselorId, studentRef) {
  const ref = String(studentRef || "");
  if (!ref) return false;
  const counselorAliases = await resolveCounselorAliases(counselorId);
  const [sqlLeads, jsonLeads] = await Promise.all([
    pool.query("SELECT * FROM student_leads").catch(() => ({ rows: [] })),
    jsonTable("student_leads").catch(() => []),
  ]);
  const leads = mergeStudents(
    sqlLeads.rows.map((row) => asLead(row, counselorId, counselorAliases)),
    jsonLeads.map((row) => asLead(row, counselorId, counselorAliases)),
  );
  return leads.some(
    (lead) =>
      String(lead.assigned_counselor_id) === String(counselorId) &&
      (String(lead.id) === ref || String(lead.user_id) === ref),
  );
}

app.get("/api/university-catalog/countries", auth, async (_req, res) => {
  try {
    res.json(await catalogCountries());
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load countries." });
  }
});

app.get("/api/university-catalog/universities", auth, async (req, res) => {
  try {
    const country = String(req.query.country || "").trim();
    if (!country) return res.status(400).json({ error: "Country is required." });
    res.json(await catalogUniversities(country));
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load universities." });
  }
});

app.get("/api/university-catalog/degrees", auth, async (req, res) => {
  try {
    const country = String(req.query.country || "").trim();
    const university = String(req.query.university || "").trim();
    if (!country || !university) {
      return res.status(400).json({ error: "Country and university are required." });
    }
    res.json(await catalogDegrees(country, university));
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load degree types." });
  }
});

app.get("/api/university-programs", auth, async (req, res) => {
  try {
    const result = await searchUniversityPrograms({
      q: req.query.q,
      country: req.query.country,
      university: req.query.university,
      degree: req.query.degree,
      course: req.query.course,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load university programs." });
  }
});

app.get("/api/students/:id/checklist", auth, async (req, res) => {
  try {
    const owns = await counselorOwnsStudent(req.user.id, req.params.id);
    if (!owns) return res.status(403).json({ error: "This student is not assigned to you." });

    const [sqlLeads, jsonLeads] = await Promise.all([
      pool.query("SELECT * FROM student_leads").catch(() => ({ rows: [] })),
      jsonTable("student_leads").catch(() => []),
    ]);
    const leads = mergeStudents(
      sqlLeads.rows.map((row) => asLead(row, req.user.id)),
      jsonLeads,
    );
    const student = leads.find(
      (row) => String(row.id) === String(req.params.id) || String(row.user_id) === String(req.params.id),
    );
    if (!student) return res.status(404).json({ error: "Student not found." });

    const [items, sqlDocs, jsonDocs, requests] = await Promise.all([
      jsonTable("document_checklists"),
      pool.query("SELECT * FROM documents").catch(() => ({ rows: [] })),
      jsonTable("documents"),
      jsonTable("document_requests").catch(() => []),
    ]);

    const ownsDoc = (ownerId) =>
      ownerId != null &&
      (String(ownerId) === String(student.user_id) || String(ownerId) === String(student.id));
    const docs = mergeById(sqlDocs.rows.map(asDocument), jsonDocs.map(asDocument))
      .filter((doc) => !doc.archived && ownsDoc(doc.user_id));

    const countries = student.preferred_countries || [];
    const degree = student.qualification_level || student.degree_level || "";

    const applicable = items
      .filter((item) => item.is_active !== false)
      .filter((item) => checklistApplies(item, countries, degree))
      .sort((a, b) => Number(a.display_order || 99) - Number(b.display_order || 99));

    const studentUserId = String(student.user_id || student.id);
    const pendingRequests = requests.filter(
      (row) => String(row.student_id) === studentUserId && String(row.status || "pending") === "pending",
    );

    const checklist = applicable.map((item) => {
      const match = docs.find(
        (doc) => String(doc.document_type || "").trim().toLowerCase() === String(item.document_type).trim().toLowerCase(),
      );
      const request = pendingRequests.find(
        (row) => String(row.document_type || "").trim().toLowerCase() === String(item.document_type).trim().toLowerCase(),
      );
      return {
        document_type: item.document_type,
        description: item.description || "",
        is_required: item.is_required !== false,
        allowed_file_types: item.allowed_file_types || [],
        max_file_size_mb: item.max_file_size_mb || 20,
        status: match ? match.status : "requested",
        document_id: match?.id || null,
        file_name: match?.file_name || null,
        admin_comments: match?.admin_comments || "",
        uploaded_at: match?.created_at || null,
        request_id: request?.id || null,
        request_sent: Boolean(request),
        request_sent_at: request?.created_at || null,
      };
    });

    const required = checklist.filter((row) => row.is_required);
    res.json({
      student_id: studentUserId,
      countries,
      degree,
      items: checklist,
      required_total: required.length,
      required_approved: required.filter((row) => row.status === "approved").length,
      awaiting_review: checklist.filter((row) => row.status === "uploaded" || row.status === "pending").length,
      not_uploaded: checklist.filter((row) => row.status === "requested").length,
      complete: required.length > 0 && required.every((row) => row.status === "approved"),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not build the checklist." });
  }
});

async function resolveAssignedStudent(counselorId, studentRef) {
  const [sqlLeads, jsonLeads] = await Promise.all([
    pool.query("SELECT * FROM student_leads").catch(() => ({ rows: [] })),
    jsonTable("student_leads").catch(() => []),
  ]);
  const leads = mergeStudents(
    sqlLeads.rows.map((row) => asLead(row, counselorId)),
    jsonLeads,
  );
  return leads.find(
    (row) =>
      String(row.assigned_counselor_id) === String(counselorId) &&
      (String(row.id) === String(studentRef) || String(row.user_id) === String(studentRef)),
  );
}

function needsDocumentRequest(status) {
  return !status || status === "requested" || status === "rejected";
}

app.post("/api/students/:id/document-requests", auth, async (req, res) => {
  try {
    const student = await resolveAssignedStudent(req.user.id, req.params.id);
    if (!student) return res.status(403).json({ error: "This student is not assigned to you." });

    const requestedTypes = Array.isArray(req.body.document_types)
      ? req.body.document_types.map((item) => String(item || "").trim()).filter(Boolean)
      : String(req.body.document_type || "").trim()
        ? [String(req.body.document_type).trim()]
        : [];
    if (!requestedTypes.length) {
      return res.status(400).json({ error: "Select at least one document to request." });
    }

    const studentUserId = String(student.user_id || student.id);
    const [checklistItems, existingRequests, sqlDocs, jsonDocs] = await Promise.all([
      jsonTable("document_checklists"),
      jsonTable("document_requests").catch(() => []),
      pool.query("SELECT * FROM documents").catch(() => ({ rows: [] })),
      jsonTable("documents"),
    ]);

    const ownsDoc = (ownerId) =>
      ownerId != null &&
      (String(ownerId) === studentUserId || String(ownerId) === String(student.id));
    const docs = mergeById(sqlDocs.rows.map(asDocument), jsonDocs.map(asDocument))
      .filter((doc) => !doc.archived && ownsDoc(doc.user_id));

    const now = new Date().toISOString();
    const created = [];
    const skipped = [];

    for (const documentType of requestedTypes) {
      const checklistItem = checklistItems.find(
        (item) => String(item.document_type || "").trim().toLowerCase() === documentType.trim().toLowerCase(),
      );
      const match = docs.find(
        (doc) => String(doc.document_type || "").trim().toLowerCase() === documentType.trim().toLowerCase(),
      );
      const currentStatus = match ? match.status : "requested";
      if (!needsDocumentRequest(currentStatus)) {
        skipped.push({ document_type: documentType, reason: "already_submitted" });
        continue;
      }

      const existing = existingRequests.find(
        (row) =>
          String(row.student_id) === studentUserId &&
          String(row.document_type || "").trim().toLowerCase() === documentType.trim().toLowerCase() &&
          String(row.status || "pending") === "pending",
      );
      if (existing) {
        const refreshed = { ...existing, updated_at: now };
        await jsonUpsert("document_requests", refreshed);
        created.push(refreshed);
        continue;
      }

      const payload = {
        id: crypto.randomUUID(),
        student_id: studentUserId,
        requested_by: req.user.id,
        document_type: checklistItem?.document_type || documentType,
        description: checklistItem?.description || "",
        is_mandatory: checklistItem?.is_required !== false,
        max_file_size_mb: checklistItem?.max_file_size_mb || 20,
        allowed_file_types: checklistItem?.allowed_file_types || ["pdf", "jpg", "jpeg", "png"],
        status: "pending",
        created_at: now,
        updated_at: now,
      };
      await jsonUpsert("document_requests", payload);
      created.push(payload);
    }

    if (!created.length) {
      return res.status(400).json({
        error: skipped.length
          ? "These documents were already submitted or are awaiting review."
          : "No documents could be requested.",
        skipped,
      });
    }

    const names = created.map((row) => row.document_type).join(", ");
    const title = created.length === 1 ? "Document requested" : "Documents requested";
    const message = created.length === 1
      ? `Your counselor has requested ${names}. Please upload it in your student portal.`
      : `Your counselor has requested these documents: ${names}. Please upload them in your student portal.`;

    await jsonUpsert("document_notifications", {
      id: crypto.randomUUID(),
      user_id: studentUserId,
      notification_type: "request",
      title,
      message,
      action_url: "/student/documents",
      created_at: now,
      is_read: false,
    });
    await jsonUpsert("notifications", {
      id: crypto.randomUUID(),
      user_id: studentUserId,
      title,
      message,
      type: "warning",
      action_url: "/student/documents",
      created_at: now,
      is_read: false,
    });

    res.json({ ok: true, requests: created, skipped });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not send document request." });
  }
});

app.get("/api/checklists", auth, async (_req, res) => {
  try {
    const items = await jsonTable("document_checklists");
    items.sort((a, b) => Number(a.display_order || 99) - Number(b.display_order || 99));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load document types." });
  }
});

app.post("/api/checklists", auth, async (req, res) => {
  try {
    const allowed = Array.isArray(req.body.allowed_file_types)
      ? req.body.allowed_file_types
      : String(req.body.allowed_file_types || "pdf,jpg,png")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const countries = Array.isArray(req.body.countries)
      ? req.body.countries
      : String(req.body.countries || req.body.country || "All")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const degreeTypes = Array.isArray(req.body.degree_types)
      ? req.body.degree_types
      : String(req.body.degree_types || req.body.degree_type || "All")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const payload = {
      id: req.body.id || `dc-${crypto.randomUUID()}`,
      document_type: String(req.body.document_type || "").trim(),
      description: String(req.body.description || ""),
      is_required: req.body.is_required !== false,
      is_active: req.body.is_active !== false,
      max_file_size_mb: Number(req.body.max_file_size_mb || 20),
      allowed_file_types: allowed,
      country: countries[0] || "All",
      countries: countries.length ? countries : ["All"],
      degree_type: degreeTypes[0] || "All",
      degree_types: degreeTypes.length ? degreeTypes : ["All"],
      display_order: Number(req.body.display_order || 99),
    };
    if (!payload.document_type) return res.status(400).json({ error: "Document type is required." });
    await jsonUpsert("document_checklists", payload);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not add document type." });
  }
});

app.patch("/api/checklists/:id", auth, async (req, res) => {
  try {
    const items = await jsonTable("document_checklists");
    const found = items.find((row) => String(row.id) === String(req.params.id));
    if (!found) return res.status(404).json({ error: "Document type not found." });
    const next = { ...found, ...req.body, id: found.id };
    await jsonUpsert("document_checklists", next);
    res.json(next);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not update document type." });
  }
});

if (IS_PRODUCTION) {
  const distDir = path.join(root, "dist");
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
}

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Unknown API route." });
});

async function start() {
  await new Promise((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Fly Masters counselor API on port ${PORT}`);
      resolve();
    });
  });

  try {
    await applySchema();
    console.log("Database schema ready");
  } catch (error) {
    console.error("Database schema failed:", error.message || error);
    if (!IS_PRODUCTION) {
      console.error("Start the database with: docker compose up -d");
      console.error("Then use DATABASE_URL=postgresql://flymasters:flymasters@127.0.0.1:5433/flymasters");
    }
  }
}

start().catch((error) => {
  console.error("Counselor portal failed to start:", error.message || error);
  process.exit(1);
});

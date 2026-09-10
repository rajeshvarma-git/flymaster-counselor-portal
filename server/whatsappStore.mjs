import crypto from "crypto";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  generateOtp,
  getWhatsAppConfig,
  hashOtp,
  normalizePhone,
  otpExpiryDate,
  sendWhatsAppOtp,
  sendWhatsAppText,
  verifyOtpHash,
} from "./whatsapp.mjs";

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function jsonTable(pool, tableName) {
  const result = await pool.query("SELECT data FROM app_records WHERE table_name = $1", [tableName]).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({ ...(row.data || {}), id: String(row.data?.id || row.id || "") }));
}

export async function jsonUpsert(pool, tableName, data) {
  const id = String(data.id || crypto.randomUUID());
  const now = new Date().toISOString();
  const row = { ...data, id, updated_at: now };
  if (!row.created_at) row.created_at = now;
  await pool.query(
    `INSERT INTO app_records (id, table_name, data, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [id, tableName, JSON.stringify(row)],
  );
  return row;
}

export async function resolveSessionUser(pool, token, verifyJwt) {
  if (!token) return null;
  if (verifyJwt) {
    const claims = await verifyJwt(token);
    if (claims?.id) {
      const role = claims.role || (await roleForUser(pool, claims.id));
      return { id: String(claims.id), email: claims.email || "", role };
    }
  }
  const session = await pool.query(
    `SELECT s.user_id, u.email
     FROM auth_sessions s
     JOIN auth_users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  ).catch(() => ({ rows: [] }));
  if (session.rows[0]) {
    const userId = String(session.rows[0].user_id);
    return { id: userId, email: session.rows[0].email || "", role: await roleForUser(pool, userId) };
  }
  return null;
}

async function roleForUser(pool, userId) {
  const result = await pool.query(
    "SELECT data FROM app_records WHERE table_name = 'user_roles' AND data->>'user_id' = $1 LIMIT 1",
    [String(userId)],
  ).catch(() => ({ rows: [] }));
  return result.rows[0]?.data?.role || "student";
}

export async function getProfile(pool, userId) {
  const profiles = await jsonTable(pool, "profiles");
  return profiles.find((row) => String(row.user_id) === String(userId)) || null;
}

export async function updateProfileWhatsApp(pool, userId, patch) {
  const profiles = await jsonTable(pool, "profiles");
  const existing = profiles.find((row) => String(row.user_id) === String(userId));
  const next = {
    ...(existing || { id: `profile-${userId}`, user_id: userId, created_at: new Date().toISOString() }),
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await jsonUpsert(pool, "profiles", next);
  return next;
}

export async function getVerificationStatus(pool, userId) {
  const profile = await getProfile(pool, userId);
  return {
    verified: Boolean(profile?.whatsapp_verified),
    phone: profile?.whatsapp_number || profile?.phone || "",
    verifiedAt: profile?.whatsapp_verified_at || null,
  };
}

function phoneMessage(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? digits : digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits;
  if (!normalized) return "Enter your phone number";
  if (normalized.length !== 10) return "Enter a 10-digit phone number";
  return "";
}

function phoneDigits(value) {
  const normalized = normalizePhone(value);
  return normalized.startsWith("91") && normalized.length === 12 ? normalized.slice(2) : normalized;
}

export async function sendOtpForUser(pool, userId, phoneInput) {
  const issue = phoneMessage(phoneInput);
  if (issue) return { error: issue, status: 400 };
  const phone = normalizePhone(phoneInput);

  const rows = await jsonTable(pool, "whatsapp_verifications");
  const recent = rows
    .filter((row) => String(row.user_id) === String(userId) && String(row.phone_number) === phone)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (recent?.created_at) {
    const elapsed = (Date.now() - Date.parse(recent.created_at)) / 1000;
    if (elapsed < OTP_RESEND_SECONDS) {
      return { error: `Please wait ${Math.ceil(OTP_RESEND_SECONDS - elapsed)} seconds before requesting another code.`, status: 429 };
    }
  }

  const code = generateOtp();
  const sent = await sendWhatsAppOtp(phone, code);
  if (!sent.ok && !sent.dev) return { error: sent.error || "Could not send WhatsApp code.", status: 502 };

  await jsonUpsert(pool, "whatsapp_verifications", {
    id: crypto.randomUUID(),
    user_id: String(userId),
    phone_number: phone,
    code_hash: hashOtp(code),
    attempts: 0,
    expires_at: otpExpiryDate(),
    verified_at: null,
    created_at: new Date().toISOString(),
  });

  return {
    ok: true,
    message: "Verification code sent to your WhatsApp.",
    devHint: sent.dev ? `WhatsApp not configured — code: ${code}` : undefined,
  };
}

export async function verifyOtpForUser(pool, userId, phoneInput, codeInput) {
  const code = String(codeInput || "").trim();
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code.", status: 400 };
  const phone = normalizePhone(phoneInput);
  const rows = await jsonTable(pool, "whatsapp_verifications");
  const pending = rows
    .filter((row) => String(row.user_id) === String(userId) && String(row.phone_number) === phone && !row.verified_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!pending) return { error: "No active verification code. Request a new one.", status: 400 };
  if (Date.parse(pending.expires_at) < Date.now()) return { error: "Code expired. Request a new one.", status: 400 };
  if (Number(pending.attempts || 0) >= OTP_MAX_ATTEMPTS) return { error: "Too many attempts. Request a new code.", status: 429 };
  if (!verifyOtpHash(code, pending.code_hash)) {
    await jsonUpsert(pool, "whatsapp_verifications", { ...pending, attempts: Number(pending.attempts || 0) + 1 });
    return { error: "Incorrect code.", status: 400 };
  }

  const now = new Date().toISOString();
  await jsonUpsert(pool, "whatsapp_verifications", { ...pending, verified_at: now, attempts: Number(pending.attempts || 0) + 1 });
  await updateProfileWhatsApp(pool, userId, {
    whatsapp_number: phone,
    whatsapp_verified: true,
    whatsapp_verified_at: now,
    phone: phoneDigits(phoneInput),
  });

  const leads = await jsonTable(pool, "student_leads");
  for (const lead of leads.filter((row) => String(row.user_id) === String(userId))) {
    await jsonUpsert(pool, "student_leads", {
      ...lead,
      phone: phoneDigits(phoneInput),
      whatsapp_number: phone,
      whatsapp_verified: true,
    });
  }

  return { ok: true, verified: true, phone: phoneDigits(phoneInput) };
}

export async function findLeadForUser(pool, userId) {
  const leads = await jsonTable(pool, "student_leads");
  return leads.find((row) => String(row.user_id) === String(userId) || String(row.id) === String(userId)) || null;
}

export function isConvertedStudent(lead) {
  return lead?.entity_type === "student" || lead?.lead_status === "converted";
}

export async function findLeadByPhone(pool, phone) {
  const normalized = normalizePhone(phone);
  const leads = await jsonTable(pool, "student_leads");
  return leads.find((row) => normalizePhone(row.whatsapp_number || row.phone || "") === normalized) || null;
}

export function resolveConversationParticipants(lead) {
  if (!lead) return { telecallerId: null, counselorId: null, stage: "lead" };
  const converted = isConvertedStudent(lead);
  return {
    telecallerId: lead.assigned_telecaller_id ? String(lead.assigned_telecaller_id) : null,
    counselorId: lead.assigned_counselor_id ? String(lead.assigned_counselor_id) : null,
    stage: converted ? "student" : "lead",
  };
}

function participantSyncKey(lead) {
  const { telecallerId, counselorId, stage } = resolveConversationParticipants(lead);
  return `${telecallerId || ""}|${counselorId || ""}|${stage}`;
}

/** Primary handler for routing/notifications — both staff can still reply when assigned. */
export function resolveActiveHandler(lead) {
  if (!lead) return { handlerId: null, handlerRole: null, stage: "lead" };
  const { telecallerId, counselorId, stage } = resolveConversationParticipants(lead);
  const converted = stage === "student";
  if (converted && counselorId) {
    return { handlerId: counselorId, handlerRole: "counselor", stage };
  }
  if (!converted && telecallerId) {
    return { handlerId: telecallerId, handlerRole: "telecaller", stage };
  }
  if (counselorId) {
    return { handlerId: counselorId, handlerRole: "counselor", stage };
  }
  return { handlerId: null, handlerRole: null, stage };
}

export function leadAssignedToTelecaller(lead, staffId) {
  return Boolean(lead && staffId && String(lead.assigned_telecaller_id || "") === String(staffId));
}

export function counselorCanReply({ lead, conversation, aliases, portalCounselorId = null }) {
  if (!aliases?.size) return false;
  if (lead && leadOwnedByCounselor(lead, aliases, portalCounselorId)) return true;
  if (conversation && idInAliases(conversation.assigned_counselor_id, aliases)) return true;
  return false;
}

export function canStaffReply({ staffRole, staffId, lead, aliases = null, conversation = null }) {
  if (staffRole === "admin" || staffRole === "super_admin") return true;
  if (!staffId) return false;
  const converted = lead ? isConvertedStudent(lead) : conversation?.stage === "student";
  if (staffRole === "telecaller") {
    if (converted) return false;
    if (lead && leadAssignedToTelecaller(lead, staffId)) return true;
    return String(conversation?.assigned_telecaller_id || "") === String(staffId);
  }
  if (staffRole === "counselor") {
    if (aliases?.size) return counselorCanReply({ lead, conversation, aliases, portalCounselorId: staffId });
    const assigned = String(lead?.assigned_counselor_id || conversation?.assigned_counselor_id || "");
    return assigned === String(staffId);
  }
  return false;
}

export async function loadAllLeads(pool) {
  const [sql, json] = await Promise.all([
    pool.query("SELECT * FROM student_leads ORDER BY created_at DESC").catch(() => ({ rows: [] })),
    jsonTable(pool, "student_leads"),
  ]);
  const map = new Map();
  for (const row of sql.rows) map.set(String(row.id), { ...row, id: String(row.id) });
  for (const row of json) {
    const id = String(row.id);
    map.set(id, { ...(map.get(id) || {}), ...row, id });
  }
  return [...map.values()];
}

async function notifyAdmins(pool, notify, title, message, actionUrl = "/admin/whatsapp") {
  if (!notify) return;
  const roles = await jsonTable(pool, "user_roles");
  for (const row of roles.filter((item) => item.role === "admin" || item.role === "super_admin")) {
    await notify(String(row.user_id), title, message, "warning", actionUrl);
  }
}

export async function createWhatsAppLead(pool, phone, previewMessage = "") {
  const digits = phoneDigits(phone);
  const userId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const now = new Date().toISOString();
  const lead = {
    id: leadId,
    user_id: userId,
    email: `whatsapp+${digits || Date.now()}@flymasters.local`,
    phone: digits,
    whatsapp_number: normalizePhone(phone),
    first_name: "WhatsApp",
    last_name: digits ? digits.slice(-4) : "Lead",
    preferred_countries: [],
    field_of_interest: "",
    academic_score: "",
    lead_status: "hot",
    lead_stage: "hot",
    lead_source: "whatsapp",
    last_channel: "whatsapp",
    last_message_preview: String(previewMessage || "").slice(0, 140),
    priority: "high",
    assigned_telecaller_id: null,
    assigned_counselor_id: null,
    entity_type: "lead",
    status: "new",
    notes: `[${now.slice(0, 10)}] Auto-created from inbound WhatsApp.`,
    created_at: now,
  };
  await jsonUpsert(pool, "student_leads", lead);
  return lead;
}

export async function syncConversationFromLead(pool, lead, options = {}) {
  if (!lead?.id) return null;
  const { businessPhoneId = null, recordHandoff = false, previousLead = null } = options;
  const phone = normalizePhone(lead.whatsapp_number || lead.phone || "");
  const { telecallerId, counselorId, stage } = resolveConversationParticipants(lead);
  const { handlerId, handlerRole } = resolveActiveHandler(lead);
  const conversation = await ensureWhatsAppConversation(pool, {
    userId: lead.user_id || "",
    phone,
    leadId: lead.id,
    businessPhoneId,
    stage,
    telecallerId,
    counselorId,
    activeHandlerId: handlerId,
    activeHandlerRole: handlerRole,
  });
  if (recordHandoff && previousLead && conversation) {
    await recordParticipantHandoff(pool, conversation, previousLead, lead);
  }
  return conversation;
}

export async function handoffOnConversion(pool, leadId) {
  const leads = await loadAllLeads(pool);
  const lead = leads.find((row) => String(row.id) === String(leadId));
  if (!lead || !isConvertedStudent(lead)) return null;
  const previousLead = { ...lead, entity_type: "lead", lead_status: "hot" };
  return syncConversationFromLead(pool, lead, { recordHandoff: true, previousLead });
}

export function findLeadForConversation(conversation, leads) {
  if (!conversation) return null;
  const phone = normalizePhone(conversation.phone_number || "");
  return (
    leads.find(
      (row) =>
        String(row.user_id) === String(conversation.user_id) ||
        String(row.id) === String(conversation.lead_id) ||
        (phone && normalizePhone(row.whatsapp_number || row.phone || "") === phone),
    ) || null
  );
}

export function idInAliases(value, aliases) {
  return value != null && value !== "" && aliases?.has(String(value));
}

const SHARED_STUDENT_COUNSELOR_ID = "local-counselor-1";

export function leadOwnedByCounselor(lead, aliases, portalCounselorId = null) {
  if (!lead) return false;
  const assigned = String(lead.assigned_counselor_id || "");
  if (!assigned) return false;
  if (portalCounselorId && assigned === String(portalCounselorId)) return true;
  if (!aliases?.size) return false;
  if (assigned === SHARED_STUDENT_COUNSELOR_ID) {
    return [...aliases].some((id) => id && id !== SHARED_STUDENT_COUNSELOR_ID);
  }
  return idInAliases(assigned, aliases);
}

export function conversationVisibleToCounselor(conversation, aliases, leads) {
  if (!conversation || !aliases?.size) return false;
  if (idInAliases(conversation.assigned_counselor_id, aliases)) return true;
  const lead = findLeadForConversation(conversation, leads);
  return leadOwnedByCounselor(lead, aliases);
}

export function conversationVisibleToTelecaller(conversation, staffId, leads) {
  if (!conversation || !staffId) return false;
  if (String(conversation.assigned_telecaller_id || "") === String(staffId)) return true;
  const lead = findLeadForConversation(conversation, leads);
  return leadAssignedToTelecaller(lead, staffId);
}

export async function ensureCounselorWhatsAppThreads(pool, aliases, portalCounselorId = null) {
  if (!aliases?.size) return { provisioned: 0, skippedNoPhone: 0 };
  const portalId = portalCounselorId
    ? String(portalCounselorId)
    : [...aliases].find((id) => id && id !== SHARED_STUDENT_COUNSELOR_ID) || null;
  if (!portalId) return { provisioned: 0, skippedNoPhone: 0 };

  const leads = await loadAllLeads(pool);
  let provisioned = 0;
  let skippedNoPhone = 0;
  for (const lead of leads) {
    if (!leadOwnedByCounselor(lead, aliases, portalId)) continue;
    const phone = normalizePhone(lead.whatsapp_number || lead.phone || "");
    if (!phone || phone.length < 12) {
      skippedNoPhone += 1;
      continue;
    }
    const { telecallerId, stage } = resolveConversationParticipants(lead);
    const { handlerId, handlerRole } = resolveActiveHandler(lead);
    const assignedCounselor = lead.assigned_counselor_id ? String(lead.assigned_counselor_id) : portalId;
    await ensureWhatsAppConversation(pool, {
      userId: lead.user_id || "",
      phone,
      leadId: lead.id,
      stage,
      telecallerId,
      counselorId: idInAliases(assignedCounselor, aliases) ? portalId : assignedCounselor,
      activeHandlerId: handlerId,
      activeHandlerRole: handlerRole,
    });
    provisioned += 1;
  }
  return { provisioned, skippedNoPhone };
}

export async function ensureTelecallerWhatsAppThreads(pool, telecallerId) {
  if (!telecallerId) return { provisioned: 0, skippedNoPhone: 0 };
  const leads = await loadAllLeads(pool);
  let provisioned = 0;
  let skippedNoPhone = 0;
  for (const lead of leads) {
    if (!leadAssignedToTelecaller(lead, telecallerId) || isConvertedStudent(lead)) continue;
    const phone = normalizePhone(lead.whatsapp_number || lead.phone || "");
    if (!phone || phone.length < 12) {
      skippedNoPhone += 1;
      continue;
    }
    const { telecallerId: tcId, counselorId, stage } = resolveConversationParticipants(lead);
    const { handlerId, handlerRole } = resolveActiveHandler(lead);
    await ensureWhatsAppConversation(pool, {
      userId: lead.user_id || "",
      phone,
      leadId: lead.id,
      stage,
      telecallerId: tcId,
      counselorId,
      activeHandlerId: handlerId,
      activeHandlerRole: handlerRole,
    });
    provisioned += 1;
  }
  return { provisioned, skippedNoPhone };
}

export function computeCounselorWhatsAppMeta(leads, aliases, portalCounselorId, mode = "all") {
  const owned = leads.filter((lead) => {
    if (!leadOwnedByCounselor(lead, aliases, portalCounselorId)) return false;
    const converted = isConvertedStudent(lead);
    if (mode === "student") return converted;
    if (mode === "lead") return !converted;
    return true;
  });
  const withPhone = owned.filter((lead) => {
    const phone = normalizePhone(lead.whatsapp_number || lead.phone || "");
    return phone.length >= 12;
  });
  return {
    assigned: owned.length,
    withPhone: withPhone.length,
    missingPhone: Math.max(0, owned.length - withPhone.length),
  };
}

export async function enrichWhatsAppConversations(pool, conversations, leads, { aliases = null, staffRole = "counselor", staffId = null } = {}) {
  const messages = await jsonTable(pool, "whatsapp_messages");
  return conversations.map((row) => {
    const lead = findLeadForConversation(row, leads);
    const convMessages = messages
      .filter((item) => String(item.conversation_id) === String(row.id))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const chatMessages = convMessages.filter((item) => item.channel !== "system" && item.kind !== "system");
    const last = chatMessages[chatMessages.length - 1];
    const unread = chatMessages.filter((item) => item.direction === "inbound" && !item.is_read).length;
    const studentName = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() : "";
    const converted = isConvertedStudent(lead);
    return {
      ...row,
      student_name: studentName || null,
      is_unknown: !row.user_id && !row.lead_id,
      last_message: last?.body || row.last_message_preview || null,
      unread_count: unread,
      stage: row.stage || (converted ? "student" : "lead"),
      lead_source: lead?.lead_source || null,
      canReply: canStaffReply({ staffRole, staffId, lead, aliases, conversation: row }),
      assigned_telecaller_id: row.assigned_telecaller_id || lead?.assigned_telecaller_id || null,
      assigned_counselor_id: row.assigned_counselor_id || lead?.assigned_counselor_id || null,
    };
  });
}

export async function appendSystemMessage(pool, conversationId, body) {
  return appendWhatsAppMessage(pool, {
    conversationId,
    direction: "inbound",
    body,
    senderId: null,
    senderType: "system",
    channel: "system",
    status: "system",
  });
}

export async function recordParticipantHandoff(pool, conversation, previousLead, nextLead) {
  if (!conversation?.id || !nextLead) return conversation;
  const nextKey = participantSyncKey(nextLead);
  if (String(conversation.participant_sync_key || "") === nextKey) return conversation;

  const prevTc = String(previousLead?.assigned_telecaller_id || "");
  const nextTc = String(nextLead.assigned_telecaller_id || "");
  const prevCo = String(previousLead?.assigned_counselor_id || "");
  const nextCo = String(nextLead.assigned_counselor_id || "");
  const wasConverted = isConvertedStudent(previousLead);
  const isConverted = isConvertedStudent(nextLead);

  const notes = [];
  if (nextTc && nextTc !== prevTc) notes.push("A telecaller joined this chat.");
  if (nextCo && nextCo !== prevCo) notes.push("A counselor joined this chat.");
  if (isConverted && !wasConverted) notes.push("Lead converted — counselor now handles WhatsApp replies.");

  for (const body of notes) {
    await appendSystemMessage(pool, conversation.id, body);
  }

  const updated = {
    ...conversation,
    participant_sync_key: nextKey,
    assigned_telecaller_id: nextTc || null,
    assigned_counselor_id: nextCo || null,
  };
  await jsonUpsert(pool, "whatsapp_conversations", updated);
  return updated;
}

export async function ensureWhatsAppConversation(pool, {
  userId,
  phone,
  leadId,
  businessPhoneId,
  stage = null,
  telecallerId = null,
  counselorId = null,
  activeHandlerId = null,
  activeHandlerRole = null,
  lastMessagePreview = null,
}) {
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const rows = await jsonTable(pool, "whatsapp_conversations");
  const existing = rows.find(
    (row) =>
      (userId && String(row.user_id) === String(userId)) ||
      (normalizedPhone && normalizePhone(row.phone_number || "") === normalizedPhone) ||
      (leadId && String(row.lead_id) === String(leadId)),
  );
  const nextTelecaller = telecallerId ?? existing?.assigned_telecaller_id ?? null;
  const nextCounselor = counselorId ?? existing?.assigned_counselor_id ?? null;
  const handlerId = activeHandlerId ?? existing?.active_handler_id ?? null;
  const handlerRole = activeHandlerRole ?? existing?.active_handler_role ?? null;

  if (existing) {
    const next = {
      ...existing,
      user_id: String(userId || existing.user_id || ""),
      phone_number: normalizedPhone || normalizePhone(existing.phone_number || ""),
      lead_id: leadId || existing.lead_id,
      assigned_telecaller_id: nextTelecaller,
      assigned_counselor_id: nextCounselor,
      assigned_staff_id: handlerId ?? existing.assigned_staff_id ?? null,
      staff_role: handlerRole ?? existing.staff_role ?? null,
      active_handler_id: handlerId ?? existing.active_handler_id ?? null,
      active_handler_role: handlerRole ?? existing.active_handler_role ?? null,
      stage: stage || existing.stage || "lead",
      last_message_preview: lastMessagePreview ?? existing.last_message_preview ?? null,
      business_phone_id: businessPhoneId || existing.business_phone_id || null,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(existing);
    if (changed) await jsonUpsert(pool, "whatsapp_conversations", next);
    return next;
  }

  return jsonUpsert(pool, "whatsapp_conversations", {
    id: crypto.randomUUID(),
    user_id: String(userId || ""),
    lead_id: leadId || null,
    phone_number: normalizedPhone || "",
    business_phone_id: businessPhoneId || null,
    assigned_telecaller_id: nextTelecaller,
    assigned_counselor_id: nextCounselor,
    assigned_staff_id: handlerId,
    staff_role: handlerRole,
    active_handler_id: handlerId,
    active_handler_role: handlerRole,
    stage: stage || "lead",
    last_message_preview: lastMessagePreview,
    last_message_at: null,
    participant_sync_key: null,
    created_at: new Date().toISOString(),
  });
}

export async function listWhatsAppConversations(pool, filterFn) {
  const rows = await jsonTable(pool, "whatsapp_conversations");
  return rows
    .filter((row) => (filterFn ? filterFn(row) : true))
    .sort((a, b) => String(b.last_message_at || b.created_at || "").localeCompare(String(a.last_message_at || a.created_at || "")));
}

export async function listWhatsAppMessages(pool, conversationId) {
  const rows = await jsonTable(pool, "whatsapp_messages");
  return rows
    .filter((row) => String(row.conversation_id) === String(conversationId))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function isRealInboundMessage(row) {
  return row.direction === "inbound" && row.channel !== "system" && row.kind !== "system";
}

export async function getMessagingWindowStatus(pool, conversationId) {
  const messages = await listWhatsAppMessages(pool, conversationId);
  const inbound = messages.filter(isRealInboundMessage);
  const lastInbound = inbound[inbound.length - 1];
  if (!lastInbound?.created_at) {
    return { open: false, reason: "The student has not messaged on WhatsApp yet. They must message your business number first." };
  }
  const elapsed = Date.now() - Date.parse(lastInbound.created_at);
  if (elapsed > MESSAGING_WINDOW_MS) {
    const hours = Math.floor(elapsed / (60 * 60 * 1000));
    return {
      open: false,
      reason: `The 24-hour reply window closed about ${hours} hours ago. Ask the student to send a new WhatsApp message, or configure WHATSAPP_REPLY_TEMPLATE in Railway.`,
      lastInboundAt: lastInbound.created_at,
    };
  }
  return { open: true, lastInboundAt: lastInbound.created_at };
}

export async function appendWhatsAppMessage(pool, {
  conversationId,
  direction,
  body,
  senderId,
  senderType,
  channel = "whatsapp",
  waMessageId = null,
  status = "sent",
}) {
  const now = new Date().toISOString();
  const message = await jsonUpsert(pool, "whatsapp_messages", {
    id: crypto.randomUUID(),
    conversation_id: String(conversationId),
    direction,
    body,
    sender_id: senderId || null,
    sender_type: senderType || (direction === "inbound" ? "student" : "staff"),
    channel,
    wa_message_id: waMessageId,
    delivery_status: status,
    is_read: direction === "outbound",
    created_at: now,
  });

  const conversations = await jsonTable(pool, "whatsapp_conversations");
  const conversation = conversations.find((row) => String(row.id) === String(conversationId));
  const isSystem = channel === "system";
  if (conversation && !isSystem) {
    await jsonUpsert(pool, "whatsapp_conversations", {
      ...conversation,
      last_message_at: now,
      last_message_preview: String(body || "").slice(0, 140),
    });
  }
  return message;
}

export async function sendStaffWhatsAppReply(pool, { conversationId, staffId, body, notify, staffRole = "counselor", aliases = null }) {
  const conversations = await jsonTable(pool, "whatsapp_conversations");
  let conversation = conversations.find((row) => String(row.id) === String(conversationId));
  if (!conversation) return { error: "Conversation not found.", status: 404 };
  const text = String(body || "").trim();
  if (!text) return { error: "Message cannot be empty.", status: 400 };

  const leads = await loadAllLeads(pool);
  const lead = findLeadForConversation(conversation, leads);
  if (!canStaffReply({ staffRole, staffId, lead, aliases, conversation })) {
    return {
      error: staffRole === "counselor"
        ? "You cannot reply to this thread. Confirm this lead is assigned to you in My Leads."
        : "You cannot reply to this thread at the current stage.",
      status: 403,
    };
  }
  const { telecallerId, counselorId, stage } = resolveConversationParticipants(lead || {});
  conversation = await jsonUpsert(pool, "whatsapp_conversations", {
    ...conversation,
    assigned_telecaller_id: telecallerId || conversation.assigned_telecaller_id || null,
    assigned_counselor_id: counselorId || conversation.assigned_counselor_id || null,
    last_replied_by_id: staffId,
    last_replied_by_role: staffRole,
    stage: isConvertedStudent(lead) ? "student" : (stage || conversation.stage || "lead"),
    user_id: conversation.user_id || lead?.user_id || "",
    lead_id: conversation.lead_id || lead?.id || null,
  });

  const recipientPhone = normalizePhone(conversation.phone_number || "");
  const cfg = getWhatsAppConfig();
  const senderPhoneId = cfg.phoneNumberId;
  const windowStatus = await getMessagingWindowStatus(pool, conversationId);
  if (!windowStatus.open && !cfg.replyTemplateName) {
    const message = await appendWhatsAppMessage(pool, {
      conversationId,
      direction: "outbound",
      body: text,
      senderId: staffId,
      senderType: "staff",
      channel: "whatsapp",
      waMessageId: null,
      status: `failed: ${windowStatus.reason}`,
    });
    return { error: windowStatus.reason, status: 400, message, windowClosed: true };
  }

  const sent = await sendWhatsAppText(recipientPhone, text, senderPhoneId);
  if (!sent.ok) {
    const message = await appendWhatsAppMessage(pool, {
      conversationId,
      direction: "outbound",
      body: text,
      senderId: staffId,
      senderType: "staff",
      channel: "whatsapp",
      waMessageId: null,
      status: `failed: ${sent.error || "WhatsApp send failed"}`,
    });
    return { error: sent.error || "WhatsApp send failed.", status: 502, message };
  }

  const message = await appendWhatsAppMessage(pool, {
    conversationId,
    direction: "outbound",
    body: text,
    senderId: staffId,
    senderType: "staff",
    channel: sent.viaTemplate ? "whatsapp_template" : "whatsapp",
    waMessageId: sent.waMessageId || null,
    status: sent.dev ? "sent (dev)" : sent.viaTemplate ? "sent (template)" : "sent",
  });

  if (notify && conversation.user_id) {
    await notify(conversation.user_id, "New WhatsApp message", text.slice(0, 140), "info", "/student/chat");
  }
  return { ok: true, message, dev: sent.dev };
}

export async function handleIncomingWhatsApp(pool, { from, body, waMessageId, notify, businessPhoneId }) {
  const phone = normalizePhone(from);
  const preview = String(body || "").slice(0, 140);
  const profiles = await jsonTable(pool, "profiles");
  const profile = profiles.find((row) => normalizePhone(row.whatsapp_number || row.phone || "") === phone);
  let lead =
    (await findLeadByPhone(pool, phone)) ||
    (profile ? (await jsonTable(pool, "student_leads")).find((row) => String(row.user_id) === String(profile.user_id)) : null);

  let createdLead = false;
  if (!lead) {
    lead = await createWhatsAppLead(pool, phone, preview);
    createdLead = true;
  } else {
    await jsonUpsert(pool, "student_leads", {
      ...lead,
      whatsapp_number: lead.whatsapp_number || phone,
      last_channel: "whatsapp",
      last_message_preview: preview,
      last_contact_date: new Date().toISOString(),
    });
    lead = { ...lead, whatsapp_number: lead.whatsapp_number || phone, last_message_preview: preview };
  }

  const userId = profile?.user_id || lead?.user_id || "";
  const { telecallerId, counselorId, stage } = resolveConversationParticipants(lead);
  const { handlerId, handlerRole } = resolveActiveHandler(lead);

  const conversation = await ensureWhatsAppConversation(pool, {
    userId,
    phone,
    leadId: lead.id,
    businessPhoneId,
    stage,
    telecallerId,
    counselorId,
    activeHandlerId: handlerId,
    activeHandlerRole: handlerRole,
    lastMessagePreview: preview,
  });

  const message = await appendWhatsAppMessage(pool, {
    conversationId: conversation.id,
    direction: "inbound",
    body,
    senderId: userId || phone,
    senderType: "student",
    channel: "whatsapp",
    waMessageId,
    status: "received",
  });

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || phone;
  if (notify) {
    const converted = isConvertedStudent(lead);
    const counselorUrl = converted ? "/counselor/whatsapp/students" : "/counselor/whatsapp/leads";
    const notified = new Set();
    if (telecallerId && !converted) {
      await notify(telecallerId, `WhatsApp from ${name}`, preview, "info", "/admin/inbox");
      notified.add(String(telecallerId));
    }
    if (counselorId) {
      await notify(counselorId, `WhatsApp from ${name}`, preview, "info", counselorUrl);
      notified.add(String(counselorId));
    }
    if (!notified.size && handlerId) {
      const actionUrl = handlerRole === "counselor" ? counselorUrl : handlerRole === "telecaller" ? "/admin/inbox" : "/admin/whatsapp";
      await notify(handlerId, `WhatsApp from ${name}`, preview, "info", actionUrl);
    } else if (!notified.size) {
      await notifyAdmins(
        pool,
        notify,
        createdLead ? "New WhatsApp lead" : "Unassigned WhatsApp message",
        createdLead
          ? `${name} messaged on WhatsApp. Assign a telecaller from Leads or WhatsApp.`
          : `${name}: ${preview}`,
        "/admin/whatsapp",
      );
    }
  }

  return { conversation, message, lead, createdLead };
}

export async function updateMessageStatus(pool, waMessageId, status) {
  const rows = await jsonTable(pool, "whatsapp_messages");
  const message = rows.find((row) => String(row.wa_message_id) === String(waMessageId));
  if (!message) return null;
  return jsonUpsert(pool, "whatsapp_messages", { ...message, delivery_status: status });
}

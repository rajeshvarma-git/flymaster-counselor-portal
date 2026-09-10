import crypto from "crypto";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  generateOtp,
  hashOtp,
  normalizePhone,
  otpExpiryDate,
  sendWhatsAppOtp,
  sendWhatsAppText,
  verifyOtpHash,
} from "./whatsapp.mjs";

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

export function resolveActiveHandler(lead) {
  if (!lead) return { handlerId: null, handlerRole: null, stage: "lead" };
  const converted = isConvertedStudent(lead);
  const stage = converted ? "student" : "lead";
  if (converted && lead.assigned_counselor_id) {
    return { handlerId: String(lead.assigned_counselor_id), handlerRole: "counselor", stage };
  }
  if (!converted && lead.assigned_telecaller_id) {
    return { handlerId: String(lead.assigned_telecaller_id), handlerRole: "telecaller", stage };
  }
  return { handlerId: null, handlerRole: null, stage };
}

export function canStaffReply({ staffRole, staffId, lead }) {
  if (staffRole === "admin" || staffRole === "super_admin") return true;
  if (!lead || !staffId) return false;
  const converted = isConvertedStudent(lead);
  if (staffRole === "telecaller") {
    return !converted && String(lead.assigned_telecaller_id || "") === String(staffId);
  }
  if (staffRole === "counselor") {
    return converted && String(lead.assigned_counselor_id || "") === String(staffId);
  }
  return false;
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

export async function syncConversationFromLead(pool, lead, businessPhoneId = null) {
  if (!lead?.id) return null;
  const phone = normalizePhone(lead.whatsapp_number || lead.phone || "");
  const { handlerId, handlerRole, stage } = resolveActiveHandler(lead);
  return ensureWhatsAppConversation(pool, {
    userId: lead.user_id || "",
    phone,
    staffId: handlerId,
    staffRole: handlerRole,
    leadId: lead.id,
    businessPhoneId,
    stage,
    activeHandlerId: handlerId,
    activeHandlerRole: handlerRole,
  });
}

export async function handoffOnConversion(pool, leadId) {
  const leads = await jsonTable(pool, "student_leads");
  const lead = leads.find((row) => String(row.id) === String(leadId));
  if (!lead) return null;
  const conversations = await jsonTable(pool, "whatsapp_conversations");
  const conversation = conversations.find(
    (row) => String(row.lead_id) === String(leadId) || normalizePhone(row.phone_number) === normalizePhone(lead.whatsapp_number || lead.phone || ""),
  );
  if (!conversation) return syncConversationFromLead(pool, lead);
  const next = {
    ...conversation,
    stage: "student",
    active_handler_id: lead.assigned_counselor_id || null,
    active_handler_role: lead.assigned_counselor_id ? "counselor" : null,
    assigned_staff_id: lead.assigned_counselor_id || null,
    staff_role: lead.assigned_counselor_id ? "counselor" : null,
  };
  await jsonUpsert(pool, "whatsapp_conversations", next);
  return next;
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

export function conversationVisibleToCounselor(conversation, counselorId, leads) {
  const id = String(counselorId || "");
  if (!id || !conversation) return false;
  if (String(conversation.assigned_staff_id || "") === id) return true;

  const lead = findLeadForConversation(conversation, leads);
  if (String(lead?.assigned_counselor_id || "") === id) return true;

  const phone = normalizePhone(conversation.phone_number || "");
  if (phone && !conversation.user_id && !conversation.lead_id) {
    return true;
  }
  return false;
}

export async function enrichWhatsAppConversations(pool, conversations, leads) {
  const messages = await jsonTable(pool, "whatsapp_messages");
  return conversations.map((row) => {
    const lead = findLeadForConversation(row, leads);
    const convMessages = messages
      .filter((item) => String(item.conversation_id) === String(row.id))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const last = convMessages[convMessages.length - 1];
    const unread = convMessages.filter((item) => item.direction === "inbound" && !item.is_read).length;
    const studentName = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() : "";
    return {
      ...row,
      student_name: studentName || null,
      is_unknown: !row.user_id && !row.lead_id,
      last_message: last?.body || null,
      unread_count: unread,
    };
  });
}

export async function ensureWhatsAppConversation(pool, {
  userId,
  phone,
  staffId,
  staffRole,
  leadId,
  businessPhoneId,
  stage = null,
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
  const handlerId = activeHandlerId ?? staffId ?? existing?.active_handler_id ?? existing?.assigned_staff_id ?? null;
  const handlerRole = activeHandlerRole ?? staffRole ?? existing?.active_handler_role ?? existing?.staff_role ?? null;
  if (existing) {
    const next = {
      ...existing,
      user_id: String(userId || existing.user_id || ""),
      phone_number: normalizedPhone || normalizePhone(existing.phone_number || ""),
      lead_id: leadId || existing.lead_id,
      assigned_staff_id: handlerId,
      staff_role: handlerRole,
      active_handler_id: handlerId,
      active_handler_role: handlerRole,
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
    assigned_staff_id: handlerId,
    staff_role: handlerRole,
    active_handler_id: handlerId,
    active_handler_role: handlerRole,
    stage: stage || "lead",
    last_message_preview: lastMessagePreview,
    last_message_at: null,
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
  if (conversation) {
    await jsonUpsert(pool, "whatsapp_conversations", {
      ...conversation,
      last_message_at: now,
      last_message_preview: String(body || "").slice(0, 140),
    });
  }
  return message;
}

export async function sendStaffWhatsAppReply(pool, { conversationId, staffId, body, notify, staffRole = "counselor" }) {
  const conversations = await jsonTable(pool, "whatsapp_conversations");
  let conversation = conversations.find((row) => String(row.id) === String(conversationId));
  if (!conversation) return { error: "Conversation not found.", status: 404 };
  const text = String(body || "").trim();
  if (!text) return { error: "Message cannot be empty.", status: 400 };

  const leads = await jsonTable(pool, "student_leads");
  const lead = findLeadForConversation(conversation, leads);
  if (!canStaffReply({ staffRole, staffId, lead })) {
    return { error: "You cannot reply to this thread at the current stage.", status: 403 };
  }
  if (!conversation.assigned_staff_id && staffId) {
    conversation = await jsonUpsert(pool, "whatsapp_conversations", {
      ...conversation,
      assigned_staff_id: staffId,
      staff_role: staffRole,
      user_id: conversation.user_id || lead?.user_id || "",
      lead_id: conversation.lead_id || lead?.id || null,
    });
  }

  const recipientPhone = normalizePhone(conversation.phone_number || "");
  const senderPhoneId = conversation.business_phone_id || null;
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
    channel: "whatsapp",
    waMessageId: sent.waMessageId || null,
    status: sent.dev ? "sent (dev)" : "sent",
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
  const { handlerId, handlerRole, stage } = resolveActiveHandler(lead);

  const conversation = await ensureWhatsAppConversation(pool, {
    userId,
    phone,
    staffId: handlerId,
    staffRole: handlerRole,
    leadId: lead.id,
    businessPhoneId,
    stage,
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
    if (handlerId) {
      const actionUrl =
        handlerRole === "counselor"
          ? "/counselor/whatsapp"
          : handlerRole === "telecaller"
            ? "/admin/inbox"
            : "/admin/whatsapp";
      await notify(handlerId, `WhatsApp from ${name}`, preview, "info", actionUrl);
    } else {
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

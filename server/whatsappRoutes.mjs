import { getWhatsAppConfig, normalizePhone, parseIncomingWebhook, verifyWhatsAppCredentials } from "./whatsapp.mjs";
import {
  appendWhatsAppMessage,
  canStaffReply,
  conversationVisibleToCounselor,
  ensureCounselorWhatsAppThreads,
  ensureWhatsAppConversation,
  enrichWhatsAppConversations,
  findLeadForConversation,
  findLeadForUser,
  getVerificationStatus,
  handleIncomingWhatsApp,
  jsonTable,
  jsonUpsert,
  listWhatsAppConversations,
  listWhatsAppMessages,
  loadAllLeads,
  resolveSessionUser,
  sendOtpForUser,
  sendStaffWhatsAppReply,
  syncConversationFromLead,
  verifyOtpForUser,
} from "./whatsappStore.mjs";

export function mountWhatsAppRoutes(app, {
  pool,
  verifyJwt,
  notify,
  staffRoles = ["admin", "super_admin", "counselor", "telecaller"],
  resolveCounselorAliases = null,
}) {
  async function portalSession(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const user = await resolveSessionUser(pool, token, verifyJwt);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    req.user = user;
    next();
  }

  function requireStaff(req, res, next) {
    if (!staffRoles.includes(req.user?.role)) {
      return res.status(403).json({ error: "Staff access required." });
    }
    next();
  }

  async function counselorAliasesFor(userId) {
    if (typeof resolveCounselorAliases === "function") {
      return resolveCounselorAliases(userId);
    }
    return new Set([String(userId)]);
  }

  async function counselorCanAccessConversation(conversationId, userId) {
    const leads = await loadAllLeads(pool);
    const conversations = await jsonTable(pool, "whatsapp_conversations");
    const conversation = conversations.find((row) => String(row.id) === String(conversationId));
    if (!conversation) return { ok: false, status: 404, error: "Conversation not found." };
    const aliases = await counselorAliasesFor(userId);
    if (!conversationVisibleToCounselor(conversation, aliases, leads)) {
      return { ok: false, status: 403, error: "You do not have access to this conversation." };
    }
    const lead = findLeadForConversation(conversation, leads);
    return { ok: true, conversation, lead, aliases };
  }

  app.get("/api/whatsapp/webhook", (req, res) => {
    const cfg = getWhatsAppConfig();
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "").trim();
    const challenge = req.query["hub.challenge"];
    const expected = cfg.webhookVerifyToken;
    console.log("[whatsapp] verify request", {
      mode,
      hasChallenge: challenge != null && challenge !== "",
      tokenMatches: token === expected,
    });
    if (mode === "subscribe" && token && token === expected) {
      return res.status(200).type("text/plain").send(String(challenge ?? ""));
    }
    console.warn("[whatsapp] verify rejected — check WHATSAPP_WEBHOOK_VERIFY_TOKEN in Railway");
    return res.status(403).type("text/plain").send("Forbidden");
  });

  app.get("/api/whatsapp/status", async (_req, res) => {
    const cfg = getWhatsAppConfig();
    const credentials = await verifyWhatsAppCredentials();
    res.json({
      ok: credentials.ok,
      webhookReady: Boolean(cfg.webhookVerifyToken),
      verifyTokenLength: cfg.webhookVerifyToken.length,
      whatsappApiConfigured: Boolean(cfg.accessToken && cfg.phoneNumberId),
      credentialsValid: credentials.ok,
      credentialError: credentials.error || null,
      displayPhone: credentials.displayPhone || null,
    });
  });

  app.post("/api/whatsapp/webhook", async (req, res) => {
    try {
      const items = parseIncomingWebhook(req.body);
      for (const item of items) {
        if (item.kind === "status") {
          const rows = await jsonTable(pool, "whatsapp_messages");
          const message = rows.find((row) => String(row.wa_message_id) === String(item.waMessageId));
          if (message) await jsonUpsert(pool, "whatsapp_messages", { ...message, delivery_status: item.status });
          if (item.businessPhoneId && item.recipient) {
            const conversations = await jsonTable(pool, "whatsapp_conversations");
            const conversation = conversations.find(
              (row) => normalizePhone(row.phone_number || "") === normalizePhone(item.recipient),
            );
            if (conversation && conversation.business_phone_id !== item.businessPhoneId) {
              await jsonUpsert(pool, "whatsapp_conversations", {
                ...conversation,
                business_phone_id: item.businessPhoneId,
              });
            }
          }
          continue;
        }
        await handleIncomingWhatsApp(pool, {
          from: item.from,
          body: item.body,
          waMessageId: item.waMessageId,
          businessPhoneId: item.businessPhoneId,
          notify,
        });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message || "Webhook failed" });
    }
  });

  app.get("/api/whatsapp/verification-status", portalSession, async (req, res) => {
    try {
      res.json(await getVerificationStatus(pool, req.user.id));
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not load verification status" });
    }
  });

  app.post("/api/whatsapp/send-otp", portalSession, async (req, res) => {
    try {
      const result = await sendOtpForUser(pool, req.user.id, req.body.phone);
      if (result.error) return res.status(result.status || 400).json({ error: result.error, devHint: result.devHint });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not send code" });
    }
  });

  app.post("/api/whatsapp/verify-otp", portalSession, async (req, res) => {
    try {
      const result = await verifyOtpForUser(pool, req.user.id, req.body.phone, req.body.code);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      const lead = await findLeadForUser(pool, req.user.id);
      if (lead) await syncConversationFromLead(pool, lead);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not verify code" });
    }
  });

  app.get("/api/whatsapp/conversations", portalSession, requireStaff, async (req, res) => {
    try {
      const role = req.user.role;
      const leads = await loadAllLeads(pool);
      let aliases = null;
      if (role === "counselor") {
        aliases = await counselorAliasesFor(req.user.id);
        await ensureCounselorWhatsAppThreads(pool, aliases, req.user.id);
      }
      const conversations = await listWhatsAppConversations(pool, (row) => {
        if (role === "admin" || role === "super_admin") return true;
        if (role === "counselor") return conversationVisibleToCounselor(row, aliases, leads);
        if (role === "telecaller") {
          const lead = leads.find((item) => String(item.user_id) === String(row.user_id) || String(item.id) === String(row.lead_id));
          return String(lead?.assigned_telecaller_id || row.active_handler_id || row.assigned_staff_id || "") === String(req.user.id);
        }
        return false;
      });
      const enriched = await enrichWhatsAppConversations(pool, conversations, leads, {
        aliases,
        staffRole: role,
      });
      res.json({ conversations: enriched });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not load conversations" });
    }
  });

  app.get("/api/whatsapp/conversations/:id/messages", portalSession, requireStaff, async (req, res) => {
    try {
      if (req.user.role === "counselor") {
        const access = await counselorCanAccessConversation(req.params.id, req.user.id);
        if (!access.ok) return res.status(access.status || 403).json({ error: access.error });
      }
      const messages = await listWhatsAppMessages(pool, req.params.id);
      res.json({ messages });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not load messages" });
    }
  });

  app.post("/api/whatsapp/messages", portalSession, requireStaff, async (req, res) => {
    try {
      let aliases = null;
      if (req.user.role === "counselor") {
        const access = await counselorCanAccessConversation(req.body.conversationId, req.user.id);
        if (!access.ok) return res.status(access.status || 403).json({ error: access.error });
        aliases = access.aliases;
      }
      const result = await sendStaffWhatsAppReply(pool, {
        conversationId: req.body.conversationId,
        staffId: req.user.id,
        body: req.body.message,
        notify,
        staffRole: req.user.role === "telecaller" ? "telecaller" : "counselor",
        aliases,
      });
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not send message" });
    }
  });

  app.post("/api/whatsapp/conversations/:id/read", portalSession, requireStaff, async (req, res) => {
    try {
      if (req.user.role === "counselor") {
        const access = await counselorCanAccessConversation(req.params.id, req.user.id);
        if (!access.ok) return res.status(access.status || 403).json({ error: access.error });
      }
      const messages = await listWhatsAppMessages(pool, req.params.id);
      for (const row of messages.filter((item) => item.direction === "inbound" && !item.is_read)) {
        await jsonUpsert(pool, "whatsapp_messages", { ...row, is_read: true });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not mark read" });
    }
  });

  app.post("/api/whatsapp/app-message", portalSession, async (req, res) => {
    try {
      const text = String(req.body.message || "").trim();
      if (!text) return res.status(400).json({ error: "Message cannot be empty." });
      const status = await getVerificationStatus(pool, req.user.id);
      if (!status.verified) return res.status(403).json({ error: "Verify your WhatsApp number first." });
      const lead = await findLeadForUser(pool, req.user.id);
      const conversation = lead
        ? await syncConversationFromLead(pool, lead)
        : await ensureWhatsAppConversation(pool, { userId: req.user.id, phone: status.phone });
      const message = await appendWhatsAppMessage(pool, {
        conversationId: conversation.id,
        direction: "inbound",
        body: text,
        senderId: req.user.id,
        senderType: "student",
        channel: "app",
        status: "received",
      });
      const staffId = lead?.assigned_counselor_id || lead?.assigned_telecaller_id;
      if (notify && staffId) {
        await notify(staffId, "New in-app message", text.slice(0, 140), "info", lead?.assigned_counselor_id ? "/counselor/whatsapp" : "/admin/telecallers");
      }
      res.json({ message, conversation });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not send message" });
    }
  });

  app.get("/api/whatsapp/my-thread", portalSession, async (req, res) => {
    try {
      const status = await getVerificationStatus(pool, req.user.id);
      if (!status.verified) return res.json({ verified: false, conversation: null, messages: [] });
      const lead = await findLeadForUser(pool, req.user.id);
      const conversation = lead
        ? await syncConversationFromLead(pool, lead)
        : await ensureWhatsAppConversation(pool, { userId: req.user.id, phone: status.phone });
      const messages = await listWhatsAppMessages(pool, conversation.id);
      res.json({ verified: true, conversation, messages });
    } catch (error) {
      res.status(500).json({ error: error.message || "Could not load thread" });
    }
  });
}

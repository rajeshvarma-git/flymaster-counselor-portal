import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, MessageCircle, Phone, Send, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { useLocalStore } from "@/lib/store";
import { displayName } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export type WhatsAppPageMode = "lead" | "student";

interface WhatsAppConversation {
  id: string;
  user_id: string;
  phone_number: string;
  last_message_at?: string | null;
  student_name?: string | null;
  is_unknown?: boolean;
  last_message?: string | null;
  unread_count?: number;
  stage?: string;
  lead_source?: string | null;
  canReply?: boolean;
}

interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel?: string;
  kind?: string;
  delivery_status?: string;
  created_at: string;
}

interface WhatsAppStatus {
  ok: boolean;
  webhookReady: boolean;
  whatsappApiConfigured: boolean;
  credentialsValid?: boolean;
  credentialError?: string | null;
  displayPhone?: string | null;
}

interface WhatsAppMeta {
  assigned?: number;
  withPhone?: number;
  missingPhone?: number;
  provisioned?: number;
  skippedNoPhone?: number;
}

const PAGE_COPY: Record<
  WhatsAppPageMode,
  { title: string; subtitle: string; emptyTitle: string; emptyHint: string; icon: typeof MessageCircle; accent: string; selectedBg: string; bubbleBg: string }
> = {
  lead: {
    title: "WhatsApp — Leads",
    subtitle: "WhatsApp threads for open leads assigned to you (before conversion).",
    emptyTitle: "No lead WhatsApp threads yet.",
    emptyHint: "Assigned leads with a phone number appear here. When they message your Fly Masters WhatsApp number, you can reply within 24 hours.",
    icon: Phone,
    accent: "text-sky-500",
    selectedBg: "bg-sky-50",
    bubbleBg: "bg-sky-600",
  },
  student: {
    title: "WhatsApp — Students",
    subtitle: "WhatsApp and in-app messages with converted students assigned to you.",
    emptyTitle: "No student WhatsApp threads yet.",
    emptyHint: "When a student messages on WhatsApp, their thread appears here.",
    icon: Users,
    accent: "text-emerald-500",
    selectedBg: "bg-emerald-50",
    bubbleBg: "bg-emerald-600",
  },
};

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return phone || "Unknown";
}

function isConvertedLead(lead: { entity_type?: string; lead_status?: string }) {
  return lead.entity_type === "student" || lead.lead_status === "converted";
}

interface WhatsAppChatProps {
  mode: WhatsAppPageMode;
}

export default function WhatsAppChat({ mode }: WhatsAppChatProps) {
  const copy = PAGE_COPY[mode];
  const Icon = copy.icon;
  const { user } = useAuth();
  const store = useLocalStore();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [meta, setMeta] = useState<WhatsAppMeta | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [windowStatus, setWindowStatus] = useState<{ open: boolean; reason?: string } | null>(null);

  const assignedCount = useMemo(() => {
    if (!user?.id) return 0;
    return store.leads.filter((lead) => {
      const converted = isConvertedLead(lead);
      const matchesMode = mode === "student" ? converted : !converted;
      return matchesMode && lead.assigned_counselor_id === user.id;
    }).length;
  }, [store.leads, mode, user?.id]);

  useEffect(() => {
    void api<WhatsAppStatus>("/whatsapp/status", { auth: false })
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setMessages([]);
    setLoading(true);
    const load = () =>
      api<{ conversations: WhatsAppConversation[]; meta?: WhatsAppMeta | null }>(`/whatsapp/conversations?stage=${mode}`)
        .then((data) => {
          const next = data.conversations || [];
          setConversations(next);
          setMeta(data.meta || null);
          setLoadError(null);
          setSelectedId((current) => {
            if (current && next.some((item) => item.id === current)) return current;
            return next[0]?.id || null;
          });
        })
        .catch((error) => {
          setConversations([]);
          setLoadError(error instanceof Error ? error.message : "Could not load WhatsApp conversations.");
        })
        .finally(() => setLoading(false));
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || conversations[0] || null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      setWindowStatus(null);
      return;
    }
    const loadMessages = () =>
      api<{ messages: WhatsAppMessage[]; windowStatus?: { open: boolean; reason?: string } }>(
        `/whatsapp/conversations/${selected.id}/messages`,
      ).then((data) => {
        setMessages(data.messages || []);
        setWindowStatus(data.windowStatus || null);
        void api(`/whatsapp/conversations/${selected.id}/read`, { method: "POST" }).catch(() => {});
      });
    void loadMessages();
    const timer = window.setInterval(loadMessages, 5000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  const contactLabel = (item: WhatsAppConversation) => {
    if (item.student_name) return item.student_name;
    const lead = store.leads.find(
      (row) => String(row.user_id) === String(item.user_id) || String(row.id) === String(item.user_id),
    );
    if (lead) return displayName(lead.first_name, lead.last_name);
    if (item.is_unknown || !item.user_id) return `WhatsApp ${formatPhone(item.phone_number)}`;
    return item.phone_number ? formatPhone(item.phone_number) : "Unknown contact";
  };

  const send = async () => {
    if (!selected?.id || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    const text = draft.trim();
    try {
      const result = await api<{ message: WhatsAppMessage }>("/whatsapp/messages", {
        method: "POST",
        body: { conversationId: selected.id, message: text },
      });
      setMessages((prev) => [...prev, result.message]);
      setDraft("");
      setConversations((prev) =>
        prev.map((item) =>
          item.id === selected.id ? { ...item, last_message: text, is_unknown: false, unread_count: 0 } : item,
        ),
      );
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not send WhatsApp message.");
    } finally {
      setSending(false);
    }
  };

  const unknownCount = conversations.filter((item) => item.is_unknown).length;
  const whatsappReady = status?.credentialsValid && status?.webhookReady;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Icon className={`h-6 w-6 ${copy.accent}`} />
        <div>
          <h1 className="text-2xl font-bold">{copy.title}</h1>
          <p className="text-slate-600">{copy.subtitle}</p>
        </div>
      </div>

      {status && !whatsappReady && (
        <Card className="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">WhatsApp sending is not working on the server.</p>
            <p className="mt-1 text-amber-800">
              {status.credentialError ||
                "Ask admin to set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Railway."}
            </p>
          </div>
        </Card>
      )}

      {loadError && (
        <Card className="mb-4 flex items-start gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load WhatsApp threads</p>
            <p className="mt-1 text-red-800">{loadError}</p>
          </div>
        </Card>
      )}

      {sendError && (
        <Card className="mb-4 flex items-start gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Message could not be sent</p>
            <p className="mt-1 text-red-800">{sendError}</p>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto p-2">
          {loading && conversations.length === 0 && <p className="p-4 text-sm text-slate-500">Loading conversations...</p>}
          {conversations.map((item) => (
            <button
              key={item.id}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm ${selected?.id === item.id ? copy.selectedBg : "hover:bg-slate-50"}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{contactLabel(item)}</p>
                {!!item.unread_count && item.unread_count > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${mode === "lead" ? "bg-sky-600" : "bg-emerald-600"}`}>
                    {item.unread_count}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{formatPhone(item.phone_number)}</p>
              {item.last_message && <p className="mt-1 truncate text-xs text-slate-400">{item.last_message}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                {item.lead_source === "whatsapp" && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">WhatsApp</span>
                )}
                {item.is_unknown && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">New number</span>
                )}
              </div>
            </button>
          ))}
          {!loading && conversations.length === 0 && (
            <div className="space-y-2 p-4 text-sm text-slate-500">
              <p>{copy.emptyTitle}</p>
              <p className="text-xs leading-relaxed">{copy.emptyHint}</p>
              {assignedCount > 0 && (
                <p className="text-xs leading-relaxed text-slate-400">
                  You have {assignedCount} assigned {mode === "lead" ? "lead" : "student"}
                  {assignedCount === 1 ? "" : "s"}
                  {(meta?.withPhone ?? assignedCount) > 0
                    ? " with a phone number — select a thread above once it appears, or refresh if you just got assigned."
                    : " — add a phone number on each lead in My Leads so WhatsApp threads can appear here."}
                  {(meta?.missingPhone ?? 0) > 0 && (
                    <>
                      {" "}
                      {meta?.missingPhone} {meta?.missingPhone === 1 ? "lead is" : "leads are"} missing a phone number.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="flex max-h-[70vh] flex-col p-5">
          {!selected && !loading && <p className="text-sm text-slate-500">Select a conversation.</p>}
          {selected && (
            <>
              <div className="mb-4 border-b border-slate-100 pb-3">
                <p className="font-semibold">{contactLabel(selected)}</p>
                <p className="text-xs text-slate-500">{formatPhone(selected.phone_number)}</p>
                <span className={`mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-medium ${mode === "lead" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {mode === "lead" ? "Lead" : "Student"}
                </span>
                {selected.is_unknown && (
                  <p className="mt-2 text-xs text-amber-700">
                    This number is not linked to a profile yet.
                    {unknownCount > 1 ? ` ${unknownCount} unlinked chats on this page.` : ""}
                  </p>
                )}
                {windowStatus && !windowStatus.open && (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {windowStatus.reason}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {messages.map((item) => {
                  const system = item.channel === "system" || item.kind === "system";
                  if (system) {
                    return (
                      <p key={item.id} className="mb-3 text-center text-[11px] text-slate-500">
                        {item.body}
                      </p>
                    );
                  }
                  const fromContact = item.direction === "inbound";
                  return (
                    <div
                      key={item.id}
                      className={`mb-3 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${fromContact ? "bg-slate-100" : `ml-auto text-white ${copy.bubbleBg}`}`}
                    >
                      <p>{item.body}</p>
                      <div className={`mt-1 flex flex-wrap gap-2 text-[10px] ${fromContact ? "text-slate-400" : "text-white/70"}`}>
                        <span>{item.created_at ? format(new Date(item.created_at), "PP p") : ""}</span>
                        {item.channel && (
                          <span>{item.channel === "app" ? "In-app" : item.channel === "whatsapp_template" ? "Template" : "WhatsApp"}</span>
                        )}
                        {item.delivery_status && (
                          <span className={item.delivery_status.startsWith("failed") ? "font-medium text-red-300" : ""}>
                            {item.delivery_status.startsWith("failed")
                              ? item.delivery_status.replace(/^failed:\s*/i, "")
                              : item.delivery_status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                <input
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Reply on WhatsApp..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void send();
                  }}
                />
                <Button onClick={() => void send()} disabled={sending || !draft.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export function WhatsAppLeadsChat() {
  return <WhatsAppChat mode="lead" />;
}

export function WhatsAppStudentsChat() {
  return <WhatsAppChat mode="student" />;
}

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, MessageCircle, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useLocalStore } from "@/lib/store";
import { displayName } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface WhatsAppConversation {
  id: string;
  user_id: string;
  phone_number: string;
  last_message_at?: string | null;
  student_name?: string | null;
  is_unknown?: boolean;
  last_message?: string | null;
  unread_count?: number;
}

interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel?: string;
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

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return phone || "Unknown";
}

export default function WhatsAppChat() {
  const store = useLocalStore();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    void api<WhatsAppStatus>("/whatsapp/status", { auth: false })
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    const load = () =>
      api<{ conversations: WhatsAppConversation[] }>("/whatsapp/conversations")
        .then((data) => {
          const next = data.conversations || [];
          setConversations(next);
          setSelectedId((current) => current || next[0]?.id || null);
        })
        .catch(() => setConversations([]))
        .finally(() => setLoading(false));
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || conversations[0] || null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      return;
    }
    const loadMessages = () =>
      api<{ messages: WhatsAppMessage[] }>(`/whatsapp/conversations/${selected.id}/messages`).then((data) => {
        setMessages(data.messages || []);
        void api(`/whatsapp/conversations/${selected.id}/read`, { method: "POST" }).catch(() => {});
      });
    void loadMessages();
    const timer = window.setInterval(loadMessages, 5000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  const studentLabel = (item: WhatsAppConversation) => {
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
          item.id === selected.id
            ? { ...item, last_message: text, is_unknown: false, unread_count: 0 }
            : item,
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
        <MessageCircle className="h-6 w-6 text-emerald-500" />
        <div>
          <h1 className="text-2xl font-bold">WhatsApp</h1>
          <p className="text-slate-600">Reply to students on WhatsApp or see their in-app messages here.</p>
        </div>
      </div>

      {status && !whatsappReady && (
        <Card className="mb-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">WhatsApp sending is not working on the server.</p>
            <p className="mt-1 text-amber-800">
              {status.credentialError ||
                "Ask admin to set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Railway (same values as the Meta WhatsApp number that receives student messages)."}
            </p>
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
              className={`w-full rounded-xl px-3 py-2 text-left text-sm ${selected?.id === item.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{studentLabel(item)}</p>
                {!!item.unread_count && item.unread_count > 0 && (
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {item.unread_count}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{formatPhone(item.phone_number)}</p>
              {item.last_message && (
                <p className="mt-1 truncate text-xs text-slate-400">{item.last_message}</p>
              )}
              {item.is_unknown && (
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-600">New number</p>
              )}
            </button>
          ))}
          {!loading && conversations.length === 0 && (
            <div className="space-y-2 p-4 text-sm text-slate-500">
              <p>No WhatsApp threads yet.</p>
              <p className="text-xs leading-relaxed">
                When a student messages your Fly Masters WhatsApp number, the chat appears here — even if they use a
                number not saved on their profile yet.
              </p>
            </div>
          )}
        </Card>

        <Card className="flex max-h-[70vh] flex-col p-5">
          {!selected && !loading && <p className="text-sm text-slate-500">Select a conversation.</p>}
          {selected && (
            <>
              <div className="mb-4 border-b border-slate-100 pb-3">
                <p className="font-semibold">{studentLabel(selected)}</p>
                <p className="text-xs text-slate-500">{formatPhone(selected.phone_number)}</p>
                {selected.is_unknown && (
                  <p className="mt-2 text-xs text-amber-700">
                    This number is not linked to a student profile yet. You can still reply here; ask them to verify
                    WhatsApp in the student portal to link their account.
                    {unknownCount > 1 ? ` ${unknownCount} unlinked chats total.` : ""}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {messages.map((item) => {
                  const fromStudent = item.direction === "inbound";
                  return (
                    <div
                      key={item.id}
                      className={`mb-3 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${fromStudent ? "bg-slate-100" : "ml-auto bg-emerald-600 text-white"}`}
                    >
                      <p>{item.body}</p>
                      <div className={`mt-1 flex flex-wrap gap-2 text-[10px] ${fromStudent ? "text-slate-400" : "text-white/70"}`}>
                        <span>{item.created_at ? format(new Date(item.created_at), "PP p") : ""}</span>
                        {item.channel && <span>{item.channel === "app" ? "In-app" : "WhatsApp"}</span>}
                        {item.delivery_status && (
                          <span className={item.delivery_status.startsWith("failed") ? "text-red-500" : ""}>
                            {item.delivery_status.replace(/^failed:\s*/i, "Failed: ")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet. Waiting for a reply...</p>}
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

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { MessageCircle, Send } from "lucide-react";
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

export default function WhatsAppChat() {
  const store = useLocalStore();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const load = () =>
      api<{ conversations: WhatsAppConversation[] }>("/whatsapp/conversations")
        .then((data) => setConversations(data.conversations || []))
        .catch(() => setConversations([]));
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
    void api<{ messages: WhatsAppMessage[] }>(`/whatsapp/conversations/${selected.id}/messages`).then((data) => {
      setMessages(data.messages || []);
      void api(`/whatsapp/conversations/${selected.id}/read`, { method: "POST" }).catch(() => {});
    });
  }, [selected?.id]);

  const studentLabel = (userId: string) => {
    const lead = store.leads.find((item) => String(item.user_id) === String(userId) || String(item.id) === String(userId));
    return lead ? displayName(lead.first_name, lead.last_name) : userId;
  };

  const send = async () => {
    if (!selected?.id || !draft.trim()) return;
    setSending(true);
    try {
      const result = await api<{ message: WhatsAppMessage }>("/whatsapp/messages", {
        method: "POST",
        body: { conversationId: selected.id, message: draft.trim() },
      });
      setMessages((prev) => [...prev, result.message]);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <MessageCircle className="h-6 w-6 text-emerald-500" />
        <div>
          <h1 className="text-2xl font-bold">WhatsApp</h1>
          <p className="text-slate-600">Reply to students on WhatsApp or see their in-app messages here.</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto p-2">
          {conversations.map((item) => (
            <button
              key={item.id}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm ${selected?.id === item.id ? "bg-emerald-50" : "hover:bg-slate-50"}`}
              onClick={() => setSelectedId(item.id)}
            >
              <p className="font-medium">{studentLabel(item.user_id)}</p>
              <p className="text-xs text-slate-500">{item.phone_number}</p>
            </button>
          ))}
          {conversations.length === 0 && <p className="p-4 text-sm text-slate-500">No WhatsApp threads for your students yet.</p>}
        </Card>
        <Card className="flex max-h-[70vh] flex-col p-5">
          {!selected && <p className="text-sm text-slate-500">Select a conversation.</p>}
          {selected && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {messages.map((item) => {
                  const fromStudent = item.direction === "inbound";
                  return (
                    <div key={item.id} className={`mb-3 max-w-[80%] rounded-2xl px-3 py-2 text-sm ${fromStudent ? "bg-slate-100" : "ml-auto bg-emerald-600 text-white"}`}>
                      <p>{item.body}</p>
                      <div className={`mt-1 flex flex-wrap gap-2 text-[10px] ${fromStudent ? "text-slate-400" : "text-white/70"}`}>
                        <span>{item.created_at ? format(new Date(item.created_at), "PP p") : ""}</span>
                        {item.channel && <span>{item.channel === "app" ? "In-app" : "WhatsApp"}</span>}
                        {item.delivery_status && <span>{item.delivery_status}</span>}
                      </div>
                    </div>
                  );
                })}
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

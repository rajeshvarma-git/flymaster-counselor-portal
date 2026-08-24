import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Clock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ensureConversation, markConversationRead, sendLocalMessage, useLocalStore } from "@/lib/store";
import { displayName } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

function messageTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm");
}

export default function CounselorChat() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [params] = useSearchParams();
  const wantedStudent = params.get("student") || "";
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const mine = store.leads.filter((lead) => lead.assigned_counselor_id === user?.id);
  const conversations = store.conversations
    .filter((item) => item.counselor_id === user?.id)
    .map((item) => {
      const lead = mine.find((row) => row.user_id === item.student_id);
      const thread = store.messages
        .filter((message) => message.conversation_id === item.id)
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
      const last = thread[thread.length - 1];
      return {
        ...item,
        student_name: displayName(lead?.first_name, lead?.last_name, lead?.email || "Student"),
        last_message: last?.message,
        unread_count: thread.filter((message) => message.receiver_id === user?.id && !message.is_read).length,
      };
    })
    .sort((a, b) => (b.last_message_at || "").localeCompare(a.last_message_at || ""));

  useEffect(() => {
    if (!user) return;
    mine.forEach((lead) => ensureConversation(user.id, lead.user_id));
  }, [user?.id, mine.length]);

  useEffect(() => {
    if (wantedStudent) {
      const match = conversations.find((item) => item.student_id === wantedStudent);
      if (match) setActiveId(match.id);
      return;
    }
    if (!activeId && conversations[0]) setActiveId(conversations[0].id);
  }, [conversations, activeId, wantedStudent]);

  useEffect(() => {
    if (activeId && user) markConversationRead(activeId, user.id);
  }, [activeId, user?.id, store.messages.length]);

  const messages = useMemo(
    () =>
      store.messages
        .filter((item) => item.conversation_id === activeId)
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))),
    [store.messages, activeId],
  );
  const active = conversations.find((item) => item.id === activeId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !active || !draft.trim()) return;
    sendLocalMessage({
      conversationId: active.id,
      senderId: user.id,
      receiverId: active.student_id,
      message: draft.trim(),
    });
    setDraft("");
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Student chat</h1>
      <p className="text-slate-600">Same conversation as the student portal Counselor Chat, in order.</p>
      <div className="mt-6 grid min-h-[60vh] overflow-hidden rounded-2xl border bg-white lg:grid-cols-[240px_1fr]">
        <aside className="border-r">
          {conversations.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveId(item.id)}
              className={`block w-full px-4 py-3 text-left text-sm ${activeId === item.id ? "bg-sky-50 font-semibold" : "hover:bg-slate-50"}`}
            >
              {item.student_name}
              <span className="block truncate text-xs font-normal text-slate-500">{item.last_message || "No messages yet"}</span>
              {item.unread_count > 0 && <span className="mt-1 inline-flex rounded-full bg-navy-900 px-1.5 text-[10px] text-white">{item.unread_count}</span>}
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              Open Counselor Chat on the student portal, or add a student in My Leads, to start a chat.
            </p>
          )}
        </aside>
        <div className="flex flex-col">
          {active && (
            <div className="border-b px-4 py-3">
              <p className="font-semibold">{active.student_name}</p>
              <p className="text-xs text-slate-500">Student portal chat</p>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => {
              const mineMsg = message.sender_id === user?.id;
              return (
                <div key={message.id} className={`flex ${mineMsg ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mineMsg ? "bg-navy-900 text-white" : "bg-slate-100"}`}>
                    <p>{message.message}</p>
                    {messageTime(message.created_at) && (
                      <p className={`mt-1 flex items-center gap-1 text-[10px] ${mineMsg ? "text-white/70" : "text-slate-500"}`}>
                        <Clock className="h-3 w-3" />
                        {messageTime(message.created_at)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          {active && (
            <form className="flex gap-2 border-t p-3" onSubmit={send}>
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${active.student_name}`} />
              <Button type="submit">Send</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

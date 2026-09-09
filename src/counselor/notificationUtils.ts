import type { LocalNotification } from "@/lib/store";
import { Bell, FileText, MessageCircle, Phone, Users } from "lucide-react";

export function notificationIcon(note: LocalNotification) {
  if (note.category === "chat" || note.type === "chat") return MessageCircle;
  if (note.category === "document" || String(note.title || "").toLowerCase().includes("document")) return FileText;
  if (String(note.title || "").toLowerCase().includes("lead")) return Phone;
  if (String(note.title || "").toLowerCase().includes("student")) return Users;
  return Bell;
}

export function notificationUrl(note: LocalNotification) {
  if (note.action_url) return note.action_url;
  const title = String(note.title || "").toLowerCase();
  if (note.type === "chat" || title.includes("message")) return "/counselor/chat";
  if (title.includes("document")) return "/counselor/documents";
  if (title.includes("lead")) return "/counselor/leads";
  if (title.includes("student")) return "/counselor/students";
  return "/counselor/notifications";
}

export function notificationTone(note: LocalNotification) {
  if (note.category === "chat" || note.type === "chat") return "border-violet-200 bg-violet-50";
  if (note.category === "document") return "border-emerald-200 bg-emerald-50";
  if (String(note.title || "").toLowerCase().includes("lead")) return "border-orange-200 bg-orange-50";
  return "border-sky-200 bg-sky-50";
}

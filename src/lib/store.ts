import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface LocalLead {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  lead_status: string;
  lead_stage: string;
  lead_source: string;
  priority: string;
  field_of_interest: string;
  academic_score: string;
  preferred_countries: string[];
  notes: string;
  next_follow_up_date: string | null;
  last_contact_date: string | null;
  conversion_date: string | null;
  created_at: string;
  assigned_counselor_id: string | null;
  entity_type: string;
}

export interface LocalConversation {
  id: string;
  student_id: string;
  counselor_id: string;
  last_message_at: string | null;
}

export interface LocalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface LocalNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface LocalDocument {
  id: string;
  user_id: string;
  document_type: string;
  file_name: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  status: string;
  archived: boolean;
  admin_comments?: string;
  reviewed_at?: string | null;
  created_at: string;
}

export interface LocalApplication {
  id: string;
  user_id: string;
  university_name: string;
  course_name: string;
  country: string;
  city: string;
  intake_term: string;
  priority_level: string;
  status: string;
  notes: string;
  counselor_comments: string;
  created_at: string;
}

export interface LocalShortlist {
  id: string;
  student_id: string;
  student_email?: string;
  counselor_id: string;
  university_name: string;
  course_name: string;
  location: string;
  counselor_notes: string;
  created_at: string;
}

export interface LocalLeave {
  id: string;
  counselor_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  total_days: number;
  status: string;
}

export interface LocalAttendance {
  id: string;
  counselor_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  status: string;
}

export interface LocalSalary {
  id: string;
  counselor_id: string;
  month: string;
  year: number;
  net_salary: number;
  notes: string;
}

export interface CounselorExtra {
  user_id: string;
  bio: string;
  specializations: string[];
  phone: string;
}

interface AppStore {
  leads: LocalLead[];
  conversations: LocalConversation[];
  messages: LocalMessage[];
  notifications: LocalNotification[];
  documents: LocalDocument[];
  applications: LocalApplication[];
  shortlists: LocalShortlist[];
  leave: LocalLeave[];
  attendance: LocalAttendance[];
  salary: LocalSalary[];
  counselorExtras: CounselorExtra[];
}

const listeners = new Set<() => void>();
let cache: AppStore = {
  leads: [],
  conversations: [],
  messages: [],
  notifications: [],
  documents: [],
  applications: [],
  shortlists: [],
  leave: [],
  attendance: [],
  salary: [],
  counselorExtras: [],
};

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getStore() {
  return cache;
}

export async function refreshStore() {
  try {
    cache = await api<AppStore>("/state");
    emit();
  } catch {
    emit();
  }
}

export async function addLead(input: {
  counselorId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  field?: string;
  countries?: string;
}) {
  await api("/leads", { method: "POST", body: input });
  await refreshStore();
}

export async function updateLead(id: string, update: Partial<LocalLead>) {
  await api(`/leads/${id}`, { method: "PATCH", body: update });
  await refreshStore();
}

export async function claimLead(id: string, _counselorId: string) {
  await api(`/leads/${id}/claim`, { method: "POST" });
  await refreshStore();
}

export async function saveCounselorExtra(extra: CounselorExtra) {
  await api("/profile", {
    method: "PUT",
    body: {
      bio: extra.bio,
      specializations: extra.specializations,
      phone: extra.phone,
    },
  });
  await refreshStore();
}

export async function markNotificationsRead(_userId: string) {
  await api("/notifications/read", { method: "POST" });
  await refreshStore();
}

export async function addLeave(row: Omit<LocalLeave, "id">) {
  await api("/leave", { method: "POST", body: row });
  await refreshStore();
}

export async function addAttendance(row: Omit<LocalAttendance, "id">) {
  await api("/attendance", { method: "POST", body: row });
  await refreshStore();
}

export async function updateAttendance(id: string, update: Partial<LocalAttendance>) {
  await api(`/attendance/${id}`, { method: "PATCH", body: update });
  await refreshStore();
}

export async function addShortlist(row: Omit<LocalShortlist, "id" | "created_at">) {
  await api("/shortlists", { method: "POST", body: row });
  try {
    await refreshStore();
  } catch {
    emit();
  }
}

export async function setDocumentStatus(id: string, status: string, comments?: string) {
  await api(`/documents/${id}`, { method: "PATCH", body: { status, comments } });
  await refreshStore();
}

export async function fetchDocumentFile(id: string) {
  return api<{ fileName: string; dataUrl: string }>(`/documents/${id}/file`);
}

export async function setApplicationStatus(id: string, status: string, comments?: string) {
  await api(`/applications/${id}`, { method: "PATCH", body: { status, comments } });
  await refreshStore();
}

export async function ensureConversation(_counselorId: string, studentId: string) {
  const row = await api<LocalConversation>("/conversations", { method: "POST", body: { studentId } });
  await refreshStore();
  return row;
}

export async function sendLocalMessage(input: {
  conversationId: string;
  senderId: string;
  receiverId: string;
  message: string;
}) {
  await api("/messages", {
    method: "POST",
    body: {
      conversationId: input.conversationId,
      receiverId: input.receiverId,
      message: input.message,
    },
  });
  await refreshStore();
}

export async function markConversationRead(conversationId: string, _receiverId: string) {
  await api(`/conversations/${conversationId}/read`, { method: "POST" });
  await refreshStore();
}

export function useLocalStore() {
  const [data, setData] = useState(getStore);
  useEffect(() => {
    void refreshStore();
    const unsub = subscribeStore(() => setData({ ...getStore() }));
    const poll = window.setInterval(() => {
      void refreshStore();
    }, 4000);
    return () => {
      unsub();
      window.clearInterval(poll);
    };
  }, []);
  return data;
}

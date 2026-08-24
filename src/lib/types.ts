export type Role = "student" | "counselor" | "admin" | "super_admin";
export type LeadStatus = "cold" | "warm" | "hot" | "converted";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type DocumentStatus = "requested" | "uploaded" | "approved" | "rejected";

export interface User {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  createdAt: string;
}

export interface CounselorProfile {
  userId: string;
  active: boolean;
  specializations: string[];
  bio: string;
}

export interface StudentLead {
  id: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  qualification: string;
  field: string;
  score: string;
  budget: string;
  leadStatus: LeadStatus;
  assignedCounselorId?: string;
  leadSource: "ai_chat" | "signup" | "manual";
  notes: string;
  nextFollowUp?: string;
  lastContactAt?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  answers: Record<string, string>;
  messages: ChatMessage[];
  complete: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  studentId: string;
  counselorId: string;
  createdAt: string;
}

export interface PrivateMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt: string;
}

export interface ShortlistItem {
  id: string;
  leadId: string;
  counselorId: string;
  universityName: string;
  course: string;
  country: string;
  notes: string;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  counselorId: string;
  from: string;
  to: string;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
}

export interface AttendanceDay {
  id: string;
  counselorId: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
}

export interface SalaryRecord {
  id: string;
  counselorId: string;
  month: string;
  amount: number;
  note: string;
  postedAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface StudentDocument {
  id: string;
  leadId: string;
  name: string;
  status: DocumentStatus;
  updatedAt: string;
}

export interface AppState {
  users: User[];
  counselors: CounselorProfile[];
  leads: StudentLead[];
  chatSessions: ChatSession[];
  conversations: Conversation[];
  messages: PrivateMessage[];
  shortlists: ShortlistItem[];
  leave: LeaveRequest[];
  attendance: AttendanceDay[];
  salary: SalaryRecord[];
  notifications: AppNotification[];
  documents: StudentDocument[];
  sessionUserId: string | null;
  shiftStartedAt: Record<string, string>;
}

export interface University {
  id: string;
  name: string;
  country: string;
  city: string;
  ranking: string;
  tuition: string;
  programs: string[];
  duration: string;
  language: string;
  visa: string;
}

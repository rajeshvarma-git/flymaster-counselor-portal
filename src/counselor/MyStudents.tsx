import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  Calendar,
  FileText,
  GraduationCap,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Target,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ensureConversation, useLocalStore } from "@/lib/store";
import { displayName, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";

function isManagedStudent(lead: { entity_type: string; lead_status: string; lead_stage: string; lead_source?: string }) {
  return (
    lead.entity_type === "student" ||
    lead.lead_status === "converted" ||
    lead.lead_stage === "converted" ||
    lead.lead_source === "student_site" ||
    lead.lead_source === "student_chat"
  );
}

function joinedOn(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy");
}

export default function MyStudents() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const students = useMemo(() => {
    const seen = new Set<string>();
    return store.leads.filter((lead) => {
      if (lead.assigned_counselor_id !== user?.id || !isManagedStudent(lead)) return false;
      const key = lead.user_id
        ? `u:${lead.user_id}`
        : `e:${(lead.email || "").trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [store.leads, user?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((student) =>
      `${student.first_name} ${student.last_name} ${student.email} ${student.phone} ${student.field_of_interest} ${student.preferred_countries.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [students, query]);

  const selected = students.find((student) => student.id === selectedId) || null;
  const selectedDocs = selected
    ? store.documents.filter((doc) => doc.user_id === selected.user_id && !doc.archived)
    : [];
  const selectedShortlists = selected
    ? store.shortlists.filter((item) => item.student_id === selected.user_id)
    : [];
  const selectedMessages = selected
    ? store.messages.filter((message) => {
        const conversation = store.conversations.find((item) => item.id === message.conversation_id);
        return conversation?.student_id === selected.user_id;
      })
    : [];

  const openChat = async (studentId: string) => {
    if (!user) return;
    await ensureConversation(user.id, studentId);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-sky-500" />
          <div>
            <h1 className="text-2xl font-bold">My Students ({students.length})</h1>
            <p className="text-slate-600">Students from the student portal and converted leads you manage</p>
          </div>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4">
        {filtered.map((student) => {
          const docs = store.documents.filter((doc) => doc.user_id === student.user_id && !doc.archived).length;
          const lists = store.shortlists.filter((item) => item.student_id === student.user_id).length;
          const badge = student.lead_status === "converted" || student.entity_type === "student" ? "enrolled" : student.lead_status;
          return (
            <Card key={student.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-semibold text-sky-700">
                    {initials(student.first_name, student.last_name, student.email)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">{displayName(student.first_name, student.last_name, student.email)}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{student.email || "No email"}</span>
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{student.phone || "No phone"}</span>
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined {joinedOn(student.created_at)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      {student.field_of_interest && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                          <GraduationCap className="h-3 w-3" />{student.field_of_interest}
                        </span>
                      )}
                      {student.preferred_countries.map((country) => (
                        <span key={country} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                          <Target className="h-3 w-3" />{country}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                        <FileText className="h-3 w-3" />{docs} documents
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                        <Target className="h-3 w-3" />{lists} shortlists
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge value={badge} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setSelectedId(student.id)}>View profile</Button>
                    <Link to={`/counselor/chat?student=${encodeURIComponent(student.user_id)}`} onClick={() => void openChat(student.user_id)}>
                      <Button size="sm"><MessageCircle className="h-4 w-4" />Chat</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="p-12 text-center">
            <Users className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-semibold">{query ? "No matching students" : "No students assigned yet"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {query
                ? "Try a different name or email."
                : "Students appear here when they sign in on the student portal, or when you convert a lead in My Leads."}
            </p>
          </Card>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{displayName(selected.first_name, selected.last_name, selected.email)}</h2>
                <p className="text-sm text-slate-500">Student profile and progress</p>
              </div>
              <Badge value={selected.lead_status === "converted" || selected.entity_type === "student" ? "enrolled" : selected.lead_status} />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Email</p>
                <p className="text-sm">{selected.email || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Phone</p>
                <p className="text-sm">{selected.phone || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Joined</p>
                <p className="text-sm">{joinedOn(selected.created_at)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Academic score</p>
                <p className="text-sm">{selected.academic_score || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Field of interest</p>
                <p className="text-sm">{selected.field_of_interest || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Preferred countries</p>
                <p className="text-sm">{selected.preferred_countries.join(", ") || "—"}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Card className="p-4 text-center">
                <FileText className="mx-auto mb-1 h-5 w-5 text-sky-500" />
                <p className="text-2xl font-bold">{selectedDocs.length}</p>
                <p className="text-xs text-slate-500">Documents</p>
              </Card>
              <Card className="p-4 text-center">
                <GraduationCap className="mx-auto mb-1 h-5 w-5 text-sky-500" />
                <p className="text-2xl font-bold">{selectedShortlists.length}</p>
                <p className="text-xs text-slate-500">Shortlists</p>
              </Card>
              <Card className="p-4 text-center">
                <MessageCircle className="mx-auto mb-1 h-5 w-5 text-sky-500" />
                <p className="text-2xl font-bold">{selectedMessages.length}</p>
                <p className="text-xs text-slate-500">Messages</p>
              </Card>
            </div>

            {selectedShortlists.length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-semibold">University shortlists</p>
                <div className="mt-2 space-y-2">
                  {selectedShortlists.map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <p className="font-medium">{item.university_name}</p>
                      <p className="text-slate-500">{item.course_name} · {item.location}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedId(null)}>Close</Button>
              <Link to={`/counselor/documents`}>
                <Button variant="secondary">Documents</Button>
              </Link>
              <Link to={`/counselor/chat?student=${encodeURIComponent(selected.user_id)}`} onClick={() => void openChat(selected.user_id)}>
                <Button>Open chat</Button>
              </Link>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

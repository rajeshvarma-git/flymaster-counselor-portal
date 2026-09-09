import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  Calendar,
  ClipboardList,
  FileText,
  GraduationCap,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Send,
  Target,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ensureConversation, fetchStudentChecklist, requestStudentDocuments, useLocalStore } from "@/lib/store";
import { displayName, initials, isConvertedStudent } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";

function joinedOn(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy");
}

function canRequestDocument(status: string) {
  return status === "requested" || status === "rejected";
}

export default function MyStudents() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Awaited<ReturnType<typeof fetchStudentChecklist>> | null>(null);
  const [requestingType, setRequestingType] = useState<string | null>(null);
  const [requestingAll, setRequestingAll] = useState(false);
  const [requestNotice, setRequestNotice] = useState("");

  const students = useMemo(() => {
    const seen = new Set<string>();
    return store.leads.filter((lead) => {
      if (lead.assigned_counselor_id !== user?.id || !isConvertedStudent(lead)) return false;
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

  useEffect(() => {
    if (!selected) {
      setChecklist(null);
      setRequestNotice("");
      return;
    }
    void fetchStudentChecklist(selected.user_id || selected.id)
      .then(setChecklist)
      .catch(() => setChecklist(null));
  }, [selected?.id, selected?.user_id]);

  const refreshChecklist = async () => {
    if (!selected) return;
    const next = await fetchStudentChecklist(selected.user_id || selected.id);
    setChecklist(next);
  };

  const sendDocumentRequest = async (documentTypes: string[], mode: "single" | "all" = "single") => {
    if (!selected || documentTypes.length === 0) return;
    if (mode === "all") setRequestingAll(true);
    else setRequestingType(documentTypes[0]);
    setRequestNotice("");
    try {
      const result = await requestStudentDocuments(selected.user_id || selected.id, documentTypes);
      const count = result.requests.length;
      setRequestNotice(
        count === 1
          ? `Request sent for ${result.requests[0].document_type}.`
          : `Requests sent for ${count} documents.`,
      );
      await refreshChecklist();
    } catch (error) {
      setRequestNotice(error instanceof Error ? error.message : "Could not send document request.");
    } finally {
      setRequestingType(null);
      setRequestingAll(false);
    }
  };

  const pendingRequestItems = checklist?.items.filter((item) => canRequestDocument(item.status)) || [];
  const unsentRequestItems = pendingRequestItems.filter((item) => !item.request_sent);
  const reminderRequestItems = pendingRequestItems.filter((item) => item.request_sent);

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
                    <button
                      type="button"
                      className="text-left text-lg font-semibold text-slate-900 transition hover:text-sky-700 hover:underline"
                      onClick={() => setSelectedId(student.id)}
                    >
                      {displayName(student.first_name, student.last_name, student.email)}
                    </button>
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

            {checklist && (
              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-sky-500" />
                    <p className="text-sm font-semibold">Document checklist</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {unsentRequestItems.length > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={requestingAll || Boolean(requestingType)}
                        onClick={() => void sendDocumentRequest(unsentRequestItems.map((item) => item.document_type), "all")}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {requestingAll ? "Sending..." : `Request all missing (${unsentRequestItems.length})`}
                      </Button>
                    )}
                    {unsentRequestItems.length === 0 && reminderRequestItems.length > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={requestingAll || Boolean(requestingType)}
                        onClick={() => void sendDocumentRequest(reminderRequestItems.map((item) => item.document_type), "all")}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {requestingAll ? "Sending..." : "Send reminder"}
                      </Button>
                    )}
                    <Badge
                      value={checklist.complete ? "approved" : checklist.required_approved > 0 ? "uploaded" : "requested"}
                      className="normal-case"
                    >
                      {checklist.required_approved} of {checklist.required_total} required approved
                    </Badge>
                  </div>
                </div>
                <p className="mb-2 text-xs text-slate-500">
                  Based on {checklist.countries.join(", ") || "no preferred country yet"}
                  {checklist.degree ? ` · ${checklist.degree}` : ""}
                </p>
                {requestNotice && (
                  <p className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">{requestNotice}</p>
                )}
                <div className="space-y-2">
                  {checklist.items.map((item) => {
                    const showRequest = canRequestDocument(item.status);
                    const busy = requestingType === item.document_type;
                    return (
                      <div key={item.document_type} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{item.document_type}</p>
                          {item.description ? <p className="text-slate-500">{item.description}</p> : null}
                          {item.file_name ? <p className="text-xs text-slate-400">{item.file_name}</p> : null}
                          {item.request_sent && item.request_sent_at ? (
                            <p className="mt-1 text-xs text-sky-700">
                              Request sent {joinedOn(item.request_sent_at)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge value={item.status === "approved" ? "approved" : item.status === "rejected" ? "rejected" : item.status === "requested" ? "requested" : "uploaded"} />
                          {showRequest && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy || requestingAll}
                              onClick={() => void sendDocumentRequest([item.document_type])}
                            >
                              <Send className="h-3.5 w-3.5" />
                              {busy ? "Sending..." : item.request_sent ? "Send reminder" : "Send request"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {checklist.items.length === 0 && (
                    <p className="text-sm text-slate-500">
                      No checklist items match this student yet. Ask an admin to add document types under Catalog → Document lists.
                    </p>
                  )}
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

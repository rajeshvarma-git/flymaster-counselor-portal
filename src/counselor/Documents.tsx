import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { ClipboardList, Download, FileText, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { displayName } from "@/lib/utils";
import { fetchDocumentFile, setDocumentStatus, useLocalStore } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "uploaded", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

function isPending(status: string) {
  return status === "uploaded" || status === "pending";
}

function displayStatus(status: string) {
  if (isPending(status)) return "needs review";
  return status;
}

export default function Documents() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("uploaded");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);

  const students = store.leads.filter((lead) => lead.assigned_counselor_id === user?.id);
  const studentIds = new Set([
    ...students.map((lead) => lead.user_id),
    ...store.conversations.filter((item) => item.counselor_id === user?.id).map((item) => item.student_id),
  ]);
  const names: Record<string, string> = {};
  students.forEach((lead) => {
    names[lead.user_id] = displayName(lead.first_name, lead.last_name, lead.email);
  });

  const docs = store.documents.filter((doc) => studentIds.has(doc.user_id) && !doc.archived);
  const pendingCount = docs.filter((doc) => isPending(doc.status)).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((doc) => studentId === "all" || doc.user_id === studentId)
      .filter((doc) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "uploaded") return isPending(doc.status);
        return doc.status === statusFilter;
      })
      .filter((doc) =>
        `${names[doc.user_id] || ""} ${doc.document_type} ${doc.file_name}`.toLowerCase().includes(q),
      )
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [docs, studentId, statusFilter, query, names]);

  const reviewDoc = docs.find((doc) => doc.id === reviewId) || null;

  const openFile = async (id: string) => {
    try {
      const file = await fetchDocumentFile(id);
      const link = document.createElement("a");
      link.href = file.dataUrl;
      link.download = file.fileName || "document";
      link.target = "_blank";
      link.click();
    } catch {
      window.alert("Could not open this file.");
    }
  };

  const decide = async (status: "approved" | "rejected") => {
    if (!reviewDoc) return;
    setBusy(true);
    try {
      await setDocumentStatus(reviewDoc.id, status, comments.trim());
      setReviewId(null);
      setComments("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-slate-600">Files students upload are sent here. Review, then approve or reject.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Link to="/counselor/documents/setup">
            <Button variant="secondary">
              <ClipboardList className="h-4 w-4" /> Set up
            </Button>
          </Link>
          <div className="relative w-full max-w-xs sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search student or file" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={statusFilter === item.id ? "primary" : "secondary"}
            onClick={() => setStatusFilter(item.id)}
          >
            {item.label}
            {item.id === "uploaded" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Button>
        ))}
      </div>

      <div className="mb-4 max-w-xs">
        <Label>Student</Label>
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="all">All students</option>
          {students.map((lead) => (
            <option key={lead.user_id} value={lead.user_id}>
              {displayName(lead.first_name, lead.last_name, lead.email)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-3">
        {filtered.map((doc) => (
          <Card key={doc.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{doc.document_type}</p>
                <p className="text-sm text-slate-600">{names[doc.user_id] || "Student"} · {doc.file_name}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {doc.created_at && !Number.isNaN(new Date(doc.created_at).getTime())
                    ? `Submitted ${format(new Date(doc.created_at), "MMM d, yyyy HH:mm")}`
                    : "Submitted"}
                </p>
                {doc.admin_comments && (
                  <p className="mt-2 text-sm text-slate-500">Note: {doc.admin_comments}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={displayStatus(doc.status)} />
                <Button size="sm" variant="secondary" onClick={() => void openFile(doc.id)}>
                  <Download className="h-4 w-4" /> View
                </Button>
                {isPending(doc.status) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReviewId(doc.id);
                      setComments(doc.admin_comments || "");
                    }}
                  >
                    Review
                  </Button>
                )}
                {doc.status === "rejected" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setReviewId(doc.id);
                      setComments(doc.admin_comments || "");
                    }}
                  >
                    Review again
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card className="p-12 text-center">
            <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-semibold">{docs.length === 0 ? "No student documents yet" : "No files match this filter"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {docs.length === 0
                ? "Set up required document types first, then ask students to upload at Student Portal → Documents."
                : "Try All, or pick a different student."}
            </p>
            {docs.length === 0 && (
              <Link to="/counselor/documents/setup" className="mt-4 inline-block">
                <Button>
                  <ClipboardList className="h-4 w-4" /> Set up documents
                </Button>
              </Link>
            )}
          </Card>
        )}
      </div>

      {reviewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg p-6">
            <h2 className="text-lg font-bold">Review {reviewDoc.document_type}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {names[reviewDoc.user_id] || "Student"} · {reviewDoc.file_name}
            </p>
            <div className="mt-4">
              <Label>Counselor note (shown to the student)</Label>
              <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional comment, especially if you reject the file" />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setReviewId(null)}>Cancel</Button>
              <Button variant="secondary" onClick={() => void openFile(reviewDoc.id)}>View file</Button>
              <Button variant="danger" disabled={busy} onClick={() => void decide("rejected")}>Reject</Button>
              <Button disabled={busy} onClick={() => void decide("approved")}>Approve</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

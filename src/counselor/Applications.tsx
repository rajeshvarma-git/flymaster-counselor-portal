import { useMemo, useState } from "react";
import { format } from "date-fns";
import { BookOpen, GraduationCap, MapPin, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { displayName } from "@/lib/utils";
import { setApplicationStatus, useLocalStore } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

const FILTERS = [
  { id: "needs_review", label: "Needs review" },
  { id: "all", label: "All" },
  { id: "counselor_approved", label: "Approved" },
  { id: "returned", label: "Returned" },
];

function needsReview(status: string) {
  return status === "pending_counselor" || status === "submitted";
}

function displayStatus(status: string) {
  if (needsReview(status)) return "needs review";
  if (status === "counselor_approved") return "approved";
  if (status === "returned") return "returned";
  return status.replaceAll("_", " ");
}

export default function Applications() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("needs_review");
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

  const apps = (store.applications || []).filter((app) => studentIds.has(app.user_id));
  const pendingCount = apps.filter((app) => needsReview(app.status)).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps
      .filter((app) => studentId === "all" || app.user_id === studentId)
      .filter((app) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "needs_review") return needsReview(app.status);
        return app.status === statusFilter;
      })
      .filter((app) =>
        `${names[app.user_id] || ""} ${app.university_name} ${app.course_name}`.toLowerCase().includes(q),
      )
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [apps, studentId, statusFilter, query, names]);

  const reviewApp = apps.find((app) => app.id === reviewId) || null;

  const decide = async (status: "counselor_approved" | "returned") => {
    if (!reviewApp) return;
    setBusy(true);
    try {
      await setApplicationStatus(reviewApp.id, status, comments.trim());
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
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-slate-600">Students send applications here. Approve or return them — they are not sent to universities from the student portal.</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search student or university" value={query} onChange={(e) => setQuery(e.target.value)} />
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
            {item.id === "needs_review" && pendingCount > 0 ? ` (${pendingCount})` : ""}
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
        {filtered.map((app) => (
          <Card key={app.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{app.university_name || "University"}</p>
                <p className="text-sm text-slate-600">{names[app.user_id] || "Student"}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                  <GraduationCap className="h-3.5 w-3.5" />
                  {app.course_name || "Course not set"}
                </p>
                {(app.city || app.country) && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                    <MapPin className="h-3 w-3" />
                    {[app.city, app.country].filter(Boolean).join(", ")}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  {app.intake_term || "Intake not set"}
                  {app.created_at && !Number.isNaN(new Date(app.created_at).getTime())
                    ? ` · Started ${format(new Date(app.created_at), "MMM d, yyyy")}`
                    : ""}
                </p>
                {app.notes && <p className="mt-2 text-sm text-slate-500">Student note: {app.notes}</p>}
                {app.counselor_comments && <p className="mt-1 text-sm text-slate-500">Your note: {app.counselor_comments}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={displayStatus(app.status)} />
                <Badge value={`${app.priority_level || "medium"} priority`} />
                {needsReview(app.status) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReviewId(app.id);
                      setComments(app.counselor_comments || "");
                    }}
                  >
                    Review
                  </Button>
                )}
                {app.status === "returned" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setReviewId(app.id);
                      setComments(app.counselor_comments || "");
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
            <BookOpen className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-semibold">{apps.length === 0 ? "No applications yet" : "No applications match this filter"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {apps.length === 0
                ? "When a student clicks Send to counselor on My Applications, it appears here. It is not sent to the university."
                : "Try All, or pick a different student."}
            </p>
          </Card>
        )}
      </div>

      {reviewApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg p-6">
            <h2 className="text-lg font-bold">Review {reviewApp.university_name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {names[reviewApp.user_id] || "Student"} · {reviewApp.course_name || "Course"}
            </p>
            <p className="mt-3 text-sm text-slate-600">Approving confirms the file with you. It does not send the application to the university.</p>
            <div className="mt-4">
              <Label>Note to student</Label>
              <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional comment, especially if you return it" />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setReviewId(null)}>Cancel</Button>
              <Button variant="danger" disabled={busy} onClick={() => void decide("returned")}>Return to student</Button>
              <Button disabled={busy} onClick={() => void decide("counselor_approved")}>Approve</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

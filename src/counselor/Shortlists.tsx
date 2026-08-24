import { FormEvent, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { addShortlist, useLocalStore } from "@/lib/store";
import { UNIVERSITIES } from "@/lib/universities";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

export default function Shortlists() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [universityName, setUniversityName] = useState(UNIVERSITIES[0]?.name || "");

  const leads = store.leads.filter((lead) => lead.assigned_counselor_id === user?.id);
  const students = useMemo(
    () =>
      [...leads].sort((a, b) => {
        const aPortal = a.entity_type === "student" || a.lead_source === "student_site" ? 0 : 1;
        const bPortal = b.entity_type === "student" || b.lead_source === "student_site" ? 0 : 1;
        return aPortal - bPortal;
      }),
    [leads],
  );
  const items = store.shortlists.filter((item) => item.counselor_id === user?.id);
  const selectedUniversity = UNIVERSITIES.find((university) => university.name === universityName);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setError("");
    setSaving(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const studentId = String(data.get("studentId"));
    const selected = students.find((lead) => String(lead.user_id) === studentId || String(lead.id) === studentId);
    try {
      await addShortlist({
        student_id: String(selected?.user_id || selected?.id || studentId),
        student_email: selected?.email || "",
        counselor_id: user.id,
        university_name: universityName,
        course_name: String(data.get("course")),
        location: String(data.get("country") || [selectedUniversity?.city, selectedUniversity?.country].filter(Boolean).join(", ")),
        counselor_notes: String(data.get("notes") || ""),
      });
      form.reset();
      setUniversityName(UNIVERSITIES[0]?.name || "");
    } catch (err: any) {
      setError(err?.message || "Could not add this university to the shortlist.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h1 className="text-2xl font-bold">University shortlist</h1>
        <p className="text-slate-600">Propose universities to an assigned student. They will see this on My Shortlists.</p>
        <Card className="mt-4 p-5">
          {students.length === 0 ? (
            <p className="text-sm text-slate-600">
              No assigned students yet. Open My Students or wait for a student portal signup to appear, then try again.
            </p>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <div>
                <Label>Student</Label>
                <Select name="studentId" required>
                  <option value="">Select a student portal account</option>
                  {students.map((lead) => (
                    <option key={`${lead.user_id || lead.id}-${lead.email || ""}`} value={lead.user_id || lead.id}>
                      {lead.first_name} {lead.last_name}
                      {lead.email ? ` · ${lead.email}` : ""}
                      {lead.entity_type === "student" || lead.lead_source === "student_site" ? " (Student portal)" : " (Lead)"}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>University</Label>
                <Select
                  name="universityName"
                  required
                  value={universityName}
                  onChange={(event) => setUniversityName(event.target.value)}
                >
                  {UNIVERSITIES.map((university) => (
                    <option key={university.id} value={university.name}>
                      {university.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Country / location</Label>
                <Input
                  name="country"
                  required
                  key={universityName}
                  defaultValue={[selectedUniversity?.city, selectedUniversity?.country].filter(Boolean).join(", ")}
                />
              </div>
              <div>
                <Label>Course</Label>
                <Input name="course" required placeholder="e.g. Data Science" />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea name="notes" placeholder="Why this university fits the student" />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Add to shortlist"}
              </Button>
            </form>
          )}
        </Card>
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sent to students</h2>
        {items.length === 0 ? (
          <Card className="p-4 text-sm text-slate-600">
            No shortlists yet. Add a university on the left and it will appear here and in the student portal.
          </Card>
        ) : (
          items.map((item) => {
            const lead = store.leads.find(
              (row) =>
                row.user_id === item.student_id ||
                row.id === item.student_id ||
                (item.student_email && row.email && row.email.toLowerCase() === String(item.student_email).toLowerCase()),
            );
            return (
              <Card key={item.id} className="p-4">
                <p className="font-semibold">{item.university_name}</p>
                <p className="text-sm">{[item.course_name, item.location].filter(Boolean).join(" · ")}</p>
                <p className="text-xs text-slate-500">
                  For {lead ? `${lead.first_name} ${lead.last_name}` : "student"}
                  {lead?.email ? ` · ${lead.email}` : ""}
                </p>
                {item.counselor_notes ? <p className="mt-2 text-sm text-slate-600">{item.counselor_notes}</p> : null}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

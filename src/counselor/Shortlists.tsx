import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { addShortlist, useLocalStore } from "@/lib/store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

interface CatalogCountry {
  name: string;
  university_count: number;
  program_count: number;
}

interface CatalogUniversity {
  name: string;
  location: string;
  program_count: number;
}

interface CatalogDegree {
  name: string;
  program_count: number;
}

interface CatalogProgram {
  id: string;
  university_name: string;
  program_name: string;
  course?: string;
  specialization?: string;
  country?: string;
  location?: string;
  city?: string;
  degree?: string;
}

const PAGE_SIZE = 20;

export default function Shortlists() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");

  const [countries, setCountries] = useState<CatalogCountry[]>([]);
  const [universities, setUniversities] = useState<CatalogUniversity[]>([]);
  const [degrees, setDegrees] = useState<CatalogDegree[]>([]);
  const [programs, setPrograms] = useState<{ rows: CatalogProgram[]; total: number }>({ rows: [], total: 0 });

  const [country, setCountry] = useState("");
  const [university, setUniversity] = useState("");
  const [degree, setDegree] = useState("");
  const [programId, setProgramId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

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
  const selectedProgram = programs.rows.find((row) => row.id === programId) || null;

  useEffect(() => {
    void api<CatalogCountry[]>("/university-catalog/countries")
      .then(setCountries)
      .catch((err: Error) => setCatalogError(err.message));
  }, []);

  useEffect(() => {
    if (!country) {
      setUniversities([]);
      return;
    }
    void api<CatalogUniversity[]>(`/university-catalog/universities?country=${encodeURIComponent(country)}`)
      .then(setUniversities)
      .catch((err: Error) => setCatalogError(err.message));
  }, [country]);

  useEffect(() => {
    if (!country || !university) {
      setDegrees([]);
      return;
    }
    const params = new URLSearchParams({ country, university });
    void api<CatalogDegree[]>(`/university-catalog/degrees?${params.toString()}`)
      .then(setDegrees)
      .catch((err: Error) => setCatalogError(err.message));
  }, [country, university]);

  useEffect(() => {
    if (!country || !university || !degree) {
      setPrograms({ rows: [], total: 0 });
      return;
    }
    const params = new URLSearchParams({
      country,
      university,
      degree,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (query.trim()) params.set("q", query.trim());
    void api<{ rows: CatalogProgram[]; total: number }>(`/university-programs?${params.toString()}`)
      .then((result) => {
        setPrograms(result);
        if (programId && !result.rows.some((row) => row.id === programId)) {
          setProgramId("");
        }
      })
      .catch((err: Error) => setCatalogError(err.message));
  }, [country, university, degree, query, page, programId]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !selectedProgram) return;
    setError("");
    setSaving(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const studentId = String(data.get("studentId"));
    const selected = students.find((lead) => String(lead.user_id) === studentId || String(lead.id) === studentId);
    const courseName =
      [selectedProgram.program_name, selectedProgram.course, selectedProgram.specialization].filter(Boolean).join(" · ") ||
      String(data.get("course") || "");
    const location =
      selectedProgram.location ||
      [selectedProgram.city, selectedProgram.country || country].filter(Boolean).join(", ");
    try {
      await addShortlist({
        student_id: String(selected?.user_id || selected?.id || studentId),
        student_email: selected?.email || "",
        counselor_id: user.id,
        university_name: selectedProgram.university_name || university,
        course_name: courseName,
        location,
        counselor_notes: String(data.get("notes") || ""),
        university_id: selectedProgram.id,
      });
      form.reset();
      setCountry("");
      setUniversity("");
      setDegree("");
      setProgramId("");
      setQuery("");
      setPage(0);
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
        <p className="text-slate-600">
          Browse the admin university catalog, then propose programs to an assigned student.
        </p>
        {catalogError ? (
          <Card className="mt-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{catalogError}</Card>
        ) : null}
        <Card className="mt-4 p-5">
          {students.length === 0 ? (
            <p className="text-sm text-slate-600">
              No assigned students yet. Open My Students or wait for a student portal signup to appear, then try again.
            </p>
          ) : countries.length === 0 ? (
            <p className="text-sm text-slate-600">
              No universities in the catalog yet. Ask an admin to upload CSV files under Admin → Universities.
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
                <Label>Country</Label>
                <Select
                  required
                  value={country}
                  onChange={(event) => {
                    setCountry(event.target.value);
                    setUniversity("");
                    setDegree("");
                    setProgramId("");
                    setPage(0);
                  }}
                >
                  <option value="">Choose a country</option>
                  {countries.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} ({item.university_count} universities)
                    </option>
                  ))}
                </Select>
              </div>
              {country ? (
                <div>
                  <Label>University</Label>
                  <Select
                    required
                    value={university}
                    onChange={(event) => {
                      setUniversity(event.target.value);
                      setDegree("");
                      setProgramId("");
                      setPage(0);
                    }}
                  >
                    <option value="">Choose a university</option>
                    {universities.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.program_count} programs)
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {university ? (
                <div>
                  <Label>Degree type</Label>
                  <Select
                    required
                    value={degree}
                    onChange={(event) => {
                      setDegree(event.target.value);
                      setProgramId("");
                      setPage(0);
                    }}
                  >
                    <option value="">Choose a degree type</option>
                    {degrees.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.program_count} programs)
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {degree ? (
                <>
                  <div>
                    <Label>Search programs</Label>
                    <Input
                      placeholder="Filter by course or specialization..."
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(0);
                      }}
                    />
                  </div>
                  <div>
                    <Label>Program</Label>
                    <Select required value={programId} onChange={(event) => setProgramId(event.target.value)}>
                      <option value="">Choose a program</option>
                      {programs.rows.map((item) => (
                        <option key={item.id} value={item.id}>
                          {[item.program_name, item.course, item.specialization].filter(Boolean).join(" · ")}
                        </option>
                      ))}
                    </Select>
                    {programs.total > PAGE_SIZE ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={page === 0}
                          onClick={() => setPage((value) => Math.max(0, value - 1))}
                        >
                          Previous
                        </Button>
                        <span>
                          Page {page + 1} of {Math.ceil(programs.total / PAGE_SIZE)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={(page + 1) * PAGE_SIZE >= programs.total}
                          onClick={() => setPage((value) => value + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {selectedProgram ? (
                <Card className="bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">{selectedProgram.university_name}</p>
                  <p className="text-slate-600">
                    {[selectedProgram.program_name, selectedProgram.course, selectedProgram.specialization]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-slate-500">
                    {selectedProgram.location ||
                      [selectedProgram.city, selectedProgram.country || country].filter(Boolean).join(", ")}
                  </p>
                </Card>
              ) : null}
              <div>
                <Label>Notes</Label>
                <Textarea name="notes" placeholder="Why this university fits the student" />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" disabled={saving || !selectedProgram}>
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
            No shortlists yet. Pick a program from the admin catalog and it will appear here and in the student portal.
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

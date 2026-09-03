import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Field";

interface ChecklistItem {
  id: string;
  document_type: string;
  description: string;
  is_required: boolean;
  is_active: boolean;
  max_file_size_mb: number;
  allowed_file_types: string[];
  country: string;
  countries: string[];
  degree_type: string;
  degree_types: string[];
  display_order: number;
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function DocumentsSetup() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api<ChecklistItem[]>("/checklists");
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load document types.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/checklists", {
        method: "POST",
        body: {
          document_type: String(data.get("document_type")),
          description: String(data.get("description") || ""),
          allowed_file_types: String(data.get("types") || "pdf,jpg,png"),
          max_file_size_mb: Number(data.get("size") || 20),
          is_required: Boolean(data.get("required")),
          countries: splitList(String(data.get("countries") || "All")),
          degree_types: splitList(String(data.get("degree_types") || "All")),
          display_order: Number(data.get("display_order") || 99),
        },
      });
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add document type.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    setError("");
    try {
      await api(`/checklists/${id}`, { method: "PATCH", body: { is_active } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update document type.");
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to="/counselor/documents">
            <Button variant="secondary" size="sm" className="mt-1">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-sky-500" />
              <h1 className="text-2xl font-bold">Set up documents</h1>
            </div>
            <p className="mt-1 text-slate-600">
              Choose which files students must upload. They appear on Student Portal → Documents and here when submitted.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card>
      )}

      <Card className="mb-4 p-5">
        <p className="font-semibold">Add document type</p>
        <p className="mt-1 text-sm text-slate-500">
          Use &quot;All&quot; for countries or degrees to apply to every student. Filter by country or degree when needed.
        </p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void add(e)}>
          <div>
            <Label>Document type</Label>
            <Input name="document_type" required placeholder="e.g. Passport, Transcripts, SOP" />
          </div>
          <div>
            <Label>Allowed file types</Label>
            <Input name="types" defaultValue="pdf,jpg,png" />
          </div>
          <div>
            <Label>Countries</Label>
            <Input name="countries" defaultValue="All" placeholder="All or Canada, United Kingdom" />
          </div>
          <div>
            <Label>Degree types</Label>
            <Input name="degree_types" defaultValue="All" placeholder="All or Masters, Bachelors" />
          </div>
          <div>
            <Label>Max size (MB)</Label>
            <Input name="size" type="number" defaultValue={20} min={1} max={100} />
          </div>
          <div>
            <Label>Display order</Label>
            <Input name="display_order" type="number" defaultValue={99} min={1} />
          </div>
          <div className="sm:col-span-2">
            <Label>Instructions for the student</Label>
            <Textarea name="description" placeholder="What the student should upload and any format notes" />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="required" defaultChecked /> Required document
          </label>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add document type"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-3">
        {loading && (
          <Card className="p-8 text-center text-sm text-slate-500">Loading document types…</Card>
        )}
        {!loading &&
          items.map((item) => (
            <Card key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{item.document_type}</p>
                {item.description ? <p className="text-sm text-slate-500">{item.description}</p> : null}
                <p className="mt-1 text-xs text-slate-400">
                  {(item.allowed_file_types || []).join(", ") || "pdf"} · max {item.max_file_size_mb || 20} MB
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Countries:{" "}
                  {(item.countries?.length ? item.countries : [item.country || "All"]).join(", ")}
                  {" · "}
                  Degrees:{" "}
                  {(item.degree_types?.length ? item.degree_types : [item.degree_type || "All"]).join(", ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {item.is_required !== false && <Badge value="hot">Required</Badge>}
                <Badge value={item.is_active === false ? "cold" : "assigned"}>
                  {item.is_active === false ? "Hidden" : "Active"}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void toggleActive(item.id, item.is_active === false)}
                >
                  {item.is_active === false ? "Activate" : "Hide"}
                </Button>
              </div>
            </Card>
          ))}
        {!loading && items.length === 0 && (
          <Card className="p-8 text-center">
            <ClipboardList className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-semibold">No document types yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add passport, transcripts, SOP, and other required files above. Students will see them on their Documents page.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

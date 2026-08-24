import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Flame, Mail, Phone, PhoneCall } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { claimLead, updateLead, useLocalStore } from "@/lib/store";
import type { LeadStatus } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

const STATUSES: LeadStatus[] = ["cold", "warm", "hot", "converted"];

export default function MyLeads() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<LeadStatus>("warm");
  const [follow, setFollow] = useState("");

  const leads = useMemo(
    () =>
      store.leads.filter(
        (lead) =>
          lead.assigned_counselor_id === user?.id &&
          lead.entity_type !== "student" &&
          lead.lead_status !== "converted" &&
          lead.lead_stage !== "converted",
      ),
    [store.leads, user?.id],
  );
  const unassigned = useMemo(
    () => store.leads.filter((lead) => !lead.assigned_counselor_id),
    [store.leads],
  );
  const selected = leads.find((lead) => lead.id === selectedId) || null;

  const save = () => {
    if (!selected) return;
    const stamp = notes ? `\n[${format(new Date(), "PPP")}] ${notes}` : "";
    updateLead(selected.id, {
      lead_status: status,
      lead_stage: status,
      last_contact_date: new Date().toISOString(),
      next_follow_up_date: follow || null,
      notes: `${selected.notes || ""}${stamp}`.trim(),
      conversion_date: status === "converted" ? new Date().toISOString() : selected.conversion_date,
      entity_type: status === "converted" ? "student" : selected.entity_type,
    });
    setSelectedId(null);
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <PhoneCall className="h-6 w-6 text-sky-500" />
        <div>
          <h1 className="text-2xl font-bold">My Leads</h1>
          <p className="text-slate-600">{leads.length} leads on this counselor portal</p>
        </div>
      </div>

      <div className="grid gap-4">
        {unassigned.length > 0 && (
          <Card className="p-5">
            <p className="font-semibold">Unassigned students</p>
            <div className="mt-3 space-y-2">
              {unassigned.map((lead) => (
                <div key={lead.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <span className="text-sm">{lead.first_name} {lead.last_name} · {lead.email}</span>
                  <Button size="sm" onClick={() => user && claimLead(lead.id, user.id)}>Assign to me</Button>
                </div>
              ))}
            </div>
          </Card>
        )}
        {leads.map((lead) => (
          <Card key={lead.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold">
                  {lead.lead_status === "hot" && <Flame className="h-4 w-4 text-orange-500" />}
                  {lead.first_name} {lead.last_name}
                </p>
                <div className="mt-1 flex flex-wrap gap-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span>
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>
                </div>
                <p className="mt-2 text-sm">{lead.preferred_countries.join(", ")} · {lead.field_of_interest} · {lead.academic_score}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge value={lead.lead_status || "cold"} />
                <Button size="sm" onClick={() => {
                  setSelectedId(lead.id);
                  setNotes("");
                  setStatus((lead.lead_status as LeadStatus) || "cold");
                  setFollow(lead.next_follow_up_date?.slice(0, 10) || "");
                }}>Update status</Button>
              </div>
            </div>
            {lead.notes && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{lead.notes}</pre>}
          </Card>
        ))}
        {leads.length === 0 && (
          <Card className="p-12 text-center">
            <PhoneCall className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="font-semibold">No active leads</p>
            <p className="text-sm text-slate-500">Leads from the student portal will show up here.</p>
          </Card>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg p-6">
            <h2 className="text-lg font-bold">Update {selected.first_name}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <Label>Lead status</Label>
                <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
                  {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                </Select>
              </div>
              <div>
                <Label>Next follow-up</Label>
                <Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />
              </div>
              <div>
                <Label>Call notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedId(null)}>Cancel</Button>
              <Button onClick={save}>Save update</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

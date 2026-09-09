export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function displayName(first?: string, last?: string, fallback = "User") {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || fallback;
}

export function initials(first?: string, last?: string, email?: string) {
  const a = first?.[0] || email?.[0] || "U";
  const b = last?.[0] || "";
  return (a + b).toUpperCase();
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function isConvertedStudent(lead: { entity_type?: string; lead_status?: string; lead_stage?: string }) {
  return lead.entity_type === "student" || lead.lead_status === "converted" || lead.lead_stage === "converted";
}

export function isOpenLead(lead: { entity_type?: string; lead_status?: string; lead_stage?: string }) {
  return !isConvertedStudent(lead);
}

export function counselorOwnsLead(
  lead: { assigned_counselor_id?: string | null },
  counselorId?: string | null,
  linkedIds: string[] = [],
) {
  if (!counselorId || !lead.assigned_counselor_id) return false;
  const owned = String(lead.assigned_counselor_id);
  if (owned === counselorId) return true;
  return linkedIds.some((id) => id === owned);
}

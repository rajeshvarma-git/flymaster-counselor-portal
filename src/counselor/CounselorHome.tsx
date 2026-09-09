import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, LogIn, LogOut, Phone, Target, Timer, TrendingUp, Users } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { addAttendance, updateAttendance, useLocalStore } from "@/lib/store";
import { isConvertedStudent, isOpenLead } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function CounselorHome() {
  const { user } = useAuth();
  const store = useLocalStore();
  const [elapsed, setElapsed] = useState("");
  const [busy, setBusy] = useState(false);

  const leads = store.leads.filter((lead) => lead.assigned_counselor_id === user?.id);
  const today = format(new Date(), "yyyy-MM-dd");
  const todayAttendance = store.attendance.find((row) => row.counselor_id === user?.id && row.date === today) || null;

  useEffect(() => {
    if (!todayAttendance?.clock_in || todayAttendance.clock_out) {
      setElapsed("");
      return;
    }
    const tick = () => {
      const start = new Date(`${todayAttendance.date}T${todayAttendance.clock_in}`);
      const diff = Date.now() - start.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [todayAttendance]);

  const clockIn = () => {
    if (!user || todayAttendance?.clock_in) return;
    setBusy(true);
    const now = new Date();
    addAttendance({
      counselor_id: user.id,
      date: format(now, "yyyy-MM-dd"),
      clock_in: format(now, "HH:mm:ss"),
      clock_out: null,
      total_hours: null,
      status: "present",
    });
    setBusy(false);
  };

  const clockOut = () => {
    if (!user || !todayAttendance?.clock_in) return;
    setBusy(true);
    const now = new Date();
    const time = format(now, "HH:mm:ss");
    const clockInAt = new Date(`${todayAttendance.date}T${todayAttendance.clock_in}`);
    const clockOutAt = new Date(`${todayAttendance.date}T${time}`);
    updateAttendance(todayAttendance.id, {
      clock_out: time,
      total_hours: (clockOutAt.getTime() - clockInAt.getTime()) / 3600000,
    });
    setBusy(false);
  };

  const students = leads.filter((lead) => isConvertedStudent(lead));
  const openLeads = leads.filter((lead) => isOpenLead(lead));
  const hot = openLeads.filter((lead) => lead.lead_status === "hot");
  const followUps = openLeads.filter((lead) => lead.next_follow_up_date?.slice(0, 10) === today);
  const rate = leads.length ? Math.round((students.length / leads.length) * 100) : 0;

  const stats = useMemo(() => [
    { label: "Assigned leads", value: openLeads.length, icon: Phone },
    { label: "My students", value: students.length, icon: Users },
    { label: "Hot leads", value: hot.length, icon: Flame },
    { label: "Follow-ups today", value: followUps.length, icon: Target },
    { label: "Conversion rate", value: `${rate}%`, icon: TrendingUp },
  ], [openLeads.length, students.length, hot.length, followUps.length, rate]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Good to see you, {user?.firstName || "Counselor"}</h1>
          <p className="text-slate-600">Your counselor workspace on this computer.</p>
        </div>
        <Card className="min-w-[240px] px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Timer className="h-4 w-4 text-sky-500" /> Shift timer</p>
          {todayAttendance?.clock_in && !todayAttendance.clock_out && (
            <p className="mt-1 font-mono text-xl font-bold">{elapsed || "00:00:00"}</p>
          )}
          {todayAttendance?.clock_out && (
            <p className="mt-1 text-sm text-slate-500">Done · {todayAttendance.total_hours?.toFixed(2)} hrs</p>
          )}
          {!todayAttendance?.clock_in && <p className="mt-1 text-sm text-slate-500">Not clocked in</p>}
          <div className="mt-2 flex gap-2">
            {!todayAttendance?.clock_in && (
              <Button size="sm" disabled={busy} onClick={clockIn}><LogIn className="h-4 w-4" /> Clock in</Button>
            )}
            {todayAttendance?.clock_in && !todayAttendance.clock_out && (
              <Button size="sm" variant="danger" disabled={busy} onClick={clockOut}><LogOut className="h-4 w-4" /> Clock out</Button>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((item) => (
          <Card key={item.label} className="p-4">
            <item.icon className="h-5 w-5 text-sky-500" />
            <p className="mt-3 text-2xl font-bold">{item.value}</p>
            <p className="text-sm text-slate-500">{item.label}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Today's follow-ups</h2>
          <Link to="/counselor/leads" className="text-sm text-sky-600">Open My Leads</Link>
        </div>
        {followUps.length === 0 && <p className="text-sm text-slate-500">Nothing due today.</p>}
        {followUps.map((lead) => (
          <div key={lead.id} className="flex items-center justify-between border-t py-3 first:border-0">
            <div>
              <p className="font-medium">{lead.first_name} {lead.last_name}</p>
              <p className="text-xs text-slate-500">{lead.preferred_countries.join(", ")} · {lead.field_of_interest}</p>
            </div>
            <Badge value={lead.lead_status || "cold"} />
          </div>
        ))}
      </Card>
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import {
  addAttendance,
  addLeave,
  markNotificationsRead,
  updateAttendance,
  useLocalStore,
} from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function phoneMessage(value: string) {
  const digits = phoneDigits(value);
  if (!digits) return "Enter your phone number";
  if (digits.length !== 10) return "Enter a 10-digit phone number";
  return "";
}

export function CounselorProfile() {
  const { user, updateProfile } = useAuth();
  const store = useLocalStore();
  const extra = store.counselorExtras.find((item) => item.user_id === user?.id);
  const [bio, setBio] = useState("");
  const [specializations, setSpecializations] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName((value) => value || user.firstName);
    setLastName((value) => value || user.lastName);
    setBio((value) => value || extra?.bio || "");
    setSpecializations((value) => value || (extra?.specializations || []).join(", "));
    setPhone((value) => value || user.phone || extra?.phone || "");
  }, [user, extra]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const specs = specializations.split(",").map((item) => item.trim()).filter(Boolean);
    const nextPhone = phoneDigits(phone);
    const phoneIssue = phoneMessage(phone);
    setSaved("");
    setError("");
    setPhoneError(phoneIssue);
    if (phoneIssue) return;
    setBusy(true);
    try {
      await updateProfile({
        firstName,
        lastName,
        phone: nextPhone,
        bio,
        specializations: specs,
      });
      setPhone(nextPhone);
      setSaved("Profile saved.");
      window.setTimeout(() => setSaved(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold">My Profile</h1>
      <p className="text-slate-600">Your details are shown to students in Counselor Chat.</p>
      <Card className="mt-4 p-6">
        <form className="space-y-3" autoComplete="off" noValidate onSubmit={save}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name</Label>
              <Input autoComplete="off" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label>Last name</Label>
              <Input autoComplete="off" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input value={user?.email || ""} readOnly autoComplete="off" className="bg-slate-50" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              type="text"
              autoComplete="off"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError(phoneMessage(e.target.value));
              }}
              placeholder="10-digit mobile number"
              className={phoneError ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : undefined}
            />
            {phoneError && <p className="mt-1 text-sm text-rose-600">{phoneError}</p>}
          </div>
          <div>
            <Label>Specializations (comma separated)</Label>
            <Input value={specializations} onChange={(e) => setSpecializations(e.target.value)} placeholder="UK, Canada, Data Science" />
          </div>
          <div><Label>Bio</Label><Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short note about how you help students" /></div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save profile"}</Button>
            {saved && <span className="text-sm text-emerald-600">{saved}</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}

export function NotificationsPage() {
  const { user } = useAuth();
  const store = useLocalStore();
  const notes = store.notifications.filter((item) => item.user_id === user?.id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Button size="sm" variant="secondary" onClick={() => user && markNotificationsRead(user.id)}>Mark all read</Button>
      </div>
      <div className="mt-4 space-y-3">
        {notes.map((note) => (
          <Card key={note.id} className={`p-4 ${note.is_read ? "" : "border-sky-200 bg-sky-50"}`}>
            <p className="font-semibold">{note.title}</p>
            <p className="text-sm text-slate-600">{note.message}</p>
          </Card>
        ))}
        {notes.length === 0 && <p className="text-slate-500">No notifications.</p>}
      </div>
    </div>
  );
}

export function LeavePage() {
  const { user } = useAuth();
  const store = useLocalStore();
  const rows = store.leave.filter((item) => item.counselor_id === user?.id);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const data = new FormData(e.currentTarget);
    const from = String(data.get("from"));
    const to = String(data.get("to"));
    const days = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
    addLeave({
      counselor_id: user.id,
      leave_type: String(data.get("leave_type") || "casual"),
      start_date: from,
      end_date: to,
      reason: String(data.get("reason")),
      total_days: days,
      status: "pending",
    });
    e.currentTarget.reset();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Leave</h1>
      <Card className="mt-4 max-w-xl p-5">
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <Label>Leave type</Label>
            <Select name="leave_type" defaultValue="casual">
              <option value="casual">Casual</option>
              <option value="sick">Sick</option>
              <option value="earned">Earned</option>
              <option value="unpaid">Unpaid</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>From</Label><Input type="date" name="from" required /></div>
            <div><Label>To</Label><Input type="date" name="to" required /></div>
          </div>
          <div><Label>Reason</Label><Textarea name="reason" required /></div>
          <Button type="submit">Request leave</Button>
        </form>
      </Card>
      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <Card key={row.id} className="flex items-center justify-between p-4">
            <span className="capitalize">{row.leave_type} · {row.start_date} → {row.end_date} · {row.reason}</span>
            <Badge value={row.status} />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AttendancePage() {
  const { user } = useAuth();
  const store = useLocalStore();
  const today = format(new Date(), "yyyy-MM-dd");
  const rows = [...store.attendance]
    .filter((item) => item.counselor_id === user?.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const unique = new Map<string, (typeof rows)[number]>();
  rows.forEach((row) => {
    if (!unique.has(row.date)) unique.set(row.date, row);
  });
  const history = [...unique.values()];
  const todayRow = unique.get(today);

  const clockIn = () => {
    if (!user || todayRow?.clock_in) return;
    addAttendance({
      counselor_id: user.id,
      date: today,
      clock_in: format(new Date(), "HH:mm:ss"),
      clock_out: null,
      total_hours: null,
      status: "present",
    });
  };

  const clockOut = () => {
    if (!user || !todayRow?.clock_in || todayRow.clock_out) return;
    const time = format(new Date(), "HH:mm:ss");
    const start = new Date(`${today}T${todayRow.clock_in}`);
    const end = new Date(`${today}T${time}`);
    updateAttendance(todayRow.id, {
      clock_out: time,
      total_hours: (end.getTime() - start.getTime()) / 3600000,
    });
  };

  const dayLabel = (value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return format(date, "EEE d MMM yyyy");
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Attendance</h1>
      <p className="text-slate-600">Clock in once per day, then clock out when your shift ends.</p>
      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="font-semibold">Today · {dayLabel(today)}</p>
          <p className="text-sm text-slate-500">
            {todayRow?.clock_in
              ? `In ${todayRow.clock_in}${todayRow.clock_out ? ` · out ${todayRow.clock_out}` : " · still on shift"}`
              : "Not clocked in yet"}
            {todayRow?.total_hours != null ? ` · ${todayRow.total_hours.toFixed(2)} hrs` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {!todayRow?.clock_in && <Button onClick={clockIn}>Clock in</Button>}
          {todayRow?.clock_in && !todayRow.clock_out && <Button variant="danger" onClick={clockOut}>Clock out</Button>}
          {todayRow?.clock_out && <Badge value="present" />}
        </div>
      </Card>
      <div className="mt-4 space-y-2">
        {history.map((row) => (
          <Card key={row.date} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <span>{dayLabel(row.date)} · in {row.clock_in || "—"} · out {row.clock_out || "—"}</span>
            <span className="text-slate-500">
              {row.total_hours != null ? `${row.total_hours.toFixed(2)} hrs` : row.clock_out ? "" : "Open"}
            </span>
          </Card>
        ))}
        {history.length === 0 && <p className="text-slate-500">No attendance records yet.</p>}
      </div>
    </div>
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function SalaryPage() {
  const { user } = useAuth();
  const store = useLocalStore();
  const rows = [...store.salary]
    .filter((item) => item.counselor_id === user?.id)
    .sort((a, b) => b.year - a.year || MONTHS.indexOf(b.month) - MONTHS.indexOf(a.month));
  const year = new Date().getFullYear();
  const ytd = rows.filter((row) => row.year === year).reduce((sum, row) => sum + Number(row.net_salary || 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold">Salary</h1>
      <p className="text-slate-600">Monthly salary credited for your counselor account.</p>
      {rows.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm text-slate-500">{year} year to date</p>
            <p className="text-2xl font-bold">₹{ytd.toLocaleString("en-IN")}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-slate-500">Latest month</p>
            <p className="text-2xl font-bold">₹{Number(rows[0].net_salary).toLocaleString("en-IN")}</p>
          </Card>
        </div>
      )}
      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <Card key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <p className="font-semibold">{row.month} {row.year}</p>
              {row.notes ? <p className="text-sm text-slate-500">{row.notes}</p> : null}
            </div>
            <span className="text-lg font-semibold">₹{Number(row.net_salary).toLocaleString("en-IN")}</span>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-slate-500">No salary records yet.</p>}
      </div>
    </div>
  );
}

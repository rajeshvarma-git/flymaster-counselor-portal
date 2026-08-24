import { NavLink, Outlet } from "react-router-dom";
import {
  BookOpen,
  Bell,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Phone,
  Target,
  User,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { displayName, initials } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { useLocalStore } from "@/lib/store";

const work = [
  { to: "/counselor", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/counselor/leads", label: "My Leads", icon: Phone },
  { to: "/counselor/students", label: "My Students", icon: Users },
  { to: "/counselor/shortlists", label: "Shortlists", icon: Target },
  { to: "/counselor/chat", label: "Student Chat", icon: MessageCircle },
  { to: "/counselor/documents", label: "Documents", icon: FileText },
  { to: "/counselor/applications", label: "Applications", icon: BookOpen },
  { to: "/counselor/notifications", label: "Notifications", icon: Bell },
];

const account = [
  { to: "/counselor/profile", label: "My Profile", icon: User },
  { to: "/counselor/leave", label: "Leave", icon: Calendar },
  { to: "/counselor/attendance", label: "Attendance", icon: Clock },
  { to: "/counselor/salary", label: "Salary", icon: DollarSign },
];

export default function CounselorLayout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const store = useLocalStore();
  const unread = store.notifications.filter((item) => item.user_id === user?.id && !item.is_read).length;
  const pendingApps = (store.applications || []).filter(
    (item) => item.status === "pending_counselor" || item.status === "submitted",
  ).length;

  const Nav = () => (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Counselor Portal</p>
          <p className="text-xs text-slate-400">Fly Masters</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Work</p>
        {work.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `mx-2 mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {item.label === "Applications" && pendingApps > 0 && (
              <span className="ml-auto rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white">{pendingApps}</span>
            )}
            {item.label === "Notifications" && unread > 0 && (
              <span className="ml-auto rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-navy-950">{unread}</span>
            )}
          </NavLink>
        ))}
        <p className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Account</p>
        {account.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `mx-2 mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300">
            {initials(user?.firstName, user?.lastName, user?.email)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{displayName(user?.firstName, user?.lastName)}</p>
            <p className="text-xs text-slate-400">Counselor</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-300 hover:bg-white/10"
          onClick={() => {
            void signOut();
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Button
        variant="ghost"
        size="sm"
        className="fixed left-3 top-3 z-50 md:hidden"
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </Button>
      <aside className="hidden w-64 flex-col bg-navy-950 md:flex">
        <Nav />
      </aside>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
          <aside className="fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-navy-950 md:hidden">
            <Nav />
          </aside>
        </>
      )}
      <main className="flex-1 overflow-y-auto p-4 pt-14 md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  );
}

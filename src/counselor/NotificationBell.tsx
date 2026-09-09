import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { markNotificationRead, useLocalStore } from "@/lib/store";
import type { LocalNotification } from "@/lib/store";
import { notificationIcon, notificationUrl } from "@/counselor/notificationUtils";
import { Button } from "@/components/ui/Button";

export default function NotificationBell() {
  const { user } = useAuth();
  const store = useLocalStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const notes = store.notifications
    .filter((item) => item.user_id === user?.id)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const unread = notes.filter((item) => !item.is_read);
  const preview = notes.slice(0, 6);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openNote = async (note: LocalNotification) => {
    if (!note.is_read) await markNotificationRead(note.id).catch(() => {});
    setOpen(false);
    navigate(notificationUrl(note));
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative h-10 w-10 rounded-full border border-slate-200 bg-white p-0 shadow-sm hover:bg-slate-50"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-slate-700" />
        {unread.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-navy-950">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">{unread.length} unread</p>
            </div>
            <Link to="/counselor/notifications" className="text-xs font-medium text-sky-600 hover:underline" onClick={() => setOpen(false)}>
              View all
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {preview.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>
            )}
            {preview.map((note) => {
              const Icon = notificationIcon(note);
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left hover:bg-slate-50 ${note.is_read ? "" : "bg-sky-50/70"}`}
                  onClick={() => void openNote(note)}
                >
                  <div className={`mt-0.5 rounded-full p-2 ${note.category === "chat" ? "bg-violet-100 text-violet-600" : "bg-sky-100 text-sky-600"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{note.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{note.message}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {note.created_at ? formatDistanceToNow(new Date(note.created_at), { addSuffix: true }) : "Just now"}
                    </p>
                  </div>
                  {!note.is_read && <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

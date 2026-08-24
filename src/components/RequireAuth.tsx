import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/lib/types";
import type { ReactNode } from "react";

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { user, role, loading, roleLoading } = useAuth();

  if (loading || (user && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
          <p className="mt-3 text-sm text-slate-500">Loading counselor portal...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;
  if (roles && role && !roles.includes(role) && role !== "student") return <Navigate to="/" replace />;
  return <>{children}</>;
}

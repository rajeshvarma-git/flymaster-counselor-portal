import { Component, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";
import CounselorLayout from "@/counselor/CounselorLayout";
import CounselorHome from "@/counselor/CounselorHome";
import MyLeads from "@/counselor/MyLeads";
import MyStudents from "@/counselor/MyStudents";
import Shortlists from "@/counselor/Shortlists";
import CounselorChat from "@/counselor/CounselorChat";
import Documents from "@/counselor/Documents";
import Applications from "@/counselor/Applications";
import {
  AttendancePage,
  CounselorProfile,
  LeavePage,
  NotificationsPage,
  SalaryPage,
} from "@/counselor/AccountPages";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Something went wrong" };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-navy-950 p-6 text-white">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold">The page failed to load</h1>
            <p className="mt-2 text-sm text-slate-300">{this.state.error}</p>
            <button
              className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-navy-950"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<Navigate to="/" replace />} />

          <Route
            path="/counselor"
            element={
              <RequireAuth roles={["counselor"]}>
                <CounselorLayout />
              </RequireAuth>
            }
          >
            <Route index element={<CounselorHome />} />
            <Route path="leads" element={<MyLeads />} />
            <Route path="students" element={<MyStudents />} />
            <Route path="shortlists" element={<Shortlists />} />
            <Route path="chat" element={<CounselorChat />} />
            <Route path="documents" element={<Documents />} />
            <Route path="applications" element={<Applications />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="profile" element={<CounselorProfile />} />
            <Route path="leave" element={<LeavePage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="salary" element={<SalaryPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}

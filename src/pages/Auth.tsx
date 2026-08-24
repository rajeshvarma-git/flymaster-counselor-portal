import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user, loading, signIn, signUp } = useAuth();

  useEffect(() => {
    if (!loading && user) navigate("/counselor", { replace: true });
  }, [user, loading, navigate]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp({ email, password, firstName, lastName });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="w-full max-w-md p-8 text-navy-900">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold leading-tight">Fly Masters</p>
            <p className="text-xs uppercase tracking-widest text-slate-500">Counselor login</p>
          </div>
        </div>

        <h1 className="text-2xl font-bold">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login"
            ? "Use the counselor email and password from Admin → Users. Same database as the admin portal."
            : "This creates a counselor in the admin portal too. Or ask an admin to create you under Users with role Counselor."}
        </p>

        <form className="mt-6 space-y-3" onSubmit={(e) => void onSubmit(e)}>
          {mode === "signup" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <Input name="firstName" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <Label>Last name</Label>
                <Input name="lastName" required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label>Email</Label>
            <Input name="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              name="password"
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button className="w-full" type="submit" disabled={busy || loading}>
            {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === "login" ? (
            <>
              New counselor?{" "}
              <button type="button" className="font-medium text-sky-700" onClick={() => { setMode("signup"); setError(""); }}>
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" className="font-medium text-sky-700" onClick={() => { setMode("login"); setError(""); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}

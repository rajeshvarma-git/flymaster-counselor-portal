import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/InputOtp";
import { useAuth } from "@/context/AuthContext";

type SignupStep = "form" | "verify";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupStep, setSignupStep] = useState<SignupStep>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user, loading, signIn, signUp, sendVerificationCode } = useAuth();

  useEffect(() => {
    if (!loading && user) navigate("/counselor", { replace: true });
  }, [user, loading, navigate]);

  const resetSignupFlow = () => {
    setSignupStep("form");
    setVerificationCode("");
    setInfo("");
  };

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    setError("");
    resetSignupFlow();
  };

  const requestVerificationCode = async () => {
    setError("");
    setInfo("");
    const result = await sendVerificationCode(email.trim());
    setInfo(result.devHint || result.message);
    setSignupStep("verify");
  };

  const onSignupFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!email.trim()) throw new Error("Enter your email address.");
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");
      await requestVerificationCode();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code");
    } finally {
      setBusy(false);
    }
  };

  const onResendCode = async () => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await requestVerificationCode();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend verification code");
    } finally {
      setBusy(false);
    }
  };

  const onVerifyAndCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (verificationCode.length !== 6) throw new Error("Enter the 6-digit verification code.");
      await signUp({ email, password, firstName, lastName, verificationCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  };

  const onLoginSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-8">
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

        <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "login" ? "bg-white text-navy-900 shadow-sm" : "text-slate-500"}`}
            onClick={() => switchMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "signup" ? "bg-white text-navy-900 shadow-sm" : "text-slate-500"}`}
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>

        {mode === "login" ? (
          <>
            <h1 className="text-2xl font-bold">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">
              Use the counselor email and password from Admin → Users.
            </p>

            <form className="mt-6 space-y-3" onSubmit={(e) => void onLoginSubmit(e)}>
              <div>
                <Label>Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button className="w-full" type="submit" disabled={busy || loading}>
                {busy ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </>
        ) : signupStep === "form" ? (
          <>
            <h1 className="text-2xl font-bold">Create account</h1>
            <p className="mt-1 text-sm text-slate-500">
              Enter your details. We will send a Gmail verification code before creating your counselor account.
            </p>

            <form className="mt-6 space-y-3" onSubmit={(e) => void onSignupFormSubmit(e)}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>First name</Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      name="firstName"
                      required
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div>
                  <Label>Last name</Label>
                  <Input
                    name="lastName"
                    required
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    name="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button className="w-full" type="submit" disabled={busy || loading}>
                {busy ? "Sending code..." : "Continue"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <ShieldCheck className="h-7 w-7" />
              </span>
            </div>
            <h1 className="text-center text-2xl font-bold">Verify your email</h1>
            <p className="mt-2 text-center text-sm text-slate-500">
              Enter the 6-digit code sent to <span className="font-medium text-navy-900">{email}</span>
            </p>

            <form className="mt-6 space-y-4" onSubmit={(e) => void onVerifyAndCreate(e)}>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={verificationCode}
                  onChange={setVerificationCode}
                  disabled={busy}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {info || `We sent a verification code to ${email}. Check your inbox and spam folder.`}
              </div>

              {error && <p className="text-sm text-rose-600">{error}</p>}

              <Button className="w-full" type="submit" disabled={busy || loading || verificationCode.length !== 6}>
                {busy ? "Creating account..." : "Verify & create account"}
              </Button>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setInfo("");
                    setVerificationCode("");
                    setSignupStep("form");
                  }}
                >
                  Back
                </Button>
                <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void onResendCode()}>
                  {busy ? "Sending..." : "Resend code"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-4 text-center text-white">
      <p className="text-6xl font-extrabold">404</p>
      <p className="mt-3 text-slate-300">That page is not in the counselor portal.</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="gold">Back to sign in</Button>
      </Link>
    </div>
  );
}

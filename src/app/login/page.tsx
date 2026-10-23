import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { FeedbackBanner } from "@/components/ui";
import { loginAction } from "@/lib/actions";
import { getCurrentActor } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; redirectTo?: string }>;
}) {
  const actor = await getCurrentActor();
  if (actor) redirect("/dashboard");
  const params = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see what is happening in your family today."
      footer={
        <p>
          New here?{" "}
          <Link href="/register" className="link font-semibold">
            Create a household
          </Link>
        </p>
      }
    >
      <FeedbackBanner ok={params.ok} error={params.error} />
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="redirectTo" value={params.redirectTo ?? "/dashboard"} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="field" placeholder="you@example.com" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-ink-soft hover:text-teal">
              Forgot?
            </Link>
          </div>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </div>
        <button type="submit" className="btn w-full">
          Sign in
        </button>
      </form>

      <div className="mt-6 rounded-2xl border border-teal/15 bg-teal-mist/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-deep">Demo household</p>
        <p className="mt-1 text-sm text-ink-soft">
          After <code className="rounded bg-white px-1 py-0.5 text-xs">npm run db:seed</code>, sign in with{" "}
          <strong>ivan@homeorbit.demo</strong> / <strong>OrbitDemo123!</strong>. Maria, Alex and Grandma Elena have
          accounts too.
        </p>
      </div>
    </AuthShell>
  );
}

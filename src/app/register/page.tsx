import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { FeedbackBanner } from "@/components/ui";
import { registerAction } from "@/lib/actions";
import { getCurrentActor } from "@/lib/auth/session";

export const metadata = { title: "Create a household" };

function timeZones(): string[] {
  const preferred = ["Europe/Sofia", "Europe/London", "Europe/Berlin", "Europe/Madrid", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
  let supported: string[] = [];
  try {
    supported = Intl.supportedValuesOf("timeZone");
  } catch {
    supported = preferred;
  }
  return [...new Set([...preferred, ...supported])];
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getCurrentActor();
  if (actor) redirect("/dashboard");
  const params = await searchParams;
  return (
    <AuthShell
      title="Create your family orbit"
      subtitle="One shared household, six or more profiles, real coordination. You can invite the rest of the family in Settings."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="link font-semibold">
            Sign in
          </Link>
        </p>
      }
    >
      <FeedbackBanner error={params.error} />
      <form action={registerAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="householdName">
            Household name
          </label>
          <input id="householdName" name="householdName" required className="field" placeholder="The Petrovi family" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input id="name" name="name" required className="field" placeholder="Ivan Petrov" />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className="field" placeholder="you@example.com" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            className="field"
          />
          <p className="mt-1 text-[11px] text-ink-soft">At least 10 characters with upper case, lower case and a number.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="timezone">
              Time zone
            </label>
            <select id="timezone" name="timezone" className="field" defaultValue="Europe/Sofia">
              {timeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="locale">
              Language
            </label>
            <select id="locale" name="locale" className="field" defaultValue="en">
              <option value="en">English</option>
              <option value="bg">Български</option>
            </select>
          </div>
        </div>
        <button type="submit" className="btn w-full">
          Create account
        </button>
      </form>
    </AuthShell>
  );
}

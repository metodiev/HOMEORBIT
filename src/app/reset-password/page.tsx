import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { FeedbackBanner } from "@/components/ui";
import { resetPasswordAction } from "@/lib/actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your reset link is valid for one hour and can be used once."
      footer={
        <p>
          <Link href="/login" className="link font-semibold">
            Back to sign in
          </Link>
        </p>
      }
    >
      <FeedbackBanner error={params.error} />
      {!params.token ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This page needs a reset token. Request a new link from the sign-in page.
        </p>
      ) : (
        <form action={resetPasswordAction} className="space-y-4">
          <input type="hidden" name="token" value={params.token} />
          <div>
            <label className="label" htmlFor="password">
              New password
            </label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="field" />
          </div>
          <button type="submit" className="btn w-full">
            Save password
          </button>
        </form>
      )}
    </AuthShell>
  );
}

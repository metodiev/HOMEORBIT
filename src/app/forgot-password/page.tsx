import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { FeedbackBanner } from "@/components/ui";
import { requestPasswordResetAction } from "@/lib/actions";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; token?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="We will create a one-hour reset link. In this self-hosted version, no email provider is configured, so the link is shown in development mode and household admins can help in production."
      footer={
        <p>
          <Link href="/login" className="link font-semibold">
            Back to sign in
          </Link>
        </p>
      }
    >
      <FeedbackBanner ok={params.ok} error={params.error} />
      <form action={requestPasswordResetAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className="field" placeholder="you@example.com" />
        </div>
        <button type="submit" className="btn w-full">
          Create reset link
        </button>
      </form>
      {params.token ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Development reset link</p>
          <Link href={`/reset-password?token=${encodeURIComponent(params.token)}`} className="link break-all">
            /reset-password?token={params.token}
          </Link>
        </div>
      ) : null}
    </AuthShell>
  );
}

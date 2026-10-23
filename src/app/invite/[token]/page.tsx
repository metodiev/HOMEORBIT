import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { FeedbackBanner } from "@/components/ui";
import { acceptInviteAction } from "@/lib/actions";
import { invitationPreview } from "@/lib/domain/settings";
import { toErrorMessage } from "@/lib/errors";

export const metadata = { title: "Join the family" };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  let preview: ReturnType<typeof invitationPreview> | null = null;
  let error: string | null = null;
  try {
    preview = invitationPreview(token);
  } catch (cause) {
    error = toErrorMessage(cause);
  }

  return (
    <AuthShell
      title="Join the family"
      subtitle={
        preview
          ? `${preview.memberName}, you are invited to ${preview.householdName} as ${preview.role}. Choose a password to activate your account.`
          : "This invitation could not be loaded."
      }
      footer={
        <p>
          <Link href="/login" className="link font-semibold">
            Back to sign in
          </Link>
        </p>
      }
    >
      <FeedbackBanner error={query.error ?? error ?? undefined} />
      {preview ? (
        <form action={acceptInviteAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="rounded-2xl border border-black/5 bg-white p-4 text-sm text-ink-soft">
            Sign-in email: <strong className="text-ink">{preview.email}</strong>
          </div>
          <div>
            <label className="label" htmlFor="password">
              Choose a password
            </label>
            <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="field" />
            <p className="mt-1 text-[11px] text-ink-soft">At least 10 characters with upper case, lower case and a number.</p>
          </div>
          <button type="submit" className="btn w-full">
            Accept invitation
          </button>
        </form>
      ) : (
        <Link href="/login" className="btn-secondary w-full">
          Go to sign in
        </Link>
      )}
    </AuthShell>
  );
}

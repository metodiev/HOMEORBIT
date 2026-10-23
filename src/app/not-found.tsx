import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="card max-w-md p-8 text-center">
        <p className="text-3xl" aria-hidden>
          🔭
        </p>
        <h1 className="mt-3 text-xl font-semibold">Nothing in this orbit</h1>
        <p className="mt-2 text-sm text-ink-soft">The page or record you were looking for does not exist, or you do not have access to it.</p>
        <Link href="/dashboard" className="btn mt-5">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}

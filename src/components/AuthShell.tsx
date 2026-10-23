import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-teal-deep px-10 py-12 text-cream lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full border border-dashed border-sun/30" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-80 w-80 rounded-full border border-cream/10" />
        <div className="relative">
          <Link href="/" className="flex items-center gap-3">
            <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-sun/60">
              <span className="h-3 w-3 rounded-full bg-sun" />
              <span className="absolute h-9 w-9 rounded-full border border-dashed border-cream/40" />
            </span>
            <span>
              <span className="block font-display text-xl font-semibold">HomeOrbit</span>
              <span className="block text-[11px] uppercase tracking-[0.2em] text-cream/60">Family operating system</span>
            </span>
          </Link>
        </div>
        <div className="relative max-w-md">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-sun">One calm place</p>
          <h2 className="font-display text-4xl leading-tight text-balance">
            The whole family, in one orbit.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-cream/75">
            Calendars, school runs, deliveries, shopping, meals and decisions — coordinated by an assistant that
            works with your real family data and asks before it acts.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-cream/80">
            {[
              ["🗓️", "Shared and private calendars with real conflict checks"],
              ["🧠", "An assistant that uses tools, not guesses"],
              ["🛡️", "Guardian-approved actions and audit trails"],
              ["📦", "Deliveries, pickups and errands that don't slip"],
            ].map(([icon, line]) => (
              <li key={line} className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 text-base">
                  {icon}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex -space-x-2">
            {[
              ["#0f766e", "🧑"],
              ["#b45309", "👩"],
              ["#2563eb", "🧑‍🎓"],
              ["#db2777", "👧"],
              ["#7c3aed", "🧒"],
              ["#64748b", "👵"],
            ].map(([color, emoji]) => (
              <span
                key={emoji}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-teal-deep text-sm"
                style={{ backgroundColor: `${color}55` }}
              >
                {emoji}
              </span>
            ))}
          </div>
          <p className="text-xs text-cream/60">Six profiles. One shared brain.</p>
        </div>
      </section>

      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-deep text-sun">◐</span>
            <span className="font-display text-lg font-semibold">HomeOrbit</span>
          </div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-sm text-ink-soft">{footer}</div> : null}
        </div>
      </section>
    </div>
  );
}

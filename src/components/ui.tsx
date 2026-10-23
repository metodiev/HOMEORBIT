import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-terracotta">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function FeedbackBanner({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      role="status"
      className={`mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      <span aria-hidden className="text-base leading-5">
        {error ? "⚠️" : "✓"}
      </span>
      <p className="whitespace-pre-wrap break-words">{error ?? ok}</p>
    </div>
  );
}

export function EmptyState({
  icon = "🌱",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-white/50 px-6 py-10 text-center">
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function MemberAvatar({
  name,
  color,
  avatar,
  size = "md",
}: {
  name: string;
  color: string;
  avatar?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions = size === "sm" ? "h-7 w-7 text-sm" : size === "lg" ? "h-12 w-12 text-xl" : "h-9 w-9 text-base";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white shadow-sm ${dimensions}`}
      style={{ backgroundColor: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}55` }}
      title={name}
    >
      <span aria-hidden>{avatar || name.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "teal" | "amber" | "red" | "berry" | "blue";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-sand text-ink-soft",
    teal: "bg-teal-mist text-teal-deep",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    berry: "bg-pink-100 text-pink-900",
    blue: "bg-sky-100 text-sky-900",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? "p-5" : ""} ${className}`}>
      {title || action ? (
        <div className={`mb-3 flex items-start justify-between gap-3 ${padded ? "" : "p-5 pb-0"}`}>
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const className = variant === "primary" ? "btn" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint ? <p className="text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export function GuestRestricted({ title }: { title: string }) {
  return (
    <EmptyState
      icon="🔐"
      title={`${title} is not part of guest access`}
      description="Your invited-relative account only includes calendars, trips and notes explicitly shared with you. Ask a guardian if you need access to something else."
      action={
        <Link href="/dashboard" className="btn-secondary">
          Back to dashboard
        </Link>
      }
    />
  );
}

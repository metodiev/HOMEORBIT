export type NavItem = {
  href: string;
  labelKey: string;
  icon: string;
  badge?: number;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.home", icon: "🏡" },
  { href: "/calendar", labelKey: "nav.calendar", icon: "📅" },
  { href: "/assistant", labelKey: "nav.assistant", icon: "✨" },
  { href: "/tasks", labelKey: "nav.tasks", icon: "✅" },
  { href: "/shopping", labelKey: "nav.shopping", icon: "🛒" },
  { href: "/deliveries", labelKey: "nav.deliveries", icon: "📦" },
  { href: "/school", labelKey: "nav.school", icon: "🎒" },
  { href: "/holidays", labelKey: "nav.holidays", icon: "🌄" },
  { href: "/notes", labelKey: "nav.notes", icon: "📝" },
  { href: "/household", labelKey: "nav.household", icon: "🧺" },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/notifications", labelKey: "nav.notifications", icon: "🔔" },
  { href: "/approvals", labelKey: "nav.approvals", icon: "🛡️" },
  { href: "/settings", labelKey: "nav.settings", icon: "⚙️" },
];

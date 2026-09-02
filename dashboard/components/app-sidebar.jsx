import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Globe,
  PanelLeft,
  Settings,
  LayoutGrid,
  Cloud,
  ArrowUpRight,
} from "lucide-react";
import { cx, useDismiss, Favicon } from "@/components/ui";
import { UnidralGlyph } from "@/components/brand";
import { onSiteChange } from "@/lib-engine/api";
import { EditableText, useContent } from "@/components/editable-section";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { label: "Overview", href: "/app", icon: LayoutGrid, key: "nav_overview" },
  { label: "Proxy Sites", href: "/sites", icon: Globe, key: "nav_sites" },
  { label: "Domains", href: "/domains", icon: Cloud, key: "nav_domains" },
  { label: "Settings", href: "/settings", icon: Settings, key: "nav_settings" },
  { label: "Upgrade", href: "/upgrade", icon: ArrowUpRight, key: "nav_upgrade", accent: true },
];

function IconButton({ children, onClick, className = "", title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        "flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-line hover:text-fg",
        className
      )}
    >
      {children}
    </button>
  );
}

function TelegramButton({ align = "left" }) {
  const [open, setOpen] = React.useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Telegram"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex h-[24px] w-[24px] items-center justify-center rounded-[5px] transition-colors",
          open ? "bg-line text-fg" : "text-fg2 hover:bg-line hover:text-fg"
        )}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.387 4.028-1.627 4.476-1.635z"/>
        </svg>
      </button>

      {open ? (
        <div
          className={cx(
            "absolute z-[60] w-[200px] max-w-[calc(100vw-20px)] animate-popIn overflow-hidden rounded-[8px] border border-stroke bg-raised sm:w-[220px]",
            "bottom-[30px]",
            align === "left" ? "left-[-6px]" : "right-[-6px]"
          )}
        >
          <div className="px-[12px] py-[10px]">
            <div className="text-[13px] font-medium text-fg">Join us on Telegram</div>
            <div className="mt-[2px] text-[11.5px] text-fg3">Get support and updates</div>
          </div>
          <a
            href="https://t.me/unidrals"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex h-[36px] items-center justify-between border-t border-line px-[12px] text-[12.5px] text-fg transition-colors hover:bg-pressed"
          >
            Open Telegram
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[14px] w-[14px] shrink-0 text-fg3">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.387 4.028-1.627 4.476-1.635z"/>
            </svg>
          </a>
        </div>
      ) : null}
    </div>
  );
}

function RecentSites({ collapsed }) {
  const router = useRouter();
  const [sites, setSites] = React.useState([]);

  React.useEffect(() => {
    function loadSites() {
      import("@/lib-engine/api").then(({ api }) => {
        api.listSites().then((res) => {
          const list = (res.sites || res || []).slice(0, 6);
          setSites(list);
        }).catch(() => {});
      });
    }
    loadSites();
    const unsub = onSiteChange(loadSites);
    return () => unsub();
  }, []);

  if (collapsed) {
    return (
      <div className="mt-[4px] flex flex-col items-center gap-[7px]">
        {sites.slice(0, 4).map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.subdomain}
            onClick={() => router.push(`/sites/${s.id}`)}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] bg-line text-[10px] font-bold text-fg2 transition-colors hover:bg-pressed"
          >
            {(s.subdomain || "??").slice(0, 2).toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mt-[10px] flex h-[26px] items-center justify-between px-[14px]">
        <span className="text-[12px] text-fg3">Recent sites</span>
        <Link href="/sites" className="text-[11px] text-fg3 transition-colors hover:text-fg">
          View all
        </Link>
      </div>

      <div className="mt-[4px] px-[8px]">
        {sites.length === 0 ? (
          <div className="px-[6px] py-[4px] text-[12.5px] text-fg3">No sites yet</div>
        ) : (
          sites.map((s) => (
            <Link
              key={s.id}
              href={`/sites/${s.id}`}
              className="flex h-[28px] items-center gap-[8px] rounded-[6px] px-[6px] text-[12.5px] text-fg2 transition-colors hover:bg-hover hover:text-fg"
            >
              <Favicon url={s.target_url} subdomain={s.subdomain} size={18} />
              <span className="truncate">{s.subdomain}</span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}

export function AppSidebar({ collapsed, onToggle, variant = "static" }) {
  const router = useRouter();

  const shell =
    variant === "drawer"
      ? "relative flex h-full w-full shrink-0 flex-col border-r border-line bg-panel"
      : "relative flex h-screen w-[264px] shrink-0 flex-col border-r border-line bg-panel";

  if (collapsed && variant === "static") {
    return (
      <aside className="flex h-screen w-[48px] shrink-0 flex-col items-center border-r border-hover bg-panel">
        <div className="flex h-[40px] shrink-0 items-center">
          <IconButton title="Expand sidebar" onClick={onToggle}>
            <PanelLeft className="h-[14px] w-[14px]" strokeWidth={1.8} />
          </IconButton>
        </div>

        <div className="flex w-full flex-1 flex-col items-center gap-[7px] overflow-y-auto scroll-hide px-0 py-[4px]">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              title={item.label}
            >
              <button
                type="button"
                className={cx(
                  "flex h-[26px] w-[26px] items-center justify-center rounded-[6px] transition-colors",
                  router.pathname === item.href
                    ? "bg-line text-fg"
                    : "text-fg2 hover:bg-hover hover:text-fg"
                )}
              >
                <item.icon className="h-[14px] w-[14px]" strokeWidth={1.8} />
              </button>
            </Link>
          ))}

          <RecentSites collapsed />
        </div>

        <div className="flex shrink-0 flex-col items-center gap-[8px] py-[12px]">
          <ThemeToggle collapsed />
          <TelegramButton align="left" />
        </div>
      </aside>
    );
  }

  return (
    <aside className={shell}>
      <div className="flex h-[40px] shrink-0 items-center justify-between px-[10px]">
        <span className="flex items-center gap-[8px] px-[4px]">
          <UnidralGlyph className="h-[16px] w-auto" />
          <span className="text-[13px] font-medium text-fg">Unidral</span>
        </span>
        <div className="flex items-center gap-[2px]">
          <IconButton title="Collapse sidebar" onClick={onToggle}>
            <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-hide">
        <nav className="mt-[10px] space-y-[2px] px-[10px]">
          {navItems.map((item) => {
            const active = router.pathname === item.href;
            return (
              <Link key={item.label} href={item.href}>
                <button
                  type="button"
                  className={cx(
                    "group relative flex h-[34px] w-full items-center gap-[10px] rounded-[8px] px-[10px] text-[13px] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    active
                      ? "bg-raised text-fg"
                      : "text-fg2 hover:bg-hover hover:text-fg"
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
                  ) : null}
                  <item.icon
                    className={cx(
                      "h-[15px] w-[15px] shrink-0 transition-colors",
                      active || item.accent ? "text-accent" : "text-fg3 group-hover:text-fg2"
                    )}
                    strokeWidth={1.8}
                  />
                  <EditableText page="navigation" section={item.key} defaultText={item.label} as="span" />
                </button>
              </Link>
            );
          })}
        </nav>

        <RecentSites />
      </div>

      <div className="flex h-[46px] shrink-0 items-center justify-end gap-[4px] px-[10px]">
        <ThemeToggle />
        <TelegramButton align="left" />
      </div>
    </aside>
  );
}

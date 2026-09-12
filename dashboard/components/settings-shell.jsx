import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ArrowLeft,
  ArrowUpRight,
  Cog,
  Database,
  Server,
  PanelLeft,
} from "lucide-react";
import { Drawer, cx, useDismiss } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";

const navItems = [
  { label: "Engine", icon: Cog, href: "/settings/engine" },
  { label: "Environment", icon: Server, href: "/settings/env" },
  { label: "Firebase", icon: Database, href: "/settings/firebase" },
];

function NavRow({ item, nested }) {
  const router = useRouter();
  const active = Boolean(item.href && router.pathname === item.href);

  const content = (
    <>
      <item.icon className="h-[15px] w-[15px] shrink-0 text-fg2" strokeWidth={1.8} />
      <span className="truncate">{item.label}</span>
    </>
  );

  const className = cx(
    "relative flex h-[32px] w-full items-center gap-[10px] rounded-[8px] pr-[8px] text-[13px] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
    nested ? "pl-[20px]" : "pl-[8px]",
    active ? "bg-raised text-fg" : "text-fg2 hover:bg-hover hover:text-fg"
  );

  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className}>
      {content}
    </button>
  );
}

function TelegramButton() {
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
          open ? "bg-line text-fg" : "text-fg3 hover:bg-line hover:text-fg"
        )}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.387 4.028-1.627 4.476-1.635z"/>
        </svg>
      </button>

      {open ? (
        <div className="absolute bottom-[30px] left-[6px] z-[60] w-[200px] max-w-[calc(100vw-20px)] animate-popIn overflow-hidden rounded-[8px] border border-stroke bg-raised">
          <div className="px-[12px] py-[10px]">
            <div className="text-[13px] font-medium text-fg">Join us on Telegram</div>
            <div className="mt-[2px] text-[11.5px] text-fg3">Get support and updates</div>
          </div>
          <a
            href="https://t.me/unidral"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex h-[36px] items-center justify-between border-t border-line px-[12px] text-[12.5px] text-fg transition-colors hover:bg-pressed"
          >
            Open Telegram
            <ArrowUpRight className="h-[12px] w-[12px] text-fg3" strokeWidth={2} />
          </a>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsSidebar({ variant = "static", onClose }) {
  return (
    <aside
      className={cx(
        "flex flex-col bg-panel",
        variant === "drawer"
          ? "h-full w-full border-r border-line"
          : "h-screen w-[280px] shrink-0 border-r border-hover"
      )}
    >
      <div className="flex h-[40px] items-center justify-between px-[10px]">
        <Link
          href="/app"
          className="flex h-[26px] items-center gap-[8px] rounded-[6px] px-[6px] text-[12.5px] text-fg transition-colors hover:bg-hover"
        >
          <ArrowLeft className="h-[14px] w-[14px] text-fg2" strokeWidth={1.9} />
          Back to app
        </Link>
        <div className="flex items-center gap-[2px]">
          {variant === "drawer" ? (
            <button
              type="button"
              title="Close menu"
              onClick={onClose}
              className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-line hover:text-fg"
            >
              <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="scroll-thin mt-[14px] flex-1 overflow-y-auto px-[10px] pb-[10px]">
        <div className="px-[8px] pb-[4px] text-[12px] text-fg3">Settings</div>
        <div className="mt-[6px]">
          {navItems.map((item) => (
            <NavRow key={item.label} item={item} />
          ))}
        </div>
      </nav>

      <div className="flex h-[40px] items-center gap-[2px] border-t border-hover px-[10px]">
        <TelegramButton />
      </div>
    </aside>
  );
}

const SettingsChromeContext = React.createContext({ openDrawer: () => {} });

export function SettingsShell({ children }) {
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [router.pathname]);

  const value = React.useMemo(() => ({ openDrawer: () => setDrawerOpen(true) }), []);

  return (
    <SettingsChromeContext.Provider value={value}>
      <div className="flex h-screen w-full overflow-hidden bg-canvas">
        {isDesktop ? (
          <SettingsSidebar />
        ) : (
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <SettingsSidebar variant="drawer" onClose={() => setDrawerOpen(false)} />
          </Drawer>
        )}
        <div className="scroll-thin flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </SettingsChromeContext.Provider>
  );
}

export function SettingsHeader({ crumb, tabs, right }) {
  const { openDrawer } = React.useContext(SettingsChromeContext);

  return (
    <>
      <div className="flex h-[40px] shrink-0 items-center gap-[9px] border-b border-hover px-[14px]">
        <button
          type="button"
          title="Open menu"
          onClick={openDrawer}
          className="-ml-[2px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-line hover:text-fg md:hidden"
        >
          <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.8} />
        </button>
        <Link href="/settings" className="text-[13px] text-fg transition-colors hover:text-white">
          Settings
        </Link>
        {crumb ? (
          <>
            <span className="text-[13px] text-stroke">/</span>
            <span className="text-[13px] text-fg">{crumb}</span>
          </>
        ) : null}
      </div>

      {tabs || right ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-[10px] px-[16px] py-[9px] md:h-[44px] md:flex-nowrap md:px-[24px] md:py-0">
          <div className="flex items-center gap-[6px]">{tabs}</div>
          {right}
        </div>
      ) : null}
    </>
  );
}

export function BackToOrganization() {
  return (
    <div className="px-[16px] pt-[14px] md:px-[21px]">
      <Link
        href="/settings"
        className="inline-flex items-center gap-[8px] text-[12.5px] text-fg2 transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-[13px] w-[13px]" strokeWidth={1.9} />
        Back to settings
      </Link>
    </div>
  );
}

export function Tab({ children, active, onClick, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-[28px] items-center gap-[6px] rounded-[7px] px-[11px] text-[12.5px] font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        active ? "bg-raised text-fg" : "text-fg3 hover:bg-hover hover:text-fg2"
      )}
    >
      {children}
      {typeof count === "number" ? <span className="text-fg4">{count}</span> : null}
    </button>
  );
}

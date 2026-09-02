import * as React from "react";
import { PanelLeft, RefreshCw, Github } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { UnidralLockup } from "@/components/brand";
import { Drawer, cx, LinkNav, Favicon } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api } from "@/lib-engine/api";
import Link from "next/link";

export default function AppPage() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const [sites, setSites] = React.useState([]);
  const [health, setHealth] = React.useState({});
  const [domains, setDomains] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [spinning, setSpinning] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const [siteList, healthMap, domList] = await Promise.all([
        api.listSites().catch(() => []),
        api.siteHealth().catch(() => ({})),
        api.listDomains().catch(() => []),
      ]);
      const ss = Array.isArray(siteList) ? siteList : (siteList?.sites || []);
      setSites(ss);
      setHealth(healthMap || {});
      setDomains(Array.isArray(domList) ? domList : (domList?.domains || []));
      setUpdatedAt(new Date());
    } catch {}
    finally { setLoading(false); setSpinning(false); }
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const safeLoad = () => { if (mounted) load(); };
    safeLoad();
    const t = setInterval(safeLoad, 30000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [load]);

  const showFloatingToggle = isDesktop ? collapsed : true;

  const live = sites.filter((s) => s.mode === "live").length;
  const verified = domains.filter((d) => d.verified || d.status === "active").length;

  const refresh = () => {
    setSpinning(true);
    load();
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      {isDesktop ? (
        <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      ) : (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <AppSidebar collapsed={false} variant="drawer" onToggle={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <main className="scroll-thin relative flex-1 overflow-y-auto">
        {showFloatingToggle ? (
          <button
            type="button"
            title={isDesktop ? "Expand sidebar" : "Open menu"}
            onClick={() => (isDesktop ? setCollapsed(false) : setDrawerOpen(true))}
            className="absolute left-[14px] top-[10px] z-20 flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-line hover:text-fg md:left-[20px] md:top-[8px] md:h-[24px] md:w-[24px]"
          >
            <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        ) : null}

        <div className="mx-auto w-full max-w-[840px] px-[16px] pb-[80px] pt-[60px] md:px-[24px] md:pt-[72px]">
          <div className="mb-[24px] flex items-start justify-between px-[8px]">
            <div>
              <UnidralLockup />
              <p className="mt-[8px] flex items-center gap-[6px] text-[11.5px] text-fg4">
                Reverse Proxy Engine by 8 Universes
                <a
                  href="https://github.com/cmd447/Unidral-OSS"
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg4 transition-colors hover:text-fg2"
                >
                  <Github className="h-[12px] w-[12px]" strokeWidth={1.8} />
                </a>
              </p>
              <p className="mt-[8px] text-[13px] text-fg3">
                Overview
              </p>
            </div>
            <div className="flex flex-col items-end gap-[4px] pt-[2px]">
              <button
                type="button"
                onClick={refresh}
                className="flex h-[26px] items-center gap-[6px] text-[11.5px] text-fg3 transition-colors hover:text-fg"
              >
                <RefreshCw className={cx("h-[12px] w-[12px]", spinning && "animate-spin")} strokeWidth={1.8} />
                Refresh
              </button>
              {updatedAt ? (
                <span className="text-[10.5px] tabular-nums text-fg4">
                  Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-[24px] px-[8px] sm:grid-cols-4">
            {[
              { label: "Proxy sites", value: sites.length, sub: `${live} live` },
              { label: "Domains", value: domains.length, sub: `${verified} verified` },
            ].map((stat) => (
              <div key={stat.label} className="border-t border-line py-[14px] pr-[16px]">
                <div className="text-[11px] text-fg4">{stat.label}</div>
                <div className="mt-[6px] text-[22px] font-semibold leading-none tabular-nums text-fg">
                  {loading ? "-" : stat.value}
                </div>
                <div className="mt-[6px] text-[11px] text-fg4">{stat.sub}</div>
              </div>
            ))}
          </div>

          <div className="mt-[28px] px-[8px]">
            <div className="mb-[10px] flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-fg">Your sites</h3>
              <LinkNav href="/sites">View all</LinkNav>
            </div>
            {loading ? (
              <div className="border-t border-line py-[20px] text-center text-[12.5px] text-fg3">Loading…</div>
            ) : sites.length === 0 ? (
              <div className="border-t border-line py-[20px] text-center text-[12.5px] text-fg3">
                No sites yet. Get started by adding your first site.
              </div>
            ) : (
              <div>
                {sites.slice(0, 5).map((site) => {
                  const hs = health[site.id]?.status || "unknown";
                  return (
                    <Link
                      key={site.id}
                      href={`/sites/${site.id}`}
                      className="group flex h-[44px] items-center gap-[12px] border-b border-line transition-colors hover:bg-hover/50"
                    >
                      <Favicon url={site.target_url} subdomain={site.subdomain} size={20} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                        {site.subdomain}
                      </span>
                      <span className="hidden truncate text-[12px] text-fg3 sm:inline">
                        {site.target_url}
                      </span>
                      <span
                        className={cx(
                          "w-[32px] shrink-0 text-right text-[10px] font-medium uppercase tracking-[0.04em]",
                          site.mode === "live" ? "text-accent" : "text-fg4"
                        )}
                      >
                        {site.mode || "dev"}
                      </span>
                      <span
                        className={cx(
                          "w-[36px] shrink-0 text-right text-[10px] font-medium uppercase tracking-[0.04em]",
                          hs === "up" ? "text-fg3" : hs === "down" ? "text-error" : "text-fg4"
                        )}
                      >
                        {hs}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

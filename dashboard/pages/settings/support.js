import * as React from "react";
import {
  Globe,
  Code2,
  Server,
  AlertTriangle,
} from "lucide-react";
import { SettingsShell, SettingsHeader, BackToOrganization } from "@/components/settings-shell";
import { UnidralGlyph } from "@/components/brand";

const FEATURES = [
  {
    icon: Globe,
    title: "Reverse Proxy Engine",
    desc: "Proxy any website under your own subdomain or custom domain. Subdomain routing, wildcard support, multi-domain management, and automatic DNS + SSL provisioning through Cloudflare and Let's Encrypt.",
  },
  {
    icon: Code2,
    title: "JS/CSS Injection",
    desc: "Inject custom JavaScript and CSS into any proxied page — pre-built templates or your own code. Modify the target site's behavior, appearance, and functionality as traffic flows through the engine.",
  },
  {
    icon: Server,
    title: "Self-Hosted Infrastructure",
    desc: "Ships as Dockerized services: Node.js engine, nginx, and Firestore-backed persistence. Everything is managed from the dashboard — domains, certificates, and site configuration.",
  },
];

const FLOW = [
  { step: "1", title: "Add a domain", desc: "Bring a domain under management — the engine creates the Cloudflare zone, nameservers, and wildcard SSL automatically." },
  { step: "2", title: "Create a site", desc: "Point a subdomain at any target URL and the engine proxies it transparently." },
  { step: "3", title: "Customize", desc: "Attach CSS-selector rules, script injections, and overrides to shape the proxied experience." },
  { step: "4", title: "Go live", desc: "Switch the site to live mode and the proxy starts serving traffic immediately." },
];

export default function AboutPage() {
  return (
    <SettingsShell>
      <SettingsHeader crumb="About" />
      <BackToOrganization />

      <div className="mx-auto w-full max-w-[760px] px-[16px] pb-[100px] pt-[14px] md:px-[24px]">
        {}
        <div className="flex items-center gap-[14px]">
          <UnidralGlyph className="h-[40px] w-auto" />
          <div>
            <h1 className="text-[20px] font-semibold leading-[26px] text-fg">Unidral Engine</h1>
            <p className="mt-[1px] text-[13px] text-fg3">
              Self-hosted reverse proxy — OSS Edition
            </p>
          </div>
        </div>

        {}
        <div className="mt-[24px]">
          <p className="text-[14px] leading-[22px] text-fg2">
            Unidral Engine sits between a target website and your visitors. It re-serves any site
            under a domain you control, while giving you full control over what happens to the
            traffic: rewrite content, inject code, and customize the proxied experience.
            Everything runs on your own infrastructure — no third-party relay.
          </p>
          <p className="mt-[10px] text-[13px] leading-[20px] text-fg3">
            It is built for a single operator: one dashboard manages domains and sites.
          </p>
        </div>

        {}
        <div className="mt-[36px]">
          <h2 className="text-[15px] font-medium text-fg">How it works</h2>
          <div className="mt-[14px]">
            {FLOW.map((f, i) => (
              <div key={f.step} className="flex items-start gap-[12px]">
                <div className="flex flex-col items-center">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[10.5px] font-semibold text-fg2">
                    {f.step}
                  </span>
                  {i < FLOW.length - 1 ? <span className="my-[2px] w-[1px] flex-1 bg-line" /> : null}
                </div>
                <div className={i < FLOW.length - 1 ? "pb-[16px]" : ""}>
                  <div className="text-[13px] font-medium text-fg">{f.title}</div>
                  <div className="mt-[2px] text-[12.5px] leading-[19px] text-fg3">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {}
        <div className="mt-[36px]">
          <h2 className="text-[15px] font-medium text-fg">Capabilities</h2>
          <div className="mt-[14px] border-t border-line">
            {FEATURES.map((f) => (
              <div key={f.title} className="border-b border-line py-[16px]">
                <div className="flex items-center gap-[10px]">
                  <f.icon className="h-[15px] w-[15px] shrink-0 text-fg2" strokeWidth={1.8} />
                  <span className="text-[13.5px] font-medium text-fg">{f.title}</span>
                </div>
                <p className="mt-[8px] pl-[25px] text-[12.5px] leading-[19px] text-fg3">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {}
        <div className="mt-[36px]">
          <h2 className="text-[15px] font-medium text-fg">Technology</h2>
          <div className="mt-[12px] flex flex-wrap gap-[8px]">
            {[
              "Node.js", "Express", "Next.js 15", "Firebase Firestore",
              "Docker", "Nginx", "Cloudflare API", "Let's Encrypt",
              "Tailwind CSS", "certbot",
            ].map((tech) => (
              <span
                key={tech}
                className="rounded-[6px] border border-line bg-surface px-[10px] py-[5px] text-[12px] text-fg2"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {}
        <div className="mt-[36px] border-l-2 border-accent/40 bg-accent/5 px-[18px] py-[14px]">
          <h3 className="text-[13.5px] font-medium text-accent">Disclaimer</h3>
          <p className="mt-[6px] text-[12.5px] leading-[19px] text-fg3">
            This software is provided for authorized security testing, research, and educational
            purposes only. You are solely responsible for ensuring you have proper authorization
            before proxying or intercepting data from any website or user. Unauthorized
            use of this tool may violate computer fraud, privacy, and wiretapping laws in your
            jurisdiction. The authors and contributors of this software assume no liability for
            misuse or damage caused by this tool. Use at your own risk and in
            compliance with all applicable laws and regulations.
          </p>
        </div>
      </div>
    </SettingsShell>
  );
}

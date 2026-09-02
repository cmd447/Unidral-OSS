import * as React from "react";
import Head from "next/head";
import {
  Globe, Cloud, Server, ArrowRight, ArrowLeft, Check, X,
  Key, RefreshCw, Terminal, Database, ExternalLink, Loader2,
  Wifi
} from "lucide-react";
import { UnidralLockup } from "@/components/brand";
import { cx, Card, BlueButton, GhostButton } from "@/components/ui";

const STEPS = [
  { id: 1, label: "Domain", icon: Globe },
  { id: 2, label: "Cloudflare", icon: Cloud },
  { id: 3, label: "Firebase", icon: Database },
  { id: 4, label: "Launch", icon: Server },
];

export default function SetupWizard() {
  const [step, setStep] = React.useState(1);
  const [setupKey, setSetupKey] = React.useState("");

  const [baseDomain, setBaseDomain] = React.useState("");
  const [dashboardSubdomain, setDashboardSubdomain] = React.useState("");
  const [apiSubdomain, setApiSubdomain] = React.useState("");
  const [vpsIp, setVpsIp] = React.useState("");

  const [dnsStatus, setDnsStatus] = React.useState(null);
  const [dnsResolvedIp, setDnsResolvedIp] = React.useState("");

  const [cfToken, setCfToken] = React.useState("");
  const [cfAccountId, setCfAccountId] = React.useState("");
  const [cfValidationStatus, setCfValidationStatus] = React.useState(null);
  const [cfValidationMsg, setCfValidationMsg] = React.useState("");

  const [firebaseProjectId, setFirebaseProjectId] = React.useState("");
  const [firebaseSaJson, setFirebaseSaJson] = React.useState("");

  const [initializing, setInitializing] = React.useState(false);
  const [consoleLogs, setConsoleLogs] = React.useState([]);
  const [initSuccess, setInitSuccess] = React.useState(false);
  const [initError, setInitError] = React.useState("");

  const consoleRef = React.useRef(null);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const key = params.get("key");
      if (key) setSetupKey(key);

      fetch("/api/setup/status")
        .then(res => res.json())
        .then(data => {
          if (data.installed) setInitSuccess(true);
        })
        .catch(() => {});
    }
  }, []);

  React.useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLogs]);

  async function verifyDns() {
    if (!baseDomain.trim() || !vpsIp.trim()) return;
    setDnsStatus("checking");
    setDnsResolvedIp("");
    try {
      const res = await fetch(`/api/setup/verify-dns?domain=${encodeURIComponent(baseDomain.trim())}&ip=${encodeURIComponent(vpsIp.trim())}`);
      const data = await res.json();
      if (data.matches) {
        setDnsStatus("ok");
        setDnsResolvedIp(data.resolvedIp);
      } else {
        setDnsStatus("fail");
        setDnsResolvedIp(data.resolvedIp || "no record");
      }
    } catch {
      setDnsStatus("fail");
      setDnsResolvedIp("lookup failed");
    }
  }

  async function validateCloudflareToken() {
    if (!cfToken) return;
    setCfValidationStatus("loading");
    setCfValidationMsg("");
    try {
      const res = await fetch("/api/setup/validate-cloudflare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cfToken })
      });
      const data = await res.json();
      if (data.valid) {
        setCfValidationStatus("valid");
        setCfValidationMsg(data.message || "Token verified");
      } else {
        setCfValidationStatus("invalid");
        setCfValidationMsg(data.message || "Validation failed");
      }
    } catch (e) {
      setCfValidationStatus("invalid");
      setCfValidationMsg(e.message);
    }
  }

  async function launchEngine() {
    setInitializing(true);
    setConsoleLogs([]);
    setInitError("");
    try {
      const payload = {
        setupKey, baseDomain, dashboardSubdomain, apiSubdomain,
        cfToken, cfAccountId, vpsIp, firebaseProjectId,
        firebaseServiceAccountJson: firebaseSaJson
      };
      const res = await fetch("/api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok && res.headers.get("content-type")?.includes("json")) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Initialization failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setConsoleLogs(prev => [...prev, text]);
      }
      setInitSuccess(true);
    } catch (e) {
      setInitError(e.message);
    } finally {
      setInitializing(false);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setFirebaseSaJson(evt.target.result);
    reader.readAsText(file);
  }

  const step1Valid = baseDomain.trim() && dashboardSubdomain.trim() && apiSubdomain.trim() && vpsIp.trim() && dnsStatus === "ok";
  const step2Valid = cfToken.trim() && cfAccountId.trim() && cfValidationStatus === "valid";
  const step3Valid = firebaseProjectId.trim() && firebaseSaJson.trim();

  return (
    <>
      <Head><title>Setup - Unidral Engine</title></Head>
      <div className="min-h-screen bg-canvas text-fg">
        {}
        <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur-sm">
          <div className="mx-auto flex h-[48px] max-w-[680px] items-center justify-between px-[16px]">
            <UnidralLockup />
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-fg4">Setup</span>
          </div>
        </header>

        <div className="mx-auto max-w-[680px] px-[16px] py-[20px] md:px-[24px] md:py-[28px]">
          {}
          <div className="mb-[20px] flex items-center gap-[0px] border-b border-line">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = step === s.id;
              const isDone = step > s.id;
              return (
                <React.Fragment key={s.id}>
                  <button
                    onClick={() => isDone && setStep(s.id)}
                    disabled={!isDone && !isActive}
                    className={cx(
                      "relative flex h-[32px] items-center gap-[5px] px-[10px] text-[12px] font-medium transition-colors",
                      isActive ? "text-fg" :
                      isDone ? "text-fg2 hover:text-fg" :
                      "text-fg4"
                    )}
                  >
                    {isDone ? <Check className="h-[12px] w-[12px] text-accent" strokeWidth={2} /> : <Icon className="h-[12px] w-[12px]" strokeWidth={1.8} />}
                    {s.label}
                    {isActive ? (
                      <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-accent" />
                    ) : null}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {}
          {step === 1 && (
            <div className="animate-pageIn space-y-[14px]">
              <SectionTitle icon={Globe} title="Domain & DNS" sub="Your apex domain and subdomains. A wildcard A record must point to this VPS." />

              <Card className="divide-y divide-line">
                <InputRow label="Base Domain" required>
                  <input
                    type="text"
                    value={baseDomain}
                    onChange={(e) => { setBaseDomain(e.target.value); setDnsStatus(null); }}
                    placeholder="mydomain.com"
                    className={inputCls}
                  />
                </InputRow>
                <InputRow label="Dashboard Subdomain" required>
                  <input
                    type="text"
                    value={dashboardSubdomain}
                    onChange={(e) => setDashboardSubdomain(e.target.value)}
                    placeholder="thirdeye"
                    className={inputCls}
                  />
                </InputRow>
                <InputRow label="API Subdomain" required>
                  <input
                    type="text"
                    value={apiSubdomain}
                    onChange={(e) => setApiSubdomain(e.target.value)}
                    placeholder="debian"
                    className={inputCls}
                  />
                </InputRow>
                <InputRow label="VPS IPv4" required>
                  <input
                    type="text"
                    value={vpsIp}
                    onChange={(e) => { setVpsIp(e.target.value); setDnsStatus(null); }}
                    placeholder="1.2.3.4"
                    className={cx(inputCls, "font-mono tabular-nums")}
                  />
                </InputRow>
              </Card>

              {}
              <div className="flex items-center gap-[8px]">
                <GhostButton onClick={verifyDns} disabled={!baseDomain.trim() || !vpsIp.trim() || dnsStatus === "checking"} className="h-[28px]">
                  {dnsStatus === "checking" ? <><Loader2 className="h-[12px] w-[12px] animate-spin" strokeWidth={1.8} /> Checking</> : <><Wifi className="h-[12px] w-[12px]" strokeWidth={1.8} /> Verify DNS</>}
                </GhostButton>
                {dnsStatus === "ok" && <span className="flex items-center gap-[4px] text-[11.5px] text-success"><Check className="h-[12px] w-[12px]" strokeWidth={2} /> Resolves to {dnsResolvedIp}</span>}
                {dnsStatus === "fail" && <span className="flex items-center gap-[4px] text-[11.5px] text-error"><X className="h-[12px] w-[12px]" strokeWidth={2} /> Resolved {dnsResolvedIp}, expected {vpsIp}</span>}
              </div>
              {dnsStatus === "fail" && (
                <p className="text-[11px] leading-[16px] text-fg3">
                  Create a wildcard A record in Cloudflare: type <span className="font-mono text-fg2">A</span>, name <span className="font-mono text-fg2">*</span>, content <span className="font-mono text-fg2">{vpsIp || "your VPS IP"}</span>, proxy off. DNS propagation may take a few minutes.
                </p>
              )}

              <NavButtons onNext={() => setStep(2)} nextDisabled={!step1Valid} />
            </div>
          )}

          {}
          {step === 2 && (
            <div className="animate-pageIn space-y-[14px]">
              <SectionTitle icon={Cloud} title="Cloudflare" sub="DNS management and automated wildcard SSL certificates." />

              <Card className="divide-y divide-line">
                <InputRow label="API Token" required>
                  <input
                    type="password"
                    value={cfToken}
                    onChange={(e) => { setCfToken(e.target.value); setCfValidationStatus(null); }}
                    placeholder="cfk_..."
                    className={cx(inputCls, "font-mono")}
                  />
                </InputRow>
                <InputRow label="Account ID" required>
                  <input
                    type="text"
                    value={cfAccountId}
                    onChange={(e) => setCfAccountId(e.target.value)}
                    placeholder="8characterid"
                    className={cx(inputCls, "font-mono")}
                  />
                </InputRow>
              </Card>

              <div className="flex items-center gap-[8px]">
                <GhostButton onClick={validateCloudflareToken} disabled={!cfToken || cfValidationStatus === "loading"} className="h-[28px]">
                  {cfValidationStatus === "loading" ? <><Loader2 className="h-[12px] w-[12px] animate-spin" strokeWidth={1.8} /> Validating</> :
                   cfValidationStatus === "valid" ? <><Check className="h-[12px] w-[12px]" strokeWidth={2} /> Valid</> :
                   <><Check className="h-[12px] w-[12px]" strokeWidth={1.8} /> Validate</>}
                </GhostButton>
                {cfValidationMsg && <span className={cx("text-[11.5px]", cfValidationStatus === "valid" ? "text-success" : "text-error")}>{cfValidationMsg}</span>}
              </div>

              <HelpLine>
                dash.cloudflare.com, My Profile, API Tokens, Create Token, Edit zone DNS template, select your zone, copy token.
              </HelpLine>
              <HelpLink href="https://www.youtube.com/watch?v=o-oeKmtC1JQ" label="Video: creating a Cloudflare API token" />

              <NavButtons onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!step2Valid} />
            </div>
          )}

          {}
          {step === 3 && (
            <div className="animate-pageIn space-y-[14px]">
              <SectionTitle icon={Database} title="Firebase" sub="Firestore persists sites, rules, sessions, tokens, and settings." />

              <Card className="divide-y divide-line">
                <InputRow label="Project ID" required>
                  <input
                    type="text"
                    value={firebaseProjectId}
                    onChange={(e) => setFirebaseProjectId(e.target.value)}
                    placeholder="your-project-id"
                    className={cx(inputCls, "font-mono")}
                  />
                </InputRow>
                <div className="px-[14px] py-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-fg">Service Account JSON <span className="text-accent">*</span></span>
                    <label className="flex cursor-pointer items-center gap-[4px] text-[11.5px] text-link hover:underline">
                      <Key className="h-[11px] w-[11px]" strokeWidth={1.8} />
                      Upload file
                      <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={firebaseSaJson}
                    onChange={(e) => setFirebaseSaJson(e.target.value)}
                    placeholder='{ "type": "service_account", ... }'
                    className="mt-[6px] w-full rounded-[6px] border border-line bg-surface px-[10px] py-[8px] font-mono text-[11.5px] text-fg2 focus:border-accent focus:outline-none"
                  />
                  {firebaseSaJson && <p className="mt-[4px] flex items-center gap-[4px] text-[11px] text-success"><Check className="h-[11px] w-[11px]" strokeWidth={2} /> {firebaseSaJson.length} chars loaded</p>}
                </div>
              </Card>

              <HelpLine>
                console.firebase.google.com, Add project, Project Settings, Service Accounts, Generate new private key, upload the JSON here. Enable Firestore in production mode.
              </HelpLine>
              <div className="flex gap-[12px]">
                <HelpLink href="https://www.youtube.com/watch?v=5VQRF2wzcr4" label="Video: creating a Firebase project" />
                <HelpLink href="https://www.youtube.com/watch?v=yylnC3dr_no" label="Video: service account key" />
              </div>

              <NavButtons onBack={() => setStep(2)} onNext={() => setStep(4)} nextDisabled={!step3Valid} />
            </div>
          )}

          {}
          {step === 4 && (
            <div className="animate-pageIn space-y-[14px]">
              <SectionTitle icon={Server} title="Review & Launch" sub="The installer writes config, issues SSL, and starts all services." />

              <Card className="divide-y divide-line">
                <ReviewRow label="Base Domain" value={baseDomain} />
                <ReviewRow label="Dashboard" value={`${dashboardSubdomain}.${baseDomain}`} />
                <ReviewRow label="API" value={`${apiSubdomain}.${baseDomain}`} />
                <ReviewRow label="VPS IP" value={vpsIp} mono />
                <ReviewRow label="DNS" value={dnsStatus === "ok" ? "Verified" : "Unverified"} valueClass={dnsStatus === "ok" ? "text-success" : "text-error"} />
                <ReviewRow label="Cloudflare" value={cfValidationStatus === "valid" ? "Validated" : "Not validated"} valueClass={cfValidationStatus === "valid" ? "text-success" : "text-error"} />
                <ReviewRow label="Firebase" value={firebaseProjectId || "-"} mono />
                <ReviewRow label="Service Account" value={firebaseSaJson ? "Loaded" : "-"} valueClass={firebaseSaJson ? "text-success" : ""} />
              </Card>

              {}
              {(initializing || consoleLogs.length > 0 || initSuccess || initError) && (
                <div ref={consoleRef} className="scroll-thin max-h-[200px] overflow-y-auto rounded-[8px] border border-line bg-black p-[10px] font-mono text-[11px] leading-[16px]">
                  <div className="mb-[4px] flex items-center gap-[4px] border-b border-line pb-[4px] text-fg4">
                    <Terminal className="h-[11px] w-[11px]" strokeWidth={1.8} />
                    <span className="text-[10px] uppercase tracking-wider">Log</span>
                  </div>
                  {consoleLogs.map((log, i) => <pre key={i} className="whitespace-pre-wrap text-success">{log}</pre>)}
                  {initSuccess && <p className="mt-[4px] flex items-center gap-[4px] font-bold text-success"><Check className="h-[11px] w-[11px]" strokeWidth={2} /> Complete. Redirecting...</p>}
                  {initError && <p className="mt-[4px] flex items-center gap-[4px] font-bold text-error"><X className="h-[11px] w-[11px]" strokeWidth={2} /> {initError}</p>}
                </div>
              )}

              <div className="flex items-center justify-between pt-[4px]">
                <GhostButton onClick={() => setStep(3)} disabled={initializing} className="h-[30px]">
                  <ArrowLeft className="h-[12px] w-[12px]" strokeWidth={1.8} /> Back
                </GhostButton>
                {initSuccess ? (
                  <a href={`https://${dashboardSubdomain}.${baseDomain}`} className="group flex h-[30px] items-center gap-[6px] text-[12.5px] font-medium text-fg transition-opacity hover:opacity-75">
                    <span className="border-b-2 border-accent pb-[2px]">Open Dashboard</span>
                    <ArrowRight className="h-[12px] w-[12px] text-accent transition-transform group-hover:translate-x-[2px]" strokeWidth={1.8} />
                  </a>
                ) : (
                  <BlueButton onClick={launchEngine} disabled={initializing} className="h-[30px]">
                    {initializing ? <><Loader2 className="h-[12px] w-[12px] animate-spin" strokeWidth={1.8} /> Launching</> : <><Server className="h-[12px] w-[12px]" strokeWidth={1.8} /> Launch</>}
                  </BlueButton>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const inputCls = "w-full rounded-[6px] border border-line bg-surface px-[10px] py-[7px] text-[13px] text-fg focus:border-accent focus:outline-none";

function SectionTitle({ icon: Icon, title, sub }) {
  return (
    <div>
      <h1 className="flex items-center gap-[6px] text-[15px] font-bold tracking-tight text-fg">
        <Icon className="h-[14px] w-[14px] text-accent" strokeWidth={1.8} />
        {title}
      </h1>
      <p className="mt-[3px] text-[12px] leading-[17px] text-fg3">{sub}</p>
    </div>
  );
}

function InputRow({ label, required, children }) {
  return (
    <div className="px-[14px] py-[10px]">
      <label className="mb-[5px] block text-[12px] font-medium text-fg2">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      {children}
    </div>
  );
}

function NavButtons({ onBack, onNext, nextDisabled }) {
  return (
    <div className="flex items-center justify-between pt-[4px]">
      {onBack ? (
        <GhostButton onClick={onBack} className="h-[30px]">
          <ArrowLeft className="h-[12px] w-[12px]" strokeWidth={1.8} /> Back
        </GhostButton>
      ) : <div />}
      <BlueButton onClick={onNext} disabled={nextDisabled} className="h-[30px]">
        Continue <ArrowRight className="h-[12px] w-[12px]" strokeWidth={1.8} />
      </BlueButton>
    </div>
  );
}

function HelpLine({ children }) {
  return <p className="text-[11px] leading-[16px] text-fg4">{children}</p>;
}

function HelpLink({ href, label }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-[4px] text-[11px] text-link hover:underline">
      <ExternalLink className="h-[10px] w-[10px]" strokeWidth={1.8} />
      {label}
    </a>
  );
}

function ReviewRow({ label, value, valueClass = "", mono = false }) {
  return (
    <div className="flex items-center justify-between px-[14px] py-[8px]">
      <span className="text-[12px] text-fg3">{label}</span>
      <span className={cx("text-[12.5px] text-fg2", mono && "font-mono tabular-nums", valueClass)}>{value}</span>
    </div>
  );
}

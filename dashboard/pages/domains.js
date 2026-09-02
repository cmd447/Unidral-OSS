import * as React from "react";
import {
  PanelLeft,
  Plus,
  Trash2,
  RefreshCw,
  Terminal,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  Globe,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Drawer,
  cx,
  Card,
  BlueButton,
  GhostButton,
  Badge,
  Toggle,
  SectionHeading,
  ConfirmDialog,
} from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api } from "@/lib-engine/api";

const INPUT_CLASS =
  "h-[30px] w-full rounded-[6px] border border-stroke bg-raised px-[10px] text-[12.5px] text-fg outline-none focus:border-accent";

function stripDomain(raw) {
  let v = (raw || "").trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/^www\./, "");
  v = v.replace(/\/+$/, "");
  return v;
}

function allChecksPass(dom) {
  
  if (dom.status === "active" || dom.status === "provisioned") return true;
  
  return (
    (dom.nameserver_status === "active" || dom.nameserver_status === "verified") &&
    (dom.propagation_status === "success" || dom.propagation_status === "propagated") &&
    (dom.ssl_status === "active" || dom.ssl_status === "cf_universal")
  );
}

function stepLabel(status) {
  const key = (status || "").toLowerCase();
  if (
    key === "done" ||
    key === "active" ||
    key === "success" ||
    key === "provisioned"
  )
    return "Done";
  if (key === "waiting_user") return "Waiting for you";
  if (key === "in_progress" || key === "checking" || key === "provisioning")
    return "In progress";
  if (key === "error" || key === "failed") return "Error";
  return "Pending";
}

function StepDot({ status }) {
  const key = (status || "").toLowerCase();
  let color = "bg-stroke"; 
  let pulse = false;
  if (
    key === "done" ||
    key === "active" ||
    key === "success" ||
    key === "provisioned"
  ) {
    color = "bg-fg"; 
  } else if (
    key === "waiting_user" ||
    key === "in_progress" ||
    key === "checking" ||
    key === "provisioning"
  ) {
    color = "bg-accent"; 
    pulse = true;
  } else if (key === "error" || key === "failed") {
    color = "bg-error"; 
  }
  return (
    <span
      className={cx(
        "mt-[5px] inline-block h-[7px] w-[7px] shrink-0 rounded-full",
        color,
        pulse && "animate-pulse"
      )}
    />
  );
}

function NameserverRow({ ns }) {
  const [copied, setCopied] = React.useState(false);
  const doCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ns).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-center gap-[8px] rounded-[5px] border border-line bg-surface px-[8px] py-[4px]">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg2">{ns}</code>
      <button
        type="button"
        onClick={doCopy}
        className="flex shrink-0 items-center gap-[3px] rounded-[4px] px-[5px] py-[2px] text-[10.5px] text-fg3 transition-colors hover:bg-raised hover:text-fg"
      >
        {copied ? (
          <>
            <Check className="h-[10px] w-[10px] text-fg" strokeWidth={2} />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-[10px] w-[10px]" strokeWidth={1.8} />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function DomainCard({
  dom,
  steps,
  fullyActive,
  sitesCount = 0,
  vResult,
  isVerifying,
  expanded,
  onExpand,
  onToggleProxy,
  onVerify,
  onRemove,
}) {
  return (
    <Card key={dom.id} className="px-[14px] py-[12px]">
      {}
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[6px]">
            <span className="truncate text-[13px] font-medium text-fg">{dom.domain}</span>
            {fullyActive ? (
              <Badge tone="new">Active</Badge>
            ) : dom.status === "error" ? (
              <Badge>
                <span className="flex items-center gap-[3px]">
                  <AlertCircle className="h-[9px] w-[9px]" strokeWidth={2} />
                  Error
                </span>
              </Badge>
            ) : (
              <Badge>
                <span className="flex items-center gap-[3px]">
                  <Loader2 className="h-[9px] w-[9px] animate-spin" strokeWidth={2} />
                  Provisioning
                </span>
              </Badge>
            )}
            {dom.proxied ? <Badge>Proxied</Badge> : null}
          </div>
          {dom.ip || sitesCount > 0 ? (
            <div className="mt-[4px] flex items-center gap-[10px] text-[11px] text-fg4">
              {dom.ip ? <span>IP: {dom.ip}</span> : null}
              {sitesCount > 0 ? (
                <span>
                  {sitesCount} site{sitesCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {}
        <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
          <div className="flex items-center gap-[5px]">
            <span className="text-[11px] text-fg4">Proxy</span>
            <Toggle
              checked={!!dom.proxied}
              onChange={() => onToggleProxy(dom)}
              label="Toggle proxy"
            />
          </div>
          <GhostButton onClick={() => onVerify(dom)} disabled={isVerifying}>
            {isVerifying ? (
              <Loader2 className="h-[12px] w-[12px] animate-spin" strokeWidth={2} />
            ) : null}
            Check
          </GhostButton>
          <button
            type="button"
            onClick={() => onRemove(dom)}
            title="Remove domain"
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-errorBorder hover:text-error"
          >
            <Trash2 className="h-[13px] w-[13px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {}
      {vResult ? (
        <div
          className={cx(
            "mt-[10px] rounded-[6px] border px-[10px] py-[6px] text-[11.5px]",
            vResult.state === "error"
              ? "border-errorBorder text-error"
              : vResult.state === "success"
              ? "border-errorBorder text-fg"
              : "border-line text-fg3"
          )}
        >
          {vResult.message}
        </div>
      ) : null}

      {}
      {fullyActive && !expanded ? (
        <div className="mt-[10px] border-t border-line pt-[10px]">
          <button
            type="button"
            onClick={() => onExpand(true)}
            className="text-[11.5px] text-fg3 transition-colors hover:text-fg"
          >
            Show setup details
          </button>
        </div>
      ) : (
        <div className="mt-[12px] space-y-[10px] border-t border-line pt-[12px]">
          {fullyActive && expanded ? (
            <button
              type="button"
              onClick={() => onExpand(false)}
              className="mb-[4px] text-[11.5px] text-fg3 transition-colors hover:text-fg"
            >
              Hide setup details
            </button>
          ) : null}
          {steps.map((step) => {
            const sKey = (step.status || "").toLowerCase();
            const isDone =
              sKey === "done" ||
              sKey === "active" ||
              sKey === "success" ||
              sKey === "provisioned";
            const isError = sKey === "error" || sKey === "failed";
            const showNsBox = step.key === "nameservers" && Array.isArray(step.detail) && !isDone;
            return (
              <div key={step.key} className="flex items-start gap-[10px]">
                <StepDot status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[12.5px] text-fg">{step.title}</span>
                    <span
                      className={cx(
                        "text-[10.5px]",
                        isDone
                          ? "text-fg"
                          : isError
                          ? "text-error"
                          : "text-fg4"
                      )}
                    >
                      {stepLabel(step.status)}
                    </span>
                  </div>
                  {step.detail ? (
                    <div className="mt-[6px]">
                      {showNsBox ? (
                        <>
                          <div className="border-l-2 border-error p-[10px]">
                            <div className="mb-[6px] text-[11px] font-medium text-fg2">
                              Update nameservers at your registrar to:
                            </div>
                            <div className="space-y-[4px]">
                              {step.detail.map((ns) => (
                                <NameserverRow key={ns} ns={ns} />
                              ))}
                            </div>
                          </div>
                          <div className="mt-[6px] text-[11px] text-fg3">
                            We&apos;ll check automatically every few seconds. No need to refresh.
                          </div>
                          {step.serverDetail ? (
                            <div className="mt-[4px] text-[11px] text-fg4 whitespace-pre-wrap">{step.serverDetail}</div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-[11px] text-fg3 whitespace-pre-wrap">{step.detail}</div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function DomainsPage() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const [domains, setDomains] = React.useState([]);
  const [logs, setLogs] = React.useState([]);
  const [sites, setSites] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [spinning, setSpinning] = React.useState(false);
  const [error, setError] = React.useState("");

  const [showForm, setShowForm] = React.useState(false);
  const [formDomain, setFormDomain] = React.useState("");
  const [formProxied, setFormProxied] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [formError, setFormError] = React.useState("");

  const [showLogs, setShowLogs] = React.useState(false);
  const [verifyResults, setVerifyResults] = React.useState({});
  const [expandedDomains, setExpandedDomains] = React.useState({});
  const [verifying, setVerifying] = React.useState({});
  const [syncingIp, setSyncingIp] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState(null); 

  const [confirmState, setConfirmState] = React.useState(null); 
  
  const [proxyWarning, setProxyWarning] = React.useState(null); 

  const showFloatingToggle = isDesktop ? collapsed : true;

  const load = React.useCallback(async () => {
    try {
      const [domRes, logsRes, sitesRes] = await Promise.all([
        api.listDomains().catch(() => ({ domains: [] })),
        api.domainLogs({ limit: 50 }).catch(() => ({ logs: [] })),
        api.listSites().catch(() => ({ sites: [] })),
      ]);
      setDomains((domRes?.domains || []).map((d) => ({ ...d, proxied: d.cf_proxied !== false })));
      setLogs(logsRes?.logs || []);
      setSites(sitesRes?.sites || sitesRes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const hasProvisioning = React.useMemo(
    () =>
      domains.some(
        (d) =>
          d.status === "provisioning" ||
          d.propagation_status === "checking" ||
          d.nameserver_status === "pending" ||
          d.ssl_status === "pending"
      ),
    [domains]
  );

  React.useEffect(() => {
    if (loading || domains.length === 0) return;
    const intervalMs = hasProvisioning ? 5000 : 30000;
    const id = setInterval(() => {
      load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [hasProvisioning, loading, domains.length, load]);

  const refresh = () => {
    setSpinning(true);
    load();
  };

  function openAddDomain() {
    setShowForm((v) => !v);
  }

  async function handleAddDomain(e) {
    e.preventDefault();
    const clean = stripDomain(formDomain);
    if (!clean) {
      setFormError("Domain is required");
      return;
    }
    setAdding(true);
    setFormError("");
    try {
      const opts = { proxied: formProxied };
      await api.addDomain(clean, opts);
      setFormDomain("");
      setShowForm(false);
      
      await load();
      
      setTimeout(() => load(), 2000);
      setTimeout(() => load(), 5000);
    } catch (err) {
      setFormError(err.message || "Failed to add domain. Make sure Unidral is configured.");
    } finally {
      setAdding(false);
    }
  }

  function handleRemoveDomain(d) {
    setConfirmState({
      title: "Remove domain",
      message: `Remove domain "${d.domain}"? This will delete DNS records and revoke the SSL certificate.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        try {
          await api.removeDomain(d.id);
          await load();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  async function handleVerifyDomain(dom) {
    setVerifying((v) => ({ ...v, [dom.id]: true }));
    setVerifyResults((v) => ({ ...v, [dom.id]: { state: "running", message: "Checking..." } }));
    try {
      await api.verifyDomain(dom.id);
      
      const domRes = await api.listDomains().catch(() => ({ domains: [] }));
      const freshDomains = (domRes?.domains || []).map((d) => ({ ...d, proxied: d.cf_proxied !== false }));
      setDomains(freshDomains);
      const updated = freshDomains.find((d) => d.id === dom.id);
      const refreshed = updated || dom;
      if (allChecksPass(refreshed)) {
        setVerifyResults((v) => ({
          ...v,
          [dom.id]: { state: "success", message: "All checks passed - domain is active." },
        }));
      } else {
        const pending = [];
        if (refreshed.nameserver_status !== "active") pending.push("nameservers");
        if (refreshed.propagation_status !== "success") pending.push("DNS propagation");
        if (refreshed.ssl_status !== "active" && refreshed.ssl_status !== "cf_universal") pending.push("SSL");
        setVerifyResults((v) => ({
          ...v,
          [dom.id]: { state: "pending", message: `Still waiting on: ${pending.join(", ")}` },
        }));
      }
    } catch (err) {
      setVerifyResults((v) => ({
        ...v,
        [dom.id]: { state: "error", message: err.message || "Check failed." },
      }));
    } finally {
      setVerifying((v) => ({ ...v, [dom.id]: false }));
    }
  }

  function handleToggleProxy(d) {
    const newVal = !d.proxied;
    if (!allChecksPass(d)) {
      setConfirmState({
        title: "Domain not ready",
        message:
          "This domain hasn't been fully set up yet. Complete all provisioning steps before toggling the proxy.",
        confirmLabel: "OK",
        onConfirm: () => {},
      });
      return;
    }

    if (!newVal) {
      setProxyWarning({
        domain: d,
        onConfirm: async () => {
          try {
            await api.updateDomainProxy(d.id, false);
            await load();
          } catch (err) {
            setError(err.message);
          }
        },
      });
      return;
    }

    setConfirmState({
      title: "Enable proxy",
      message: `Enable the proxy for "${d.domain}"?`,
      confirmLabel: "Enable",
      onConfirm: async () => {
        try {
          await api.updateDomainProxy(d.id, true);
          await load();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  async function handleSyncIp() {
    setSyncingIp(true);
    setSyncResult(null);
    setError("");
    try {
      const ipRes = await api.getVpsIp();
      const vpsIp = ipRes?.ip || ipRes?.configuredIp;
      if (!vpsIp) throw new Error("Could not determine VPS IP");
      const result = await api.syncDomainIps(vpsIp);
      setSyncResult(result);
      await load();
    } catch (err) {
      setError(err.message || "Failed to sync DNS records");
    } finally {
      setSyncingIp(false);
    }
  }

  function buildSteps(dom) {
    const nsList = dom.nameservers || dom.cf_nameservers || [];
    const serverSteps = dom.steps || [];
    const findStep = (key) => serverSteps.find((s) => s.key === key);
    const steps = [
      {
        key: "zone",
        title: "Add to Unidral",
        status: findStep("zone")?.status || dom.status,
        detail: findStep("zone")?.detail || null,
      },
      {
        key: "nameservers",
        title: "Update nameservers",
        status: findStep("nameserver")?.status || dom.nameserver_status || "pending",
        
        detail: nsList.length > 0 ? nsList : (findStep("nameserver")?.detail || null),
        serverDetail: findStep("nameserver")?.detail || null,
      },
      {
        key: "dns",
        title: "DNS records",
        status: findStep("dns")?.status || dom.propagation_status || "pending",
        detail: findStep("dns")?.detail || null,
      },
      {
        key: "ssl",
        title: "SSL certificate",
        status: findStep("ssl")?.status || dom.ssl_status || "pending",
        detail: findStep("ssl")?.detail || null,
      },
      {
        key: "engine",
        title: "Engine registration",
        status: findStep("engine")?.status || "pending",
        detail: findStep("engine")?.detail || null,
      },
      {
        key: "propagation",
        title: "DNS propagation",
        status: findStep("propagation")?.status || dom.propagation_status || "pending",
        detail: findStep("propagation")?.detail || null,
      },
    ];
    return steps;
  }

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

        <div className="mx-auto w-full max-w-[760px] px-[16px] pb-[80px] pt-[60px] md:px-[24px] md:pt-[72px]">
          <div className="mb-[20px] flex flex-wrap items-center justify-between gap-[8px] px-[8px]">
            <div>
              <h1 className="text-[20px] font-bold tracking-tight text-fg">Domains</h1>
              <p className="mt-[2px] text-[12.5px] text-fg3">
                Manage base domains, DNS records, and SSL certificates.
              </p>
              <p className="mt-[2px] text-[11px] text-fg4">
                {loading ? "Loading..." : `${domains.length} domains`}
                {hasProvisioning ? (
                  <span className="ml-[6px] inline-flex items-center gap-[3px] text-accent">
                    <Loader2 className="h-[10px] w-[10px] animate-spin" strokeWidth={2} />
                    provisioning
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                onClick={handleSyncIp}
                disabled={syncingIp || domains.length === 0}
                title="Detect VPS IP and update all domain DNS records"
                className="flex h-[28px] items-center gap-[5px] text-[11.5px] text-fg2 transition-colors hover:text-fg disabled:opacity-50"
              >
                {syncingIp ? (
                  <Loader2 className="h-[12px] w-[12px] animate-spin" strokeWidth={2} />
                ) : (
                  <Globe className="h-[12px] w-[12px]" strokeWidth={1.8} />
                )}
                Sync IP
              </button>
              <button
                type="button"
                onClick={refresh}
                className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-fg2 transition-colors hover:bg-line hover:text-fg"
              >
                <RefreshCw className={cx("h-[14px] w-[14px]", spinning && "animate-spin")} strokeWidth={1.8} />
              </button>
              <BlueButton onClick={openAddDomain}>
                <Plus className="h-[13px] w-[13px]" strokeWidth={2} />
                Add domain
              </BlueButton>
            </div>
          </div>

          {syncResult ? (
            <div className="mb-[12px] border-l-2 border-line px-[8px] py-[4px] text-[12px] text-fg3">
              <div className="font-medium text-fg">Synced DNS to IP {syncResult.ip}</div>
              <div className="mt-[2px]">
                {syncResult.success} succeeded, {syncResult.failed} failed out of {syncResult.total} domains
              </div>
              {syncResult.results?.some(r => !r.ok) ? (
                <div className="mt-[4px] text-error">
                  {syncResult.results.filter(r => !r.ok).map(r => `${r.domain}: ${r.error}`).join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mb-[12px] border-l-2 border-error px-[14px] py-[10px] text-[12.5px] text-error">
              {error}
            </div>
          ) : null}

          {showForm ? (
            <Card className="mb-[14px] p-[16px]">
              <SectionHeading title="Add a new domain" description="Add a custom domain with DNS verification." />
              <form onSubmit={handleAddDomain} className="space-y-[12px]">
                <div>
                  <label className="mb-[4px] block text-[12px] text-fg3">Domain</label>
                  <input
                    type="text"
                    value={formDomain}
                    onChange={(e) => setFormDomain(stripDomain(e.target.value))}
                    placeholder="my-domain.com"
                    className={INPUT_CLASS}
                  />
                  <div className="mt-[4px] text-[11px] text-fg4">
                    Enter the bare domain. https:
                  </div>
                </div>
                <div className="flex items-center gap-[8px]">
                  <Toggle checked={formProxied} onChange={setFormProxied} label="Proxy" />
                  <span className="text-[12px] text-fg3">Proxy (orange cloud)</span>
                </div>
                {formError ? <div className="text-[12px] text-error">{formError}</div> : null}
                <div className="flex items-center gap-[8px] pt-[4px]">
                  <BlueButton type="submit" disabled={adding}>
                    {adding ? "Adding..." : "Add domain"}
                  </BlueButton>
                  <GhostButton onClick={() => setShowForm(false)}>Cancel</GhostButton>
                </div>
              </form>
            </Card>
          ) : null}

          {}
          <div className="px-[8px]">
            <SectionHeading title="All domains" />
            {loading ? (
              <Card className="p-[24px] text-center text-[12.5px] text-fg3">Loading domains...</Card>
            ) : domains.length === 0 ? (
              <Card className="p-[24px] text-center">
                <div className="text-[13px] text-fg">No domains yet</div>
                <div className="mt-[4px] text-[12.5px] text-fg3">
                  Click &quot;Add domain&quot; to add a custom domain.
                </div>
              </Card>
            ) : (
              <div className="space-y-[6px]">
                {domains.map((dom) => (
                  <DomainCard
                    key={dom.id}
                    dom={dom}
                    steps={buildSteps(dom)}
                    fullyActive={allChecksPass(dom)}
                    sitesCount={sites.filter((s) => (s.base_domain || "").toLowerCase() === dom.domain.toLowerCase()).length}
                    vResult={verifyResults[dom.id]}
                    isVerifying={verifying[dom.id]}
                    expanded={expandedDomains[dom.id]}
                    onExpand={(val) => setExpandedDomains((v) => ({ ...v, [dom.id]: val }))}
                    onToggleProxy={handleToggleProxy}
                    onVerify={handleVerifyDomain}
                    onRemove={handleRemoveDomain}
                  />
                ))}
              </div>
            )}
          </div>

          {}
          <div className="mt-[20px] px-[8px]">
            <div className="mb-[10px] flex items-center justify-between">
              <SectionHeading title="Domain logs" description="Recent domain operation logs." className="mb-0" />
              <GhostButton onClick={() => setShowLogs((v) => !v)}>
                <Terminal className="h-[12px] w-[12px]" strokeWidth={1.8} />
                {showLogs ? "Hide" : "Show"}
              </GhostButton>
            </div>
            {showLogs ? (
              <Card className="p-[12px]">
                {logs.length === 0 ? (
                  <div className="py-[10px] text-center text-[12px] text-fg3">No logs available.</div>
                ) : (
                  <div className="max-h-[300px] space-y-[4px] overflow-y-auto">
                    {logs.map((log, i) => (
                      <div
                        key={log.id || i}
                        className="flex items-start gap-[8px] border-b border-line py-[6px] last:border-b-0"
                      >
                        <span
                          className={cx(
                            "shrink-0 rounded-[3px] px-[4px] py-[1px] text-[10px] font-medium",
                            log.level === "error"
                              ? "bg-errorBorder text-error"
                              : log.level === "warn"
                              ? "bg-errorBg text-accent"
                              : "bg-pressed text-fg3"
                          )}
                        >
                          {log.level || "info"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-fg2">{log.message}</div>
                          <div className="mt-[1px] text-[10.5px] text-fg4">
                            {log.domain || ""} {log.timestamp ? `- ${new Date(log.timestamp).toLocaleString()}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      </main>

      {}
      <ConfirmDialog
        open={!!proxyWarning}
        onClose={() => setProxyWarning(null)}
        onConfirm={() => {
          const fn = proxyWarning?.onConfirm;
          setProxyWarning(null);
          if (fn) fn();
        }}
        title="Turn off proxy?"
        warning
        confirmLabel="Turn off"
        message={
          "Turning off the proxy is not recommended. The proxy provides DDoS protection, caching, and SSL. Only turn it off if the site you are cloning is not working properly with the proxy enabled. Are you sure you want to continue?"
        }
      />

      {}
      <ConfirmDialog
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          const fn = confirmState?.onConfirm;
          setConfirmState(null);
          if (fn) fn();
        }}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel || "Confirm"}
        danger={confirmState?.danger}
        warning={confirmState?.warning}
      />
    </div>
  );
}

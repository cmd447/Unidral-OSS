import * as React from "react";
import Link from "next/link";
import { PanelLeft, Plus, Trash2, RefreshCw, X, Globe } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Drawer, cx, Card, BlueButton, GhostButton, Toggle, SectionHeading, ConfirmDialog, Favicon, SiteCard, useToast } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api, siteUrl, BASE_DOMAIN, BASE_DOMAINS, notifySiteChange } from "@/lib-engine/api";

function cleanInput(raw) {
  return (raw || "").trim().toLowerCase().replace(/\s+/g, "").replace(/^https?:\/\//, "");
}

export default function SitesPage() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const [sites, setSites] = React.useState([]);
  const [health, setHealth] = React.useState({});
  const [rulesBySite, setRulesBySite] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [spinning, setSpinning] = React.useState(false);
  const [error, setError] = React.useState("");

  const [showForm, setShowForm] = React.useState(false);
  const toast = useToast();
  const [formSub, setFormSub] = React.useState("");
  const [formUrl, setFormUrl] = React.useState("");
  const [formBase, setFormBase] = React.useState("");
  const [formWildcard, setFormWildcard] = React.useState(false);
  const [formMode, setFormMode] = React.useState("dev");
  const [formLabel, setFormLabel] = React.useState("");
  const [formEgressMode, setFormEgressMode] = React.useState("direct");
  const [formWorkersUrl, setFormWorkersUrl] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [formError, setFormError] = React.useState("");

  const [availableBases, setAvailableBases] = React.useState([]);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState(null);

  const showFloatingToggle = isDesktop ? collapsed : true;

  const formBaseRef = React.useRef(formBase);
  formBaseRef.current = formBase;

  const load = React.useCallback(async () => {
    try {
      const [siteList, healthMap, bases] = await Promise.all([
        api.listSites().catch(() => []),
        api.siteHealth().catch(() => ({})),
        api.availableBaseDomains().catch(() => ({ domains: [] })),
      ]);
      const ss = Array.isArray(siteList) ? siteList : [];
      
      setSites(ss.filter((s) => !s.session_capture));
      setHealth(healthMap || {});
      let bd = bases?.domains || [];
      if (!Array.isArray(bd)) bd = [];
      setAvailableBases(bd);
      if (bd.length > 0 && !formBaseRef.current) setFormBase(bd[0].domain || BASE_DOMAINS[0]);

      const rm = {};
      await Promise.all(
        ss.map(async (s) => {
          try { rm[s.id] = (await api.listRules(s.id)).length; } catch { rm[s.id] = 0; }
        })
      );
      setRulesBySite(rm);
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

  const refresh = () => {
    setSpinning(true);
    load();
  };

  function resetForm() {
    setFormSub("");
    setFormUrl("");
    setFormWildcard(false);
    setFormMode("dev");
    setFormLabel("");
    setFormEgressMode("direct");
    setFormWorkersUrl("");
    setFormError("");
  }

  async function handleCreate(e) {
    e.preventDefault();
    const missing = [];
    if (!formSub.trim()) missing.push("Subdomain");
    if (!formUrl.trim()) missing.push("Target URL");
    if (missing.length > 0) {
      setFormError(`Missing: ${missing.join(", ")}`);
      toast.error(`Missing: ${missing.join(", ")}`);
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      await api.createSite({
        subdomain: formSub.trim().toLowerCase(),
        target_url: formUrl.trim(),
        base_domain: formBase || undefined,
        wildcard: formWildcard,
        mode: formMode,
        label: formLabel.trim() || undefined,
        egress_mode: formEgressMode,
        workers_url: formWorkersUrl.trim() || undefined,
      });
      toast.success("Site created");
      notifySiteChange();
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err.message);
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(siteId) {
    try {
      await api.deleteSite(siteId);
      notifySiteChange();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleLive(site) {
    const newMode = site.mode === "live" ? "dev" : "live";
    try {
      await api.updateSite(site.id, { mode: newMode });
      notifySiteChange();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const inputCls = "h-[32px] w-full rounded-[6px] border border-stroke bg-raised px-[10px] text-[13px] text-fg outline-none focus:border-accent";

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

        <div className="mx-auto w-full max-w-[960px] px-[16px] pb-[80px] pt-[60px] md:px-[24px] md:pt-[72px]">
          <div className="mb-[20px] flex flex-col gap-[8px] px-[8px] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-[20px] font-bold tracking-tight text-fg">Sites</h1>
              <p className="mt-[2px] text-[12.5px] text-fg3">
                Create and manage proxied sites with custom subdomains.
              </p>
              <p className="mt-[2px] text-[11px] font-semibold text-fg4">
                {loading ? "Loading…" : `${sites.length} sites`}
              </p>
            </div>
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                onClick={refresh}
                className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-fg2 transition-colors hover:bg-line hover:text-fg"
              >
                <RefreshCw className={cx("h-[14px] w-[14px]", spinning && "animate-spin")} strokeWidth={1.8} />
              </button>
              <BlueButton onClick={() => { resetForm(); setShowForm((v) => !v); }}>
                <Plus className="h-[13px] w-[13px]" strokeWidth={2} />
                Add site
              </BlueButton>
            </div>
          </div>

          {error ? (
            <div className="mb-[12px] rounded-[8px] border border-errorBorder bg-errorSurface px-[14px] py-[10px] text-[12.5px] text-error">
              {error}
            </div>
          ) : null}

          {showForm ? (
            <Card className="mb-[14px] p-[16px]">
              <div className="mb-[12px] flex items-center justify-between">
                <SectionHeading title="Add a new site" description="Create a new proxied site with a subdomain and target URL." className="mb-0" />
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-fg"
                >
                  <X className="h-[13px] w-[13px]" strokeWidth={1.8} />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-[14px]">
                {}
                <div className="rounded-[8px] border border-line bg-panel p-[14px]">
                  <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-wide text-fg4">
                    Identity
                  </div>
                  <p className="mb-[12px] text-[11.5px] text-fg4">
                    Choose the public address visitors will see and the destination the proxy will fetch content from.
                  </p>
                  <div className="space-y-[12px]">
                    <div>
                      <label className="mb-[4px] block text-[12px] text-fg3">Public address</label>
                      <div className="flex flex-wrap items-center gap-[6px] sm:gap-[8px]">
                        <code className="shrink-0 text-[13px] text-fg4">https://</code>
                        <input
                          type="text"
                          value={formSub}
                          onChange={(e) => setFormSub(cleanInput(e.target.value))}
                          placeholder="my-site"
                          className={cx(inputCls, "min-w-[100px] flex-1")}
                        />
                        <code className="shrink-0 text-[13px] text-fg4">.</code>
                        {availableBases.length > 1 ? (
                          <select
                            value={formBase}
                            onChange={(e) => setFormBase(e.target.value)}
                            className={cx(inputCls, "min-w-0 flex-1 sm:max-w-[150px] sm:flex-none")}
                          >
                            {availableBases.map((bd) => (
                              <option key={bd.domain} value={bd.domain}>{bd.domain}</option>
                            ))}
                          </select>
                        ) : (
                          <code className="shrink-0 text-[13px] text-fg4">{formBase || BASE_DOMAINS[0]}</code>
                        )}
                      </div>
                      {formSub ? (
                        <div className="mt-[6px] flex items-center gap-[6px] text-[10.5px] text-fg4">
                          <Globe className="h-[10px] w-[10px]" strokeWidth={1.8} />
                          Will be served at{" "}
                          <code className="text-accent">https://{formSub}.{formBase || BASE_DOMAINS[0]}</code>
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <label className="mb-[4px] block text-[12px] text-fg3">Target URL</label>
                      <input
                        type="text"
                        value={formUrl}
                        onChange={(e) => {
                          let v = e.target.value;
                          if (v && !v.startsWith("http://") && !v.startsWith("https://") && !v.includes("://")) {
                            v = "https://" + v;
                          }
                          setFormUrl(v);
                        }}
                        placeholder="https://example.com"
                        className={inputCls}
                      />
                      <p className="mt-[4px] text-[11px] text-fg4">The destination website the proxy will mirror. All traffic to your public address is forwarded here.</p>
                    </div>
                    <div>
                      <label className="mb-[4px] block text-[12px] text-fg3">Label (optional)</label>
                      <input
                        type="text"
                        value={formLabel}
                        onChange={(e) => setFormLabel(e.target.value)}
                        placeholder="My Site"
                        className={inputCls}
                      />
                      <p className="mt-[4px] text-[11px] text-fg4">A friendly name to help you identify this site in the dashboard.</p>
                    </div>
                  </div>
                </div>

                {}
                <div className="rounded-[8px] border border-line bg-surface p-[14px]">
                  <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-wide text-fg4">
                    Behavior
                  </div>
                  <p className="mb-[12px] text-[11.5px] text-fg4">
                    Control how the proxy handles requests. Dev mode is for testing; Live mode is for production use.
                  </p>
                  <div className="mb-[4px] text-[12px] text-fg3">Mode</div>
                  <div className="flex gap-[6px]">
                    <button
                      type="button"
                      onClick={() => setFormMode("dev")}
                      className={cx(
                        "flex h-[30px] flex-1 items-center justify-center rounded-[6px] border text-[12.5px] font-medium transition-colors",
                        formMode === "dev" ? "border-accent bg-accent/10 text-fg" : "border-stroke bg-raised text-fg3 hover:text-fg"
                      )}
                    >
                      Dev (toolbar)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormMode("live")}
                      className={cx(
                        "flex h-[30px] flex-1 items-center justify-center rounded-[6px] border text-[12.5px] font-medium transition-colors",
                        formMode === "live" ? "border-accent bg-accent/10 text-fg" : "border-stroke bg-raised text-fg3 hover:text-fg"
                      )}
                    >
                      Live (clean)
                    </button>
                  </div>
                  <div className="mt-[3px] text-[11px] text-fg4">
                    {formMode === "dev" ? "Injects a debugging toolbar into the page so you can inspect the proxy in real time. Never share dev links with targets." : "Clean proxy with no toolbar — indistinguishable from a normal site. Use this when sharing links with real visitors."}
                  </div>

                  <div className="mt-[12px] flex items-center justify-between rounded-[8px] border border-line bg-raised px-[12px] py-[10px]">
                    <div>
                      <div className="text-[12.5px] font-medium text-fg2">Wildcard mode</div>
                      <p className="mt-[2px] text-[11.5px] text-fg4">Proxy all subdomains of the target (e.g. api.mysite.domain). Useful when the target site loads assets from subdomains.</p>
                    </div>
                    <Toggle checked={formWildcard} onChange={setFormWildcard} label="Wildcard" />
                  </div>
                </div>

                {}
                <div className="rounded-[8px] border border-line bg-panel p-[14px]">
                  <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-wide text-fg4">
                    Network
                  </div>
                  <p className="mb-[12px] text-[11.5px] text-fg4">
                    Choose which IP address the proxy uses when fetching content from the target. This affects how the target sees your traffic.
                  </p>
                  <div className="mb-[4px] text-[12px] text-fg3">IP egress mode</div>
                  <div className="flex gap-[6px]">
                    <button
                      type="button"
                      onClick={() => setFormEgressMode("direct")}
                      className={cx(
                        "flex h-[30px] flex-1 items-center justify-center rounded-[6px] border text-[12.5px] font-medium transition-colors",
                        formEgressMode === "direct" ? "border-accent bg-accent/10 text-fg" : "border-stroke bg-raised text-fg3 hover:text-fg"
                      )}
                    >
                      Direct
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormEgressMode("warp")}
                      className={cx(
                        "flex h-[30px] flex-1 items-center justify-center rounded-[6px] border text-[12.5px] font-medium transition-colors",
                        formEgressMode === "warp" ? "border-accent bg-accent/10 text-fg" : "border-stroke bg-raised text-fg3 hover:text-fg"
                      )}
                    >
                      WARP
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormEgressMode("workers")}
                      className={cx(
                        "flex h-[30px] flex-1 items-center justify-center rounded-[6px] border text-[12.5px] font-medium transition-colors",
                        formEgressMode === "workers" ? "border-accent bg-accent/10 text-fg" : "border-stroke bg-raised text-fg3 hover:text-fg"
                      )}
                    >
                      Workers
                    </button>
                  </div>
                  {formEgressMode === "direct" ? (
                    <p className="mt-[3px] text-[11px] text-fg4">Direct — uses your VPS IP address. Simplest option, but the target sees your server's IP on every request.</p>
                  ) : formEgressMode === "warp" ? (
                    <p className="mt-[3px] text-[11px] text-fg4">Cloudflare WARP — routes traffic through Cloudflare's free WARP tunnel. The target sees a shared Cloudflare IP, not your VPS.</p>
                  ) : (
                    <p className="mt-[3px] text-[11px] text-fg4">Cloudflare Worker relay — routes traffic through a Cloudflare Worker you control. The target sees the Worker's IP. Most isolated option.</p>
                  )}
                  {formEgressMode === "workers" ? (
                    <div className="mt-[12px]">
                      <label className="mb-[4px] block text-[12px] text-fg3">Worker URL</label>
                      <input
                        type="text"
                        value={formWorkersUrl}
                        onChange={(e) => setFormWorkersUrl(e.target.value)}
                        placeholder="https://unidral-egress.your-subdomain.workers.dev"
                        className={inputCls}
                      />
                    </div>
                  ) : null}
                </div>
                {formError ? (
                  <div className="text-[12px] text-error">{formError}</div>
                ) : null}
                <div className="flex items-center gap-[8px] pt-[2px]">
                  <BlueButton type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create site"}
                  </BlueButton>
                  <GhostButton onClick={() => { setShowForm(false); resetForm(); }}>Cancel</GhostButton>
                </div>
              </form>
            </Card>
          ) : null}

          {loading ? (
            <Card className="p-[24px] text-center text-[12.5px] text-fg3">Loading sites…</Card>
          ) : sites.length === 0 ? (
            <Card className="flex flex-col items-center justify-center px-[30px] py-[64px]">
              <div className="mb-[16px] flex h-[56px] w-[56px] items-center justify-center rounded-[14px] bg-surface">
                <Globe className="h-[26px] w-[26px] text-fg3" />
              </div>
              <div className="text-[15px] font-medium text-fg">No sites yet</div>
              <div className="mt-[4px] text-[12.5px] text-fg3">
                Create your first proxied site to start rendering a target under your own domain.
              </div>
              <BlueButton className="mt-[18px]" onClick={() => { resetForm(); setShowForm(true); }}>
                Add your first site
              </BlueButton>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-[14px] px-[8px] sm:grid-cols-2 lg:grid-cols-3">
              {sites.map((site) => {
                const hs = health[site.id]?.status || "unknown";
                const ruleCount = rulesBySite[site.id] ?? site.rule_count ?? 0;
                const url = siteUrl(site);
                return (
                  <SiteCard
                    key={site.id}
                    site={site}
                    healthStatus={hs}
                    ruleCount={ruleCount}
                    siteUrl={url}
                    onToggleLive={() => handleToggleLive(site)}
                    onDelete={() => setConfirmDeleteId(site.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => handleDelete(confirmDeleteId)}
        title="Delete site"
        message="This will permanently delete the site and all its rules. This cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

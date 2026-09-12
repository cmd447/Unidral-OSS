import * as React from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  PanelLeft, ArrowLeft, Plus, Trash2, Activity,
  ExternalLink, X, Code2, Globe, Save, Loader2,
  AlertCircle, Check, ChevronDown, Zap,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Drawer, cx, Card, BlueButton, GhostButton, Toggle, SectionHeading, Badge, Favicon, ConfirmDialog } from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api, siteUrl, BASE_DOMAIN, BASE_DOMAINS } from "@/lib-engine/api";

const CSP_MODES = [
  { value: "strip", label: "Strip" },
  { value: "rewrite", label: "Rewrite" },
  { value: "none", label: "None" },
];

const inputCls = "w-full rounded-[6px] border border-stroke bg-raised px-[10px] py-[7px] text-[13px] text-fg placeholder:text-fg4 focus:border-accent focus:outline-none transition-colors";

export default function SiteDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const isDesktop = useIsDesktop();

  const [site, setSite] = React.useState(null);
  const [config, setConfig] = React.useState({
    label: "",
    notes: "",
    mode: "active",
    csp_mode: "strip",
    block_ads: false,
    wildcard: false,
    subdomains: [],
    custom_js: "",
    custom_css: "",
  });
  const [rules, setRules] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [configSaved, setConfigSaved] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const [editingRule, setEditingRule] = React.useState(null);
  const [ruleForm, setRuleForm] = React.useState({
    name: "",
    selector: "",
    action: "bind",
    event: "click",
    code: "",
    path_pattern: "*",
    enabled: true,
  });

  React.useEffect(() => {
    if (id) load();
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const s = await api.getSite(id);
      setSite(s);
      setConfig({
        label: s.label || "",
        notes: s.notes || "",
        mode: s.mode || "active",
        csp_mode: s.csp_mode || "strip",
        block_ads: s.block_ads === true,
        wildcard: s.wildcard === true,
        subdomains: s.subdomains || [],
        custom_js: s.custom_js || "",
        custom_css: s.custom_css || "",
      });
      try {
        const r = await api.listRules(id);
        setRules(r.rules || r || []);
      } catch {
        setRules([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateConfig(key, value) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  async function handleSaveConfig(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.updateSite(id, {
        label: config.label,
        notes: config.notes,
        mode: config.mode,
        csp_mode: config.csp_mode,
        block_ads: config.block_ads,
        wildcard: config.wildcard,
        subdomains: config.subdomains,
        custom_js: config.custom_js,
        custom_css: config.custom_css,
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function resetRuleForm() {
    setRuleForm({
      name: "",
      selector: "",
      action: "bind",
      event: "click",
      code: "",
      path_pattern: "*",
      enabled: true,
    });
    setEditingRule(null);
  }

  function openEditRule(rule) {
    setEditingRule(rule.id);
    setRuleForm({
      name: rule.name || "",
      selector: rule.selector || "",
      action: rule.action || "bind",
      event: rule.event || "click",
      code: rule.code || "",
      path_pattern: rule.path_pattern || "*",
      enabled: rule.enabled !== false,
    });
  }

  async function handleSaveRule(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingRule) {
        await api.updateRule(id, editingRule, ruleForm);
      } else {
        await api.createRule(id, ruleForm);
      }
      resetRuleForm();
      const r = await api.listRules(id);
      setRules(r.rules || r || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule) {
    try {
      await api.updateRule(id, rule.id, { ...rule, enabled: !rule.enabled });
      const r = await api.listRules(id);
      setRules(r.rules || r || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteRule(ruleId) {
    try {
      await api.deleteRule(id, ruleId);
      const r = await api.listRules(id);
      setRules(r.rules || r || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleLive() {
    const newMode = config.mode === "active" ? "stopped" : "active";
    updateConfig("mode", newMode);
    try {
      await api.updateSite(id, { mode: newMode });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function performDelete() {
    try {
      await api.deleteSite(id);
      router.push("/sites");
    } catch (err) {
      setError(err.message);
    }
  }

  function addSubdomain() {
    const sub = prompt("Enter subdomain prefix (e.g. accounts):");
    if (sub && sub.trim()) {
      updateConfig("subdomains", [...config.subdomains, sub.trim().toLowerCase()]);
    }
  }

  function removeSubdomain(prefix) {
    updateConfig("subdomains", config.subdomains.filter((s) => s !== prefix));
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <Loader2 className="h-5 w-5 animate-spin text-fg3" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-2 h-5 w-5 text-fg3" />
          <p className="text-[13px] text-fg3">Site not found</p>
        </div>
      </div>
    );
  }

  const sidebar = <AppSidebar collapsed={!isDesktop} onToggle={() => {}} variant={isDesktop ? "static" : "drawer"} />;

  return (
    <div className="flex h-screen bg-bg">
      {isDesktop ? sidebar : null}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-[40px] shrink-0 items-center gap-[8px] border-b border-line px-[12px]">
          {!isDesktop ? <Drawer side="left">{sidebar}</Drawer> : null}
          <Link href="/sites" className="flex items-center gap-[4px] text-[12px] text-fg3 transition-colors hover:text-fg">
            <ArrowLeft className="h-[12px] w-[12px]" />
            Sites
          </Link>
          <span className="text-fg4">/</span>
          <span className="text-[12px] font-medium text-fg">{site.subdomain}</span>
          <div className="ml-auto flex items-center gap-[6px]">
            <a
              href={siteUrl(site)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-[3px] text-[11px] text-fg3 transition-colors hover:text-fg"
            >
              <ExternalLink className="h-[11px] w-[11px]" />
              Open
            </a>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[680px] px-[20px] py-[24px]">
            {/* Header */}
            <div className="mb-[24px] flex items-center gap-[12px]">
              <Favicon url={site.target_url} subdomain={site.subdomain} size={36} />
              <div>
                <h1 className="text-[18px] font-semibold text-fg">{config.label || site.subdomain}</h1>
                <p className="text-[12px] text-fg3">{site.subdomain}.{site.base_domain || BASE_DOMAIN}</p>
              </div>
              <div className="ml-auto flex items-center gap-[6px]">
                <Badge>
                  <Activity className="mr-[3px] h-[9px] w-[9px]" />
                  {config.mode === "active" ? "Active" : "Stopped"}
                </Badge>
              </div>
            </div>

            {/* Config Form */}
            <Card className="mb-[20px] p-[20px]">
              <SectionHeading className="mb-[16px]">Site Configuration</SectionHeading>

              <form onSubmit={handleSaveConfig} className="space-y-[16px]">
                <div>
                  <label className="mb-[6px] block text-[12px] font-medium text-fg2">Label</label>
                  <input
                    type="text"
                    value={config.label}
                    onChange={(e) => updateConfig("label", e.target.value)}
                    placeholder={site.subdomain}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="mb-[6px] block text-[12px] font-medium text-fg2">Notes</label>
                  <textarea
                    value={config.notes}
                    onChange={(e) => updateConfig("notes", e.target.value)}
                    placeholder="Internal notes..."
                    rows={2}
                    className={cx(inputCls, "resize-y font-mono text-[12px]")}
                  />
                </div>

                <div>
                  <label className="mb-[6px] block text-[12px] font-medium text-fg2">Target URL</label>
                  <input
                    type="text"
                    value={site.target_url}
                    disabled
                    className={cx(inputCls, "opacity-60")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-[12px]">
                  <div>
                    <label className="mb-[6px] block text-[12px] font-medium text-fg2">Mode</label>
                    <select
                      value={config.mode}
                      onChange={(e) => updateConfig("mode", e.target.value)}
                      className={inputCls}
                    >
                      <option value="active">Active</option>
                      <option value="stopped">Stopped</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-[6px] block text-[12px] font-medium text-fg2">CSP Mode</label>
                    <select
                      value={config.csp_mode}
                      onChange={(e) => updateConfig("csp_mode", e.target.value)}
                      className={inputCls}
                    >
                      {CSP_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-[16px]">
                  <Toggle
                    checked={config.block_ads}
                    onChange={(v) => updateConfig("block_ads", v)}
                    label="Block ads"
                  />
                  <Toggle
                    checked={config.wildcard}
                    onChange={(v) => updateConfig("wildcard", v)}
                    label="Wildcard subdomains"
                  />
                </div>

                {/* Subdomains */}
                <div className="border-t border-line pt-[16px]">
                  <div className="mb-[8px] flex items-center justify-between">
                    <label className="text-[12px] font-medium text-fg2">Subdomains</label>
                    <button
                      type="button"
                      onClick={addSubdomain}
                      className="flex items-center gap-[3px] text-[11px] text-fg3 hover:text-fg"
                    >
                      <Plus className="h-[11px] w-[11px]" />
                      Add
                    </button>
                  </div>
                  {config.subdomains.length === 0 ? (
                    <p className="text-[11.5px] text-fg4">No subdomains configured</p>
                  ) : (
                    <div className="flex flex-wrap gap-[6px]">
                      {config.subdomains.map((sub) => (
                        <span
                          key={sub}
                          className="flex items-center gap-[4px] rounded-[5px] border border-stroke bg-raised px-[8px] py-[3px] text-[11.5px] text-fg2"
                        >
                          {sub}
                          <button
                            type="button"
                            onClick={() => removeSubdomain(sub)}
                            className="text-fg4 hover:text-accent"
                          >
                            <X className="h-[10px] w-[10px]" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Advanced */}
                <div className="border-t border-line pt-[16px]">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-[5px] text-[11px] font-medium uppercase tracking-wide text-fg4 transition-colors hover:text-fg3"
                  >
                    <ChevronDown className={cx("h-[11px] w-[11px] transition-transform", showAdvanced ? "rotate-180" : "")} strokeWidth={1.8} />
                    Advanced
                  </button>
                  {showAdvanced ? (
                    <div className="mt-[12px] space-y-[16px]">
                      <div>
                        <label className="mb-[6px] block text-[12px] font-medium text-fg2">Custom JS</label>
                        <textarea
                          value={config.custom_js}
                          onChange={(e) => updateConfig("custom_js", e.target.value)}
                          placeholder="// Custom JavaScript injected into all pages"
                          rows={4}
                          className={cx(inputCls, "resize-y font-mono text-[12px]")}
                        />
                      </div>
                      <div>
                        <label className="mb-[6px] block text-[12px] font-medium text-fg2">Custom CSS</label>
                        <textarea
                          value={config.custom_css}
                          onChange={(e) => updateConfig("custom_css", e.target.value)}
                          placeholder="/* Custom CSS injected into all pages */"
                          rows={4}
                          className={cx(inputCls, "resize-y font-mono text-[12px]")}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Save */}
                <div className="flex items-center gap-[8px] border-t border-line pt-[16px]">
                  <BlueButton type="submit" disabled={saving}>
                    {saving ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Save className="h-[14px] w-[14px]" />}
                    Save
                  </BlueButton>
                  {configSaved ? (
                    <span className="flex items-center gap-[3px] text-[11px] text-green-500">
                      <Check className="h-[11px] w-[11px]" />
                      Saved
                    </span>
                  ) : null}
                </div>
              </form>
            </Card>

            {/* Rules Section */}
            <Card className="mb-[20px] p-[20px]">
              <SectionHeading className="mb-[16px]">Rules</SectionHeading>

              {/* Rule form */}
              <form onSubmit={handleSaveRule} className="mb-[16px] space-y-[10px] rounded-[8px] border border-stroke bg-bg p-[12px]">
                <div className="grid grid-cols-2 gap-[8px]">
                  <input
                    type="text"
                    value={ruleForm.name}
                    onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Rule name"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={ruleForm.selector}
                    onChange={(e) => setRuleForm((f) => ({ ...f, selector: e.target.value }))}
                    placeholder="CSS selector (e.g. #login-btn)"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-3 gap-[8px]">
                  <select
                    value={ruleForm.action}
                    onChange={(e) => setRuleForm((f) => ({ ...f, action: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="bind">Bind event</option>
                    <option value="replace">Replace text</option>
                    <option value="redirect">Redirect</option>
                  </select>
                  <select
                    value={ruleForm.event}
                    onChange={(e) => setRuleForm((f) => ({ ...f, event: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="click">click</option>
                    <option value="submit">submit</option>
                    <option value="change">change</option>
                    <option value="input">input</option>
                  </select>
                  <input
                    type="text"
                    value={ruleForm.path_pattern}
                    onChange={(e) => setRuleForm((f) => ({ ...f, path_pattern: e.target.value }))}
                    placeholder="Path pattern (* = all)"
                    className={inputCls}
                  />
                </div>
                <textarea
                  value={ruleForm.code}
                  onChange={(e) => setRuleForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="// JavaScript code to execute"
                  rows={3}
                  className={cx(inputCls, "resize-y font-mono text-[12px]")}
                />
                <div className="flex items-center gap-[8px]">
                  <BlueButton type="submit" disabled={saving}>
                    {saving ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Plus className="h-[14px] w-[14px]" />}
                    {editingRule ? "Update rule" : "Add rule"}
                  </BlueButton>
                  {editingRule ? (
                    <GhostButton type="button" onClick={resetRuleForm}>Cancel</GhostButton>
                  ) : null}
                </div>
              </form>

              {/* Rules list */}
              {rules.length === 0 ? (
                <p className="text-[12px] text-fg4">No rules configured</p>
              ) : (
                <div className="space-y-[6px]">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className={cx(
                        "flex items-center gap-[8px] rounded-[6px] border border-stroke bg-raised px-[10px] py-[8px]",
                        rule.enabled === false ? "opacity-50" : ""
                      )}
                    >
                      <div className="flex-1">
                        <div className="text-[12.5px] font-medium text-fg">{rule.name || "(unnamed)"}</div>
                        <div className="text-[11px] text-fg3">
                          {rule.selector} · {rule.action} · {rule.path_pattern || "*"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule)}
                        className="text-[11px] text-fg3 hover:text-fg"
                      >
                        {rule.enabled === false ? "Enable" : "Disable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditRule(rule)}
                        className="text-[11px] text-fg3 hover:text-fg"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-fg4 hover:text-accent"
                      >
                        <Trash2 className="h-[12px] w-[12px]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Danger zone */}
            <Card className="border-accent/30 p-[20px]">
              <SectionHeading className="mb-[12px] text-accent">Danger Zone</SectionHeading>
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-fg3">Delete this site and all its rules.</p>
                <GhostButton
                  onClick={() => setConfirmDelete(true)}
                  className="text-accent hover:bg-accent/10"
                >
                  <Trash2 className="h-[14px] w-[14px]" />
                  Delete site
                </GhostButton>
              </div>
            </Card>

            {error ? (
              <div className="mt-[16px] flex items-center gap-[6px] rounded-[6px] border border-accent/30 bg-accent/5 px-[12px] py-[8px] text-[12px] text-accent">
                <AlertCircle className="h-[12px] w-[12px]" />
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={performDelete}
        title="Delete site?"
        message="This will permanently delete the site and all its rules. This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}

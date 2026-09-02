import * as React from "react";
import {
  AlertTriangle,
  Database,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Save,
  Server,
  Terminal,
} from "lucide-react";
import { SettingsShell, SettingsHeader, BackToOrganization } from "@/components/settings-shell";
import { api } from "@/lib-engine/api";
import { cx, useToast } from "@/components/ui";

function SectionHeading({ title, description }) {
  return (
    <div>
      <h2 className="text-[13px] font-medium leading-[18px] text-fg">{title}</h2>
      {description ? (
        <p className="mt-[2px] text-[12.5px] leading-[18px] text-fg3">{description}</p>
      ) : null}
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={cx("rounded-[8px] border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

function ActionButton({ children, onClick, disabled, variant = "default", loading }) {
  const base = "flex h-[32px] items-center gap-[6px] rounded-[6px] px-[12px] text-[12.5px] font-medium transition-colors disabled:opacity-50";
  const variants = {
    default: "bg-pressed text-fg hover:bg-pressed",
    danger: "bg-errorBorder text-error hover:bg-errorBorder",
    primary: "bg-accent text-white hover:bg-accentHover",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cx(base, variants[variant])}
    >
      {loading ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : null}
      {children}
    </button>
  );
}

export default function EngineSettingsPage() {
  const toast = useToast();

  const [killswitchOpen, setKillswitchOpen] = React.useState(false);
  const [killswitchLoading, setKillswitchLoading] = React.useState(false);
  const [restoreLoading, setRestoreLoading] = React.useState(false);

  const [cacheLoading, setCacheLoading] = React.useState(false);
  const [reloadLoading, setReloadLoading] = React.useState(false);

  const [brandName, setBrandName] = React.useState('');
  const [brandSaving, setBrandSaving] = React.useState(false);

  const [certRunning, setCertRunning] = React.useState(false);
  const [certOutput, setCertOutput] = React.useState('');
  const [certDryRun, setCertDryRun] = React.useState(false);
  const [nginxRestarting, setNginxRestarting] = React.useState(false);
  const certLogRef = React.useRef(null);

  React.useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const settingsRes = await api.getEngineSettings().catch((err) => {
        toast.error("Could not load engine settings: " + (err?.message || "engine unreachable"));
        return { settings: null };
      });
      if (settingsRes.settings) {
        setBrandName(settingsRes.settings.brand_name || '');
      }
    } catch (err) {
      toast.error("Could not load engine settings: " + (err?.message || "unknown error"));
    }
  }

  async function handleKillswitch() {
    setKillswitchLoading(true);
    try {
      const res = await api.killswitch();
      toast.success(`Stopped ${res.stopped} of ${res.total} sites.`);
      setKillswitchOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setKillswitchLoading(false);
    }
  }

  async function handleRestore() {
    setRestoreLoading(true);
    try {
      const res = await api.restoreSites();
      toast.success(`Restored ${res.restored} of ${res.total} sites.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRestoreLoading(false);
    }
  }

  async function handleClearCache() {
    setCacheLoading(true);
    try {
      await api.clearCache();
      toast.success('Cache cleared.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCacheLoading(false);
    }
  }

  async function handleReload() {
    setReloadLoading(true);
    try {
      const res = await api.reloadSites();
      toast.success(`Reloaded ${res.count} sites.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReloadLoading(false);
    }
  }

  async function handleSaveBranding() {
    setBrandSaving(true);
    try {
      await api.updateEngineSettings({
        brand_name: brandName,
      });
      toast.success('Branding saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBrandSaving(false);
    }
  }

  async function handleReissueCerts() {
    const action = certDryRun ? 'dry-run' : 'reissue';
    if (!certDryRun && !confirm(`Reissue all wildcard TLS certificates? This will contact Let's Encrypt and restart nginx.`)) return;
    setCertRunning(true);
    setCertOutput(`[unidral] Starting certificate ${action}...\n`);
    try {
      const res = await api.reissueCerts(certDryRun);
      setCertOutput((prev) => prev + (res.output || ''));
      if (!res.ok) {
        setCertOutput((prev) => prev + '\n[unidral] Reissue failed.\n');
      }
    } catch (err) {
      setCertOutput((prev) => prev + `\n[unidral] Error: ${err.message}\n`);
    } finally {
      setCertRunning(false);
    }
  }

  async function handleRestartNginx() {
    setNginxRestarting(true);
    try {
      await api.restartNginx();
      setCertOutput((prev) => prev + '\n[unidral] nginx restart initiated.\n');
    } catch (err) {
      setCertOutput((prev) => prev + `\n[unidral] Error: ${err.message}\n`);
    } finally {
      setNginxRestarting(false);
    }
  }

  return (
    <SettingsShell>
      <SettingsHeader crumb="Engine" />
      <BackToOrganization />

      <div className="mx-auto w-full max-w-[704px] px-[16px] pb-[80px] pt-[14px] md:px-[24px]">
        <h1 className="text-[17px] font-medium leading-[23px] text-fg">Engine</h1>
        <p className="mt-[2px] text-[12.5px] leading-[18px] text-fg3">
          Engine controls, killswitch, and branding
        </p>

        {}
        <div className="mt-[36px]">
          <SectionHeading
            title="Emergency killswitch"
            description="Emergency Kill Switch — Instantly shut down all proxied sites. Use this if a site is being abused or you need to stop all traffic immediately."
          />
          <div className="mt-[12px] rounded-[8px] border border-errorBorder bg-errorSurface p-[16px] md:p-[18px]">
            <div className="flex flex-col gap-[14px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-fg">Shut down all proxied sites</div>
                <div className="mt-[3px] text-[12px] leading-[17px] text-fg3">
                  Stops all proxy traffic immediately. Visitors will see a maintenance page.
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-[8px] sm:flex-row">
                <ActionButton
                  variant="danger"
                  onClick={() => setKillswitchOpen(true)}
                  loading={killswitchLoading}
                >
                  <AlertTriangle className="h-[13px] w-[13px]" />
                  Shut down
                </ActionButton>
                <ActionButton
                  onClick={handleRestore}
                  loading={restoreLoading}
                >
                  Restore sites
                </ActionButton>
              </div>
            </div>
          </div>
        </div>

        {}
        <div className="mt-[36px]">
          <SectionHeading
            title="Cache controls"
            description="Cache & Reload — Clear the response cache or hot-reload site configurations without restarting the engine."
          />
          <div className="mt-[12px] flex gap-[8px]">
            <ActionButton onClick={handleClearCache} loading={cacheLoading}>
              <RefreshCw className="h-[13px] w-[13px]" />
              Clear cache
            </ActionButton>
            <ActionButton onClick={handleReload} loading={reloadLoading}>
              <Database className="h-[13px] w-[13px]" />
              Reload sites
            </ActionButton>
          </div>
        </div>

        {}
        <div className="mt-[36px]">
          <SectionHeading
            title="Branding"
            description="Branding — Set the name shown across the dashboard."
          />
          <Card className="mt-[12px] p-[16px]">
            <div className="space-y-[14px]">
              <div>
                <label className="text-[12px] text-fg3">Brand name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="mt-[4px] h-[34px] w-full rounded-[6px] border border-stroke bg-surface px-[10px] text-[13px] text-fg focus:border-accent/50 focus:outline-none"
                />
              </div>
              <ActionButton onClick={handleSaveBranding} loading={brandSaving}>
                <Save className="h-[13px] w-[13px]" />
                Save branding
              </ActionButton>
            </div>
          </Card>
        </div>

        {}
        <div className="mt-[36px]">
          <SectionHeading
            title="TLS certificates"
            description="TLS Certificates — Reissue SSL certificates for your domains and restart Nginx. Use dry-run first to check for problems."
          />
          <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
            <label className="flex items-center gap-[6px] text-[12px] text-fg3">
              <input
                type="checkbox"
                checked={certDryRun}
                onChange={(e) => setCertDryRun(e.target.checked)}
                disabled={certRunning}
                className="h-[13px] w-[13px] accent-accent"
              />
              Dry run
            </label>
            <ActionButton onClick={handleReissueCerts} loading={certRunning}>
              <Lock className="h-[13px] w-[13px]" />
              {certDryRun ? 'Test reissue' : 'Reissue certs'}
            </ActionButton>
            <ActionButton onClick={handleRestartNginx} loading={nginxRestarting} disabled={certRunning}>
              <Server className="h-[13px] w-[13px]" />
              Restart nginx
            </ActionButton>
          </div>

          {}
          {certOutput ? (
            <div className="mt-[12px] overflow-hidden rounded-[8px] border border-line bg-panel">
              <div className="flex items-center gap-[6px] border-b border-line px-[10px] py-[6px]">
                <Terminal className="h-[12px] w-[12px] text-fg3" />
                <span className="text-[11px] font-medium text-fg3">Output</span>
                {certRunning ? (
                  <span className="ml-auto flex items-center gap-[4px] text-[10px] text-accent">
                    <Loader2 className="h-[10px] w-[10px] animate-spin" /> running
                  </span>
                ) : null}
              </div>
              <pre
                ref={certLogRef}
                className="max-h-[320px] overflow-auto px-[12px] py-[10px] font-mono text-[11px] leading-[16px] text-fg2"
              >
                {certOutput}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      {}
      {killswitchOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-[20px]">
          <div className="w-full max-w-[400px] rounded-[10px] border border-errorBorder bg-raised p-[20px]">
            <div className="flex items-center gap-[10px]">
              <AlertTriangle className="h-[18px] w-[18px] text-error" />
              <h3 className="text-[15px] font-semibold text-fg">Confirm shutdown</h3>
            </div>
            <p className="mt-[10px] text-[12.5px] leading-[18px] text-fg3">
              This will immediately stop all proxied sites. Visitors will see a maintenance page.
              You can restore them at any time.
            </p>
            <div className="mt-[16px] flex justify-end gap-[8px]">
              <ActionButton onClick={() => setKillswitchOpen(false)}>Cancel</ActionButton>
              <ActionButton variant="danger" onClick={handleKillswitch} loading={killswitchLoading}>
                Shut down all
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsShell>
  );
}

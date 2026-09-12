import * as React from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Server,
} from "lucide-react";
import { SettingsShell, SettingsHeader, BackToOrganization } from "@/components/settings-shell";
import { api } from "@/lib-engine/api";
import { cx } from "@/components/ui";

export default function EnvSettingsPage() {
  const [vars, setVars] = React.useState(null);
  const [rawEnv, setRawEnv] = React.useState("");
  const [editingRaw, setEditingRaw] = React.useState(false);
  const [cloudflareIni, setCloudflareIni] = React.useState("");
  const [envPath, setEnvPath] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [showSecrets, setShowSecrets] = React.useState(false);

  React.useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getEnv();
      if (res.vars) {
        setVars(res.vars);
        setEnvPath(res.path || "");
      }
      if (res.cloudflareIni) {
        setCloudflareIni(res.cloudflareIni.content || "");
      }
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(restart) {
    setSaving(true);
    setMsg(null);
    try {
      
      const updates = {};
      for (const v of vars) {
        
        if (v.value && v.value !== "••••••••••••") {
          updates[v.key] = v.value;
        }
      }
      const res = await api.updateEnv(updates, restart, cloudflareIni);
      if (res.ok) {
        setMsg({ type: "success", text: restart ? "Saved and restarting..." : "Saved successfully." });
        if (!restart) await load();
      } else {
        setMsg({ type: "error", text: res.output || "Failed to save." });
      }
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
      setRestarting(false);
    }
  }

  function updateVar(key, value) {
    setVars((prev) => prev.map((v) => (v.key === key ? { ...v, value } : v)));
  }

  
  const groups = React.useMemo(() => {
    if (!vars) return [];
    const map = {};
    for (const v of vars) {
      const g = v.group || "Other";
      if (!map[g]) map[g] = [];
      map[g].push(v);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [vars]);

  return (
    <SettingsShell>
      <SettingsHeader crumb="Environment" />
      <BackToOrganization />

      <div className="mx-auto w-full max-w-[820px] px-[16px] pb-[80px] pt-[14px] md:px-[24px]">
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div>
            <h1 className="flex items-center gap-[8px] text-[17px] font-medium text-fg">
              <Server className="h-[16px] w-[16px] text-fg3" />
              Environment
            </h1>
            <p className="mt-[2px] text-[12.5px] text-fg3">
              Edit the server&apos;s <code className="rounded bg-hover px-[4px] py-[1px] text-[11px]">.env</code> file directly.
              {envPath ? <span className="text-fg4"> — {envPath}</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              onClick={() => setShowSecrets((v) => !v)}
              title={showSecrets ? "Hide secrets" : "Show secrets"}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-fg3 transition-colors hover:bg-line hover:text-fg"
            >
              {showSecrets ? <EyeOff className="h-[14px] w-[14px]" /> : <Eye className="h-[14px] w-[14px]" />}
            </button>
            <button
              type="button"
              onClick={load}
              title="Reload"
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-fg3 transition-colors hover:bg-line hover:text-fg"
            >
              <RefreshCw className={cx("h-[14px] w-[14px]", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-[40px] flex items-center justify-center text-fg3">
            <Loader2 className="h-[20px] w-[20px] animate-spin" />
          </div>
        ) : !vars ? (
          <div className="mt-[40px] rounded-[8px] border border-line bg-surface p-[20px] text-center text-[13px] text-fg3">
            Could not load .env file.
          </div>
        ) : (
          <>
            {}
            <div className="mt-[20px] flex items-start gap-[10px] rounded-[8px] border border-errorBorder bg-errorSurface p-[14px]">
              <AlertTriangle className="mt-[1px] h-[15px] w-[15px] shrink-0 text-accent" />
              <div className="text-[12px] leading-[18px] text-fg3">
                Changes to the <code className="rounded bg-pressed px-[3px] py-[1px] text-[11px]">.env</code> file require a container restart to take effect.
                Use <span className="font-medium text-fg">Save &amp; restart</span> to apply immediately, or <span className="font-medium text-fg">Save</span> to write without restarting.
              </div>
            </div>

            {}
            <div className="mt-[24px] space-y-[28px]">
              {groups.map(([group, groupVars]) => (
                <div key={group}>
                  <div className="mb-[10px] flex items-center gap-[8px]">
                    <span className="text-[13px] font-medium text-fg">{group}</span>
                    <span className="text-[11px] text-fg4">{groupVars.length} vars</span>
                    <div className="h-[1px] flex-1 bg-line" />
                  </div>
                  <div className="space-y-[10px]">
                    {groupVars.map((v) => {
                      const isSecret = v.secret;
                      const showValue = showSecrets || !isSecret;
                      const displayValue = isSecret && !showSecrets ? v.masked || "••••••••••••" : v.value || "";
                      return (
                        <div key={v.key} className="rounded-[6px] border border-line bg-surface p-[12px]">
                          <div className="flex flex-wrap items-center justify-between gap-[8px]">
                            <label className="font-mono text-[12px] font-medium text-fg2">{v.key}</label>
                            <div className="flex items-center gap-[6px]">
                              {isSecret ? (
                                <span className="rounded-[3px] bg-pressed px-[5px] py-[1px] text-[9.5px] font-medium text-accent">SECRET</span>
                              ) : null}
                              {v.isSet ? (
                                <span className="rounded-[3px] bg-errorBg px-[5px] py-[1px] text-[9.5px] text-fg">SET</span>
                              ) : (
                                <span className="rounded-[3px] bg-pressed px-[5px] py-[1px] text-[9.5px] text-fg4">EMPTY</span>
                              )}
                            </div>
                          </div>
                          {v.desc ? (
                            <p className="mt-[3px] text-[11px] text-fg4">{v.desc}</p>
                          ) : null}
                          <input
                            type={isSecret && !showSecrets ? "password" : "text"}
                            value={displayValue}
                            onChange={(e) => updateVar(v.key, e.target.value)}
                            placeholder={isSecret ? "Enter new value..." : ""}
                            className="mt-[6px] h-[32px] w-full rounded-[5px] border border-stroke bg-surface px-[10px] font-mono text-[12px] text-fg focus:border-accent/50 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {}
            {cloudflareIni !== undefined ? (
              <div className="mt-[28px]">
                <div className="mb-[10px] flex items-center gap-[8px]">
                  <span className="text-[13px] font-medium text-fg">cloudflare.ini</span>
                  <div className="h-[1px] flex-1 bg-line" />
                </div>
                <textarea
                  value={cloudflareIni}
                  onChange={(e) => setCloudflareIni(e.target.value)}
                  rows={4}
                  placeholder="dns_cloudflare_api_token=YOUR_TOKEN"
                  className="w-full rounded-[6px] border border-stroke bg-surface px-[10px] py-[8px] font-mono text-[12px] text-fg focus:border-accent/50 focus:outline-none"
                />
              </div>
            ) : null}

            {}
            {msg ? (
              <div
                className={cx(
                  "mt-[20px] rounded-[6px] px-[12px] py-[10px] text-[12.5px]",
                  msg.type === "success" ? "bg-errorBg text-fg" : "bg-errorBg text-error"
                )}
              >
                {msg.text}
              </div>
            ) : null}

            {}
            <div className="mt-[24px] flex items-center gap-[10px]">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="flex h-[36px] items-center gap-[6px] rounded-[6px] bg-pressed px-[16px] text-[13px] font-medium text-fg transition-colors hover:bg-hover disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Save className="h-[14px] w-[14px]" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving || restarting}
                className="flex h-[36px] items-center gap-[6px] rounded-[6px] bg-errorBorder px-[16px] text-[13px] font-medium text-error transition-colors hover:bg-errorBorder disabled:opacity-50"
              >
                {restarting ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
                Save &amp; restart
              </button>
            </div>
          </>
        )}
      </div>
    </SettingsShell>
  );
}

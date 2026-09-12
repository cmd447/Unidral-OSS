import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  PanelLeft, Blocks, Copy, Trash2, Download,
  Loader2, AlertCircle, FileCode, FileArchive, Cpu,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Drawer, cx, Card, GhostButton, BlueButton, Badge, Favicon,
  SiteThumbnail, useDismiss, useToast,
} from "@/components/ui";
import { useIsDesktop } from "@/components/use-media-query";
import { api } from "@/lib-engine/api";

export default function ModulesPage() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [modules, setModules] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [zipImporting, setZipImporting] = React.useState(false);
  const [zipProgress, setZipProgress] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleteError, setDeleteError] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const toast = useToast();

  const showFloatingToggle = isDesktop ? collapsed : true;

  React.useEffect(() => {
    loadModules();
  }, []);

  async function loadModules() {
    try {
      const res = await api.listModules();
      setModules(res.modules || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDuplicate(id) {
    try {
      await api.duplicateModule(id);
      await loadModules();
    } catch (err) {
      setError(err.message);
    }
  }

  async function checkModuleUsage(mod) {
    try {
      const sites = await api.listSites();
      const siteList = Array.isArray(sites) ? sites : [];
      const using = siteList.filter(s =>
        s.session_capture && s.session_capture_config &&
        s.session_capture_config.module_id === mod.id
      );
      if (using.length > 0) {
        const names = using.map(s => s.subdomain).join(', ');
        setDeleteError(`In use by ${using.length} site(s): ${names}. Delete or reassign those sites first.`);
      }
    } catch {  }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteModule(deleteTarget.id);
      toast.success(`Module "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      await loadModules();
    } catch (err) {
      setDeleteError(err.message);
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport(id) {
    try {
      const blob = await api.exportModuleZip(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleZipImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipImporting(true);
    setZipProgress(`Uploading ${file.name}...`);
    setError("");
    try {
      const res = await api.importModuleZip(file);
      setZipProgress("");
      setZipImporting(false);
      
      const newId = res.module?.id || res.id;
      if (newId) {
        router.push(`/modules/${newId}`);
      } else {
        await loadModules();
      }
    } catch (err) {
      setZipImporting(false);
      setZipProgress("");
      setError(err.message || "ZIP import failed");
    }
    
    e.target.value = "";
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

        <div className="mx-auto w-full max-w-[1100px] px-[16px] pb-[80px] pt-[60px] md:px-[24px] md:pt-[72px]">
          {}
          <div className="mb-[24px] flex flex-col gap-[12px] px-[8px] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-[20px] font-bold tracking-tight text-fg">Modules</h1>
              <p className="mt-[4px] max-w-[420px] text-[12.5px] text-fg3">
                Modules are provider packages that tell the engine how to capture a target site.
                Each module comes as a <span className="text-fg2">.zip</span> file.
                {" "}
                <a
                  href="https://github.com/8Universes/Unidral-Engine"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2 hover:text-accentHover"
                >
                  View documentation
                </a>
              </p>
            </div>
            <div className="relative shrink-0">
              <label className="cursor-pointer">
                <span className="flex h-[28px] items-center gap-[5px] rounded-[6px] bg-accent px-[11px] text-[12.5px] font-medium text-white transition-colors hover:bg-accentHover">
                  {zipImporting ? (
                    <><Loader2 className="h-[13px] w-[13px] animate-spin" /> {zipProgress || "Importing..."}</>
                  ) : (
                    <><FileArchive className="h-[13px] w-[13px]" strokeWidth={2} /> Import Module</>
                  )}
                </span>
                <input type="file" accept=".zip" className="hidden" onChange={handleZipImport} disabled={zipImporting} />
              </label>
            </div>
          </div>

          {error ? (
            <div className="mb-[16px] rounded-[8px] border border-errorBorder bg-errorSurface px-[14px] py-[10px] text-[12.5px] text-error">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-[80px]">
              <Loader2 className="h-[24px] w-[24px] animate-spin text-fg3" />
            </div>
          ) : modules.length === 0 ? (
            <Card className="p-[40px] text-center">
              <Blocks className="mx-auto h-[32px] w-[32px] text-fg4" strokeWidth={1.5} />
              <h2 className="mt-[12px] text-[15px] font-medium text-fg">No modules yet</h2>
              <p className="mt-[4px] text-[12.5px] text-fg3">
                Import a <span className="text-fg2">.zip</span> module file to get started.
              </p>
              <div className="mt-[16px] flex items-center justify-center gap-[8px]">
                <label className="cursor-pointer">
                  <span className="flex h-[28px] items-center gap-[5px] rounded-[6px] bg-accent px-[11px] text-[12.5px] font-medium text-white transition-colors hover:bg-accentHover">
                    <FileArchive className="h-[13px] w-[13px]" /> Import Module
                  </span>
                  <input type="file" accept=".zip" className="hidden" onChange={handleZipImport} />
                </label>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-[14px] px-[8px] sm:grid-cols-3 lg:grid-cols-4">
              {modules.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  module={mod}
                  onDuplicate={() => handleDuplicate(mod.id)}
                  onDelete={() => { setDeleteError(""); setDeleteTarget(mod); checkModuleUsage(mod); }}
                  onExport={() => handleExport(mod.id)}
                />
              ))}
            </div>
          )}
        </div>

        {}
        {deleteTarget ? (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center sm:p-[16px]" onClick={() => setDeleteTarget(null)}>
            <Card className="w-full max-w-[400px] animate-slideUp sm:animate-popIn rounded-t-[16px] sm:rounded-[10px] p-[20px]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-[10px]">
                <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] bg-errorBg">
                  <AlertCircle className="h-[16px] w-[16px] text-error" />
                </div>
                <h3 className="text-[15px] font-semibold text-fg">Delete module?</h3>
              </div>
              <p className="mt-[10px] text-[12.5px] text-fg3">
                Are you sure you want to delete <span className="font-medium text-fg2">{deleteTarget.name}</span>?
                {deleteTarget.is_default ? " This is a default module and cannot be deleted." : " This action cannot be undone."}
              </p>
              {deleteError ? (
                <div className="mt-[8px] rounded-[6px] border border-errorBorder bg-errorSurface px-[10px] py-[8px] text-[12px] text-error">
                  {deleteError}
                </div>
              ) : null}
              <div className="mt-[14px] flex items-center justify-end gap-[8px]">
                <GhostButton onClick={() => setDeleteTarget(null)}>Cancel</GhostButton>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || deleteTarget.is_default}
                  className="flex h-[30px] items-center gap-[5px] rounded-[6px] bg-error px-[12px] text-[12.5px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Trash2 className="h-[13px] w-[13px]" />}
                  Delete
                </button>
              </div>
            </Card>
          </div>
        ) : null}
      </main>
    </div>
  );
}



function ModuleCard({ module: mod, onDuplicate, onDelete, onExport }) {
  const [tapped, setTapped] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));

  return (
    <div
      className="group relative cursor-pointer rounded-[10px] border border-stroke bg-raised transition-all hover:border-stroke"
      onClick={() => tapped ? setTapped(false) : null}
    >
      <Link href={`/modules/${mod.id}`} className="block">
        {}
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-[10px] bg-panel">
          <SiteThumbnail
            url={mod.target_url}
            subdomain={mod.id}
            targetUrl={mod.target_url}
            className="h-full w-full"
          />
          {}
          <div className="absolute left-[8px] top-[8px] flex flex-wrap gap-[4px]">
            {mod.is_default ? <Badge tone="new">Default</Badge> : null}
            {mod.type === 'inject' ? <Badge>Inject</Badge> : null}
            {mod.api_version >= 2 ? <Badge tone="new">v{mod.api_version}</Badge> : null}
            {mod.has_hooks ? <Badge>{mod.hook_count} hooks</Badge> : null}
            {mod.has_shim_extra ? <Badge>Shim</Badge> : null}
            {mod.has_uni_con ? (
              <Badge tone="new">
                <span className="flex items-center gap-[3px]">
                  <Cpu className="h-[8px] w-[8px]" strokeWidth={2} />
                  Uni-Con
                </span>
              </Badge>
            ) : null}
            {mod.front_count > 0 ? <Badge>{mod.front_count} fronts</Badge> : null}
            {mod.has_payload ? <Badge>Payload</Badge> : null}
          </div>
        </div>
      </Link>

      {}
      <div
        ref={menuRef}
        className={cx(
          "absolute right-[8px] top-[8px] z-[60] flex gap-[4px] transition-opacity",
          tapped ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <button
          type="button"
          title="More"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[14px] w-[14px]">
            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-[30px] z-[50] w-[150px] max-w-[calc(100vw-32px)] animate-popIn overflow-hidden rounded-[8px] border border-stroke bg-raised">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
              className="flex h-[34px] w-full items-center gap-[8px] px-[10px] text-[12px] text-fg transition-colors hover:bg-pressed"
            >
              <Copy className="h-[12px] w-[12px]" /> Duplicate
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onExport(); }}
              className="flex h-[34px] w-full items-center gap-[8px] px-[10px] text-[12px] text-fg transition-colors hover:bg-pressed"
            >
              <Download className="h-[12px] w-[12px]" /> Export
            </button>
            {!mod.is_default ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                className="flex h-[34px] w-full items-center gap-[8px] px-[10px] text-[12px] text-error transition-colors hover:bg-pressed"
              >
                <Trash2 className="h-[12px] w-[12px]" /> Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {}
      <Link href={`/modules/${mod.id}`} className="block px-[10px] py-[10px]">
        <div className="flex items-center gap-[6px]">
          <Favicon url={mod.target_url} size={16} />
          <span className="truncate text-[13px] font-medium text-fg">{mod.name}</span>
        </div>
        <div className="mt-[3px] truncate text-[11.5px] text-fg4">
          {mod.type === 'inject'
            ? `${mod.trigger || 'engine'} trigger`
            : mod.has_hooks
              ? `${mod.hook_count} hooks · ${mod.front_count} fronts`
              : `${mod.upstream_count} upstreams · ${mod.front_count} fronts`}
        </div>
      </Link>
    </div>
  );
}

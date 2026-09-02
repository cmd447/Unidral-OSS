import * as React from "react";
import { cx } from "@/components/ui";

export function UnidralGlyph({ className = "", ...props }) {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <svg viewBox="0 0 26 20" fill="currentColor" className={className} aria-hidden {...props}>
        <circle cx="4.5" cy="5" r="4.5" />
        <circle cx="4.5" cy="15" r="4.5" />
        <circle cx="13.2" cy="10" r="4.5" />
        <path d="M15.6 4.6 25.4 10l-9.8 5.4z" />
      </svg>
    );
  }

  return (
    <img
      src="/logo.png"
      alt="Unidral"
      className={cx("logo-img", className)}
      onError={() => setFailed(true)}
      {...props}
    />
  );
}

export function UnidralLockup({ suffix, className = "" }) {
  return (
    <div className={`flex items-center gap-[9px] ${className}`}>
      <UnidralGlyph className="h-[20px] w-auto" />
      <span className="text-[20px] font-bold leading-none tracking-tight text-fg">
        Unidral
        {suffix ? <span className="ml-[7px] font-semibold text-link">{suffix}</span> : null}
      </span>
    </div>
  );
}

import * as React from "react";

const STORAGE_KEY = "unidral-theme";

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return getSystemTheme();
  } catch {
    return getSystemTheme();
  }
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setTheme] = React.useState("light");
  React.useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
    if (window.matchMedia) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = e => {
        try {
          const explicit = localStorage.getItem(STORAGE_KEY);
          if (explicit === "dark" || explicit === "light") return;
        } catch {}
        const sys = e.matches ? "dark" : "light";
        setTheme(sys);
        applyTheme(sys);
      };
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
  }, []);
  const toggle = React.useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      applyTheme(next);
      return next;
    });
  }, []);
  return {
    theme: theme,
    toggle: toggle
  };
}

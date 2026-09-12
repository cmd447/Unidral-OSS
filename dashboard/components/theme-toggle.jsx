import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { cx } from "@/components/ui";
import { useTheme } from "@/lib-engine/use-theme";

export function ThemeToggle({ collapsed = false }) {
  const { theme, toggle } = useTheme();

  if (collapsed) {
    return (
      <button
        type="button"
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        onClick={toggle}
        className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-fg2 transition-colors hover:bg-line hover:text-fg"
      >
        {theme === "dark" ? (
          <Sun className="h-[14px] w-[14px]" strokeWidth={1.8} />
        ) : (
          <Moon className="h-[14px] w-[14px]" strokeWidth={1.8} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      onClick={toggle}
      className="flex h-[28px] items-center gap-[8px] rounded-[6px] px-[8px] text-[12.5px] text-fg2 transition-colors hover:bg-hover hover:text-fg"
    >
      {theme === "dark" ? (
        <Sun className="h-[14px] w-[14px]" strokeWidth={1.8} />
      ) : (
        <Moon className="h-[14px] w-[14px]" strokeWidth={1.8} />
      )}
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

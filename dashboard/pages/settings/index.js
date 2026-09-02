import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  Cog,
  Database,
  Server,
} from "lucide-react";
import { Card } from "@/components/ui";
import { SettingsHeader, SettingsShell } from "@/components/settings-shell";

function LinkRow({ row, last }) {
  const body = (
    <>
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-pressed bg-hover">
        <row.icon
          className="h-[15px] w-[15px] text-fg"
          strokeWidth={1.8}
        />
      </span>
      <span className="text-[13px] font-medium text-fg">{row.label}</span>
      <ChevronRight className="ml-auto h-[15px] w-[15px] shrink-0 text-fg3" strokeWidth={1.8} />
    </>
  );

  const inner = `flex h-[56px] w-full items-center gap-[14px] pr-[18px] text-left ${
    last ? "" : "border-b border-line"
  }`;

  return (
    <div className="pl-[18px] transition-colors hover:bg-hover">
      <Link href={row.href} className={inner}>
        {body}
      </Link>
    </div>
  );
}

export default function SettingsIndexPage() {
  const items = [
    { label: "Engine", icon: Cog, href: "/settings/engine" },
    { label: "Environment", icon: Server, href: "/settings/env" },
    { label: "Firebase", icon: Database, href: "/settings/firebase" },
  ];

  return (
    <SettingsShell>
      <SettingsHeader />

      <div className="mx-auto w-full max-w-[704px] px-[16px] pb-[80px] pt-[20px] md:px-[24px] md:pt-[48px]">
        <h1 className="mb-[4px] px-[2px] text-[17px] font-medium text-fg">Settings</h1>
        <p className="mb-[16px] px-[2px] text-[12.5px] text-fg3">
          Engine configuration, environment variables, and database management.
        </p>
        <Card>
          {items.map((row, index) => (
            <LinkRow
              key={row.label}
              row={row}
              last={index === items.length - 1}
            />
          ))}
        </Card>
      </div>
    </SettingsShell>
  );
}

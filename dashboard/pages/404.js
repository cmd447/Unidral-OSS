import * as React from "react";
import Link from "next/link";
import { UnidralGlyph } from "@/components/brand";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-auth px-[24px] py-[40px]">
      <div className="flex w-full max-w-[400px] flex-col items-center animate-fadeIn">
        <Link href="/" className="cursor-pointer">
          <UnidralGlyph className="h-[32px] w-auto" />
        </Link>

        <div className="mt-[40px] text-[13px] font-medium text-fg4">Error</div>
        <h1 className="mt-[4px] text-[48px] font-semibold leading-[48px] text-fg">
          404
        </h1>
        <p className="mt-[12px] text-center text-[13px] leading-[19px] text-fg2">
          This page could not be found.
        </p>
        <p className="mt-[4px] text-center text-[12px] leading-[17px] text-fg3">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
      </div>
    </main>
  );
}

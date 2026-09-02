import * as React from "react";
import { useRouter } from "next/router";
import { UnidralGlyph } from "@/components/brand";

export default function PreloaderPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState("Checking engine configuration…");

  React.useEffect(() => {
    fetch("/api/setup/status")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.isConfigured === false) {
          router.replace("/setup" + window.location.search);
        } else {
          router.replace("/app");
        }
      })
      .catch(() => {
        setStatus("Unable to reach the engine. Redirecting…");
        setTimeout(() => router.replace("/app"), 1200);
      });
  }, [router]);

  return (
    <main className="flex h-screen w-full flex-col items-center justify-center gap-[14px] bg-auth">
      <UnidralGlyph className="h-[40px] w-auto animate-glyphPulse" />
      <p className="text-[11.5px] text-fg4">{status}</p>
    </main>
  );
}

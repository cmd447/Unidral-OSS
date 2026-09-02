import '../styles/globals.css';
import * as React from "react";
import { useRouter } from "next/router";
import { UnidralGlyph } from "@/components/brand";
import { loadContent } from "@/lib-engine/api";
import { ToastProvider } from "@/components/ui";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Dashboard Error Boundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex h-screen w-full flex-col items-center justify-center bg-canvas p-[20px] text-center">
          <h1 className="text-[18px] font-semibold text-fg">Something went wrong</h1>
          <p className="mt-[8px] max-w-[400px] text-[13px] text-fg3">
            An unexpected error occurred in the application.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-[16px] rounded-[6px] bg-pressed px-[14px] py-[8px] text-[13px] font-medium text-fg transition-colors hover:bg-pressed"
          >
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [navigating, setNavigating] = React.useState(false);
  const [setupChecked, setSetupChecked] = React.useState(false);
  const [needsSetup, setNeedsSetup] = React.useState(false);

  React.useEffect(() => {
    if (router.pathname === "/setup") {
      setSetupChecked(true);
      return;
    }
    let cancelled = false;
    fetch("/api/setup/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.isConfigured === false) {
          setNeedsSetup(true);
          router.replace("/setup" + window.location.search);
        } else {
          setSetupChecked(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSetupChecked(true);
      });
    return () => { cancelled = true; };
  }, [router.pathname]);

  React.useEffect(() => {
    loadContent();
  }, []);

  React.useEffect(() => {
    const handleStart = () => setNavigating(true);
    const handleComplete = () => setNavigating(false);
    const handleError = () => setNavigating(false);

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);
    router.events.on('routeChangeError', handleError);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
      router.events.off('routeChangeError', handleError);
    };
  }, [router.events]);

  if (needsSetup || (!setupChecked && router.pathname !== "/setup")) {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-auth">
        <UnidralGlyph className="h-[40px] w-auto animate-glyphPulse" />
      </main>
    );
  }

  if (navigating) {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-auth">
        <UnidralGlyph className="h-[40px] w-auto animate-glyphPulse" />
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div key={router.pathname} className="animate-pageIn">
          <Component {...pageProps} />
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}

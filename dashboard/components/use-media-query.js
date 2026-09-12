import * as React from "react";

export const DESKTOP_QUERY = "(min-width: 768px)";

export function useMediaQuery(query, fallback = true) {
  const [matches, setMatches] = React.useState(fallback);
  React.useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = event => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [ query ]);
  return matches;
}

export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY, true);
}

export function useScrollLock(locked) {
  React.useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [ locked ]);
}

import { useEffect, useState } from "react";

// Relative times need no React work while a webview is hidden.
export function useVisibleClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number | undefined;
    const updateVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        timer = window.setInterval(() => setNow(Date.now()), 15_000);
      }
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  return now;
}

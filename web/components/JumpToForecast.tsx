"use client";

import { useEffect, useState } from "react";

/** On a phone the forecast panel is far down the page, so this button stays within reach until the panel is showing. */
export function JumpToForecast() {
  const [panelShowing, setPanelShowing] = useState(false);
  useEffect(() => {
    const panel = document.getElementById("forecast");
    if (!panel) return;
    const observer = new IntersectionObserver(([entry]) => setPanelShowing(Boolean(entry?.isIntersecting)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  if (panelShowing) return null;
  return (
    <a className="btn jump-to-forecast" href="#forecast">
      Make a forecast
    </a>
  );
}

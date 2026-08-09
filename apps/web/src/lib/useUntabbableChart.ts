import { useEffect, useRef } from "react";

/**
 * Keeps a Recharts chart out of the keyboard tab order.
 *
 * Recharts marks its SVG layers with tabindex="0" and overrides a tabIndex prop passed
 * to the chart or series, so the only reliable place to undo it is the DOM after render.
 * The charts here are decorative — every figure they encode is printed as text beside
 * them — and a keyboard user tabbing from the month arrows should reach the content,
 * not an unlabelled graphic.
 */
export function useUntabbableChart<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const strip = () => {
      for (const el of root.querySelectorAll('[tabindex]:not([tabindex="-1"])')) {
        el.setAttribute("tabindex", "-1");
      }
    };

    strip();
    // Recharts re-renders its layers on resize, which restores the attribute.
    const observer = new MutationObserver(strip);
    observer.observe(root, { childList: true, subtree: true, attributeFilter: ["tabindex"] });
    return () => observer.disconnect();
  }, []);

  return ref;
}

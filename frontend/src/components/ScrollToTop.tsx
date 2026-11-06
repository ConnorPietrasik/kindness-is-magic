import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * ScrollToTop — resets the window scroll to the top whenever the route's
 * path changes.
 *
 * SPA navigation does not reset the browser's scroll position, so without
 * this a link clicked from the bottom of a long page (e.g. the brochure)
 * lands the user partway down the destination.
 *
 * Deliberately keyed on the path only:
 *  - a hash-only change is a section jump the destination page scrolls to
 *    itself (the guides' TOC, Home's #how-it-works), and a search-param
 *    change is a filter — neither should yank the user to the top;
 *  - the initial mount is skipped (the previous path starts as the current
 *    one), so a refresh keeps the browser's restored position.
 * The reset is instant: index.css sets `scroll-behavior: smooth` globally,
 * and animating a multi-thousand-pixel scroll on every navigation would
 * feel like the page is still partway down.
 *
 * Must render outside the app's <Suspense>: a lazy page load swaps the whole
 * subtree for the loading fallback, which would reset the state this
 * component relies on.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  });

  return null;
}

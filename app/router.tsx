import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Pages seed client state from loader data once, on mount, so a stale cached match must not
    // render before its reload: wait for fresh data, as vinext's server-rendered navigations did.
    defaultStaleReloadMode: "blocking",
    // One not-found page for every unmatched path, as `app/not-found.tsx` was.
    notFoundMode: "root",
    // The gate's per-request nonce for the router's inline scripts; undefined in the browser.
    ssr: { nonce: getGlobalStartContext()?.nonce },
  });
}

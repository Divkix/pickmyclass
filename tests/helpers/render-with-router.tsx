import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Renders `ui` as the page at `path`, inside a router so `Link` and the router hooks work. */
export async function renderWithRouter(ui: ReactNode, path = "/"): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  await router.load();

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

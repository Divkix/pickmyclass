import { describe, expect, it } from "vite-plus/test";
import { changedStaticRoutes } from "@/lib/seo/lastmod-routes";

const TRACKED = ["/", "/about", "/legal", "/legal/terms"];

describe("changedStaticRoutes", () => {
  it.each([
    ["app/routes/about.tsx", "/about"],
    ["app/routes/legal/index.tsx", "/legal"],
    ["app/routes/legal/terms.tsx", "/legal/terms"],
    ["app/routes/index.tsx", "/"],
    ["app/routes/legal/route.tsx", "/legal"],
  ])("maps %s to %s", (file, route) => {
    expect(changedStaticRoutes([file], TRACKED)).toEqual([route]);
  });

  it("ignores shared shell files", () => {
    expect(
      changedStaticRoutes(
        [
          "app/routes/__root.tsx",
          "app/start.ts",
          "app/router.tsx",
          "app/client.tsx",
          "app/globals.css",
          "app/routeTree.gen.ts",
        ],
        TRACKED,
      ),
    ).toEqual([]);
  });

  it("keeps external content sources and ignores non-content landing components", () => {
    expect(changedStaticRoutes(["components/landing/Hero.tsx", "lib/faqs.ts"], TRACKED)).toEqual([
      "/",
    ]);
    expect(
      changedStaticRoutes(
        ["components/landing/JsonLd.tsx", "components/landing/AuthRedirect.tsx"],
        TRACKED,
      ),
    ).toEqual([]);
  });

  it("returns only tracked routes, sorted and deduplicated", () => {
    expect(
      changedStaticRoutes(
        [
          "app/routes/legal/index.tsx",
          "app/routes/about.tsx",
          "app/routes/legal/route.tsx",
          "app/routes/dashboard/index.tsx",
        ],
        TRACKED,
      ),
    ).toEqual(["/about", "/legal"]);
  });
});

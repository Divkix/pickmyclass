import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";

function robots() {
  const baseUrl = "https://pickmyclass.app";

  const disallow = [
    "/dashboard",
    "/dashboard/*",
    "/admin",
    "/admin/*",
    "/api",
    "/api/*",
    "/auth",
    "/auth/*",
    "/settings",
    "/go/*",
  ];

  return new Response(
    `User-Agent: *\nAllow: /\n${disallow.map((path) => `Disallow: ${path}`).join("\n")}\n\nSitemap: ${baseUrl}/sitemap.xml\n`,
    {
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    },
  );
}

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { GET: robots, ANY: methodNotAllowed } },
});

import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/lib/api/response";

function manifest() {
  const body = {
    name: "PickMyClass — ASU Class Seat Notifications",
    short_name: "PickMyClass",
    description: "Get email alerts when seats open in full ASU classes.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#8C1D40",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

export const Route = createFileRoute("/manifest.webmanifest")({
  server: { handlers: { GET: manifest, ANY: methodNotAllowed } },
});

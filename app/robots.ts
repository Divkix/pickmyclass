import type { MetadataRoute } from "next";

export default async function robots(): Promise<MetadataRoute.Robots> {
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

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

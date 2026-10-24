import { describe, expect, it } from "vite-plus/test";
import { buildClassEmailShell } from "@/lib/email/templates";

describe("buildClassEmailShell", () => {
  it.each([
    ["seat", "🎉 Seat Available!", "#8C1D40", "#6E1733"],
    ["instructor", "👨‍🏫 Instructor Assigned!", "#f59e0b", "#ea580c"],
    ["removed", "Class Removed from Catalog", "#6b7280", "#374151"],
  ] as const)("renders the %s preset", (variant, heading, gradientFrom, gradientTo) => {
    const html = buildClassEmailShell({
      variant,
      title: "t",
      bodyHtml: "<p>b</p>",
      preheader: "",
    });

    expect(html).toContain(`>${heading}</h1>`);
    expect(html).toContain(
      `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%); padding: 30px`,
    );
  });
});

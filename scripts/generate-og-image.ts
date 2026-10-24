import * as fs from "node:fs";
import * as path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { ReactElement } from "react";
import satori from "satori";
import { Effect } from "effect";
import { externalCall } from "../lib/effect/external-call";

const FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.woff";
const FONT_FETCH_TIMEOUT_MS = 30_000;

async function generateOGImage() {
  // Satori requires woff/ttf (not woff2). Use fontsource woff.
  const fontData = await Effect.runPromise(
    externalCall(
      async (signal) => {
        const response = await fetch(FONT_URL, { signal });

        if (!response.ok) throw new Error(`Failed to fetch font: ${response.status}`);

        return response.arrayBuffer();
      },
      FONT_FETCH_TIMEOUT_MS,
      (error) => new Error(`Font download failed: ${error.message}`, { cause: error }),
      () => new Error(`Font download timed out after ${FONT_FETCH_TIMEOUT_MS}ms`),
    ),
  );

  const element: ReactElement = {
    type: "div",
    key: null,
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: 1200,
        height: 630,
        background: "linear-gradient(135deg, #8C1D40 0%, #6E1733 100%)",
        color: "white",
        fontFamily: "Inter",
        position: "relative",
        overflow: "hidden",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 72,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    marginBottom: 16,
                  },
                  children: "PickMyClass",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 32,
                    fontWeight: 700,
                    opacity: 0.95,
                    marginBottom: 24,
                    textAlign: "center",
                    maxWidth: 800,
                  },
                  children: "Stop Refreshing MyASU Every 5 Minutes",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#FFC627",
                    marginBottom: 48,
                  },
                  children: "Free ASU Class Seat Notifications",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 18,
                    fontWeight: 700,
                    opacity: 0.6,
                    borderTop: "1px solid rgba(255,255,255,0.3)",
                    paddingTop: 16,
                  },
                  children: "pickmyclass.app",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Inter",
        data: fontData,
        weight: 700,
        style: "normal",
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const outputPath = path.join(process.cwd(), "public", "og-image.png");
  fs.writeFileSync(outputPath, pngBuffer);

  const stats = fs.statSync(outputPath);
  const sizeKB = Math.round(stats.size / 1024);
  console.log(`OG image generated at public/og-image.png (${sizeKB}KB)`);
}

void generateOGImage();

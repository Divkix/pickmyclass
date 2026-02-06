import * as fs from 'node:fs';
import * as path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { ReactNode } from 'react';
import satori from 'satori';

async function generateOGImage() {
  // Satori requires woff/ttf (not woff2). Use fontsource woff.
  const fontData = await fetch(
    'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.woff'
  ).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch font: ${r.status}`);
    return r.arrayBuffer();
  });

  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 1200,
        height: 630,
        background: 'linear-gradient(135deg, #6366F1 0%, #10B981 100%)',
        color: 'white',
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 72,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    marginBottom: 16,
                  },
                  children: 'PickMyClass',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 32,
                    fontWeight: 700,
                    opacity: 0.95,
                    marginBottom: 24,
                    textAlign: 'center',
                    maxWidth: 800,
                  },
                  children: 'Stop Refreshing MyASU Every 5 Minutes',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 24,
                    fontWeight: 700,
                    opacity: 0.75,
                    marginBottom: 48,
                  },
                  children: 'Free ASU Class Seat Notifications',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: 18,
                    fontWeight: 700,
                    opacity: 0.6,
                    borderTop: '1px solid rgba(255,255,255,0.3)',
                    paddingTop: 16,
                  },
                  children: 'pickmyclass.app',
                },
              },
            ],
          },
        },
      ],
    },
  } as unknown as ReactNode;

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Inter',
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const outputPath = path.join(process.cwd(), 'public', 'og-image.png');
  fs.writeFileSync(outputPath, pngBuffer);

  const stats = fs.statSync(outputPath);
  const sizeKB = Math.round(stats.size / 1024);
  console.log(`OG image generated at public/og-image.png (${sizeKB}KB)`);
}

generateOGImage();

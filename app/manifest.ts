import type { MetadataRoute } from 'next';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return {
    name: 'PickMyClass — ASU Class Seat Notifications',
    short_name: 'PickMyClass',
    description: 'Get email alerts when seats open in full ASU classes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#8C1D40',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}

/**
 * Renders a JSON-LD structured data script tag.
 * Content is hardcoded schema data serialized with safe escaping.
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires innerHTML for structured data; input is hardcoded schema objects with safe serialization
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}

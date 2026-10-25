import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ConsentForm } from "@/components/consent/ConsentForm";
import { requirePageAccess } from "@/lib/auth/page-access";

const consentSearch = z.object({
  error: z.string().default("").catch(""),
  next: z.string().default("").catch(""),
});

const loadConsent = createServerFn()
  .validator(consentSearch)
  .handler(async ({ data }) => {
    const search = new URLSearchParams();

    if (data.error) search.set("error", data.error);

    if (data.next) search.set("next", data.next);
    await requirePageAccess("/consent", search.size ? `?${search}` : "");
  });

export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  validateSearch: consentSearch,
  // Defaults stay out of the URL, or Start redirects every bare /consent to its canonical form.
  search: { middlewares: [stripSearchParams(consentSearch.parse({}))] },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadConsent({ data: deps }),
  component: ConsentPage,
});

function ConsentPage() {
  const search = Route.useSearch();

  return <ConsentForm saveFailed={search.error === "save_failed"} next={search.next} />;
}

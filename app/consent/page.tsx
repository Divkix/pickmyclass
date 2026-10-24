import { ConsentForm } from "@/app/consent/ConsentForm";
import { param } from "@/lib/utils/page-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConsentPage({ searchParams }: { searchParams?: SearchParams }) {
  const sp = (await searchParams) ?? {};

  return <ConsentForm saveFailed={param(sp, "error") === "save_failed"} next={param(sp, "next")} />;
}

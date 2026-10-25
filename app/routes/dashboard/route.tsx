import { Outlet, createFileRoute } from "@tanstack/react-router";
import { MotionProvider } from "@/components/MotionProvider";
import { PRIVATE_PAGE_HEAD } from "@/lib/seo/head";

export const Route = createFileRoute("/dashboard")({
  head: () => PRIVATE_PAGE_HEAD,
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <MotionProvider>
      <Outlet />
    </MotionProvider>
  );
}

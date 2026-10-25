import { createFileRoute } from "@tanstack/react-router";

// Clerk handles its own nested steps inside the parent page.
export const Route = createFileRoute("/sign-up/$")({});

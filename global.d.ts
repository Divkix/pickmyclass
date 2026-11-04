type DeploymentEnvironment = "production" | "preview" | "development";

// Both constants exist only in Vite-built code; Node scripts run with tsx must
// guard them with `typeof` (see lib/log.ts).

/** Set by `define` in vite.config.ts from the CI branch (Workers Builds or GitHub Actions). */
declare const __DEPLOYMENT_ENVIRONMENT__: DeploymentEnvironment;

/** The built commit's short SHA, or `dev` outside CI. */
declare const __BUILD_COMMIT__: string;

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

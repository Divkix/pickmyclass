type DeploymentEnvironment = "production" | "preview" | "development";

/** Set by `define` in vite.config.ts from the Workers Builds variables. */
declare const __DEPLOYMENT_ENVIRONMENT__: DeploymentEnvironment;

/** The built commit's short SHA, or `dev` outside Workers Builds. */
declare const __BUILD_COMMIT__: string;

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

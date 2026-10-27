import { defineConfig } from "cf/config";

// A Worker that only serves the static files in public/ (the directory is set in
// wrangler.config.ts, which cf uses to build static sites), on enco.sh.
export default defineConfig({
  worker: {
    name: "enco-site",
    compatibilityDate: "2026-10-23",
    domains: ["enco.sh"],
    observability: { enabled: true },
  },
});

import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL || "https://mywebsite.858795682.workers.dev",
  build: {
    inlineStylesheets: "auto",
  },
});

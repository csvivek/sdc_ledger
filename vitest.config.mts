import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";

// Tests run against the fake-data JSON store, never Supabase.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    env: {
      VERCEL: "1", // store file goes in the temp folder, not ./data
      TMPDIR: path.join(os.tmpdir(), "sdc-ledger-tests"),
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
    fileParallelism: false,
  },
});

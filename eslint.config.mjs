import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated on install from @rrweb/record.
    "public/rrweb-record.js",
  ]),
  {
    // The tracker and demo shop are plain browser scripts written for the widest support.
    files: ["public/**/*.js"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }] },
  },
]);

export default eslintConfig;

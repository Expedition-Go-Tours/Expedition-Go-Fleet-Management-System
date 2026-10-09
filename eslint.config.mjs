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
  ]),
  {
    // Route handlers are not React components; the react-hooks rules (including
    // the purity rule that flags Date.now/randomUUID in server code) don't apply.
    files: ["src/app/api/**/route.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;

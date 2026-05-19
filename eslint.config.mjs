import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      ".claude/**",
      "node_modules/**",
      "pnpm-lock.yaml",
      "tsconfig.tsbuildinfo",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        React: "readonly",
        RequestInit: "readonly",
        Response: "readonly",
        Request: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Intl: "readonly",
        PromiseRejectedResult: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
    },
  },
  {
    files: ["extensions/canvas-reader/src/**/*.js"],
    languageOptions: {
      globals: {
        chrome: "readonly",
        document: "readonly",
        Element: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        location: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
      },
    },
  },
)

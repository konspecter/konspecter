import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/coverage/",
      "apps/site/build/",
      "apps/site/.react-router/",
      "apps/server/",
      "apps/desktop/src-tauri/",
      "apps/mobile/android/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allows dropping a prop with `({ node, ...props })`.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // React Router loaders and middleware stop with a thrown response (`data(…)`, `redirect(…)`).
    files: ["apps/site/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
            { from: "package", package: "react-router", name: "DataWithResponseInit" },
            { from: "lib", name: "Response" },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
);

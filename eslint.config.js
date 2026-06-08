import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
      {
    ignores: [
      "dist/**",
      "node_modules/**"
    ]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];
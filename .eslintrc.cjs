module.exports = {
  root: true,
  extends: [
    "@tivac",
    "plugin:@typescript-eslint/recommended",
    "plugin:eslint-comments/recommended",
  ],

  ignorePatterns: ["coverage/*", "dist", "node_modules"],
  parser: "@typescript-eslint/parser",

  parserOptions: {
    project: ["./tsconfig.json", "./tsconfig.tests.json"],
    tsconfigRootDir: __dirname,
    ecmaVersion: 2020,
    sourceType: "module",
  },

  env: {
    node: true,
    es6: true,
  },

  plugins: ["@typescript-eslint"],

  reportUnusedDisableDirectives: true,

  rules: {
    "max-statements": "off",
    "newline-after-var": "off",
    "newline-before-return": "off",
    "lines-around-directive": "off",
    "padding-line-between-statements": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/no-use-before-define": "off",
    "no-use-before-define": "off",
    "no-shadow": "off",
    // Plugins
    "eslint-comments/require-description": "warn",
    "eslint-comments/disable-enable-pair": [
      "warn",
      {
        allowWholeFile: true,
      },
    ],
    "key-spacing": [
      "warn",
      {
        beforeColon: false,
      },
    ],
    "keyword-spacing": ["warn", { after: true }],
    "array-bracket-spacing": ["warn", "never"],
    "object-curly-newline": "off",
    "newline-per-chained-call": "off",
    "max-params": "off",
    "prefer-destructuring": "off",
  },
};

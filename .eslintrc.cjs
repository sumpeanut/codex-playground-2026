module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    worker: true,
  },
  parser: "@typescript-eslint/parser",
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  globals: {
    GPUBufferUsage: "readonly",
    GPUMapMode: "readonly",
    GPUShaderStage: "readonly",
    GPUTextureUsage: "readonly",
  },
  plugins: ["@typescript-eslint"],
};

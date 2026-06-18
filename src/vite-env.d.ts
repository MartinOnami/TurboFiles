/// <reference types="vite/client" />

// Raw text imports (e.g. the bundled CHANGELOG shown in Settings).
declare module "*.md?raw" {
  const content: string;
  export default content;
}

import { build } from 'esbuild';
await build({ stdin: { contents: "export * from './src/client.ts'; export * from './src/buttons.ts'; export * from './src/inspector.ts'; export * from './src/settings.ts'; export * from './src/protocol.ts';", resolveDir: process.cwd() },
  outfile: 'dist/test-api.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' });

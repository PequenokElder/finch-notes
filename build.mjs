import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'renderer/dist/app.js',
  format: 'iife',
  target: 'chrome130',
  loader: { '.css': 'text' },
  logLevel: 'info',
  minify: false,
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}

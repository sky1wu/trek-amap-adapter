import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateManifest } from 'trek-plugin-sdk';
import { build } from 'esbuild';

const cli = resolve(
  dirname(fileURLToPath(import.meta.resolve('trek-plugin-sdk'))),
  'cli/trek-plugin.js',
);
for (const id of ['amap-routes', 'amap-transit']) {
  const source = `trek-plugins/${id}/trek-plugin.json`;
  const manifest = JSON.parse(await readFile(source, 'utf8')) as { version: string };
  const validation = validateManifest(manifest);
  if (!validation.ok) throw new Error(validation.errors.join('\n'));
  const output = `dist/plugins/${id}`;
  await mkdir(`${output}/server`, { recursive: true });
  await copyFile(source, `${output}/trek-plugin.json`);
  await build({
    entryPoints: ['trek-plugins/provider.ts'],
    outfile: `${output}/server/index.js`,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    footer: { js: 'module.exports = module.exports.default;' },
    legalComments: 'inline',
  });
  await copyFile('trek-plugins/README.md', `${output}/README.md`);
  const zodLicense = await readFile('node_modules/zod/LICENSE', 'utf8');
  await writeFile(
    `${output}/LICENSE.md`,
    `${await readFile('THIRD_PARTY_NOTICES.md', 'utf8')}\n## Bundled Zod\n\n${zodLicense}`,
    'utf8',
  );
  await writeFile(`${output}/package.json`, '{"type":"commonjs"}\n', 'utf8');
  const result = spawnSync(
    process.execPath,
    [cli, 'pack', output, '--out', `dist/${id}-${manifest.version}.zip`, '--json'],
    {
      stdio: 'inherit',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

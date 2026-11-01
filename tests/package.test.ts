import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command } from '../src/util.js';

test('Git packaging ships the prebuilt plugin without invoking child npm', {skip: !process.env.npm_execpath}, async t => {
  // Exercise the npm resolver used by the developer/CI, with a deliberately
  // unavailable child npm to reproduce embedded installers' preparation failure.
  const requireNpm = createRequire(process.env.npm_execpath!);
  const pacote = requireNpm('pacote');
  const Arborist = requireNpm('@npmcli/arborist');
  const tar = requireNpm('tar');
  const root = await mkdtemp(join(tmpdir(), 'loop-git-package-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const repo = join(root, 'source with spaces');
  await mkdir(repo);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  for (const path of ['dist', 'skills', 'LICENSE', 'README.md']) await cp(resolve(path), join(repo, path), {recursive: true});
  const marker = join(root, 'child-npm-called');
  const unavailableNpm = join(root, 'unavailable-npm.js');
  await writeFile(unavailableNpm, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');process.exit(73);`);
  const options = {cache: join(root, 'cache'), npmBin: unavailableNpm, Arborist};
  const commit = async () => {
    assert.equal((await command(['git', 'add', '.'], repo)).exitCode, 0);
    const result = await command(['git', '-c', 'user.name=Packaging test', '-c', 'user.email=test@example.invalid',
      'commit', '-m', 'Packaging fixture'], repo);
    assert.equal(result.exitCode, 0, result.stderr);
    return (await command(['git', 'rev-parse', 'HEAD'], repo)).stdout.trim();
  };
  assert.equal((await command(['git', 'init', repo], root)).exitCode, 0);
  await writeFile(join(repo, 'package.json'), JSON.stringify({...pkg, scripts: {...pkg.scripts, build: 'unused'}}));
  const brokenRevision = await commit();
  const spec = `git+${pathToFileURL(repo).href}`;
  await assert.rejects(pacote.tarball.file(`${spec}#${brokenRevision}`, join(root, 'broken.tgz'), options), /git dep preparation failed/);
  await access(marker);
  await rm(marker);

  await writeFile(join(repo, 'package.json'), JSON.stringify(pkg));
  const fixedRevision = await commit();
  const archive = join(root, 'plugin.tgz');
  await pacote.tarball.file(`${spec}#${fixedRevision}`, archive, options);
  await assert.rejects(access(marker), {code: 'ENOENT'});
  const files: string[] = [];
  await tar.t({file: archive, onentry: (entry: {path: string}) => files.push(entry.path)});
  for (const path of ['dist/index.js', 'skills/openspec-verify-loop/SKILL.md',
    'skills/openspec-verify-loop/references/report-contract.md']) assert(files.includes(`package/${path}`), path);
  assert(!files.some(path => path.includes('node_modules/')));
});

import { readFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { atomicWrite } from './state.js';
import { contained, digest, exists, LoopError, VERSION } from './util.js';

const files = ['commands/verify-loop.md', 'agents/openspec-loop-verifier.md', 'agents/openspec-loop-fixer.md'];
const marker = /\n<!-- openspec-verify-loop v[^ ]+ sha256:([a-f0-9]{64}) -->\n$/;
export async function setup(projectPath: string, skillPath: string, replace = false) {
  const project = await realpath(resolve(projectPath));
  const skillDir = await realpath(skillPath);
  const skillFile = join(skillDir, 'SKILL.md');
  if (!await exists(skillFile) || !await exists(join(skillDir, 'scripts/controller.mjs'))) throw new Error('Installed skill lacks its entrypoint or runtime bundle');
  // Prefer a portable path through .opencode/skills, including a symlink to a canonical .agents copy.
  const conventional = join(project, '.opencode/skills/openspec-verify-loop');
  const located = await exists(conventional) && await realpath(conventional) === skillDir ? conventional : skillDir;
  const pathForCommand = contained(project, located) ? relative(project, join(located, 'SKILL.md')) : join(located, 'SKILL.md');
  const proposed: {path: string; body: string; status: string}[] = [];
  const conflicts: {path: string; existing: string; proposed: string}[] = [];
  for (const file of files) {
    const path = join(project, '.opencode', file);
    // Refuse directory or file symlinks escaping the requested project.
    let ancestor = path;
    while (!await exists(ancestor)) ancestor = dirname(ancestor);
    if (!contained(project, await realpath(ancestor)) || (await exists(path) && (await lstat(path)).isSymbolicLink())) {
      throw new Error(`Setup destination is a symlink or escapes the project: ${path}`);
    }
    const template = await readFile(join(skillDir, 'templates', file.split('/').at(-1)!), 'utf8');
    const content = template.replaceAll('{{skillPath}}', JSON.stringify(pathForCommand));
    const body = `${content}\n<!-- openspec-verify-loop v${VERSION} sha256:${digest(content)} -->\n`;
    let status = 'created';
    if (await exists(path)) {
      const old = await readFile(path, 'utf8');
      if (old === body) status = 'unchanged';
      else {
        const match = marker.exec(old);
        const untouched = match && digest(old.slice(0, match.index)) === match[1];
        status = 'updated';
        if (!untouched && !replace) conflicts.push({path, existing: old, proposed: body});
      }
    }
    proposed.push({path, body, status});
  }
  if (conflicts.length) throw new LoopError('blocked', 'Setup found customized files; review these replacements and rerun with --replace only if intended', conflicts);
  for (const f of proposed) if (f.status !== 'unchanged') {
    await mkdir(dirname(f.path), {recursive: true});
    await atomicWrite(f.path, f.body, true);
  }
  return {outcome: 'setup_complete', files: proposed.map(({path, status}) => ({path, status})),
    next: 'Reload OpenCode configuration before invoking /verify-loop (opencode reload from this project).'};
}

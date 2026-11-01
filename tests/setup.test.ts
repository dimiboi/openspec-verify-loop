import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setup } from '../src/setup.js';
import { command, exists } from '../src/util.js';

test('setup is idempotent, preserves frontmatter, and does not change user configuration',async t=>{
  const project=await mkdtemp(join(tmpdir(),'loop-setup-'));t.after(()=>rm(project,{recursive:true,force:true}));
  await writeFile(join(project,'opencode.json'),'user configuration');
  const skill=resolve('skills/openspec-verify-loop');
  const first=await setup(project,skill);assert(first.files.every(f=>f.status==='created'));
  const second=await setup(project,skill);assert(second.files.every(f=>f.status==='unchanged'));
  assert.equal(await readFile(join(project,'opencode.json'),'utf8'),'user configuration');
  assert.match(await readFile(join(project,'.opencode/agents/openspec-loop-verifier.md'),'utf8'),/^---\n/);
});
test('setup reports all custom-file conflicts before writing any generated file',async t=>{
  const project=await mkdtemp(join(tmpdir(),'loop-setup-'));t.after(()=>rm(project,{recursive:true,force:true}));
  await mkdir(join(project,'.opencode/agents'),{recursive:true});
  const path=join(project,'.opencode/agents/openspec-loop-fixer.md');
  await writeFile(path,'custom agent');
  await assert.rejects(setup(project,resolve('skills/openspec-verify-loop')),/customized files/);
  assert.equal(await readFile(path,'utf8'),'custom agent');
  assert(!await exists(join(project,'.opencode/commands/verify-loop.md')));
  await setup(project,resolve('skills/openspec-verify-loop'),true);
  assert.match(await readFile(path,'utf8'),/mode: all/);
});
test('setup detects edits to generated files and updates untouched generated files',async t=>{
  const base=await mkdtemp(join(tmpdir(),'loop-setup-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const project=join(base,'project'),skill=join(base,'skill');await mkdir(project);
  await cp(resolve('skills/openspec-verify-loop'),skill,{recursive:true});
  await setup(project,skill);
  const template=join(skill,'templates/openspec-loop-fixer.md');await writeFile(template,(await readFile(template,'utf8'))+'\nUpdated instructions.\n');
  const updated=await setup(project,skill);
  assert(updated.files.some(f=>f.status==='updated'));
  const path=join(project,'.opencode/agents/openspec-loop-fixer.md');
  await writeFile(path,(await readFile(path,'utf8')).replace('Updated instructions.','User customization.'));
  await assert.rejects(setup(project,skill),/customized files/);
});
for(const symlinked of [false,true]) test(`standalone ${symlinked?'symlink':'copy'} install works without source dependencies and survives relocation`,async t=>{
  const base=await mkdtemp(join(tmpdir(),'loop-install-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const project=join(base,'project with spaces');await mkdir(join(project,'.opencode/skills'),{recursive:true});
  const installed=join(project,'.opencode/skills/openspec-verify-loop');
  if(symlinked) {
    const canonical=join(project,'.agents/skills/openspec-verify-loop');await mkdir(join(project,'.agents/skills'),{recursive:true});
    await cp(resolve('skills/openspec-verify-loop'),canonical,{recursive:true});
    await symlink('../../.agents/skills/openspec-verify-loop',installed);
  } else await cp(resolve('skills/openspec-verify-loop'),installed,{recursive:true});
  const executable=join(installed,'scripts/controller.mjs');
  const result=await command([process.execPath,executable,'setup','--project',project],base);
  assert.equal(result.exitCode,0,result.stdout+result.stderr);
  assert.match(await readFile(join(project,'.opencode/commands/verify-loop.md'),'utf8'),/\.opencode\/skills\/openspec-verify-loop\/SKILL.md/);
  const moved=join(base,'relocated');await rename(project,moved);
  const help=await command([process.execPath,join(moved,'.opencode/skills/openspec-verify-loop/scripts/controller.mjs'),'--help'],base);
  assert.equal(help.exitCode,0);assert.match(help.stdout,/resume/);
});

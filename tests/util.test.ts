import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { command, delay, exists } from '../src/util.js';

test('checks execute argv directly and preserve exit code and output',async()=>{
  const result=await command([process.execPath,'-e','console.log(process.argv[1]); process.exit(7)','literal $(no-shell); data'],process.cwd());
  assert.equal(result.exitCode,7);assert.equal(result.stdout.trim(),'literal $(no-shell); data');
});
test('timeouts and cancellation do not leave a command tree running',async t=>{
  if(process.platform==='win32') {t.skip('POSIX process-group assertion');return;}
  const base=await mkdtemp(join(tmpdir(),'loop-command-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const marker=join(base,'orphan.txt');
  const descendant=`process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan'),1400);`;
  const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},100);`;
  await assert.rejects(command([process.execPath,'-e',parent],base,300),/timed out/);
  await delay(1100);
  assert.equal(await exists(marker),false);
  const abort=new AbortController();
  const task=command([process.execPath,'-e','setInterval(()=>{},100);'],base,10_000,abort.signal);
  abort.abort();await assert.rejects(task,/interrupted/);
});

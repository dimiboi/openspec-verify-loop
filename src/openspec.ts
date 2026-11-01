import { z } from 'zod';
import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import type { Adapter, Catalog, Model } from './opencode.js';
import { parseModel } from './opencode.js';
import { workerPolicyDigest, workerPermissions, type Permission } from './workers.js';
import type { Config } from './config.js';
import { LoopError, command, contained, digest, exists, jsonCommand, snapshot, type CommandResult, type Snapshot } from './util.js';

const listSchema = z.object({
  changes: z.array(z.object({name: z.string().min(1), nested: z.array(z.string()).optional()})),
  root: z.object({path: z.string(), source: z.string(), store_id: z.string().optional()}),
});
const statusSchema = z.object({changeName: z.string(), changeRoot: z.string(), schemaName: z.string()});
const applySchema = z.object({state: z.enum(['ready', 'blocked', 'all_done']),
  progress: z.object({remaining: z.number().int().nonnegative()}).passthrough(), contextFiles: z.record(z.string(), z.array(z.string())),
  tasks: z.array(z.object({sourcePath:z.string().optional()}).passthrough()).optional(),
}).passthrough();
export type Target = {project: string; changeName: string; targetPath: string; root: string; schema: string};
export type Pins = Target & {
  openspecVersion: string; procedurePath: string; procedureDigest: string; scopeDigest: string;
  workerPolicyDigest: string; configDigest: string;
  projectConfigDigest: string; trackingPaths: string[];
  agents: {verifier: string; fixer: string}; models: {verifier: Model; fixer: Model};
  permissions: {verifier: Permission[]; fixer: Permission[]};
};
export type Evidence = {validation: CommandResult; apply: z.infer<typeof applySchema>;
  checks: CommandResult[]; before: Snapshot; after: Snapshot};

export async function selectTarget(project: string, change?: string): Promise<Target> {
  const list = listSchema.parse(await jsonCommand(['openspec', 'list', '--json'], project));
  const root = await realpath(list.root.path);
  if (list.root.store_id || root !== project || !['nearest', 'implicit'].includes(list.root.source)) {
    throw new LoopError('blocked', 'Only repo-local OpenSpec roots are supported; store and multi-repository targets are unsupported');
  }
  const active = list.changes.filter(c => !c.nested?.length);
  if (change === undefined) {
    if (active.length === 0) throw new LoopError('no_active_change', 'There is no active OpenSpec change');
    if (active.length !== 1) throw new LoopError('selection_required', 'Choose an active OpenSpec change', active.map(c => c.name));
    change = active[0]!.name;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change) || !active.some(c => c.name === change)) {
    throw new LoopError('blocked', `Change ${JSON.stringify(change)} is not a valid active change`);
  }
  const status = statusSchema.parse(await jsonCommand(['openspec', 'status', '--change', change, '--json'], project));
  const targetPath = await realpath(status.changeRoot);
  if (status.changeName !== change || targetPath !== await realpath(join(root, 'openspec', 'changes', change)) || !contained(root, targetPath)) {
    throw new LoopError('blocked', 'OpenSpec resolved a target outside the selected repo-local change');
  }
  return {project, changeName: change, targetPath, root, schema: status.schemaName};
}

/** Pin the whole skill resource directory, not only its entrypoint. */
export async function directoryDigest(directory: string, filter: (name: string) => boolean = () => true): Promise<string> {
  const values: [string, string][] = [];
  const walk = async (dir: string) => {
    for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      const name = relative(directory, path).split(sep).join('/');
      if (!filter(name)) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isSymbolicLink()) throw new LoopError('blocked', `Resource contains an unsupported symlink: ${path}`);
      else values.push([name, digest(await readFile(path))]);
    }
  };
  await walk(directory);
  return digest(JSON.stringify(values));
}
async function scopeDigest(target: Target, trackingPaths: string[]) {
  // Use OpenSpec's task source paths rather than assuming an artifact ID or filename.
  return directoryDigest(target.targetPath, name => !trackingPaths.includes(resolve(target.targetPath,name)));
}
async function projectConfigDigest(project: string) {
  const hashes: [string,string][] = [];
  for(const path of ['AGENTS.md','.opencode/AGENTS.md','opencode.json','opencode.jsonc',
    '.opencode/opencode.json','.opencode/opencode.jsonc','openspec/config.yaml','openspec/config.yml']) {
    if(await exists(join(project,path)))hashes.push([path,digest(await readFile(join(project,path)))]);
  }
  if(await exists(join(project,'openspec/schemas')))hashes.push(['schemas',await directoryDigest(join(project,'openspec/schemas'))]);
  return digest(JSON.stringify(hashes));
}
function resolveWorkers(catalog: Catalog, config: Config, options: {originModel?: Model; models?: Pins['models']} = {}) {
  const build = catalog.agents.find(agent => agent.id === 'build');
  if (!build || build.mode === 'subagent') throw new LoopError('blocked', 'An API-capable build agent is required');
  const agents = {verifier: 'build', fixer: 'build'};
  const models = {} as Pins['models'];
  for (const role of ['verifier', 'fixer'] as const) {
    const override = role === 'verifier' ? config.verifierModel : config.fixerModel;
    const model = options.models?.[role] ?? (override ? parseModel(override) : options.originModel);
    if (!model) throw new LoopError('blocked', `Cannot inherit the initiating session's ${role} model; select a model in that session or set the plugin's ${role}Model option`);
    const available = catalog.models.find(m => m.providerID === model.providerID && m.id === model.id && m.enabled);
    // Hosts report the implicit base configuration as variant "default" without listing it.
    if (!available || (model.variant && model.variant !== 'default' && !available.variants.includes(model.variant))) {
      throw new LoopError('blocked', `Unavailable ${role} model ${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ''}`);
    }
    models[role] = model;
  }
  return {agents, models, workerPolicyDigest: workerPolicyDigest(build),
    permissions: {verifier: workerPermissions('verifier', build.permissions), fixer: workerPermissions('fixer', build.permissions)}};
}
export async function pinTarget(target: Target, config: Config, adapter: Adapter, options: {originModel?: Model; models?: Pins['models']} = {}): Promise<Pins> {
  const version = await command(['openspec', '--version'], target.project);
  if (version.exitCode || version.stdout.trim() !== '1.16.0') throw new LoopError('blocked', 'OpenSpec 1.16.0 is required for this release');
  const catalog = await adapter.catalog(target.project);
  const matches = catalog.skills.filter(s => s.id === 'openspec-verify-change' || s.name === 'openspec-verify-change');
  let procedurePath: string;
  if (config.skill) {
    procedurePath = await realpath(resolve(target.project, config.skill));
    if (!catalog.skills.some(s => resolve(s.path) === procedurePath)) {
      const paths = await Promise.all(catalog.skills.map(s => realpath(s.path).catch(()=>undefined)));
      if (!paths.includes(procedurePath)) throw new LoopError('blocked', 'Explicit verification skill is not advertised by this OpenCode project');
    }
  } else {
    const local = join(target.project,'.opencode/skills/openspec-verify-change/SKILL.md');
    if (await exists(local)) procedurePath = await realpath(local);
    else {
      if (matches.length !== 1) throw new LoopError('blocked', 'Expected one openspec-verify-change skill; install the expanded OpenSpec workflow or set the skill plugin option');
      procedurePath = await realpath(matches[0]!.path);
    }
  }
  if (!(await lstat(procedurePath)).isFile() || !(await readFile(procedurePath, 'utf8')).trim()) {
    throw new LoopError('blocked', 'Verification procedure is empty or unreadable');
  }
  const apply = applySchema.parse(await jsonCommand(['openspec','instructions','apply','--change',target.changeName,'--json'],target.project));
  const trackingPaths = [...new Set(await Promise.all((apply.tasks ?? []).flatMap(task=>task.sourcePath?[realpath(task.sourcePath)]:[])))].sort();
  if(trackingPaths.some(path=>!contained(target.targetPath,path)))throw new LoopError('blocked','Task tracking outside the pinned change is unsupported');
  return {...target, openspecVersion: version.stdout.trim(), procedurePath,
    procedureDigest: await directoryDigest(dirname(procedurePath)), scopeDigest: await scopeDigest(target,trackingPaths),
    trackingPaths,projectConfigDigest:await projectConfigDigest(target.project),
    configDigest: digest(JSON.stringify(config)), ...resolveWorkers(catalog, config, options)};
}
export async function checkPins(pins: Pins, config: Config, adapter: Adapter) {
  const target = await selectTarget(pins.project, pins.changeName);
  const current = await pinTarget(target, config, adapter, {models: pins.models});
  if (digest(JSON.stringify(current)) !== digest(JSON.stringify(pins))) {
    throw new LoopError('blocked', 'Pinned target, requirements, procedure, model, or agent configuration changed; review it and start a new run');
  }
}
export async function gatherEvidence(pins: Pins, config: Config, signal?: AbortSignal): Promise<Evidence> {
  const before = await snapshot(pins.project);
  const validation = await command(['openspec', 'validate', pins.changeName, '--type', 'change', '--strict', '--no-interactive', '--json'], pins.project, 120_000, signal);
  const apply = applySchema.parse(await jsonCommand(['openspec', 'instructions', 'apply', '--change', pins.changeName, '--json'], pins.project));
  for (const paths of Object.values(apply.contextFiles)) {
    for (const path of paths) if (!contained(pins.project, await realpath(path))) throw new LoopError('blocked', 'Multi-repository artifact context is unsupported');
  }
  if (apply.state === 'blocked') throw new LoopError('blocked', 'OpenSpec apply prerequisites are incomplete', apply);
  const checks: CommandResult[] = [];
  for (const check of config.checks) {
    const cwd = await realpath(resolve(pins.project, check.cwd ?? '.'));
    if (!contained(pins.project, cwd)) throw new LoopError('blocked', `Check ${check.id} is outside the checkout`);
    checks.push(await command(check.command, cwd, check.timeoutMs, signal));
  }
  const after = await snapshot(pins.project);
  if (before.hash !== after.hash) throw new LoopError('blocked', 'A configured check modified source or unignored files; ignore its generated outputs or fix the check');
  return {validation, apply, checks, before, after};
}
export function evidenceFailures(e: Evidence): string[] {
  return [
    ...(e.validation.exitCode ? ['OpenSpec strict validation failed'] : []),
    ...(e.apply.progress.remaining ? [`${e.apply.progress.remaining} OpenSpec tasks remain incomplete`] : []),
    ...e.checks.filter(c => c.exitCode).map(c => `Required check failed: ${JSON.stringify(c.command)}`),
  ];
}

import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { resolve } from 'node:path';

const endpoint = await Service.discover({version:'2.2.5'});
if(!endpoint)throw new Error('Start a healthy OpenCode 2.2.5 service before running this read-only probe.');
const client = OpenCode.make({baseUrl:endpoint.url, headers:Service.headers(endpoint)});
const location = {directory: resolve(process.argv[2] ?? process.cwd())};
const [info, models, agents, skills] = await Promise.all([
  client.server.info(), client.model.list({location}),
  client.agent.list({location}), client.skill.list({location}),
]);
console.log(JSON.stringify({version:info.version, models:models.data.map(m=>({id:m.id,providerID:m.providerID})),
  agents:agents.data.map(a=>({id:a.id,mode:a.mode})), skills:skills.data.filter(s=>s.name.startsWith('openspec')).map(s=>({id:s.id,name:s.name,path:s.path}))},null,2));

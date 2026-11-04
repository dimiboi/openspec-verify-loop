// The slice of bb's plugin API this entry uses; bb passes the real one and validates the return value.
type Bb = {agents: {configure(select: (context: {origin: {pluginId: string | null}}) => {tools: string[]; skills: string[]}): void}};

// Hide the skill from Workflows workers, as Workflows does for its own, so a verifier or fixer cannot start a loop.
export default function plugin(bb: Bb): void {
  bb.agents.configure(({origin}) => ({tools: [], skills: origin.pluginId === 'workflows' ? [] : ['openspec-verify-loop']}));
}

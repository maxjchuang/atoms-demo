/** Pinned Messages provider supports off, not the Chat/Responses spelling none. */
export const PLANNING_REASONING_EFFORT = 'off' as const;
export const PLANNING_DSH_PATCH = ['tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh']
  .map((id) => `- id: ${id}\n  disabled: true\n`).join('')
  + '- id: llm-deepseek\n  config:\n    thinking: disabled\n    reasoningEffort: off\n';

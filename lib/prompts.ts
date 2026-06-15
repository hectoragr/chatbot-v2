import promptsData from '../src/config/prompts.json' with { type: 'json' };

interface SystemPrompt {
  id: string;
  description: string;
  system: string;
  temperature: number;
  maxTokens: number;
}

interface PromptsConfig {
  prompts: {
    [key: string]: SystemPrompt;
  };
}

const config = promptsData as PromptsConfig;

export async function getSystemPrompt(promptId: string): Promise<SystemPrompt> {
  const prompt = config.prompts[promptId];
  if (!prompt) {
    throw new Error(`PROMPT_NOT_FOUND: System prompt '${promptId}' not found`);
  }
  return prompt;
}

export async function listPrompts(): Promise<{ id: string; description: string }[]> {
  return Object.values(config.prompts).map(({ id, description }) => ({
    id,
    description,
  }));
}

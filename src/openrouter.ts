import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OpenRouterUsage;
  id: string;
  model: string;
}

/**
 * Fetch available models from OpenRouter API.
 * Returns a map of display names to model IDs.
 */
export async function fetchOpenRouterModels(): Promise<Record<string, string>> {
  const secrets = readEnvFile(['OPENROUTER_API_KEY']);
  if (!secrets.OPENROUTER_API_KEY) {
    logger.warn('OPENROUTER_API_KEY not found, skipping OpenRouter model fetch');
    return {};
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${secrets.OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch OpenRouter models');
      return {};
    }

    const data = await response.json() as { data: OpenRouterModel[] };
    const models: Record<string, string> = {};

    // Filter to recent, popular models and create short aliases
    for (const model of data.data) {
      // Skip deprecated or very expensive models
      if (model.id.includes('preview') || model.id.includes('deprecated')) continue;

      // Create a short alias from the model ID
      // e.g. "anthropic/claude-3.5-sonnet" -> "or-sonnet-3.5"
      // e.g. "google/gemini-pro-1.5" -> "or-gemini-pro"
      // e.g. "openai/gpt-4-turbo" -> "or-gpt4-turbo"
      const parts = model.id.split('/');
      if (parts.length === 2) {
        const [provider, modelName] = parts;
        const shortName = modelName
          .replace('claude-', '')
          .replace('gemini-', 'gemini-')
          .replace('gpt-', 'gpt')
          .replace('-preview', '')
          .replace('-latest', '');

        const alias = `or-${provider.slice(0, 4)}-${shortName}`.slice(0, 30);
        models[alias] = model.id;
      }
    }

    logger.info({ count: Object.keys(models).length }, 'Fetched OpenRouter models');
    return models;
  } catch (error) {
    logger.error({ error }, 'Error fetching OpenRouter models');
    return {};
  }
}

/**
 * Call OpenRouter API for chat completion.
 * Simple implementation without tool calling support.
 */
export async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  abortSignal?: AbortSignal,
): Promise<{ text: string; usage: OpenRouterUsage }> {
  const secrets = readEnvFile(['OPENROUTER_API_KEY']);
  if (!secrets.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not found in .env');
  }

  logger.info({ model, messageCount: messages.length }, 'Calling OpenRouter API');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secrets.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/yourusername/claudeclaw',
      'X-Title': 'ClaudeClaw Bot',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'OpenRouter API error');
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as OpenRouterResponse;

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenRouter');
  }

  const text = data.choices[0].message.content;
  const usage = data.usage;

  logger.info({
    model: data.model,
    tokens: usage.total_tokens,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
  }, 'OpenRouter response received');

  return { text, usage };
}

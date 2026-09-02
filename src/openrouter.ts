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

export interface ModelWithPrice {
  id: string;
  alias: string;
  promptCost: number;
}

/**
 * Fetch available models from OpenRouter API.
 * Returns array of models sorted by price (cheapest first), plus a map for lookup.
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
 * Fetch OpenRouter models with pricing and return the cheapest one.
 */
export async function getCheapestOpenRouterModel(): Promise<{ id: string; alias: string } | null> {
  const secrets = readEnvFile(['OPENROUTER_API_KEY']);
  if (!secrets.OPENROUTER_API_KEY) {
    logger.warn('OPENROUTER_API_KEY not found, skipping cheapest model lookup');
    return null;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${secrets.OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch OpenRouter models for pricing');
      return null;
    }

    const data = await response.json() as { data: OpenRouterModel[] };
    const modelsWithPrice: ModelWithPrice[] = [];

    for (const model of data.data) {
      if (model.id.includes('preview') || model.id.includes('deprecated')) continue;

      const promptCost = parseFloat(model.pricing.prompt);
      if (isNaN(promptCost)) continue;

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
        modelsWithPrice.push({ id: model.id, alias, promptCost });
      }
    }

    // Sort by prompt cost, pick cheapest
    modelsWithPrice.sort((a, b) => a.promptCost - b.promptCost);
    const cheapest = modelsWithPrice[0];

    if (cheapest) {
      logger.info({ model: cheapest.id, cost: cheapest.promptCost }, 'Found cheapest OpenRouter model');
      return { id: cheapest.id, alias: cheapest.alias };
    }

    return null;
  } catch (error) {
    logger.error({ error }, 'Error fetching cheapest OpenRouter model');
    return null;
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

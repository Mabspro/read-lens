import { callAnthropicProvider } from "@/lib/providers/anthropic";
import { callGeminiProvider } from "@/lib/providers/gemini";
import { callOpenAIProvider, callGrokProvider } from "@/lib/providers/openai";

export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  grok: "grok-3",
};

export async function callProvider(provider, apiKey, model, systemPrompt, userContent, maxTokens = 8192) {
  const resolvedProvider = provider || "anthropic";
  const resolvedModel = model || DEFAULT_MODELS[resolvedProvider] || DEFAULT_MODELS.anthropic;

  if (!apiKey) {
    throw new Error("API key is required for enrichment.");
  }

  if (resolvedProvider === "anthropic") {
    return callAnthropicProvider({ apiKey, model: resolvedModel, systemPrompt, userContent, maxTokens });
  }
  if (resolvedProvider === "openai") {
    return callOpenAIProvider({ apiKey, model: resolvedModel, systemPrompt, userContent, maxTokens });
  }
  if (resolvedProvider === "gemini") {
    return callGeminiProvider({ apiKey, model: resolvedModel, systemPrompt, userContent, maxTokens });
  }
  if (resolvedProvider === "grok") {
    return callGrokProvider({ apiKey, model: resolvedModel, systemPrompt, userContent, maxTokens });
  }

  throw new Error(`Unsupported provider: ${resolvedProvider}`);
}

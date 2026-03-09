async function callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, userContent, maxTokens }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: typeof userContent === "string" ? userContent : JSON.stringify(userContent) },
      ],
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  return data.choices?.[0]?.message?.content || "";
}

export async function callOpenAIProvider(config) {
  return callOpenAICompatible({ ...config, baseUrl: "https://api.openai.com/v1" });
}

export async function callGrokProvider(config) {
  return callOpenAICompatible({ ...config, baseUrl: "https://api.x.ai/v1" });
}

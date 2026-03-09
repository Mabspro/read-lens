export async function callAnthropicProvider({ apiKey, model = "claude-sonnet-4-20250514", systemPrompt, userContent, maxTokens = 8192 }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: typeof userContent === "string" ? userContent : JSON.stringify(userContent) }],
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  return data.content?.filter((block) => block.type === "text").map((block) => block.text).join("") || "";
}

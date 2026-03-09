export async function callGeminiProvider({ apiKey, model = "gemini-2.0-flash", systemPrompt, userContent, maxTokens = 8192 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: typeof userContent === "string" ? userContent : JSON.stringify(userContent) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
}

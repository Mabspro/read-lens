import { NextResponse } from "next/server";
import { callProvider, DEFAULT_MODELS } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { provider = "anthropic", apiKey, model } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required." }, { status: 400 });
    }

    const response = await callProvider(
      provider,
      apiKey,
      model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic,
      "Return exactly the word OK.",
      "Connection test",
      32
    );

    return NextResponse.json({ ok: true, response: response.trim() || "OK" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Connection failed." }, { status: 500 });
  }
}

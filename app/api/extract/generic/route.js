import { NextResponse } from "next/server";
import { extractGenericSource } from "@/lib/extractors";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required." }, { status: 400 });
    }

    const source = await extractGenericSource(url);
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generic extraction failed." }, { status: 500 });
  }
}

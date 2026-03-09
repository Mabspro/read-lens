import { NextResponse } from "next/server";
import { extractTweetId } from "@/lib/source-utils";
import { extractTwitterSource } from "@/lib/extractors";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { id, url } = await request.json();
    const tweetId = id || extractTweetId(url || "");

    if (!tweetId) {
      return NextResponse.json({ error: "Tweet ID is required." }, { status: 400 });
    }

    const source = await extractTwitterSource(tweetId, url);
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Twitter extraction failed." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { enrichSources } from "@/lib/enrichment";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { sources, mode = "auto", providerConfig = null } = await request.json();

    if (!Array.isArray(sources) || sources.length === 0) {
      return NextResponse.json({ error: "At least one extracted source is required." }, { status: 400 });
    }

    const report = await enrichSources(sources, mode, providerConfig);
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enrichment failed." }, { status: 500 });
  }
}

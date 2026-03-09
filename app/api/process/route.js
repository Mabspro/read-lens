import { NextResponse } from "next/server";
import { detectSourceType, dedupeUrls, extractTweetId } from "@/lib/source-utils";
import { extractTwitterSource, extractGenericSource } from "@/lib/extractors";
import { enrichSources, resolveProviderSummary } from "@/lib/enrichment";

export const dynamic = "force-dynamic";

const CONCURRENCY_LIMIT = 5;

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await task(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request) {
  try {
    const { urls, mode = "auto", providerConfig = null } = await request.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "At least one URL is required." }, { status: 400 });
    }

    const normalizedUrls = dedupeUrls(urls);
    if (normalizedUrls.length === 0) {
      return NextResponse.json({ error: "No valid http(s) URLs were provided." }, { status: 400 });
    }

    const items = await mapWithConcurrency(normalizedUrls, CONCURRENCY_LIMIT, async (url) => {
      const sourceType = detectSourceType(url);
      try {
        const source = sourceType === "tweet"
          ? await extractTwitterSource(extractTweetId(url), url)
          : await extractGenericSource(url);

        return {
          url,
          sourceType,
          status: source.extractionQuality === "limited" ? "limited" : "success",
          extractionQuality: source.extractionQuality,
          extractionNote: source.extractionNote || "",
          source,
        };
      } catch (error) {
        return {
          url,
          sourceType,
          status: "failed",
          extractionQuality: "limited",
          extractionNote: error instanceof Error ? error.message : "Extraction failed.",
        };
      }
    });

    const successfulSources = items.filter((item) => item.source).map((item) => item.source);
    if (successfulSources.length === 0) {
      return NextResponse.json({ error: "No sources could be extracted.", items }, { status: 500 });
    }

    const report = await enrichSources(successfulSources, mode, providerConfig);
    report.failures = items.filter((item) => item.status === "failed").map((item) => ({ url: item.url, error: item.extractionNote }));

    return NextResponse.json({
      items,
      report,
      provider: resolveProviderSummary(providerConfig),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Processing failed." }, { status: 500 });
  }
}

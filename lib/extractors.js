import { extract } from "@extractus/article-extractor";
import {
  getTweetToken,
  normalizeTwitterPayload,
  normalizeGenericPayload,
  isThinContent,
} from "@/lib/source-utils";

function pickBetterText(primary, fallback) {
  const primaryText = (primary || "").trim();
  const fallbackText = (fallback || "").trim();
  return fallbackText.length > primaryText.length ? fallbackText : primaryText;
}

async function fetchJinaContent(url) {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: "application/json",
      "X-Respond-With": "markdown",
      "X-No-Cache": "true",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Jina Reader returned ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  let title = "";
  let text = "";
  let metadata = {};

  if (contentType.includes("application/json")) {
    const data = await response.json();
    title = data.title || "";
    text = data.content || "";
    metadata = {
      description: data.description || "",
      publishedAt: data.date || "",
    };
  } else {
    text = await response.text();
    title = (text.split(/\r?\n/).find(Boolean) || "").replace(/^#\s*/, "");
  }

  return { title, text, metadata };
}

async function fetchArticleExtractorContent(url) {
  try {
    const article = await extract(url);
    return {
      title: article?.title || "",
      text: article?.content || article?.description || "",
      metadata: {
        author: article?.author || "",
        publishedAt: article?.published || "",
        description: article?.description || "",
      },
    };
  } catch {
    return { title: "", text: "", metadata: {} };
  }
}

export async function extractTwitterSource(id, url) {
  const token = getTweetToken(id);
  const response = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "read-lens/0.1",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Twitter syndication returned ${response.status}.`);
  }

  const data = await response.json();
  return normalizeTwitterPayload(data, url);
}

export async function extractGenericSource(url) {
  const jina = await fetchJinaContent(url);
  const lowContent = isThinContent(jina.text, jina.title);

  if (!lowContent) {
    return normalizeGenericPayload({
      url,
      title: jina.title,
      text: jina.text,
      metadata: jina.metadata,
      extractionQuality: "full",
      extractionNote: "",
    });
  }

  const article = await fetchArticleExtractorContent(url);
  const mergedText = pickBetterText(jina.text, article.text);
  const mergedTitle = article.title || jina.title;
  const mergedMetadata = { ...jina.metadata, ...article.metadata };
  const stillThin = isThinContent(mergedText, mergedTitle);

  return normalizeGenericPayload({
    url,
    title: mergedTitle,
    text: mergedText || jina.text,
    metadata: mergedMetadata,
    extractionQuality: stillThin ? "limited" : "full",
    extractionNote: stillThin
      ? "Limited content extracted. Source may require direct access, PDF download, or a different tool."
      : "",
  });
}

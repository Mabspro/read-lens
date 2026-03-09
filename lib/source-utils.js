export function isValidHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getHostname(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractTweetId(input) {
  const patterns = [/status\/(\d+)/, /^(\d{15,})$/];
  for (const pattern of patterns) {
    const match = input.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function getTweetToken(id) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

export function detectSourceType(input) {
  const host = getHostname(input);
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    return "tweet";
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return "linkedin";
  }
  return "web";
}

export function extractLinkedResources(text = "") {
  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return [...new Set(matches)].slice(0, 12);
}

export function normalizeTwitterPayload(data, originalUrl) {
  const textParts = [
    data.text || "",
    data.quoted_tweet
      ? `Quoted tweet by @${data.quoted_tweet.user?.screen_name || "unknown"}: ${data.quoted_tweet.text || ""}`
      : "",
  ].filter(Boolean);

  const text = textParts.join("\n\n");

  return {
    id: data.id_str,
    sourceType: "tweet",
    title: data.user?.name ? `${data.user.name} on X` : "Tweet",
    author: data.user?.screen_name ? `@${data.user.screen_name}` : "Unknown",
    authorName: data.user?.name || "",
    url: originalUrl || `https://x.com/${data.user?.screen_name || "i"}/status/${data.id_str}`,
    hostname: getHostname(originalUrl || "https://x.com"),
    publishedAt: data.created_at || "",
    engagement: {
      likes: data.favorite_count || 0,
      reposts: data.retweet_count || 0,
    },
    preview: data.text || "",
    text,
    metadata: {
      hasMedia: Boolean(data.mediaDetails?.length || data.photos?.length),
    },
    linkedResources: extractLinkedResources(text),
    extractionQuality: "full",
    extractionNote: "",
  };
}

export function normalizeGenericPayload({ url, title, text, metadata = {}, extractionQuality = "full", extractionNote = "" }) {
  return {
    id: url,
    sourceType: detectSourceType(url),
    title: title || url,
    author: metadata.author || "",
    authorName: metadata.author || "",
    url,
    hostname: getHostname(url),
    publishedAt: metadata.publishedAt || "",
    engagement: null,
    preview: (text || "").slice(0, 280),
    text: text || "",
    metadata,
    linkedResources: extractLinkedResources(text || ""),
    extractionQuality,
    extractionNote,
  };
}

export function coerceLines(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function dedupeUrls(urls) {
  return [...new Set(urls.map((item) => item.trim()).filter(Boolean).filter(isValidHttpUrl))];
}

export function isThinContent(text, title = "") {
  const normalized = (text || "").trim();
  if (normalized.length < 200) return true;

  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 3 && normalized.length < 350) return true;

  const withoutTitle = title ? normalized.replace(title, "").trim() : normalized;
  if (withoutTitle.length < 160) return true;

  return false;
}

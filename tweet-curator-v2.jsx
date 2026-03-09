
import { useRef, useState, useCallback } from "react";

function extractTweetId(input) {
  const patterns = [/status\/(\d+)/, /^(\d{15,})$/];
  for (const pattern of patterns) {
    const match = input.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getTweetToken(id) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getHostname(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectSourceType(input) {
  const host = getHostname(input);
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    return "tweet";
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return "linkedin";
  }
  return "web";
}

async function fetchTweetSource(url) {
  const id = extractTweetId(url);
  if (!id) {
    throw new Error("Could not extract a tweet ID from this URL.");
  }

  const token = getTweetToken(id);
  const response = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
  if (!response.ok) {
    throw new Error(`Syndication API returned ${response.status}`);
  }

  const data = await response.json();
  const combinedText = [
    data.text || "",
    data.quoted_tweet
      ? `Quoted tweet by @${data.quoted_tweet.user?.screen_name || "unknown"}: ${data.quoted_tweet.text || ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: data.id_str || id,
    sourceType: "tweet",
    title: data.user?.name ? `${data.user.name} on X` : "Tweet",
    author: data.user?.screen_name ? `@${data.user.screen_name}` : "Unknown",
    url,
    hostname: getHostname(url),
    publishedAt: data.created_at || "",
    engagement: {
      likes: data.favorite_count || 0,
      reposts: data.retweet_count || 0,
    },
    text: combinedText,
    preview: data.text || "",
    metadata: {
      authorName: data.user?.name || "",
      hasMedia: !!(data.mediaDetails?.length || data.photos?.length),
    },
  };
}

async function fetchReaderSource(url) {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: "application/json",
      "X-Respond-With": "markdown",
      "X-No-Cache": "true",
    },
  });

  if (!response.ok) {
    throw new Error(`Reader returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let title = "";
  let text = "";

  if (contentType.includes("application/json")) {
    const data = await response.json();
    title = data.title || "";
    text = data.content || "";
  } else {
    text = await response.text();
    const firstLine = text.split(/\r?\n/).find(Boolean) || "";
    title = firstLine.replace(/^#\s*/, "");
  }

  return {
    id: url,
    sourceType: detectSourceType(url),
    title: title || url,
    author: "",
    url,
    hostname: getHostname(url),
    publishedAt: "",
    engagement: null,
    text,
    preview: text.slice(0, 280),
    metadata: {},
  };
}

async function fetchSource(url) {
  const sourceType = detectSourceType(url);
  if (sourceType === "tweet") {
    return fetchTweetSource(url);
  }
  return fetchReaderSource(url);
}

const SYSTEM_PROMPT = `You are a research synthesis assistant.

You will receive a JSON array of source objects. For each source, produce:
- summary: a concise 2-4 sentence synthesis
- key_takeaways: 2-4 short bullets with the most useful ideas or claims
- why_it_matters: a short explanation of why this source matters strategically or technically
- follow_up_questions: 2-4 research questions or next steps
- related_rails: 2-4 short research rails to explore next
- confidence: one of High, Medium, Low

Also produce:
- report_title: a short useful title for the batch
- batch_summary: a concise synthesis across all sources
- thematic_clusters: 2-5 short themes present in the batch

Respond ONLY with valid JSON:
{
  "report_title": "...",
  "batch_summary": "...",
  "thematic_clusters": ["...", "..."],
  "sources": [
    {
      "id": "...",
      "summary": "...",
      "key_takeaways": ["...", "..."],
      "why_it_matters": "...",
      "follow_up_questions": ["...", "..."],
      "related_rails": ["...", "..."],
      "confidence": "High"
    }
  ]
}`;

const SOURCE_COLORS = {
  tweet: "#f97316",
  linkedin: "#0a66c2",
  web: "#14b8a6",
};

function StatusDot({ color, pulse }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        display: "inline-block",
        background: color,
        animation: pulse ? "pulse 1.2s ease-in-out infinite" : "none",
      }}
    />
  );
}

function toLines(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
function renderMarkdownReport(report, generatedAt) {
  const chunks = [
    `# ${report.report_title}`,
    `_${report.sources.length} sources analyzed — ${generatedAt}_`,
    "",
    "## Batch Summary",
    report.batch_summary,
    "",
    "## Themes",
    ...toLines(report.thematic_clusters).map((theme) => `- ${theme}`),
    "",
  ];

  report.sources.forEach((source) => {
    chunks.push(`## ${source.title || source.url}`);
    chunks.push(`Source: ${source.url}`);
    if (source.author) chunks.push(`Author: ${source.author}`);
    if (source.hostname) chunks.push(`Type: ${source.sourceType} · ${source.hostname}`);
    chunks.push("");
    chunks.push("### Summary");
    chunks.push(source.summary || "");
    chunks.push("");
    chunks.push("### Key Takeaways");
    chunks.push(...toLines(source.key_takeaways).map((item) => `- ${item}`));
    chunks.push("");
    chunks.push("### Why It Matters");
    chunks.push(source.why_it_matters || "");
    chunks.push("");
    chunks.push("### Follow-up Questions");
    chunks.push(...toLines(source.follow_up_questions).map((item) => `- ${item}`));
    chunks.push("");
    chunks.push("### Research Rails");
    chunks.push(...toLines(source.related_rails).map((item) => `- ${item}`));
    chunks.push("");
  });

  return chunks.join("\n");
}

export default function TweetCuratorV2() {
  const [urlInput, setUrlInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sources, setSources] = useState([]);
  const [report, setReport] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0, errors: [] });
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef(null);

  const runResearchPass = useCallback(async () => {
    const urls = urlInput
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(isValidHttpUrl);

    const uniqueUrls = [...new Set(urls)];

    if (uniqueUrls.length === 0) {
      setErrorMsg("Paste one or more valid http(s) URLs, one per line.");
      setPhase("error");
      return;
    }

    if (!apiKey.trim()) {
      setErrorMsg("Enter your Anthropic API key for local enrichment.");
      setPhase("error");
      return;
    }

    setPhase("fetching");
    setFetchProgress({ done: 0, total: uniqueUrls.length, errors: [] });
    setErrorMsg("");
    setReport(null);
    setSources([]);

    const fetched = [];
    const errors = [];

    for (let index = 0; index < uniqueUrls.length; index += 1) {
      const currentUrl = uniqueUrls[index];
      try {
        const source = await fetchSource(currentUrl);
        fetched.push(source);
      } catch (error) {
        errors.push({
          url: currentUrl,
          error: error instanceof Error ? error.message : "Unknown extraction error",
        });
      }
      setFetchProgress({ done: index + 1, total: uniqueUrls.length, errors: [...errors] });
    }

    setSources(fetched);

    if (fetched.length === 0) {
      setErrorMsg("No sources could be extracted. Try public URLs first or reduce the batch.");
      setPhase("error");
      return;
    }

    setPhase("summarizing");

    try {
      const payload = fetched.map((source) => ({
        id: source.id,
        sourceType: source.sourceType,
        title: source.title,
        author: source.author,
        url: source.url,
        hostname: source.hostname,
        publishedAt: source.publishedAt,
        preview: source.preview,
        text: source.text?.slice(0, 12000) || "",
      }));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(payload) }],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic returned ${response.status}: ${text.slice(0, 240)}`);
      }

      const data = await response.json();
      const textBlocks = data.content?.filter((block) => block.type === "text").map((block) => block.text).join("") || "";
      const clean = textBlocks.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      const mergedSources = fetched.map((source) => {
        const enriched = parsed.sources?.find((item) => item.id === source.id) || {};
        return {
          ...source,
          summary: enriched.summary || source.preview || "",
          key_takeaways: toLines(enriched.key_takeaways),
          why_it_matters: enriched.why_it_matters || "",
          follow_up_questions: toLines(enriched.follow_up_questions),
          related_rails: toLines(enriched.related_rails),
          confidence: enriched.confidence || "Low",
        };
      });

      setReport({
        report_title: parsed.report_title || "Research Report",
        batch_summary: parsed.batch_summary || "",
        thematic_clusters: toLines(parsed.thematic_clusters),
        sources: mergedSources,
        errors,
      });
      setPhase("done");
    } catch (error) {
      const fallbackSources = fetched.map((source) => ({
        ...source,
        summary: source.preview || "",
        key_takeaways: ["Extraction worked, but enrichment failed."],
        why_it_matters: "",
        follow_up_questions: [],
        related_rails: [],
        confidence: "Low",
      }));

      setErrorMsg(
        `Enrichment failed: ${error instanceof Error ? error.message : "Unknown error"}. Extraction still worked, so you can inspect the source text below.`
      );
      setReport({
        report_title: "Research Report (unenriched)",
        batch_summary: "Content extraction succeeded, but the AI enrichment step failed.",
        thematic_clusters: [],
        sources: fallbackSources,
        errors,
      });
      setPhase("done");
    }
  }, [apiKey, urlInput]);

  const reset = useCallback(() => {
    setUrlInput("");
    setSources([]);
    setReport(null);
    setPhase("idle");
    setFetchProgress({ done: 0, total: 0, errors: [] });
    setErrorMsg("");
  }, []);

  const copyForDoc = useCallback(async () => {
    if (!report) return;
    const generatedAt = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const markdown = renderMarkdownReport(report, generatedAt);

    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      if (!outputRef.current) return;
      const range = document.createRange();
      range.selectNodeContents(outputRef.current);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("copy");
      selection.removeAllRanges();
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [report]);

  const showOutput = phase === "done" && report;
  const generatedAt = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(249,115,22,0.14), transparent 28%), radial-gradient(circle at top right, rgba(20,184,166,0.10), transparent 22%), #081018",
        color: "#d7dde7",
        fontFamily: "'Azeret Mono', 'IBM Plex Mono', monospace",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap');
        @keyframes pulse { 0%,100% { opacity:.35; transform:scale(.85) } 50% { opacity:1; transform:scale(1.1) } }
        @keyframes slideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        .source-card { animation: slideIn .28s ease forwards; }
        textarea::placeholder, input::placeholder { color: #4c5668; }
        button:hover:not(:disabled) { filter: brightness(1.06); }
        details summary { cursor: pointer; user-select: none; }
      `}</style>

      <div
        style={{
          padding: "22px 28px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#f97316", fontWeight: 600 }}>READ LENS</div>
          <div
            style={{
              fontSize: 22,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              color: "#f5f7fb",
              marginTop: 2,
            }}
          >
            Local research helper
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#7e8a9b", lineHeight: 1.6, textAlign: "right" }}>
          local-first proof
          <br />
          x + generic url extraction
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 83px)" }}>
        <div
          style={{
            width: showOutput ? "38%" : "100%",
            maxWidth: showOutput ? "460px" : "760px",
            margin: showOutput ? 0 : "0 auto",
            padding: "28px",
            borderRight: showOutput ? "1px solid rgba(255,255,255,0.07)" : "none",
            display: "flex",
            flexDirection: "column",
            transition: "all .35s ease",
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#8290a3", marginBottom: 10 }}>
            URLS TO ANALYZE
          </div>

          <textarea
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            disabled={phase === "fetching" || phase === "summarizing"}
            placeholder={`https://x.com/i/status/2030593163728212473\nhttps://www.linkedin.com/posts/example-post\nhttps://example.com/article`}
            style={{
              minHeight: showOutput ? 260 : 360,
              background: "rgba(9,16,27,0.85)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 18,
              color: "#d7dde7",
              fontSize: 13,
              lineHeight: 1.8,
              resize: "vertical",
            }}
          />

          <div style={{ fontSize: 10, letterSpacing: 2, color: "#8290a3", marginTop: 16, marginBottom: 10 }}>
            ANTHROPIC API KEY
          </div>

          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={phase === "fetching" || phase === "summarizing"}
            placeholder="sk-ant-..."
            style={{
              background: "rgba(9,16,27,0.85)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: "14px 16px",
              color: "#d7dde7",
              fontSize: 13,
            }}
          />

          <div style={{ fontSize: 11, color: "#7e8a9b", marginTop: 10, lineHeight: 1.7 }}>
            X links use the syndication endpoint. LinkedIn and most other URLs fall back to Jina Reader for text extraction.
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={runResearchPass}
              disabled={!urlInput.trim() || !apiKey.trim() || phase === "fetching" || phase === "summarizing"}
              style={{
                flex: 1,
                padding: "14px 18px",
                background:
                  phase === "fetching" || phase === "summarizing"
                    ? "rgba(255,255,255,0.08)"
                    : "linear-gradient(90deg, #f97316, #14b8a6)",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif",
                cursor:
                  !urlInput.trim() || !apiKey.trim() || phase === "fetching" || phase === "summarizing"
                    ? "not-allowed"
                    : "pointer",
                opacity: !urlInput.trim() || !apiKey.trim() ? 0.45 : 1,
              }}
            >
              {phase === "fetching"
                ? `Extracting ${fetchProgress.done}/${fetchProgress.total}...`
                : phase === "summarizing"
                  ? "Enriching report..."
                  : "Extract & Enrich"}
            </button>
            {(showOutput || phase === "error") && (
              <button
                onClick={reset}
                style={{
                  padding: "14px 18px",
                  background: "transparent",
                  color: "#a9b3c2",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </div>

          {(phase === "fetching" || phase === "summarizing") && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot color="#14b8a6" pulse />
                <span style={{ fontSize: 11, color: "#9aa6b5" }}>
                  {phase === "fetching"
                    ? `Extracting source ${fetchProgress.done} of ${fetchProgress.total}...`
                    : "Generating summaries, takeaways, and follow-up rails..."}
                </span>
              </div>
              {phase === "fetching" && fetchProgress.total > 0 && (
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #f97316, #14b8a6)",
                      width: `${(fetchProgress.done / fetchProgress.total) * 100}%`,
                      transition: "width .25s ease",
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                background: "rgba(80,20,20,0.35)",
                border: "1px solid rgba(248,113,113,0.25)",
                borderRadius: 10,
                fontSize: 12,
                color: "#fca5a5",
                lineHeight: 1.6,
              }}
            >
              {errorMsg}
            </div>
          )}

          {sources.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 11, color: "#95a2b5", letterSpacing: 1 }}>
                EXTRACTED SOURCES ({sources.length})
              </summary>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {sources.map((source, index) => (
                  <div
                    key={`${source.id}-${index}`}
                    className="source-card"
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      padding: 12,
                      background: "rgba(9,16,27,0.62)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          display: "inline-block",
                          background: SOURCE_COLORS[source.sourceType] || "#94a3b8",
                        }}
                      />
                      <span style={{ fontSize: 11, color: "#c8d1dd" }}>{source.title || source.url}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#7e8a9b", lineHeight: 1.7 }}>
                      {source.sourceType} · {source.hostname}
                      {source.author ? ` · ${source.author}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, lineHeight: 1.6 }}>
                      {source.preview}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {showOutput && report.errors?.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 11, color: "#f59e0b", letterSpacing: 1 }}>
                EXTRACTION FAILURES ({report.errors.length})
              </summary>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {report.errors.map((item, index) => (
                  <div key={`${item.url}-${index}`} style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.6 }}>
                    {item.url}
                    <br />
                    {item.error}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {showOutput && (
          <div style={{ flex: 1, padding: "28px", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 2, color: "#8290a3", marginBottom: 4 }}>REPORT</div>
                <div
                  style={{
                    fontSize: 18,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    color: "#f5f7fb",
                  }}
                >
                  {report.report_title}
                </div>
                <div style={{ fontSize: 11, color: "#7e8a9b", marginTop: 3 }}>
                  {report.sources.length} sources · {generatedAt}
                </div>
              </div>
              <button
                onClick={copyForDoc}
                style={{
                  padding: "10px 16px",
                  background: copied ? "rgba(20,184,166,0.18)" : "rgba(255,255,255,0.06)",
                  color: copied ? "#5eead4" : "#c5ced9",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied report" : "Copy report"}
              </button>
            </div>

            <div
              ref={outputRef}
              style={{
                background: "rgba(9,16,27,0.72)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                padding: 26,
              }}
            >
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#f5f7fb" }}>
                {report.report_title}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#7e8a9b" }}>{generatedAt}</div>

              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#f97316", marginBottom: 8 }}>BATCH SUMMARY</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "#d7dde7" }}>{report.batch_summary}</div>
              </div>

              {report.thematic_clusters?.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#14b8a6", marginBottom: 8 }}>THEMES</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {report.thematic_clusters.map((theme, index) => (
                      <span
                        key={`${theme}-${index}`}
                        style={{
                          fontSize: 11,
                          color: "#c9f7ef",
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "rgba(20,184,166,0.10)",
                          border: "1px solid rgba(20,184,166,0.18)",
                        }}
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 18 }}>
                {report.sources.map((source, index) => (
                  <div
                    key={`${source.id}-${index}`}
                    className="source-card"
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 14,
                      padding: 18,
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          display: "inline-block",
                          background: SOURCE_COLORS[source.sourceType] || "#94a3b8",
                        }}
                      />
                      <div style={{ fontSize: 16, color: "#f5f7fb", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
                        {source.title || source.url}
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: "#7e8a9b", lineHeight: 1.7 }}>
                      {source.sourceType} · {source.hostname}
                      {source.author ? ` · ${source.author}` : ""}
                      {source.confidence ? ` · confidence: ${source.confidence}` : ""}
                      {" · "}
                      <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: "#9dd9ff" }}>
                        source
                      </a>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 11, letterSpacing: 2, color: "#f97316", marginBottom: 6 }}>SUMMARY</div>
                      <div style={{ fontSize: 14, lineHeight: 1.7, color: "#d7dde7" }}>{source.summary}</div>
                    </div>

                    {source.key_takeaways?.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#14b8a6", marginBottom: 6 }}>KEY TAKEAWAYS</div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: "#d7dde7", lineHeight: 1.8 }}>
                          {source.key_takeaways.map((item, itemIndex) => (
                            <li key={`${item}-${itemIndex}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {source.why_it_matters && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#f97316", marginBottom: 6 }}>WHY IT MATTERS</div>
                        <div style={{ fontSize: 14, lineHeight: 1.7, color: "#d7dde7" }}>{source.why_it_matters}</div>
                      </div>
                    )}

                    {source.follow_up_questions?.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#14b8a6", marginBottom: 6 }}>FOLLOW-UP QUESTIONS</div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: "#d7dde7", lineHeight: 1.8 }}>
                          {source.follow_up_questions.map((item, itemIndex) => (
                            <li key={`${item}-${itemIndex}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {source.related_rails?.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#f97316", marginBottom: 6 }}>RESEARCH RAILS</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {source.related_rails.map((item, itemIndex) => (
                            <span
                              key={`${item}-${itemIndex}`}
                              style={{
                                fontSize: 11,
                                color: "#ffd7bd",
                                padding: "6px 10px",
                                borderRadius: 999,
                                background: "rgba(249,115,22,0.09)",
                                border: "1px solid rgba(249,115,22,0.18)",
                              }}
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <details style={{ marginTop: 14 }}>
                      <summary style={{ fontSize: 10, color: "#7e8a9b", letterSpacing: 1.2 }}>EXTRACTED TEXT PREVIEW</summary>
                      <pre
                        style={{
                          marginTop: 10,
                          background: "rgba(0,0,0,0.18)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 10,
                          padding: 14,
                          fontSize: 11,
                          color: "#9fb0c4",
                          lineHeight: 1.7,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {source.text?.slice(0, 2500)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            </div>

            <details style={{ marginTop: 18 }}>
              <summary style={{ fontSize: 10, color: "#7e8a9b", letterSpacing: 1.2 }}>RAW MARKDOWN REPORT</summary>
              <pre
                style={{
                  marginTop: 10,
                  background: "rgba(9,16,27,0.72)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: 18,
                  fontSize: 11,
                  color: "#a8b5c7",
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                }}
              >
                {renderMarkdownReport(report, generatedAt)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

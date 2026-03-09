import { coerceLines } from "@/lib/source-utils";
import { callProvider, DEFAULT_MODELS } from "@/lib/providers";

const MAX_TOKENS = 8192;
const BATCH_SIZE = 5;
const TEXT_THRESHOLD = 6000;

const SYSTEM_PROMPT = `You are a research synthesis assistant helping a generalist researcher quickly triage and retain useful knowledge.

You will receive a JSON object with two fields:
- globalMode: auto | research | quick_note
- sources: an array of normalized source objects

Mode policy:
- If globalMode is research, every non-limited source must be treated as research.
- If globalMode is quick_note, every non-limited source must be treated as quick_note.
- If globalMode is auto, decide per source:
  - research: substantive signal, strategic implication, important technical guidance, data, non-obvious market or product insight, durable concept worth revisiting
  - quick_note: brief announcement, quick reaction, tool share, link drop, lightweight commentary, simple news relay, short opinion without much depth

Always output a mode field with either "research" or "quick_note".

Research mode requirements:
- summary: concise but meaningful synthesis, not a rewrite of the source
- keyTakeaways: 2-4 concrete takeaways
- whyItMatters: practical significance for a researcher, builder, strategist, or operator
- followUpQuestions: 2-4 next questions worth checking
- researchRails: 2-4 adjacent directions to explore next
- confidence: High | Medium | Low

Quick note mode requirements:
- messageInContext: restate the core message in the context of the original post or share, preserving useful structure when helpful
- authorStance: endorsing | critiquing | questioning | neutral_sharing
- keyTakeaways: 2-3 max
- entities: list of linked resources, tools, people, organizations, papers, or products explicitly mentioned or implied strongly enough to be useful
- whyThisMightMatter: optional single sentence only when a quick note has real strategic or technical relevance; otherwise omit or leave empty
- confidence: High | Medium | Low

Formatting rules:
- Preserve meaningful bullets, numbered steps, short quoted blocks, or list structure when that structure carries meaning.
- Avoid flattening everything into generic prose if the source is list-like.
- Be concise and information-dense.
- Do not invent facts not supported by the source.

Also produce:
- reportTitle: short and useful
- batchSummary: synthesis across the whole batch
- thematicClusters: 2-5 themes that would help someone revisit the batch later

Respond ONLY with valid JSON in this shape:
{
  "reportTitle": "...",
  "batchSummary": "...",
  "thematicClusters": ["..."],
  "sources": [
    {
      "id": "...",
      "mode": "research",
      "summary": "...",
      "keyTakeaways": ["..."],
      "whyItMatters": "...",
      "followUpQuestions": ["..."],
      "researchRails": ["..."],
      "confidence": "High"
    },
    {
      "id": "...",
      "mode": "quick_note",
      "messageInContext": "...",
      "authorStance": "endorsing",
      "keyTakeaways": ["..."],
      "entities": ["..."],
      "whyThisMightMatter": "...",
      "confidence": "Medium"
    }
  ]
}`;

const MERGE_PROMPT = `You will receive multiple batch-level research summaries. Merge them into one final memo for a researcher who wants a fast but reusable synthesis.

Return ONLY valid JSON in this shape:
{
  "reportTitle": "...",
  "batchSummary": "...",
  "thematicClusters": ["..."]
}`;

function buildFallbackSource(source) {
  return {
    ...source,
    mode: source.mode || "quick_note",
    messageInContext: source.messageInContext || source.preview || source.summary || "",
    authorStance: source.authorStance || "neutral_sharing",
    keyTakeaways: source.keyTakeaways?.length ? source.keyTakeaways : ["Partial fallback: enrichment did not fully complete for this source."],
    entities: source.entities || source.linkedResources || [],
    whyThisMightMatter: source.whyThisMightMatter || "",
    summary: source.summary || source.messageInContext || source.preview || "",
    whyItMatters: source.whyItMatters || "",
    followUpQuestions: source.followUpQuestions || [],
    researchRails: source.researchRails || [],
    confidence: source.confidence || "Low",
  };
}

function buildLimitedSource(source, globalMode) {
  const resolvedMode = globalMode === "research" ? "research" : "quick_note";
  const baseSummary = source.preview || source.title || source.url;
  return {
    ...source,
    mode: resolvedMode,
    summary: `Only limited metadata could be extracted for this source. Available context: ${baseSummary}`,
    whyItMatters: "This source may still matter, but the accessible content was too thin to support a reliable full synthesis.",
    followUpQuestions: [
      "Open the source directly to inspect the full content.",
      "If this is a PDF, gated page, or dynamic app, try a document-analysis workflow or manual review.",
    ],
    researchRails: [
      "Review the original source manually.",
      "Try a PDF or saved-document workflow if the source is not plain web text.",
    ],
    messageInContext: `Limited extraction only. The available metadata suggests: ${baseSummary}`,
    authorStance: "neutral_sharing",
    keyTakeaways: [
      source.title || source.url,
      "Full article or post text could not be extracted automatically.",
      "Use direct access or a document-focused tool before relying on this source heavily.",
    ],
    entities: source.linkedResources?.length ? source.linkedResources : [source.hostname].filter(Boolean),
    whyThisMightMatter: "",
    confidence: "Low",
  };
}

function sanitizeMode(mode, globalMode) {
  if (globalMode === "research") return "research";
  if (globalMode === "quick_note") return "quick_note";
  return mode === "research" ? "research" : "quick_note";
}

function sanitizeReport(parsed, extractedSources, globalMode) {
  return {
    reportTitle: parsed.reportTitle || "Research Report",
    batchSummary: parsed.batchSummary || "",
    thematicClusters: coerceLines(parsed.thematicClusters),
    reportType: "enriched",
    sources: extractedSources.map((source) => {
      if (source.extractionQuality === "limited") {
        return buildLimitedSource(source, globalMode);
      }

      const enriched = parsed.sources?.find((item) => item.id === source.id) || {};
      const mode = sanitizeMode(enriched.mode, globalMode);
      return buildFallbackSource({
        ...source,
        mode,
        summary: enriched.summary || source.preview || "",
        keyTakeaways: coerceLines(enriched.keyTakeaways),
        whyItMatters: enriched.whyItMatters || "",
        followUpQuestions: coerceLines(enriched.followUpQuestions),
        researchRails: coerceLines(enriched.researchRails),
        messageInContext: enriched.messageInContext || source.preview || "",
        authorStance: enriched.authorStance || "neutral_sharing",
        entities: coerceLines(enriched.entities).length ? coerceLines(enriched.entities) : source.linkedResources || [],
        whyThisMightMatter: enriched.whyThisMightMatter || "",
        confidence: enriched.confidence || "Low",
      });
    }),
  };
}

function buildExtractOnlyReport(sources) {
  const counts = sources.reduce((acc, source) => {
    acc[source.sourceType] = (acc[source.sourceType] || 0) + 1;
    return acc;
  }, {});

  return {
    reportType: "extract_only",
    reportTitle: "Extracted Sources",
    batchSummary: "Organized extracted content only. Add an API key in settings to enable AI analysis.",
    thematicClusters: Object.entries(counts).map(([key, count]) => `${key}: ${count}`),
    sources: sources.map((source) => ({
      ...source,
      mode: "extract_only",
      entities: source.linkedResources || [],
      keyTakeaways: [],
      followUpQuestions: [],
      researchRails: [],
      summary: source.preview || "",
      messageInContext: source.text || source.preview || "",
    })),
  };
}

function buildBatchPayload(sources) {
  return sources
    .filter((source) => source.extractionQuality !== "limited")
    .map((source) => ({
      id: source.id,
      sourceType: source.sourceType,
      title: source.title,
      author: source.author,
      url: source.url,
      hostname: source.hostname,
      publishedAt: source.publishedAt,
      preview: source.preview,
      text: (source.text || "").slice(0, 12000),
    }));
}

function extractTextLength(sources) {
  return sources
    .filter((source) => source.extractionQuality !== "limited")
    .reduce((total, source) => total + (source.text || "").length, 0);
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonCandidate(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const direct = tryParseJson(clean);
  if (direct) return direct;
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return tryParseJson(clean.slice(start, end + 1));
  }
  return null;
}

function extractBalancedSection(text, key) {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex === -1) return "";
  const arrayStart = text.indexOf("[", keyIndex);
  if (arrayStart === -1) return "";
  let depth = 0;
  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(arrayStart, index + 1);
    }
  }
  return text.slice(arrayStart);
}

function salvageString(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)(?<!\\\\)"`));
  return match?.[1] || "";
}

function salvageArrayOfStrings(text, key) {
  const section = extractBalancedSection(text, key);
  return [...section.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]);
}

function salvageSourceObjects(text) {
  const section = extractBalancedSection(text, "sources");
  const objects = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  let escaped = false;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index];
    if (char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) inString = !inString;
    escaped = false;
    if (inString) continue;
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const parsed = tryParseJson(section.slice(start, index + 1));
        if (parsed) objects.push(parsed);
        start = -1;
      }
    }
  }
  return objects;
}

function salvagePartialResponse(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return {
    reportTitle: salvageString(clean, "reportTitle") || "Research Report",
    batchSummary: salvageString(clean, "batchSummary") || "",
    thematicClusters: salvageArrayOfStrings(clean, "thematicClusters"),
    sources: salvageSourceObjects(clean),
  };
}

function parseStructuredResponse(text) {
  return extractJsonCandidate(text) || salvagePartialResponse(text);
}

function isHostEnrichmentAllowed() {
  const rawValue = process.env.ALLOW_HOST_ENRICHMENT;
  if (typeof rawValue === "string" && rawValue.length > 0) {
    const value = rawValue.toLowerCase();
    return value === "true" || value === "1" || value === "yes";
  }
  return process.env.NODE_ENV !== "production";
}

function getProviderConfig(providerConfig) {
  if (providerConfig?.apiKey) {
    return {
      provider: providerConfig.provider || "anthropic",
      model: providerConfig.model || DEFAULT_MODELS[providerConfig.provider || "anthropic"],
      apiKey: providerConfig.apiKey,
      source: "session",
    };
  }

  if (process.env.ANTHROPIC_API_KEY && isHostEnrichmentAllowed()) {
    return {
      provider: "anthropic",
      model: DEFAULT_MODELS.anthropic,
      apiKey: process.env.ANTHROPIC_API_KEY,
      source: "env",
    };
  }

  return { provider: "none", model: "", apiKey: "", source: "free" };
}

async function callLLM(providerDetails, systemPrompt, payload, maxTokens) {
  return callProvider(
    providerDetails.provider,
    providerDetails.apiKey,
    providerDetails.model,
    systemPrompt,
    payload,
    maxTokens
  );
}

async function enrichBatch(sources, globalMode, providerDetails) {
  const batchPayload = buildBatchPayload(sources);
  if (batchPayload.length === 0) {
    return sanitizeReport({ reportTitle: "Research Report", batchSummary: "", thematicClusters: [], sources: [] }, sources, globalMode);
  }

  try {
    const text = await callLLM(providerDetails, `${SYSTEM_PROMPT}\n\nGlobal mode override: ${globalMode}.`, { globalMode, sources: batchPayload }, MAX_TOKENS);
    const parsed = parseStructuredResponse(text);
    return sanitizeReport(parsed, sources, globalMode);
  } catch {
    return sanitizeReport({ reportTitle: "Research Report", batchSummary: "", thematicClusters: [], sources: [] }, sources, globalMode);
  }
}

async function synthesizeMergedReport(batchReports, mergedSources, providerDetails) {
  const mergePayload = batchReports.map((report, index) => ({
    batch: index + 1,
    reportTitle: report.reportTitle,
    batchSummary: report.batchSummary,
    thematicClusters: report.thematicClusters,
    sources: report.sources.map((source) => ({
      id: source.id,
      title: source.title,
      mode: source.mode,
      summary: source.summary || source.messageInContext,
      keyTakeaways: source.keyTakeaways,
      researchRails: source.researchRails || [],
      entities: source.entities || [],
    })),
  }));

  try {
    const text = await callLLM(providerDetails, MERGE_PROMPT, mergePayload, 1800);
    const parsed = parseStructuredResponse(text);
    return {
      reportTitle: parsed.reportTitle || batchReports[0]?.reportTitle || "Research Report",
      batchSummary: parsed.batchSummary || batchReports.map((report) => report.batchSummary).filter(Boolean).join("\n\n"),
      thematicClusters: coerceLines(parsed.thematicClusters).length
        ? coerceLines(parsed.thematicClusters)
        : [...new Set(batchReports.flatMap((report) => report.thematicClusters || []))].slice(0, 8),
      reportType: "enriched",
      sources: mergedSources,
    };
  } catch {
    return {
      reportTitle: batchReports[0]?.reportTitle || "Research Report",
      batchSummary: batchReports.map((report) => report.batchSummary).filter(Boolean).join("\n\n"),
      thematicClusters: [...new Set(batchReports.flatMap((report) => report.thematicClusters || []))].slice(0, 8),
      reportType: "enriched",
      sources: mergedSources,
    };
  }
}

export async function enrichSources(sources, globalMode = "auto", providerConfig = null) {
  const providerDetails = getProviderConfig(providerConfig);
  if (!providerDetails.apiKey) {
    return {
      ...buildExtractOnlyReport(sources),
      provider: "none",
      providerSource: providerDetails.source,
    };
  }

  const shouldBatch = extractTextLength(sources) > TEXT_THRESHOLD;
  const report = !shouldBatch
    ? await enrichBatch(sources, globalMode, providerDetails)
    : await (async () => {
        const sourceBatches = chunk(sources, BATCH_SIZE);
        const batchReports = [];
        for (const batch of sourceBatches) {
          batchReports.push(await enrichBatch(batch, globalMode, providerDetails));
        }
        const mergedSources = batchReports.flatMap((item) => item.sources);
        return synthesizeMergedReport(batchReports, mergedSources, providerDetails);
      })();

  return {
    ...report,
    provider: providerDetails.provider,
    providerSource: providerDetails.source,
  };
}

export function resolveProviderSummary(providerConfig = null) {
  const details = getProviderConfig(providerConfig);
  return {
    provider: details.provider,
    model: details.model,
    source: details.source,
    hasKey: Boolean(details.apiKey),
  };
}





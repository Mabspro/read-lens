
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dedupeUrls } from "@/lib/source-utils";
import { renderMarkdownReport } from "@/lib/report-markdown";
import { DEFAULT_MODELS } from "@/lib/providers";

const MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "research", label: "Force Research" },
  { value: "quick_note", label: "Force Quick Note" },
];

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
  { value: "grok", label: "Grok (xAI)" },
];

const SOURCE_LABELS = {
  tweet: "Tweets",
  linkedin: "LinkedIn",
  web: "Web",
};

function StatusDot({ color, pulse = false }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        display: "inline-block",
        background: color,
        animation: pulse ? "pulse 1.2s ease-in-out infinite" : "none",
      }}
    />
  );
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function apiStatusTone({ effectiveHasKey, sessionKeyPresent, envProviderAvailable }) {
  if (sessionKeyPresent) {
    return {
      label: "Your key active",
      color: "#5eead4",
      bg: "rgba(20,184,166,0.12)",
      border: "rgba(20,184,166,0.22)",
    };
  }
  if (envProviderAvailable && effectiveHasKey) {
    return {
      label: "Server key active",
      color: "#5eead4",
      bg: "rgba(20,184,166,0.12)",
      border: "rgba(20,184,166,0.22)",
    };
  }
  return {
    label: "Free tier - extract only",
    color: "#cbd5e1",
    bg: "rgba(148,163,184,0.12)",
    border: "rgba(148,163,184,0.22)",
  };
}

function normalizeReport(payload) {
  return {
    reportType: payload.reportType || "enriched",
    reportTitle: payload.reportTitle || "Research Report",
    batchSummary: payload.batchSummary || "",
    thematicClusters: payload.thematicClusters || [],
    provider: payload.provider || "none",
    providerSource: payload.providerSource || "free",
    sources: (payload.sources || []).map((source) => ({
      ...source,
      mode: source.mode || (payload.reportType === "extract_only" ? "extract_only" : "research"),
      keyTakeaways: source.keyTakeaways || [],
      followUpQuestions: source.followUpQuestions || [],
      researchRails: source.researchRails || [],
      entities: source.entities || [],
      linkedResources: source.linkedResources || source.entities || [],
    })),
    failures: payload.failures || [],
  };
}

async function parseJson(response) {
  const text = await response.text();
  return parseJsonSafe(text) || { error: text || "Unknown response" };
}

function resolveRenderMode(source, overrideMode) {
  if (source.mode === "extract_only") return "extract_only";
  if (source.extractionQuality === "limited") return "limited";
  if (overrideMode === "research") return "research";
  if (overrideMode === "quick_note") return "quick_note";
  return source.mode === "quick_note" ? "quick_note" : "research";
}

function sourceTone(status) {
  if (status === "success" || status === "extracted") return "#5eead4";
  if (status === "limited") return "#fbbf24";
  if (status === "failed") return "#fca5a5";
  if (status === "loading") return "#7dd3fc";
  return "#5f6f87";
}

function tagStyle(kind) {
  if (kind === "research") {
    return {
      label: "RESEARCH",
      borderColor: "rgba(34, 211, 238, 0.35)",
      bg: "rgba(34, 211, 238, 0.11)",
      color: "#b8fbff",
      accent: "#22d3ee",
    };
  }
  if (kind === "quick_note") {
    return {
      label: "QUICK NOTE",
      borderColor: "rgba(245, 158, 11, 0.35)",
      bg: "rgba(245, 158, 11, 0.12)",
      color: "#fde7b2",
      accent: "#f59e0b",
    };
  }
  if (kind === "extract_only") {
    return {
      label: "EXTRACTED",
      borderColor: "rgba(20, 184, 166, 0.30)",
      bg: "rgba(20, 184, 166, 0.10)",
      color: "#c9f7ef",
      accent: "#14b8a6",
    };
  }
  return {
    label: "LIMITED",
    borderColor: "rgba(148, 163, 184, 0.32)",
    bg: "rgba(148, 163, 184, 0.10)",
    color: "#d5dce5",
    accent: "#94a3b8",
  };
}

function groupBySourceType(sources) {
  return sources.reduce((acc, source) => {
    const key = source.sourceType || "web";
    if (!acc[key]) acc[key] = [];
    acc[key].push(source);
    return acc;
  }, {});
}

function sourceTypeLabel(type) {
  return SOURCE_LABELS[type] || "Sources";
}

function buildReportCopy(report) {
  return renderMarkdownReport(
    report,
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date())
  );
}

function formatSeconds(ms) {
  return `${Math.max(0.1, ms / 1000).toFixed(ms > 10000 ? 1 : 2)}s`;
}

function estimateTokens(report) {
  if (!report?.sources?.length) return 0;
  const inputChars = report.sources.reduce((sum, source) => sum + (source.text || "").length, 0);
  const outputChars = JSON.stringify(report).length;
  return Math.round(inputChars / 4 + outputChars / 4);
}

function emitAnalytics(analyticsId, event, properties) {
  if (!analyticsId) return;
  const distinctId = `anon-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  void fetch("https://app.posthog.com/capture/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: analyticsId,
      event,
      distinct_id: distinctId,
      properties,
    }),
  }).catch(() => { });
}

function renderResourceList(items) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((item) => {
        const isUrl = /^https?:\/\//.test(item);
        return isUrl ? (
          <a key={item} href={item} target="_blank" rel="noreferrer" style={{ color: "#8bdcf7", wordBreak: "break-all" }}>
            {item}
          </a>
        ) : (
          <span key={item}>{item}</span>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ color: "#f59e0b", fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Section({ title, body }) {
  if (!body) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ color: "#d7dde7", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{body}</div>
    </div>
  );
}

function ListSection({ title, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <SectionLabel>{title}</SectionLabel>
      <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, lineHeight: 1.65 }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
function SettingsModal({
  open,
  onClose,
  provider,
  setProvider,
  sessionApiKey,
  setSessionApiKey,
  modelOverride,
  setModelOverride,
  connectionState,
  connectionMessage,
  onTestConnection,
  onClearKey,
  analyticsEnabled,
  setAnalyticsEnabled,
  analyticsAvailable,
}) {
  if (!open) return null;

  const statusColor = connectionState === "connected"
    ? "#5eead4"
    : connectionState === "invalid"
      ? "#fca5a5"
      : "#94a3b8";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.72)",
        backdropFilter: "blur(10px)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg, rgba(8,16,24,0.98), rgba(5,10,18,0.98))",
          boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
          padding: 24,
          display: "grid",
          gap: 18,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <strong style={{ color: "#f5f7fb", fontSize: 18 }}>Settings</strong>
            <span style={{ color: "#8b98aa", fontSize: 13 }}>
              Configure your AI provider for this session or stay in Extract Only mode. Session keys are kept only in your browser memory.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#8b98aa", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>Provider</span>
          <select className="settings-select"
            value={provider}
            onChange={(event) => {
              const next = event.target.value;
              setProvider(next);
              setModelOverride(DEFAULT_MODELS[next] || "");
            }}
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#f5f7fb",
              padding: "14px 16px",
            }}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#8b98aa", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>API key</span>
          <input
            type="password"
            value={sessionApiKey}
            onChange={(event) => setSessionApiKey(event.target.value)}
            placeholder="Paste a key for this browser session"
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#f5f7fb",
              padding: "14px 16px",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#8b98aa", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>Model override</span>
          <input
            value={modelOverride}
            onChange={(event) => setModelOverride(event.target.value)}
            placeholder={DEFAULT_MODELS[provider] || "Enter model id"}
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#f5f7fb",
              padding: "14px 16px",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={onTestConnection}
            disabled={!sessionApiKey || connectionState === "testing"}
            style={{
              borderRadius: 14,
              border: sessionApiKey ? "1px solid rgba(20,184,166,0.38)" : "1px solid rgba(20,184,166,0.15)",
              background: sessionApiKey ? "rgba(20,184,166,0.22)" : "rgba(20,184,166,0.08)",
              color: "#d8fffa",
              padding: "12px 16px",
              cursor: sessionApiKey ? "pointer" : "not-allowed",
              opacity: sessionApiKey ? 1 : 0.4,
            }}
          >
            {connectionState === "testing" ? "Testing..." : "Test connection"}
          </button>
          <button
            type="button"
            onClick={onClearKey}
            style={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              padding: "12px 16px",
              cursor: "pointer",
            }}
          >
            Clear key
          </button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#cbd5e1", fontSize: 13 }}>
            <StatusDot color={statusColor} pulse={connectionState === "testing"} />
            {connectionMessage}
          </span>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "14px 16px",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ color: "#f5f7fb", fontSize: 14 }}>Anonymous usage analytics</span>
            <span style={{ color: "#8b98aa", fontSize: 12 }}>
              Off by default. Tracks only batch size, source mix, provider, mode, success rates, duration, and copy events.
            </span>
          </div>
          <input type="checkbox" checked={analyticsEnabled} onChange={(event) => setAnalyticsEnabled(event.target.checked)} disabled={!analyticsAvailable} />
        </label>

        <div style={{ color: "#8b98aa", fontSize: 12, lineHeight: 1.7 }}>
          Your API key stays in browser memory for this session only. It is not written to disk. For enrichment, it is forwarded with this session&apos;s request so the selected provider can process your prompt.
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source, overrideMode }) {
  const renderMode = resolveRenderMode(source, overrideMode);
  const tone = tagStyle(renderMode);

  return (
    <article
      style={{
        borderRadius: 22,
        border: `1px solid ${tone.borderColor}`,
        borderLeft: `4px solid ${tone.accent}`,
        background: "rgba(5, 12, 21, 0.82)",
        padding: 22,
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                border: `1px solid ${tone.borderColor}`,
                background: tone.bg,
                color: tone.color,
              }}
            >
              {tone.label}
            </span>
            <strong style={{ color: "#f5f7fb", fontSize: 17 }}>{source.title || source.url}</strong>
          </div>
          <span style={{ color: "#8b98aa", fontSize: 12 }}>
            {source.sourceType} {source.hostname ? `- ${source.hostname}` : ""} {source.author ? `- ${source.author}` : ""} {source.confidence ? `- confidence: ${source.confidence}` : ""}
          </span>
        </div>
        <a href={source.url} target="_blank" rel="noreferrer" style={{ color: "#8bdcf7", fontSize: 13 }}>
          source
        </a>
      </div>

      {renderMode === "quick_note" && (
        <>
          <Section title="Core Message In Context" body={source.messageInContext || source.summary || source.preview || ""} />
          <Section title="Author Stance" body={String(source.authorStance || "neutral_sharing").replace(/_/g, " ")} />
          <ListSection title="Key Takeaways" items={source.keyTakeaways} />
          {source.whyThisMightMatter ? <Section title="Why This Might Matter" body={source.whyThisMightMatter} /> : null}
          {source.entities?.length || source.linkedResources?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <SectionLabel>Resources, Tools, People, Orgs</SectionLabel>
              {renderResourceList(source.entities?.length ? source.entities : source.linkedResources)}
            </div>
          ) : null}
        </>
      )}

      {renderMode === "research" && (
        <>
          <Section title="Summary" body={source.summary || source.preview || ""} />
          <ListSection title="Key Takeaways" items={source.keyTakeaways} />
          <Section title="Why This Matters" body={source.whyItMatters || ""} />
          <ListSection title="Follow-up Questions" items={source.followUpQuestions} />
          <ListSection title="Research Rails" items={source.researchRails} />
        </>
      )}

      {(renderMode === "extract_only" || renderMode === "limited") && (
        <>
          <Section title="Source Text" body={source.text || source.messageInContext || source.summary || source.preview || ""} />
          {source.linkedResources?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <SectionLabel>Linked Resources</SectionLabel>
              {renderResourceList(source.linkedResources)}
            </div>
          ) : null}
          {source.extractionNote ? <Section title="Extraction Note" body={source.extractionNote} /> : null}
        </>
      )}
    </article>
  );
}

function ExtractGroup({ title, sources, overrideMode }) {
  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div style={{ color: "#f5f7fb", fontSize: 18, fontWeight: 700 }}>{title}</div>
      {sources.map((source) => (
        <SourceCard key={source.id || source.url} source={source} overrideMode={overrideMode} />
      ))}
    </section>
  );
}
export default function ResearchApp({ envProviderAvailable, analyticsId, supportConfig }) {
  const [urlInput, setUrlInput] = useState("");
  const [mode, setMode] = useState("auto");
  const [phase, setPhase] = useState("idle");
  const [processingStage, setProcessingStage] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [report, setReport] = useState(null);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState([]);
  const [processingMs, setProcessingMs] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState("anthropic");
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [modelOverride, setModelOverride] = useState(DEFAULT_MODELS.anthropic);
  const [connectionState, setConnectionState] = useState("idle");
  const [connectionMessage, setConnectionMessage] = useState("Free tier - extract only");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const timersRef = useRef([]);

  const sessionKeyPresent = Boolean(sessionApiKey.trim());
  const effectiveHasKey = sessionKeyPresent || envProviderAvailable;
  const hasReport = Boolean(report);
  const apiTone = apiStatusTone({ effectiveHasKey, sessionKeyPresent, envProviderAvailable });
  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    [report]
  );

  const markdown = useMemo(() => (report ? buildReportCopy(report) : ""), [report]);
  const reportStats = useMemo(() => {
    if (!report) return null;
    const total = report.sources.length;
    const researchCount = report.sources.filter((source) => resolveRenderMode(source, mode) === "research").length;
    const quickNoteCount = report.sources.filter((source) => resolveRenderMode(source, mode) === "quick_note").length;
    const limitedCount = report.sources.filter((source) => source.extractionQuality === "limited").length;
    return {
      total,
      researchCount,
      quickNoteCount,
      limitedCount,
      tokens: estimateTokens(report),
      processingSeconds: formatSeconds(processingMs),
    };
  }, [mode, processingMs, report]);

  const groupedExtracted = useMemo(() => groupBySourceType(report?.sources || []), [report]);

  useEffect(() => {
    if (sessionKeyPresent) {
      setConnectionState("connected");
      setConnectionMessage(`Your key active (${provider})`);
      return;
    }
    if (envProviderAvailable) {
      setConnectionState("connected");
      setConnectionMessage("Using host server key");
      return;
    }
    setConnectionState("idle");
    setConnectionMessage("Standard tier - no key");
  }, [envProviderAvailable, provider, sessionKeyPresent]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  };

  const startProgressAnimation = (urls) => {
    clearTimers();
    setProcessingStage("extracting");
    setItems(urls.map((url, index) => ({ url, sourceType: "web", status: index === 0 ? "loading" : "pending", extractionNote: "" })));

    urls.forEach((url, index) => {
      const timer = setTimeout(() => {
        setItems((current) => current.map((item) => (item.url === url ? { ...item, status: "loading" } : item)));
      }, index * 180);
      timersRef.current.push(timer);
    });

    const enrichTimer = setTimeout(() => {
      setProcessingStage("enriching");
      setItems((current) => current.map((item) => ({ ...item, status: item.status === "failed" ? "failed" : "extracted" })));
    }, Math.min(1400, Math.max(700, urls.length * 180)));
    timersRef.current.push(enrichTimer);
  };

  const handleAnalyze = async () => {
    const urls = dedupeUrls(urlInput.split(/\r?\n/));
    if (!urls.length) {
      setErrorMsg("Add at least one valid http(s) URL.");
      return;
    }

    setErrorMsg("");
    setCopied(false);
    setPhase("working");
    setReport(null);
    setProcessingMs(0);
    const startedAt = performance.now();
    startProgressAnimation(urls);

    try {
      const providerConfig = sessionKeyPresent
        ? {
          provider,
          apiKey: sessionApiKey.trim(),
          model: modelOverride.trim() || DEFAULT_MODELS[provider] || "",
        }
        : null;

      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, mode, providerConfig }),
      });
      const payload = await parseJson(response);
      if (!response.ok) {
        throw new Error(payload.error || "Processing failed.");
      }

      const normalizedReport = normalizeReport(payload.report || {});
      setItems((payload.items || []).map((item) => ({
        ...item,
        status: item.status || "success",
        sourceType: item.sourceType || item.source?.sourceType || "web",
      })));
      setReport(normalizedReport);
      const elapsed = performance.now() - startedAt;
      setProcessingMs(elapsed);
      setPhase("done");
      setProcessingStage(normalizedReport.reportType === "extract_only" ? "extract_only" : "done");

      if (analyticsEnabled && analyticsId) {
        emitAnalytics(analyticsId, "read_lens_processed", {
          batch_size: urls.length,
          source_type_distribution: (payload.items || []).reduce((acc, item) => {
            const key = item.sourceType || "web";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {}),
          enrichment_mode: normalizedReport.reportType === "extract_only" ? "free" : mode,
          provider_selected: providerConfig?.provider || (envProviderAvailable ? "anthropic" : "none"),
          extraction_success_rate: (payload.items || []).filter((item) => item.status === "success" || item.status === "limited").length,
          processing_duration_ms: Math.round(elapsed),
        });
      }
    } catch (error) {
      setPhase("error");
      setProcessingStage("idle");
      setErrorMsg(error instanceof Error ? error.message : "Processing failed.");
    } finally {
      clearTimers();
    }
  };

  const handleClear = () => {
    clearTimers();
    setUrlInput("");
    setErrorMsg("");
    setReport(null);
    setItems([]);
    setPhase("idle");
    setProcessingStage("idle");
    setCopied(false);
    setProcessingMs(0);
  };

  const handleCopy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    if (analyticsEnabled && analyticsId) {
      emitAnalytics(analyticsId, "read_lens_copied_report", {
        enrichment_mode: report.reportType === "extract_only" ? "free" : mode,
        provider_selected: sessionKeyPresent ? provider : envProviderAvailable ? "anthropic" : "none",
      });
    }
  };

  const handleTestConnection = async () => {
    if (!sessionApiKey.trim()) {
      setConnectionState("idle");
      setConnectionMessage("Free tier - extract only");
      return;
    }

    setConnectionState("testing");
    setConnectionMessage("Testing connection...");

    try {
      const response = await fetch("/api/provider-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: sessionApiKey.trim(),
          model: modelOverride.trim() || DEFAULT_MODELS[provider] || "",
        }),
      });
      const payload = await parseJson(response);
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Connection failed.");
      }
      setConnectionState("connected");
      setConnectionMessage(`Your key active (${provider})`);
    } catch (error) {
      setConnectionState("invalid");
      setConnectionMessage(error instanceof Error ? error.message : "Invalid key");
    }
  };

  const handleClearKey = () => {
    setSessionApiKey("");
    setProvider("anthropic");
    setModelOverride(DEFAULT_MODELS.anthropic);
    setConnectionState(envProviderAvailable ? "connected" : "idle");
    setConnectionMessage(envProviderAvailable ? "Server key active" : "Free tier - extract only");
  };

  const statusHeading = processingStage === "extracting"
    ? "Extracting..."
    : processingStage === "enriching"
      ? "Enriching..."
      : phase === "done"
        ? "Completed"
        : "Progress";

  return (
    <>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        provider={provider}
        setProvider={setProvider}
        sessionApiKey={sessionApiKey}
        setSessionApiKey={setSessionApiKey}
        modelOverride={modelOverride}
        setModelOverride={setModelOverride}
        connectionState={connectionState}
        connectionMessage={connectionMessage}
        onTestConnection={handleTestConnection}
        onClearKey={handleClearKey}
        analyticsEnabled={analyticsEnabled}
        setAnalyticsEnabled={setAnalyticsEnabled}
        analyticsAvailable={Boolean(analyticsId)}
      />

      <main className="app-shell" style={{ minHeight: "100vh", display: "flex", justifyContent: hasReport ? "flex-start" : "center", alignItems: "stretch", padding: hasReport ? "0 0 0 20px" : "24px 20px" }}>
        <aside
          className="sidebar"
          style={{
            width: hasReport ? 380 : "min(840px, 100%)",
            maxWidth: hasReport ? 380 : 840,
            display: "flex",
            flexDirection: "column",
            minHeight: hasReport ? undefined : "min(80vh, 720px)",
          }}
        >
          {/* Header: logo left, status + gear right */}
          <header style={{ padding: "24px 28px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <div style={{ color: "#14b8a6", fontSize: 13, letterSpacing: "0.3em", textTransform: "uppercase", fontWeight: 800 }}>READ LENS</div>
              </div>
              <h1 style={{ margin: "2px 0 0 0", color: "#f5f7fb", fontSize: 24, fontWeight: 700 }}>Research helper</h1>
              <div style={{ color: "#8b98aa", fontSize: 13, marginTop: 4 }}>Fast extraction with optional BYOK analysis.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, border: `1px solid ${apiTone.border}`, background: apiTone.bg, color: "#d8fffa", padding: "8px 12px", fontSize: 12 }}>
                <StatusDot color={apiTone.color} pulse={connectionState === "testing"} />
                {apiTone.label}
              </div>
              <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" style={{ borderRadius: 999, width: 40, height: 40, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#cbd5e1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>⚙</button>
            </div>
          </header>

          {/* Full-width divider */}
          <hr style={{ margin: 0, border: "none", height: 1, background: "rgba(255,255,255,0.06)" }} />

          {/* Main content: one padded column */}
          <div style={{ flex: 1, padding: "28px 28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
            <section>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>URLS TO ANALYZE</label>
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste one URL per line"
                style={{ width: "100%", minHeight: 180, resize: "vertical", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "transparent", color: "#f5f7fb", padding: 14, lineHeight: 1.6, outline: "none", fontSize: 14 }}
              />
            </section>

            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              X links use the Twitter syndication endpoint. LinkedIn and other public URLs use Jina Reader.
            </p>

            {!effectiveHasKey ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                Free tier — add your API key in settings to enable AI analysis.
              </p>
            ) : (
              <section>
                <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>ENRICHMENT MODE</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {MODE_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setMode(opt.value)} style={{ borderRadius: 999, border: mode === opt.value ? "1px solid rgba(20,184,166,0.35)" : "1px solid rgba(255,255,255,0.08)", background: mode === opt.value ? "rgba(20,184,166,0.15)" : "rgba(255,255,255,0.03)", color: mode === opt.value ? "#d8fffa" : "#cbd5e1", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>{opt.label}</button>
                  ))}
                </div>
              </section>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={phase === "working"}
                style={{
                  flex: "1 1 200px",
                  borderRadius: 12,
                  border: "none",
                  background: phase === "working" ? "rgba(249,115,22,0.2)" : "linear-gradient(90deg, #f97316, #14b8a6)",
                  color: phase === "working" ? "#fdbba7" : "#fff",
                  padding: "14px 20px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: phase === "working" ? "not-allowed" : "pointer",
                  opacity: phase === "working" ? 0.7 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8
                }}>
                {phase === "working" && <StatusDot color="#fff" pulse />}
                {phase === "working" ? "Extracting..." : effectiveHasKey ? "Extract & Analyze" : "Extract Only"}
              </button>
              <button type="button" onClick={handleClear} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#d7dde7", padding: "14px 20px", fontSize: 14, cursor: "pointer" }}>Clear</button>
            </div>

            {errorMsg && <p style={{ margin: 0, color: "#fca5a5", fontSize: 13, lineHeight: 1.6 }}>{errorMsg}</p>}

            <section style={{ marginTop: 8 }}>
              <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>PROGRESS</div>
              {items.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Paste a batch of links to start a run.</p>
                  <button
                    type="button"
                    onClick={() => setUrlInput("https://paulgraham.com/greatwork.html\nhttps://en.wikipedia.org/wiki/Attention_Is_All_You_Need")}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#cbd5e1",
                      padding: "6px 12px",
                      fontSize: 12,
                      cursor: "pointer"
                    }}>
                    Load demo links
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {items.map((item) => {
                    const statusText = item.status === "loading" ? "Extracting..." : item.status === "pending" ? "Waiting..." : item.status === "extracted" ? "Extracted" : item.status;
                    return (
                      <div key={item.url} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <StatusDot color={sourceTone(item.status)} pulse={item.status === "loading"} />
                        <span style={{ color: item.status === "pending" ? "#7f8ba0" : "#d7dde7", fontSize: 13, wordBreak: "break-all" }}>{item.url}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{item.sourceType || "web"} — {statusText}</span>
                        {item.extractionNote && <span style={{ color: item.status === "failed" ? "#fca5a5" : "#fbbf24", fontSize: 12 }}>{item.extractionNote}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Footer: full-width divider + text */}
          <hr style={{ margin: 0, border: "none", height: 1, background: "rgba(255,255,255,0.06)" }} />
          <footer style={{ padding: "20px 28px 24px" }}>
            <a href={supportConfig?.studioUrl || "https://levrage-studio.vercel.app"} target="_blank" rel="noreferrer" style={{ color: "#f5f7fb", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>Built by LevrAge Innovation Studios</a>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Like this tool? Support the developer</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "#8b98aa" }}>
              {supportConfig?.tipUrl && <a href={supportConfig.tipUrl} target="_blank" rel="noreferrer">Buy me a coffee</a>}
              {supportConfig?.sponsorUrl && <a href={supportConfig.sponsorUrl} target="_blank" rel="noreferrer">GitHub Sponsor</a>}
              {supportConfig?.githubUrl && <a href={supportConfig.githubUrl} target="_blank" rel="noreferrer">Star on GitHub</a>}
            </div>
          </footer>
        </aside>

        {hasReport ? (
          <section style={{ flex: 1, padding: 28, display: "grid", gap: 18, alignContent: "start", animation: "slideIn 220ms ease-out" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "#8b98aa", fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase" }}>Report</div>
                <strong style={{ color: "#f5f7fb", fontSize: 20 }}>{report.reportTitle}</strong>
                <span style={{ color: "#8b98aa", fontSize: 13 }}>{`${report.sources.length} sources - ${generatedAt}`}</span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#f5f7fb",
                  padding: "12px 18px",
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied" : "Copy report"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(3, 10, 18, 0.78)",
                  padding: 24,
                  display: "grid",
                  gap: 18,
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <h2 style={{ margin: 0, color: "#f5f7fb", fontSize: 20 }}>{report.reportTitle}</h2>
                  <div style={{ color: "#8b98aa", fontSize: 13 }}>{generatedAt}</div>
                </div>
                <Section title="Batch Summary" body={report.batchSummary} />
                {report.thematicClusters?.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <SectionLabel>Themes</SectionLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {report.thematicClusters.map((theme) => (
                        <span
                          key={theme}
                          style={{
                            borderRadius: 999,
                            border: "1px solid rgba(20,184,166,0.26)",
                            background: "rgba(20,184,166,0.1)",
                            color: "#d8fffa",
                            padding: "8px 12px",
                            fontSize: 12,
                          }}
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {report.reportType === "extract_only"
                  ? Object.entries(groupedExtracted).map(([type, sources]) => (
                    <ExtractGroup key={type} title={sourceTypeLabel(type)} sources={sources} overrideMode={mode} />
                  ))
                  : report.sources.map((source) => (
                    <SourceCard key={source.id || source.url} source={source} overrideMode={mode} />
                  ))}

                <div
                  style={{
                    borderRadius: 20,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.025)",
                    padding: "18px 20px",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ color: "#cbd5e1", lineHeight: 1.7 }}>
                    Read Lens is free and built independently. If it saved you time, consider supporting the project.
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {supportConfig?.tipUrl ? (
                      <a
                        href={supportConfig.tipUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          borderRadius: 14,
                          background: "rgba(249,115,22,0.14)",
                          border: "1px solid rgba(249,115,22,0.24)",
                          color: "#ffe1cb",
                          padding: "12px 16px",
                          textDecoration: "none",
                        }}
                      >
                        Buy me a coffee
                      </a>
                    ) : null}
                    {supportConfig?.githubUrl ? (
                      <a
                        href={supportConfig.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          color: "#f5f7fb",
                          padding: "12px 16px",
                          textDecoration: "none",
                        }}
                      >
                        Star on GitHub
                      </a>
                    ) : null}
                    <a href={supportConfig?.studioUrl || "https://levrage-studio.vercel.app"} target="_blank" rel="noreferrer" style={{ alignSelf: "center", color: "#8bdcf7", textDecoration: "none" }}>
                      Need a custom tool built? → LevrAge Innovation Studios
                    </a>
                  </div>
                </div>

                {reportStats ? (
                  <details
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      paddingTop: 14,
                      color: "#8b98aa",
                      fontSize: 12,
                    }}
                  >
                    <summary style={{ cursor: "pointer", color: "#cbd5e1" }}>Details</summary>
                    <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", lineHeight: 1.7 }}>
                      <span>Sources processed: {reportStats.total}</span>
                      <span>Research memos: {reportStats.researchCount}</span>
                      <span>Quick notes: {reportStats.quickNoteCount}</span>
                      <span>Limited: {reportStats.limitedCount}</span>
                      <span>Estimated tokens used: {reportStats.tokens}</span>
                      <span>Processing time: {reportStats.processingSeconds}</span>
                    </div>
                  </details>
                ) : null}
              </div>

              <details
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.025)",
                  padding: "16px 18px",
                }}
              >
                <summary style={{ cursor: "pointer", color: "#cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Raw markdown export</span>
                  <button
                    onClick={(e) => { e.preventDefault(); handleCopy(); }}
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#cbd5e1",
                      cursor: "pointer"
                    }}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </summary>
                <pre style={{ margin: "16px 0 0", whiteSpace: "pre-wrap", lineHeight: 1.6, color: "#9fb0c6" }}>{markdown}</pre>
              </details>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}








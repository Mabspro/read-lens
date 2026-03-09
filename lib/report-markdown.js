export function renderMarkdownReport(report, generatedAt) {
  const lines = [
    `# ${report.reportTitle}`,
    `_${report.sources.length} sources analyzed - ${generatedAt}_`,
    "",
    "## Batch Summary",
    report.batchSummary || "",
    "",
  ];

  if (report.thematicClusters?.length) {
    lines.push("## Themes");
    lines.push(...report.thematicClusters.map((theme) => `- ${theme}`));
    lines.push("");
  }

  for (const source of report.sources) {
    lines.push(`## ${source.title || source.url}`);
    lines.push(`Source: ${source.url}`);
    if (source.author) lines.push(`Author: ${source.author}`);
    if (source.hostname) lines.push(`Type: ${source.sourceType} - ${source.hostname}`);
    if (source.mode) lines.push(`Mode: ${source.mode}`);
    if (source.extractionQuality === "limited") lines.push(`Extraction: limited - ${source.extractionNote}`);
    lines.push("");

    if (source.mode === "extract_only" || source.extractionQuality === "limited") {
      lines.push("### Source Text");
      lines.push(source.text || source.messageInContext || source.summary || source.preview || "");
      lines.push("");
      if (source.linkedResources?.length) {
        lines.push("### Linked Resources");
        lines.push(...source.linkedResources.map((item) => `- ${item}`));
        lines.push("");
      }
      continue;
    }

    if (source.mode === "quick_note") {
      lines.push("### Message In Context");
      lines.push(source.messageInContext || source.summary || "");
      lines.push("");
      lines.push("### Author Stance");
      lines.push(source.authorStance || "unknown");
      lines.push("");
      lines.push("### Key Takeaways");
      lines.push(...(source.keyTakeaways || []).map((item) => `- ${item}`));
      lines.push("");
      if (source.whyThisMightMatter) {
        lines.push("### Why This Might Matter");
        lines.push(source.whyThisMightMatter);
        lines.push("");
      }
      const entities = source.entities?.length ? source.entities : source.linkedResources || [];
      if (entities.length) {
        lines.push("### Resources and Entities");
        lines.push(...entities.map((item) => `- ${item}`));
        lines.push("");
      }
      continue;
    }

    lines.push("### Summary");
    lines.push(source.summary || "");
    lines.push("");
    lines.push("### Key Takeaways");
    lines.push(...(source.keyTakeaways || []).map((item) => `- ${item}`));
    lines.push("");
    lines.push("### Why It Matters");
    lines.push(source.whyItMatters || "");
    lines.push("");
    lines.push("### Follow-up Questions");
    lines.push(...(source.followUpQuestions || []).map((item) => `- ${item}`));
    lines.push("");
    lines.push("### Research Rails");
    lines.push(...(source.researchRails || []).map((item) => `- ${item}`));
    lines.push("");
  }

  return lines.join("\n");
}

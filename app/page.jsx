import ResearchApp from "@/components/research-app";

export default function Page() {
  return (
    <ResearchApp
      envProviderAvailable={Boolean(process.env.ANTHROPIC_API_KEY) && ["true", "1", "yes"].includes(String(process.env.ALLOW_HOST_ENRICHMENT || "").toLowerCase())}
      analyticsId={process.env.NEXT_PUBLIC_ANALYTICS_ID || ""}
      supportConfig={{
        studioUrl: "https://levrage-studio.vercel.app",
        tipUrl: process.env.NEXT_PUBLIC_SUPPORT_TIP_URL || "",
        githubUrl: process.env.NEXT_PUBLIC_GITHUB_REPO_URL || "",
        sponsorUrl: process.env.NEXT_PUBLIC_GITHUB_SPONSORS_URL || "",
      }}
    />
  );
}


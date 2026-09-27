import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/checkin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          userId?: string;
          type?: "morning" | "evening";
          text?: string;
        };
        const userId = (body.userId ?? "").trim();
        const type = body.type === "evening" ? "evening" : "morning";
        const text = (body.text ?? "").trim();
        if (!userId || !text) {
          return Response.json({ error: "userId and text are required" }, { status: 400 });
        }

        const { getMemWal, describeMemwalError } = await import("@/lib/memwal.server");
        const { analyzeAndLog } = await import("@/lib/memory-log.server");

        const memwal = getMemWal(userId);
        if (!memwal) {
          return Response.json(
            { error: "Walrus Memory is not configured (MEMWAL_PRIVATE_KEY / MEMWAL_ACCOUNT_ID)." },
            { status: 503 },
          );
        }

        const prefix = type === "morning" ? "Morning check-in" : "Evening review";
        const saved = await analyzeAndLog({
          memwal,
          userId,
          text: `${prefix} (${new Date().toDateString()}): ${text}`,
          source: type,
        });

        let insights = null;
        if (type === "evening") {
          try {
            const { generateInsights } = await import("@/lib/insights.server");
            insights = await generateInsights(userId);
          } catch (error) {
            console.error("insight refresh failed", error);
          }
        }

        return Response.json({
          memories: saved.memories,
          superseded: saved.superseded,
          insights,
          warning: saved.error ? describeMemwalError(saved.error) : null,
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/insights")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { userId?: string; windowDays?: number };
        const userId = (body.userId ?? "").trim();
        if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });

        try {
          const { generateInsights } = await import("@/lib/insights.server");
          const insights = await generateInsights(userId, body.windowDays ?? 14);
          return Response.json({ insights });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },
  },
});

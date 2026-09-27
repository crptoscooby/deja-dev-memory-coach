import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/memories")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = new URL(request.url).searchParams.get("userId");
        if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });

        const { getDb } = await import("@/lib/db.server");
        const db = await getDb();
        const [memories, insights, messages] = await Promise.all([
          db
            .from("memories")
            .select("id, text, source, status, blob_id, superseded_by, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(200),
          db
            .from("insights")
            .select("cards, summary, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from("chat_messages")
            .select("id, role, content, recalled, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(60),
        ]);

        if (memories.error) return Response.json({ error: memories.error.message }, { status: 500 });

        return Response.json({
          memories: memories.data ?? [],
          insights: insights.data ?? null,
          messages: messages.data ?? [],
        });
      },
    },
  },
});

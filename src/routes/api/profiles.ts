import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/profiles")({
  server: {
    handlers: {
      GET: async () => {
        const { getDb } = await import("@/lib/db.server");
        const db = await getDb();
        const { data, error } = await db
          .from("profiles")
          .select("id, name, handle, accent")
          .order("created_at", { ascending: true });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ profiles: data ?? [] });
      },
    },
  },
});

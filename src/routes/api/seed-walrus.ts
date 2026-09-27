import { createFileRoute } from "@tanstack/react-router";

/**
 * Pushes the backdated demo facts already in the app DB into Walrus Memory so
 * recall works for the seeded users. Idempotent-ish: only rows without a
 * blob_id are sent.
 */
export const Route = createFileRoute("/api/seed-walrus")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { userId?: string };
        const { getDb } = await import("@/lib/db.server");
        const { getMemWal, describeMemwalError, MEMWAL_TIMEOUT_MS, namespaceFor } = await import(
          "@/lib/memwal.server"
        );

        const db = await getDb();
        let query = db
          .from("memories")
          .select("id, user_id, text")
          .is("blob_id", null)
          .order("created_at", { ascending: true })
          .limit(60);
        if (body.userId) query = query.eq("user_id", body.userId);

        const { data: rows, error } = await query;
        if (error) return Response.json({ error: error.message }, { status: 500 });
        if (!rows || rows.length === 0) return Response.json({ synced: 0, pending: 0 });

        let synced = 0;
        let pending = 0;
        const errors: string[] = [];

        for (const row of rows as { id: string; user_id: string; text: string }[]) {
          const memwal = getMemWal(row.user_id);
          if (!memwal) {
            return Response.json({ error: "Walrus Memory is not configured." }, { status: 503 });
          }
          try {
            const result = await memwal.rememberAndWait(row.text, namespaceFor(row.user_id), {
              timeoutMs: MEMWAL_TIMEOUT_MS,
            });
            await db
              .from("memories")
              .update({ blob_id: result.blob_id, memory_id: result.id, status: "indexed" })
              .eq("id", row.id);
            synced += 1;
          } catch (syncError) {
            pending += 1;
            const message = describeMemwalError(syncError);
            if (!errors.includes(message)) errors.push(message);
            await db.from("memories").update({ status: "indexing" }).eq("id", row.id);
          }
        }

        return Response.json({ synced, pending, errors });
      },
    },
  },
});

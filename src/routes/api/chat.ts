import { createFileRoute } from "@tanstack/react-router";

/**
 * Streaming chat. Protocol: newline-delimited JSON events.
 *   {"t":"recalled","memories":[...]} | {"t":"delta","v":"..."} |
 *   {"t":"memories","memories":[...],"superseded":[...]} |
 *   {"t":"error","message":"..."} | {"t":"done"}
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { userId?: string; message?: string };
        const userId = (body.userId ?? "").trim();
        const message = (body.message ?? "").trim();
        if (!userId || !message) {
          return Response.json({ error: "userId and message are required" }, { status: 400 });
        }

        const { streamText } = await import("ai");
        const { withMemWal } = await import("@mysten-incubation/memwal/ai");
        const { getGroq, GROQ_MODEL, SYSTEM_PROMPT } = await import("@/lib/groq.server");
        const { getMemWal, memwalOptions, describeMemwalError, namespaceFor } = await import(
          "@/lib/memwal.server"
        );
        const { getDb } = await import("@/lib/db.server");
        const { recallForUser, analyzeAndLog } = await import("@/lib/memory-log.server");

        const groq = getGroq();
        if (!groq) {
          return Response.json(
            { error: "GROQ_API_KEY is not configured. Add it in project settings to enable chat." },
            { status: 503 },
          );
        }

        const db = await getDb();
        const memwal = getMemWal(userId);
        const options = memwalOptions(userId);

        const [{ data: profile }, { data: history }] = await Promise.all([
          db.from("profiles").select("name").eq("id", userId).maybeSingle(),
          db
            .from("chat_messages")
            .select("role, content")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(16),
        ]);

        await db.from("chat_messages").insert({ user_id: userId, role: "user", content: message });

        const priorMessages = (history ?? [])
          .reverse()
          .map((row: { role: string; content: string }) => ({
            role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: row.content,
          }));

        // Recalled memories power both the prompt context and the UI chips.
        let recalled: { text: string; blobId: string; distance: number }[] = [];
        let recallError: string | null = null;
        if (memwal) {
          try {
            recalled = await recallForUser(memwal, userId, message, 5);
          } catch (error) {
            recallError = describeMemwalError(error);
          }
        }

        // Fallback so the bot still feels longitudinal before/if the relayer is down.
        if (recalled.length === 0) {
          const { data: fallback } = await db
            .from("memories")
            .select("text, created_at")
            .eq("user_id", userId)
            .is("superseded_by", null)
            .order("created_at", { ascending: false })
            .limit(8);
          recalled = (fallback ?? []).map((row: { text: string }) => ({
            text: row.text,
            blobId: "",
            distance: 0.5,
          }));
        }

        const memoryContext = recalled.map((memory) => `- ${memory.text}`).join("\n");
        const system = `${SYSTEM_PROMPT}

The developer you are talking to is ${profile?.name ?? "this developer"}.
Today is ${new Date().toDateString()}.

MEMORY CONTEXT (facts you already know, recalled from Walrus memory):
${memoryContext || "(no memories yet — this is your first conversation)"}`;

        // withMemWal keeps the model wired to Walrus memory recall. autoSave is off
        // because this app saves facts explicitly, so every write is timestamped in
        // the timeline instead of happening invisibly.
        const model = options
          ? withMemWal(groq(GROQ_MODEL), {
              ...options,
              namespace: namespaceFor(userId),
              maxMemories: 5,
              autoSave: false,
              minRelevance: 0.3,
            })
          : groq(GROQ_MODEL);

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: unknown) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            let assistantText = "";
            try {
              send({ t: "recalled", memories: recalled });
              if (recallError) send({ t: "warn", message: recallError });

              const result = streamText({
                model,
                system,
                messages: [...priorMessages, { role: "user" as const, content: message }],
              });

              for await (const delta of result.textStream) {
                assistantText += delta;
                send({ t: "delta", v: delta });
              }

              await db.from("chat_messages").insert({
                user_id: userId,
                role: "assistant",
                content: assistantText,
                recalled: recalled.map((memory) => memory.text),
              });

              // Distil the turn into discrete facts and grow the timeline live.
              if (memwal && message.length > 25) {
                send({ t: "saving" });
                const saved = await analyzeAndLog({
                  memwal,
                  userId,
                  text: `Developer said: ${message}`,
                  source: "chat",
                });
                send({ t: "memories", memories: saved.memories, superseded: saved.superseded });
                if (saved.error) send({ t: "warn", message: describeMemwalError(saved.error) });
              }
              send({ t: "done" });
            } catch (error) {
              console.error("chat failed", error);
              send({ t: "error", message: describeMemwalError(error) });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});

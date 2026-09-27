import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/deja/ChatPanel";
import { InsightsPanel } from "@/components/deja/InsightsPanel";
import { MemoryTimeline } from "@/components/deja/MemoryTimeline";
import { SetupChecklist } from "@/components/deja/SetupChecklist";
import { TopBar } from "@/components/deja/TopBar";
import type { ChatMessage, HealthState, Insights, Memory, Profile } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Déjà Dev — the accountability coach that remembers" },
      {
        name: "description",
        content:
          "A solo-developer accountability chatbot with persistent Walrus memory: morning check-ins, evening reviews, and longitudinal pattern detection across days.",
      },
      { property: "og:title", content: "Déjà Dev — Yesterday remembers what you shipped" },
      {
        property: "og:description",
        content:
          "Check in every morning and evening. Déjà Dev remembers your project, blockers, mood and velocity — and surfaces the patterns.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string>("user-alex");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/profiles")
      .then((response) => response.json())
      .then((data: { profiles?: Profile[] }) => {
        if (data.profiles?.length) {
          setProfiles(data.profiles);
          setUserId((current) => current || data.profiles![0]!.id);
        }
      })
      .catch(() => undefined);
    void fetch("/api/health")
      .then((response) => response.json())
      .then((data: HealthState) => setHealth(data))
      .catch(() => undefined);
  }, []);

  const loadUser = useCallback(async (id: string) => {
    const response = await fetch(`/api/memories?userId=${encodeURIComponent(id)}`);
    const data = (await response.json()) as {
      memories?: Memory[];
      insights?: { cards: Insights["cards"]; summary: string | null; created_at: string } | null;
      messages?: { id: string; role: string; content: string; recalled: string[] }[];
    };
    setMemories(data.memories ?? []);
    setInsights(data.insights ?? null);
    setMessages(
      (data.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
        recalled: Array.isArray(message.recalled) ? message.recalled : [],
      })),
    );
  }, []);

  useEffect(() => {
    if (!userId) return;
    void loadUser(userId);
  }, [userId, loadUser]);

  const activeProfile = profiles.find((profile) => profile.id === userId);

  const streamChat = useCallback(
    async (text: string) => {
      const userMessageId = `local-user-${Date.now()}`;
      const assistantId = `local-assistant-${Date.now()}`;
      setMessages((current) => [
        ...current,
        { id: userMessageId, role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", recalled: [] },
      ]);
      setStreaming(true);
      setNotice(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, message: text }),
        });

        if (!response.ok || !response.body) {
          const error = (await response.json().catch(() => ({}))) as { error?: string };
          setNotice(error.error ?? "Chat failed.");
          setStreaming(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event["t"] === "recalled") {
              const recalled = (event["memories"] as { text: string }[]).map((item) => item.text);
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, recalled } : message,
                ),
              );
            } else if (event["t"] === "delta") {
              const delta = String(event["v"] ?? "");
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + delta }
                    : message,
                ),
              );
            } else if (event["t"] === "saving") {
              setSavingMemory(true);
            } else if (event["t"] === "memories") {
              setSavingMemory(false);
              void loadUser(userId);
            } else if (event["t"] === "warn" || event["t"] === "error") {
              setNotice(String(event["message"] ?? ""));
            }
          }
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chat failed.");
      } finally {
        setSavingMemory(false);
        setStreaming(false);
      }
    },
    [userId, loadUser],
  );

  const submitCheckin = useCallback(
    async (type: "morning" | "evening", text: string) => {
      setMessages((current) => [
        ...current,
        { id: `local-checkin-${Date.now()}`, role: "user", content: `[${type} check-in] ${text}` },
      ]);
      setSavingMemory(true);
      setNotice(null);
      try {
        const response = await fetch("/api/checkin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, type, text }),
        });
        const data = (await response.json()) as {
          error?: string;
          warning?: string | null;
          insights?: Insights | null;
        };
        if (data.error) setNotice(data.error);
        else if (data.warning) setNotice(data.warning);
        if (data.insights) setInsights(data.insights);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Check-in failed.");
      } finally {
        setSavingMemory(false);
        await loadUser(userId);
        await streamChat(
          `${type === "morning" ? "Morning check-in" : "Evening review"}: ${text}`,
        );
      }
    },
    [userId, loadUser, streamChat],
  );

  const analyzeWeek = useCallback(async () => {
    setAnalyzing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await response.json()) as { insights?: Insights; error?: string };
      if (data.error) setNotice(data.error);
      if (data.insights) setInsights(data.insights);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }, [userId]);

  const jumpToMemory = useCallback(
    (text: string) => {
      const match = memories.find((memory) => memory.text === text);
      if (!match) return;
      setHighlightId(match.id);
      document
        .getElementById(`memory-${match.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => setHighlightId(null), 2500);
    },
    [memories],
  );

  const blockingSetup =
    health &&
    (health.missing.includes("GROQ_API_KEY") ||
      health.missing.includes("MEMWAL_PRIVATE_KEY") ||
      health.missing.includes("MEMWAL_ACCOUNT_ID"));

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <TopBar
        profiles={profiles}
        activeUserId={userId}
        onSwitch={setUserId}
        onAnalyze={() => void analyzeWeek()}
        analyzing={analyzing}
        health={health}
      />

      {blockingSetup ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SetupChecklist health={health} />
          <div className="mx-auto max-w-xl px-6 pb-8 text-xs text-muted-foreground">
            The timeline below still shows the seeded demo memories for each developer.
          </div>
          <div className="mx-auto max-w-xl px-6 pb-10">
            <MemoryTimeline memories={memories} highlightId={highlightId} />
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section className="min-h-0 border-hairline lg:border-r">
            {notice ? (
              <p className="border-b border-warn/30 bg-warn/5 px-4 py-2 font-mono text-[11px] text-warn sm:px-6">
                {notice}
              </p>
            ) : null}
            <ChatPanel
              userName={activeProfile?.name ?? "dev"}
              messages={messages}
              streaming={streaming}
              savingMemory={savingMemory}
              onSend={(text) => void streamChat(text)}
              onCheckin={(type, text) => void submitCheckin(type, text)}
              onRecallClick={jumpToMemory}
            />
          </section>

          <aside className="min-h-0 space-y-6 overflow-y-auto bg-background px-4 py-5 sm:px-5">
            <InsightsPanel insights={insights} analyzing={analyzing} />
            <MemoryTimeline memories={memories} highlightId={highlightId} />
          </aside>
        </div>
      )}
    </main>
  );
}

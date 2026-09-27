import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { getMemWal, secretStatus, missingSecrets, relayerUrl, describeMemwalError } =
          await import("@/lib/memwal.server");

        const secrets = secretStatus();
        const missing = missingSecrets();
        const memwal = getMemWal();
        if (!memwal) {
          return Response.json({
            status: "unconfigured",
            relayer: relayerUrl(),
            secrets,
            missing,
            error: null,
          });
        }

        try {
          const health = await memwal.health();
          return Response.json({
            status: health.status ?? "ok",
            version: health.version ?? null,
            writeReady: health.write_ready ?? null,
            relayer: relayerUrl(),
            secrets,
            missing,
            error: null,
          });
        } catch (error) {
          return Response.json({
            status: "down",
            relayer: relayerUrl(),
            secrets,
            missing,
            error: describeMemwalError(error),
          });
        }
      },
    },
  },
});

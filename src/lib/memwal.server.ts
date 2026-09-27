import { MemWal } from "@mysten-incubation/memwal";

export const DEFAULT_RELAYER_URL = "https://relayer-staging.memory.walrus.xyz";
export const MEMWAL_TIMEOUT_MS = 25000;

export type SecretStatus = {
  MEMWAL_PRIVATE_KEY: boolean;
  MEMWAL_ACCOUNT_ID: boolean;
  MEMWAL_SERVER_URL: boolean;
  GROQ_API_KEY: boolean;
};

export function secretStatus(): SecretStatus {
  return {
    MEMWAL_PRIVATE_KEY: Boolean(process.env["MEMWAL_PRIVATE_KEY"]),
    MEMWAL_ACCOUNT_ID: Boolean(process.env["MEMWAL_ACCOUNT_ID"]),
    // Optional: falls back to the staging relayer.
    MEMWAL_SERVER_URL: true,
    GROQ_API_KEY: Boolean(process.env["GROQ_API_KEY"]),
  };
}

export function missingSecrets(): string[] {
  const status = secretStatus();
  return Object.entries(status)
    .filter(([, present]) => !present)
    .map(([name]) => name);
}

export function namespaceFor(userId: string): string {
  return `dejadev:${userId}`;
}

export function relayerUrl(): string {
  return process.env["MEMWAL_SERVER_URL"] ?? DEFAULT_RELAYER_URL;
}

/** Shared MemWal options for both the raw client and the AI SDK middleware. */
export function memwalOptions(userId?: string) {
  const key = process.env["MEMWAL_PRIVATE_KEY"];
  const accountId = process.env["MEMWAL_ACCOUNT_ID"];
  if (!key || !accountId) return null;
  return {
    key,
    accountId,
    serverUrl: relayerUrl(),
    namespace: userId ? namespaceFor(userId) : "dejadev",
  };
}

/** Returns null when the operator secrets are not configured yet. */
export function getMemWal(userId?: string): MemWal | null {
  const options = memwalOptions(userId);
  if (!options) return null;
  return MemWal.create(options);
}

export function describeMemwalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
    return "Walrus Memory rejected the delegate key (401). Check that MEMWAL_PRIVATE_KEY is registered on MEMWAL_ACCOUNT_ID and that both belong to the same (staging) environment.";
  }
  return message;
}

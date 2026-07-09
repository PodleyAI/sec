/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registers the AI providers the SEC extractors can run against, so a model's
 * `provider` discriminator resolves to something executable:
 *
 * - **Anthropic** (`provider: "ANTHROPIC"`) — inline; the cloud path used by the
 *   default `claude-sonnet-5` model. Cheap to register (the SDK loads lazily on
 *   first call) and needs `ANTHROPIC_API_KEY` at run time.
 *
 * The provider is registered defensively: a failure to load it (missing optional
 * dependency) is logged and skipped so it never aborts the CLI. Registration is
 * idempotent enough for repeat bootstraps — the provider registry keeps the last
 * registrant.
 */
export async function registerSecProviders(): Promise<void> {
  await registerAnthropic();
}

async function registerAnthropic(): Promise<void> {
  try {
    const { registerAnthropicInline } = await import("@workglow/anthropic/ai-runtime");
    await registerAnthropicInline();
  } catch (err) {
    warn("Anthropic", err);
  }
}

function warn(provider: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`AI provider "${provider}" not registered: ${msg}`);
}

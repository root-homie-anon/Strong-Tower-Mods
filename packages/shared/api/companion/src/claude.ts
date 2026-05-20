import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-6';

// Mock-mode check is deferred to first use rather than evaluated at
// module load so test setup (which sets ANTHROPIC_MOCK in beforeAll,
// after imports have already run) takes effect. The production-guard
// for the live-prod-with-mock combination fires from the same
// accessor for the same reason. The cached singleton + mode pair is
// invalidated when ANTHROPIC_MOCK flips so a single test that toggles
// the env between cases gets the right client both times.

function isMockMode(): boolean {
  return process.env['ANTHROPIC_MOCK'] === 'true';
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Validate Anthropic-related configuration at process startup.
 * Returns true if the process is allowed to continue, false if it
 * should exit non-zero. The caller (server.ts) handles the exit so
 * tests that import claude.ts directly are not killed mid-suite.
 *
 * Two invalid configs:
 *   1. ANTHROPIC_MOCK=true + NODE_ENV=production — never allowed.
 *   2. ANTHROPIC_MOCK unset + ANTHROPIC_API_KEY unset — nothing to call.
 */
export function validateAnthropicConfig(): boolean {
  if (isMockMode()) {
    if (isProduction()) {
      console.error('FATAL: ANTHROPIC_MOCK=true is forbidden when NODE_ENV=production. Exiting.');
      return false;
    }
    return true;
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('FATAL: ANTHROPIC_API_KEY is not set and ANTHROPIC_MOCK is not "true". Exiting.');
    return false;
  }
  return true;
}

function buildMockClient(): Anthropic {
  const mockClient = new Anthropic({ apiKey: 'mock-key-not-used' });

  // Cast through unknown so the mock shape stays stable against new SDK fields being added
  // to the Message interface. The call site only reads: content, usage.input_tokens,
  // usage.output_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens.
  const mockMessage = {
    id: 'mock-msg-001',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '[sentiment: warm]\nI see you out there. Stay sharp — the Commonwealth doesn\'t forgive inattention, and neither do I.',
        citations: null,
      },
    ],
    model: MODEL,
    stop_reason: 'end_turn',
    stop_sequence: null,
    container: null,
    stop_details: null,
    usage: {
      input_tokens: 512,
      output_tokens: 32,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message;

  // Override messages.create to return the mock response without hitting the Anthropic API.
  (mockClient.messages as unknown as Record<string, unknown>)['create'] = async (
    _params: Anthropic.MessageCreateParams
  ): Promise<Anthropic.Message> => mockMessage;

  return mockClient;
}

let _client: Anthropic | null = null;
let _clientMode: 'mock' | 'real' | null = null;

function getAnthropic(): Anthropic {
  const currentMode: 'mock' | 'real' = isMockMode() ? 'mock' : 'real';
  if (_client && _clientMode === currentMode) return _client;

  if (currentMode === 'mock' && isProduction()) {
    throw new Error('ANTHROPIC_MOCK=true is forbidden when NODE_ENV=production');
  }
  if (currentMode === 'real' && !process.env['ANTHROPIC_API_KEY']) {
    throw new Error('ANTHROPIC_API_KEY is not set and ANTHROPIC_MOCK is not "true"');
  }

  _client = currentMode === 'mock' ? buildMockClient() : new Anthropic();
  _clientMode = currentMode;
  return _client;
}

/**
 * Lazy proxy that resolves the real or mock client on the first
 * property access. Existing call sites use ``anthropic.messages.create(...)``
 * directly, so a proxy that delegates property reads keeps them working
 * without a refactor while moving the mode check to runtime.
 */
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    return Reflect.get(getAnthropic(), prop, receiver);
  },
}) as Anthropic;

/** Test helper — reset the cached client so a test can toggle ANTHROPIC_MOCK after import time. */
export function _resetAnthropicClientForTests(): void {
  _client = null;
  _clientMode = null;
}

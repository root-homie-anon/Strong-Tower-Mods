import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-6';

const MOCK_MODE = process.env['ANTHROPIC_MOCK'] === 'true';

if (MOCK_MODE && process.env['NODE_ENV'] === 'production') {
  console.error('FATAL: ANTHROPIC_MOCK=true is forbidden when NODE_ENV=production. Exiting.');
  process.exit(1);
}

if (!MOCK_MODE) {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('FATAL: ANTHROPIC_API_KEY is not set and ANTHROPIC_MOCK is not "true". Exiting.');
    process.exit(1);
  }
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

export const anthropic: Anthropic = MOCK_MODE ? buildMockClient() : new Anthropic();

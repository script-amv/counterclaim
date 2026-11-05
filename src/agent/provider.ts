import { z } from 'zod';
export interface ToolCall { id: string; name: string; arguments: string }
export interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string }
export interface ToolDefinition { type: 'function'; function: { name: string; description: string; parameters: object } }
export type FailureCode = 'budget' | 'turns' | 'transport' | 'provider_refused' | 'invalid_response' | 'invalid_output';
export class ModelError extends Error { constructor(readonly code: FailureCode, readonly httpStatus?: number, readonly refusalKind?: 'rate_limit' | 'allowance' | 'other') { super(({ budget: 'Run budget exhausted', turns: 'Turn limit exhausted', transport: 'Model transport failed', provider_refused: 'Model provider refused request', invalid_response: 'Invalid model response', invalid_output: 'Invalid case file after repair' })[code]); } }
export interface ModelReply { provider?: string; content?: string | null; toolCalls?: ToolCall[]; usage?: { total_tokens: number; cost?: number } }
export interface ModelProvider { model: string; complete(messages: Message[], tools: ToolDefinition[], maxTokens: number): Promise<ModelReply> }
const replySchema = z.object({
  provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).optional() }) })).min(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative(), cost: z.number().nonnegative().optional() }).optional(),
});
export class OpenRouterProvider implements ModelProvider {
  readonly model: string;
  private readonly fetcher: typeof fetch;
  constructor(private options: { apiKey: string; model?: string; fetch?: typeof fetch; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; onHttpError?: (status: number, kind: string) => void }) {
    if (!options.apiKey) throw new Error('Model provider is not configured');
    this.model = options.model?.trim() || process.env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4-flash';
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async complete(messages: Message[], tools: ToolDefinition[], maxTokens: number): Promise<ModelReply> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 120000),
          headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, messages, tools, max_tokens: maxTokens, temperature: 0, ...(this.model.startsWith('@preset/') ? {} : { provider: { require_parameters: true } }) }),
        });
      } catch { throw new ModelError('transport'); }
      if (!response.ok) {
        // Inspect bounded error data only to classify limits; never retain or expose provider text.
        let allowance = response.status === 402;
        if (response.status === 429) {
          try { allowance ||= /(?:daily|monthly|quota|allowance|credits?|balance|billing|per.day|per.month)/i.test(await boundedText(response.clone())); } catch { /* Unknown 429 remains a bounded rate-limit failure. */ }
        }
        const kind = allowance ? 'allowance' : response.status === 429 ? 'rate_limit' : 'other';
        this.options.onHttpError?.(response.status, kind);
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter === null ? 15000 * (attempt + 1) : /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        const wait = Number.isFinite(delay) ? Math.max(2000, delay) : 2000;
        try { await response.body?.cancel(); } catch { /* Never expose disposal errors. */ }
        if (!allowance && (response.status === 429 || response.status >= 500) && attempt === 0 && wait <= 30000) {
          await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(wait);
          continue;
        }
        throw new ModelError('provider_refused', response.status, kind);
      }
      let parsed: z.infer<typeof replySchema>;
      try { parsed = replySchema.parse(await boundedJson(response)); } catch { throw new ModelError('invalid_response'); }
      const message = parsed.choices[0]!.message;
      return { provider: parsed.provider, content: message.content, toolCalls: message.tool_calls?.map(t => ({ id: t.id, ...t.function })), usage: parsed.usage };
    }
    throw new Error('Model request failed');
  }
}

async function boundedJson(response: Response): Promise<unknown> { return JSON.parse(await boundedText(response)); }

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty model response');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Model response too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

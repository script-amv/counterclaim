import { PendingSubmissionError } from '../cases/storage';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ApiError } from './service';
import type { ApiErrorResponse } from './contract';

export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function requireOperator(request: Request) {
  const code = process.env.OPERATOR_CODE;
  if (!code) throw new ApiError(503, 'Operator access is not configured');
  const expected = createHash('sha256').update(`Bearer ${code}`).digest();
  const actual = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
  if (!timingSafeEqual(expected, actual)) throw new ApiError(401, 'Operator authorization is required');
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON content type required');
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(400, 'JSON body required');
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.length;
    if (bytes > 128 * 1024) { await reader.cancel(); throw new ApiError(413, 'Request too large'); }
    chunks.push(value);
  }
  try { return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new ApiError(400, 'Invalid request body'); }
}
export function ipHash(request: Request) {
  // Single trusted reverse proxy must append/overwrite this header. Use its nearest address.
  const candidate = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  const ip = isIP(candidate) ? candidate : 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}
export async function handle(work: () => Promise<Response> | Response, state?: () => unknown) {
  try { return await work(); } catch (error) {
    const e = error instanceof PendingSubmissionError ? new ApiError(409, 'Submission is pending') : error;
    const response: ApiErrorResponse = { error: e instanceof ApiError ? e.message : 'Request could not be completed' };
    if (e instanceof ApiError && e.status === 409 && state) { try { response.case = state() as ApiErrorResponse['case']; } catch { /* No state available. */ } }
    return json(response, e instanceof ApiError ? e.status : 500);
  }
}

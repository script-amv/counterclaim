import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { CaseStore } from '../src/cases/storage';
import { ApiError, CaseService, type ActionClient } from '../src/api/service';
import { buildEvidenceForm, PayPalClient, SANDBOX_BASE_URL } from '../src/paypal/client';
import { safePayPalError } from '../src/paypal/errors';
import { contentHash } from '../src/guard/submission';

// Keep values out of diagnostics, including filenames, notes, tracking and document bytes.
function shape(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map(v => shape(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, k)]));
  if (key === 'evidence_type' && typeof value === 'string' && /^[A-Z_]{1,100}$/.test(value)) return value;
  return typeof value === 'string' ? { redacted: true, characters: value.length, bytes: Buffer.byteLength(value) } : { redacted: true, type: typeof value };
}
export async function diagnoseSubmit(store: CaseStore, id: string, approvalId: string, dryRun: boolean, client?: ActionClient, print: (value: unknown) => void = console.log, savePdf?: string) {
  if (savePdf !== undefined && (!dryRun || !savePdf.trim())) throw new Error('--save-pdf requires --dry-run and a nonempty path');
  const approval = store.approvals(id).find(a => a.id === approvalId);
  if (!approval || approval.disputeId !== id || approval.contentHash !== contentHash(approval.content)) throw new Error('Missing or invalid approval');
  const evidence = approval.content.evidence;
  if (approval.content.action !== 'provide-evidence' || !evidence) throw new Error('Approval must contain provide-evidence');
  const file = new File([Buffer.from(evidence.pdfBase64, 'base64')], evidence.filename, { type: 'application/pdf' });
  const form = buildEvidenceForm(evidence.input, file);
  print({ method: 'POST', host: SANDBOX_BASE_URL, path: '/v1/customer/disputes/[redacted]/provide-evidence',
    contentType: 'multipart/form-data; boundary=[generated]',
    parts: [...form.entries()].map(([name, part]) => ({ name, ...(typeof part === 'string' ? { bytes: Buffer.byteLength(part) } : { type: part.type, bytes: part.size, filename: '[redacted]' }) })),
    input: shape(evidence.input), frozenApproval: true });
  if (dryRun) {
    // Copy the actual multipart file, never regenerate from a newer case version.
    // Refuse to overwrite an existing file; diagnostics still contain no path or bytes.
    if (savePdf !== undefined) await writeFile(savePdf, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    return;
  }
  if (!client) throw new Error('Sandbox client required');
  // Use the app's guards, reservation, exact approved payload, no write retries and reconciliation.
  const attempt = await new CaseService(store, client).submit(id, approvalId);
  print({ status: attempt.status, paypalError: attempt.paypalError });
  if (attempt.status === 'unknown') print({ guidance: 'Outcome uncertain. Sending is locked; inspect PayPal before any retry.' });
  return attempt;
}
const usage = 'Usage: node scripts/run-ts.mjs scripts/diagnose-submit.ts <dispute-id> <approval-id> [--dry-run [--save-pdf <path>]]';
class UsageError extends Error { constructor() { super(usage); } }
async function main() {
  const args = process.argv.slice(2); let dryRun = false; let savePdf: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dry-run' && !dryRun) dryRun = true;
    else if (arg === '--save-pdf' && savePdf === undefined) {
      const path = args[++i];
      if (!path?.trim() || path.startsWith('--')) throw new UsageError();
      savePdf = path;
    } else if (arg.startsWith('--')) throw new UsageError();
    else positional.push(arg);
  }
  if (positional.length !== 2 || (savePdf !== undefined && !dryRun)) throw new UsageError();
  const store = new CaseStore();
  try {
    const client = dryRun ? undefined : new PayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID ?? '', clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
      fetch: async (url, init) => {
        const response = await globalThis.fetch(url, init);
        if (init?.method === 'POST' && String(url).endsWith('/provide-evidence')) console.log({ httpStatus: response.status });
        return response;
      },
    });
    const result = await diagnoseSubmit(store, positional[0]!, positional[1]!, dryRun, client, console.log, savePdf);
    if (result && result.status !== 'submitted') process.exitCode = 1;
  } finally { store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { const safe = safePayPalError(error); if (safe) console.error({ paypalError: safe }); if (error instanceof UsageError) console.error(usage); if (error instanceof ApiError) console.error({ guard: error.message }); console.error('Diagnostic stopped. Check the IDs, approval, current action, pending attempts, database path, export destination and sandbox credentials. No automatic retry was made.'); process.exitCode = 1; });
}

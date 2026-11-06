"use client";
import { OutboundPreview } from './outbound-preview';
import { submissionFailureReason } from '../paypal/error-details';
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  CaseDetailResponse,
  CaseFile,
  CaseFileVersionResponse,
  ReadSource,
} from "@/api/contract";
import { useOperator } from "./shell";
import { date, money, reason, sourceName, words, sentence, paypalStatus, fieldValue, fieldLabel } from "./format";
const actions = {
  fight: "provide-evidence",
  offer: "make-offer",
  refund: "accept-claim",
} as const;
const actionNames = {
  "provide-evidence": "Provide evidence",
  "make-offer": "Make an offer",
  "accept-claim": "Accept claim",
};
export function CaseWorkspace({
  id,
  review = false,
}: {
  id: string;
  review?: boolean;
}) {
  const [data, setData] = useState<CaseDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [editorVersionId, setEditorVersionId] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [clientUnknown, setClientUnknown] = useState(false);
  const { execute } = useOperator();
  async function load() {
    try {
      const r = await fetch(`/api/cases/${encodeURIComponent(id)}`);
      const body = await r.json();
      if (!r.ok) throw Error(body.error ?? "The case could not be opened.");
      if (!dirty) setEditorVersionId(null);
      setData(body);
      setStale(false);
      if (body.attempts.length) setClientUnknown(false);
      setError("");
      return true;
    } catch (e) {
      setStale(true);
      setError((e as Error).message);
      return false;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cases/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error ?? "The case could not be opened.");
        setData(body);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  const running = data?.runs.at(-1)?.status === "running";
  const sending = data?.attempts.at(-1)?.status === "submitting";
  useEffect(() => {
    if (!running && !sending) return;
    const timer = setInterval(() => {
      void load();
    }, 2500);
    return () => clearInterval(timer);
  });
  function mutate(path: string, body: unknown, method = "POST") {
    execute(async (code) => {
      setBusy(path);
      setError("");
      setMessage("");
      let received = false;
      try {
        const r = await fetch(`/api/cases/${encodeURIComponent(id)}/${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${code}`,
          },
          body: JSON.stringify(body),
        });
        const result = await r.json();
        received = true;
        if (!r.ok) {
          if (r.status === 401)
            sessionStorage.removeItem("counterclaim-operator");
          if (result.case) {
            if (path === "case-file" && r.status === 409) {
              setEditorVersionId(editorVersionId ?? data?.caseFileVersions.at(-1)?.id ?? null);
              setDirty(true);
            }
            setData(result.case);
          }
          throw Error(
            r.status === 429
              ? "Investigation paused: hourly rate limit or daily spending cap reached. No further model request was started. Continue with the saved facts below."
              : result.error,
          );
        }
        if (!(await load())) {
          setMessage(
            "The write was accepted, but the updated case could not be loaded. Controls are locked until you refresh the saved facts.",
          );
          return;
        }
        if (path === "case-file") { setDirty(false); setEditorVersionId(null); }
        setMessage(
          path === "case-file"
            ? "New version saved. Approval cleared. Review and approve this version again."
            : path === "approve"
              ? "This version is approved. Nothing has been sent."
              : path === "submit"
                ? "Submission state updated. See the recorded attempt below."
                : "Investigation finished. Review the saved result.",
        );
      } catch (e) {
        if (path === "submit" && !received) setClientUnknown(true);
        setError((e as Error).message);
      } finally {
        setBusy("");
      }
    });
  }
  if (!data)
    return (
      <main id="main" className="workspace">
        {error ? (
          <div role="alert" className="notice danger">
            <h1>Case unavailable</h1>
            <p>{error}</p>
            <button onClick={load}>Try again</button>
            <Link href="/">Back to queue</Link>
          </div>
        ) : (
          <div className="skeleton">
            <p>Opening the case file…</p>
            <div />
            <div />
            <div />
          </div>
        )}
      </main>
    );
  const version = data.caseFileVersions.at(-1);
  const file = version?.caseFile;
  const run = data.runs.at(-1);
  const attempt = data.attempts.at(-1);
  const approved = data.approvals.findLast(
    (a) =>
      a.versionId === version?.id &&
      a.stage === (data.dispute.dispute_life_cycle_stage ?? "UNKNOWN"),
  );
  const resolved = data.dispute.status === "RESOLVED";
  const action = file ? actions[file.recommendation.action] : null;
  const available = action && data.case.nextActions.includes(action);
  const blocked =
    data.case.replay ||
    stale ||
    clientUnknown ||
    resolved ||
    !!busy ||
    running ||
    (!!attempt &&
      (["submitting", "unknown"].includes(attempt.status) ||
        (attempt.status === "submitted" &&
          attempt.stage === data.dispute.dispute_life_cycle_stage)));
  const verdict =
    file?.recommendation.action === "fight"
      ? "Fight this."
      : file?.recommendation.action === "offer"
        ? `Offer ${money(file.recommendation.offer_amount)}.`
        : file
          ? "Don’t fight this one."
          : resolved
            ? "The case is closed."
            : "Let’s establish the facts.";
  return (
    <main id="main" className="workspace case-workspace">
      <div className="case-nav">
        <Link href="/">All cases</Link>
        <span>{data.case.title}<small className="case-reference">{id}</small></span>
        <span className="tag">{words(data.case.stage)}</span>
      </div>
      <div className="case-heading">
        <div>
          <p className="folio">
            {review ? "Review & approve" : "Case file"} /{" "}
            {reason(data.case.reason)}
          </p>
          <h1>{review ? "Your response, on record." : verdict}</h1>
        </div>
        <div className="case-amount">
          <span>Amount in dispute</span>
          <strong>{money(data.case.amount)}</strong>
          {!data.case.amount && <small>Amount absent from the recorded trace.</small>}
          <span className="number">
            {data.case.deadline
              ? `Respond by ${date(data.case.deadline)}`
              : resolved
                ? "No response due"
                : `Waiting for ${data.case.whoseTurn === "paypal" ? "PayPal" : data.case.whoseTurn}`}
          </span>
        </div>
      </div>
      <div className="file-labels">
        <span className="tag">SANDBOX</span>
        <span>Demo seller data</span>
        {data.case.replay && <strong>Read-only replay</strong>}
        {id.startsWith("TEST-") && <strong>Test state · E2E only</strong>}
        <span className="version-label">
          {version
            ? `Version ${data.caseFileVersions.length} / ${approved ? "Approved" : "Not approved"}`
            : "No case file yet"}
        </span>
      </div>
      {data.case.replay && (
        <div className="replay-note">
          This is a saved replay.{" "}
          {id.startsWith("PP-")
            ? "Timeline snapshots are sanitized reconstructions of the recorded sandbox run; their local import times are not event times."
            : "Recorded model run on synthetic seller records, checked again by the real guard."}{" "}
          Write actions are disabled.
        </div>
      )}
      {(error || clientUnknown) && (
        <div className="notice danger" role="alert" aria-label="Case action needs attention">
          <strong>{clientUnknown ? "Unknown, check before retrying" : "Action needs attention"}</strong>
          <p>{clientUnknown ? "The browser did not receive confirmation. Sending is locked. Refresh the saved attempt and check PayPal before any retry." : error}</p>
          <button onClick={load}>Refresh saved facts</button>
        </div>
      )}
      {(message || busy || running || dirty) && (
        <div className="notice" role="status">
          {busy ? (busy === 'investigate' ? 'Investigation running. Only recorded tool activity will appear below.' : busy === 'submit' ? 'Sending your approved response. Do not retry or close this step.' : 'Saving the case file…')
            : message || (running ? 'Investigation in progress. Showing recorded tool activity only.' : 'Unsaved changes. Saving creates a new version and clears approval.')}
        </div>
      )}
      {attempt && (
        <div
          className={`notice ${attempt.status === "unknown" || attempt.status === "failed" ? "danger" : "success"}`}
        >
          <h3>
            {
              {
                submitting: "Sending , do not retry",
                submitted: "Sent to PayPal",
                failed: "Sending failed",
                unknown: "Unknown , check before retrying",
              }[attempt.status]
            }
          </h3>
          <p>
            {attempt.status === "unknown"
              ? "The connection ended without confirmation. PayPal may have received this response. Sending is locked; check the case in PayPal before any retry."
              : `${actionNames[attempt.action]} / ${date(attempt.startedAt)}. This is the saved attempt state, not a promise about the outcome.`}
          </p>
          {['failed', 'unknown'].includes(attempt.status) && <p>{submissionFailureReason(attempt.paypalError)}</p>}
          {attempt.paypalError && <small>HTTP {attempt.paypalError.status} · {attempt.paypalError.details.map(d => d.issue).filter(Boolean).join(', ') || attempt.paypalError.name}{attempt.paypalError.debug_id ? ` · Reference: ${attempt.paypalError.debug_id}` : ''}</small>}
        </div>
      )}
      {resolved && (
        <div className="outcome">
          <h2>
            {words(data.dispute.dispute_outcome?.outcome_code ?? "Resolved")}
          </h2>
          <p>
            Recorded sandbox outcome. Sandbox settlement says nothing about
            real-world evidence quality or outcomes.
          </p>
        </div>
      )}
      {!review && file && (
        <>
          <section
            className={`verdict-sheet ${file.recommendation.action}`}
            aria-label="Verdict reasoning"
          >
            <div>
              <p className="lead">{file.recommendation.reasoning}</p>
              <p className="confidence">
                <strong>
                  {sentence(file.recommendation.confidence.level)} confidence in
                  the advice.
                </strong>{" "}
                {file.recommendation.confidence.reason}
              </p>
            </div>
            <div className="next-step">
              <span>
                {version?.guard.accepted ? "Your next step" : "Review required"}
              </span>
              <p>
                {version?.guard.accepted
                  ? "Read the proof and the gaps. Then review the exact response."
                  : "The guard rejected this file. It cannot be approved."}
              </p>
              <Link className="primary" href={`/cases/${id}/approve`}>
                Review response
              </Link>
            </div>
          </section>
          <Money data={data} />
        </>
      )}
      {review ? (
        <>
          <div className="step-nav">
            <Link href={`/cases/${id}`}>1. Read the case</Link>
            <strong>2. Review & approve</strong>
            <span>3. Send to PayPal</span>
          </div>
          {file && version ? (
            <>
              <Editor
                key={editorVersionId ?? version.id}
                file={file}
                version={version}
                disabled={!!blocked}
                onDirty={(next) => {
                  setDirty(next);
                  if (next) setEditorVersionId(editorVersionId ?? version.id);
                }}
                save={(f) => mutate("case-file", { caseFile: f, baseVersionId: version.id }, "PUT")}
              />
              <section className="send-sheet">
                <div>
                  <h2>Exactly what gets sent</h2>
                  <p>
                    <strong>
                      PayPal action:{" "}
                      {action ? actionNames[action] : "Unavailable"}.
                    </strong>
                  </p>
                  <p>
                    {action === "provide-evidence"
                      ? "Your seller note and the evidence PDF containing delivery facts from the selected shipment and tracking records."
                      : action === "make-offer"
                        ? `Your seller note and a ${money(file.recommendation.offer_amount)} refund offer. No evidence PDF is sent.`
                        : "Your seller note and acceptance of the claim. No evidence PDF is sent. A planned refund is not proof of an issued refund."}
                  </p>
                  {action === "provide-evidence" && (version.outboundPacket
                    ? <OutboundPreview packet={version.outboundPacket} />
                    : <p className="notice">PDF content is unavailable until the source and privacy checks pass.</p>)}
                </div>
                <div className="approval-box">
                  <h3>{approved ? "Version approved" : "Approval required"}</h3>
                  <p>
                    {approved
                      ? `Version ${data.caseFileVersions.length} is bound to its content hash. Sending is a separate action.`
                      : "Approve this version to generate the bound PDF preview. This does not send it."}
                  </p>
                  <button
                    className={approved ? "" : "primary"}
                    disabled={
                      !!blocked ||
                      dirty ||
                      !version.guard.accepted ||
                      !available
                    }
                    onClick={() => mutate("approve", { versionId: version.id, snapshotFingerprint: data.snapshotFingerprint })}
                  >
                    {approved ? "Approve again" : "Approve this version"}
                  </button>
                  {!version.guard.accepted && (
                    <p className="danger-text">
                      Rejected files cannot be approved. Correct the reasons
                      shown below.
                    </p>
                  )}
                  {!available && (
                    <p>
                      PayPal does not currently offer{" "}
                      {action
                        ? actionNames[action].toLowerCase()
                        : "this action"}{" "}
                      for this case.
                    </p>
                  )}
                  {data.case.replay && (
                    <p>Read-only replay. Approval and sending are disabled.</p>
                  )}
                  {approved && action === "provide-evidence" && (
                    <a
                      className="text-button"
                      href={`/api/cases/${id}/evidence.pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open approved PDF
                    </a>
                  )}
                  <button
                    className={approved ? "primary" : ""}
                    disabled={
                      !!blocked ||
                      dirty ||
                      !approved ||
                      !available ||
                      !version.guard.accepted
                    }
                    onClick={() =>
                      mutate("submit", { approvalId: approved!.id })
                    }
                  >
                    Send approved response
                  </button>
                </div>
              </section>
              {approved && action === "provide-evidence" ? (
                <section className="pdf-preview">
                  <h2>Approved PDF preview</h2>
                  <iframe
                    title="Approved evidence PDF"
                    src={`/api/cases/${id}/evidence.pdf`}
                  />
                </section>
              ) : (
                action === "provide-evidence" && (
                  <div className="notice">
                    <h3>PDF preview follows approval</h3>
                    <p>
                      The server generates and binds the exact PDF bytes to
                      approval. First review the checked PDF content and exclusions
                      above. Then approve to inspect the PDF before
                      sending.
                    </p>
                  </div>
                )
              )}
              <section className="action-list">
                <h2>PayPal’s current actions</h2>
                {Object.entries(actionNames).map(([key, label]) => (
                  <div key={key}>
                    <strong>{label}</strong>
                    <span>
                      {data.case.nextActions.includes(key)
                        ? "Currently offered by PayPal"
                        : "Unavailable: absent from PayPal’s current action list"}
                    </span>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <div className="empty">
              <h2>A case file is needed first</h2>
              <p>Open the case and review its raw facts first.</p>
              <Link href={`/cases/${id}`}>Back to case</Link>
            </div>
          )}
        </>
      ) : (
        <>
          {file && <Claims key={version!.id} file={file} sources={version!.sources} highlights={data.computed.citationHighlights} notice={data.computed.instructionNotice} />}
          <section className="gaps-section">
            <div>
              <p className="folio">What the evidence cannot establish</p>
              <h2>Gaps to weigh.</h2>
              <p>Missing proof matters as much as a supporting record.</p>
            </div>
            <div>
              {(file?.gaps ?? data.computed.gaps).map((g, i) => (
                <article className="gap" key={i}>
                  <span className="gap-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{g.missing}</h3>
                    <p>{g.why_it_matters}</p>
                    <small className="tag">
                      {data.computed.gaps.some((f) => f.missing === g.missing)
                        ? "Computed by code"
                        : "Raised in the case file"}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      <div className="lower-grid">
        <Guard version={version} history={data.caseFileVersions} />
        <section className="timeline">
          <h2>The case, in order.</h2>
          {file?.timeline.map((t, i) => (
            <div className="timeline-event" key={`t${i}`}>
              <time>{date(t.date)}</time>
              <p>{t.event}</p>
              <InlineCitations ids={t.citations} sources={version!.sources} />
            </div>
          ))}
          {data.events.map((e, i) => (
            <div className="timeline-event" key={e.id}>
              <time>
                {id === "PP-R-ZAT-10196609"
                  ? `Recorded snapshot ${String(i + 1).padStart(2, "0")}`
                  : date(e.snapshot.update_time ?? e.observedAt)}
              </time>
              <p>
                PayPal: {paypalStatus(e.snapshot.status)}, {words(e.snapshot.dispute_life_cycle_stage)} stage
              </p>
              {data.case.replay && (
                <small>Saved replay; not a live status check.</small>
              )}
            </div>
          ))}
          {!resolved && !available && (
            <p className="notice">
              PayPal hasn’t made a seller action available in the saved
              snapshot.
              {data.case.replay
                ? " This is a replay; no live check was made."
                : " Refresh saved facts to see the latest local sync. This page reads the saved record only."}
            </p>
          )}
        </section>
      </div>
      <section className="trace">
        <p className="sync-note">
          {data.case.replay
            ? "Replay imported locally. No live PayPal check."
            : data.case.lastSyncedAt
              ? `Saved snapshot last synced ${new Date(data.case.lastSyncedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC.`
              : "Last sync time unavailable."}
        </p>
        <div className="section-head">
          <h2>
            {data.case.replay
              ? "Sources in this replay"
              : "What the agent read"}
          </h2>
          <span className="muted">
            {data.case.replay
              ? `${version?.sources.length ?? 0} source records / ${run ? "Recorded model run" : "Recorded sandbox trace"}`
              : run
                ? `${words(run.status)} / ${run.toolCalls.length} recorded tool calls`
                : "Investigation not started"}
          </span>
        </div>
        {run?.status === "running" && (
          <p>
            Investigation in progress. {run.toolCalls.length} tool calls saved
            so far. Showing recorded activity only.
          </p>
        )}
        {run?.status === "failed" && (
          <div className="notice danger">
            <h3>
              {run.failureCode === "budget"
                ? "Spending cap reached"
                : "Investigation stopped"}
            </h3>
            <p>
              {run.failureCode ??
                run.failure ??
                "The run did not produce a valid case file."}{" "}
              Partial output is blocked from sending. Review the facts below and
              continue by hand.
            </p>
          </div>
        )}
        <details>
          <summary>Read trace and raw dispute facts</summary>
          <ol>
            {run?.toolCalls.map((t, i) => (
                <li key={i}>
                  <strong>{words(t.tool)}</strong>{" "}
                  {Object.values(t.arguments).join(" / ")}
                  <span className="muted">: {t.result}</span>
                </li>
              ))}
          </ol>
          {data.case.replay && version && (
            <InlineCitations
              ids={version.sources.map((s) => s.id)}
              sources={version.sources}
            />
          )}
          <dl className="facts">
            {Object.entries(data.dispute)
              .filter(
                ([k, v]) =>
                  v !== undefined && !["links", "dispute_outcome"].includes(k),
              )
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{words(k)}</dt>
                  <dd>
                    {typeof v === "object"
                      ? money(v as { value: string; currency_code: string })
                      : String(v)}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
        <div className="investigate">
          <p>
            {data.case.replay
              ? (run ? `Recorded model run · ${run.model} · ${date(run.startedAt)}. No live model call.` : "Recorded sandbox trace. No model analysis is available for this case.")
              : "Investigating reads sources only. It cannot send anything to PayPal."}
          </p>
          <button
            disabled={!!blocked}
            onClick={() => mutate("investigate", {})}
          >
            {running ? "Investigation running" : "Investigate case"}
          </button>
        </div>
        {!file && !data.case.replay && <ManualCase />}
      </section>
    </main>
  );
}
function Money({ data }: { data: CaseDetailResponse }) {
  const m = data.computed.money;
  const amount = (value: string | null) =>
    value && m.currency_code
      ? money({ value, currency_code: m.currency_code })
      : "Unknown";
  return (
    <section className="money-strip" aria-label="Conditional money facts">
      <div>
        <span>If you win</span>
        <strong>{amount(m.net_if_won)}</strong>
        <small>After recorded item and shipping costs</small>
      </div>
      <div>
        <span>If you lose</span>
        <strong>{amount(m.net_if_lost)}</strong>
        <small>Recorded costs already spent</small>
      </div>
      <p>
        Computed from source records.
        <br />
        Conditional outcomes, not odds.
        <br />
        Fees and win probabilities are not assumed.
      </p>
    </section>
  );
}
function Claims({ file, sources, highlights, notice }: { file: CaseFile; sources: ReadSource[]; highlights: Record<string, string[]>[]; notice: string | null }) {
  const [selected, setSelected] = useState<{
    id: string;
    claim: number;
  } | null>(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 760px)').matches) return null;
    for (let claim = 0; claim < file.claims.length; claim++) {
      const id = file.claims[claim]!.citations.find(id => sources.some(s => s.id === id));
      if (id) return { id, claim };
    }
    return null;
  });
  const pane = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const source = sources.find((s) => s.id === selected?.id);
  function open(id: string, claim: number, button: HTMLButtonElement) {
    trigger.current = button;
    setSelected({ id, claim });
    setTimeout(() => {
      pane.current?.focus({ preventScroll: true });
      if (window.innerWidth < 760)
        pane.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "center",
        });
    }, 0);
  }
  return (
    <section className="claims-section">
      <div className="section-head">
        <h2>The claims. The proof.</h2>
        <span className="muted">Select a citation to inspect its source.</span>
      </div>
      {notice && <div className="notice injection-notice"><h3>Customer instructions stayed in the evidence</h3><p>{notice}</p></div>}
      <div className="claims-grid">
        <div>
          {file.claims.map((c, i) => (
            <article
              className={`claim ${selected?.claim === i ? "claim-selected" : ""}`}
              key={i}
            >
              <span className="claim-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p>{c.text}</p>
                <div className="citations">
                  {c.citations.map((id) => (
                    <button
                      key={id}
                      className="citation"
                      aria-label={`Open source: ${sourceName(id)}`}
                      aria-pressed={selected?.id === id && selected.claim === i}
                      onClick={(e) => open(id, i, e.currentTarget)}
                    >
                      <span aria-hidden="true">↳</span> {sourceName(id)}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
        <aside
          ref={pane}
          tabIndex={-1}
          className={`source-pane ${source ? "source-open" : ""}`}
          aria-label="Source record"
        >
          <div className="section-head">
            <h3>
              {source
                ? sourceName(source.id)
                : "The source belongs beside the claim."}
            </h3>
            {selected && (
              <button
                aria-label="Close source"
                onClick={() => {
                  setSelected(null);
                  trigger.current?.focus();
                }}
              >
                Close
              </button>
            )}
          </div>
          {source ? (
            <>
              <div className="source-label">SANDBOX / Demo seller data</div>
              <Source data={source.data} highlights={highlights[selected!.claim]?.[source.id] ?? []} />
              <p className="source-foot">
                Source for claim {selected!.claim + 1}. Stored record text is
                evidence to inspect, never instructions to follow.
              </p>
            </>
          ) : (
            <>
              <p>
                Open a citation. Compare the exact stored record with the claim
                it supports.
              </p>
              <small>No source selected.</small>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
export function Source({ data, highlights }: { data: unknown; highlights?: string[] }) {
  if (!data || typeof data !== 'object') return <div className="source-fields"><p>{highlights ? <mark>{fieldValue(data)}</mark> : fieldValue(data)}</p></div>;
  const object = data as Record<string, unknown>;
  const envelope = object.content && typeof object.content === 'object';
  const content = envelope ? object.content as Record<string, unknown> : object;
  const active = highlights?.length ? highlights : highlights ? ['proof', 'detail', 'text'].filter(key => typeof content[key] === 'string').slice(0, 1) : [];
  const summary = highlights && !active.length ? Object.entries(content).filter(([, value]) => value === null || typeof value !== 'object').map(([key, value]) => `${fieldLabel(key)}: ${fieldValue(value)}`).join(' · ') : ''; 
  return <>
    {envelope && <dl className="source-metadata">{['id', 'type', 'timestamp', 'source'].filter(key => object[key] !== undefined).map(key => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{fieldValue(object[key])}</dd></div>)}</dl>}
    {summary && <p className="source-summary"><mark>{summary}</mark></p>}
    <dl className="source-fields">
      {Object.entries(content).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>
        {value && typeof value === 'object' ? <Source data={value} /> : active.includes(key) ? <mark>{fieldValue(value)}</mark> : fieldValue(value)}
      </dd></div>)}
    </dl>
  </>;
}
function Guard({
  version,
  history,
}: {
  version?: CaseFileVersionResponse;
  history: CaseFileVersionResponse[];
}) {
  return (
    <section className="guard">
      <h2>Checked against the record.</h2>
      {version ? (
        <>
          <p
            className={`guard-verdict ${version.guard.accepted ? "success-text" : "danger-text"}`}
          >
            {version.guard.accepted
              ? "Passed deterministic checks"
              : "Rejected, approval blocked"}
          </p>
          <p>
            The guard checks citation IDs, supported figures, typed facts,
            attachment availability, private data and repeated instructions.
          </p>
          {version.guard.reasons.length > 0 && (
            <ul className="guard-reasons">
              {version.guard.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {version.guard.warnings?.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          <p className="muted">
            Passing does not prove a claim is true or predict PayPal’s decision.
          </p>
          <details>
            <summary>Case-file version history</summary>
            {history.slice(0, -1).map((v, i) => (
              <article className="version-history" key={v.id}>
                <h3>
                  Version {i + 1}: {v.guard.accepted ? "Passed" : "Rejected"}
                </h3>
                {v.guard.reasons.map((r) => (
                  <p className="danger-text" key={r}>
                    {r}
                  </p>
                ))}
                {!v.guard.accepted && (
                  <>
                    <p>
                      {v.caseFile?.summary ??
                        "Output withheld by privacy checks."}
                    </p>
                    {v.caseFile?.claims.map((c, j) => (
                      <p key={j}>{c.text}</p>
                    ))}
                  </>
                )}
              </article>
            ))}
            {/* Version identity is public; approval payload is never displayed. */}
            <p>
              Current version: <span className="source-id">{version.id}</span>
              <br />
              Saved {date(version.createdAt)}.
            </p>
            <p>
              Rejected output stays visible in the case file, with these
              reasons.
            </p>
          </details>
        </>
      ) : (
        <p>A guard result will appear after a case file is saved.</p>
      )}
    </section>
  );
}
export function Editor({
  file,
  version,
  disabled,
  onDirty,
  save,
}: {
  file: CaseFile;
  version: CaseFileVersionResponse;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  save: (f: CaseFile) => void;
}) {
  const [draft, setDraft] = useState(file);
  const dirty = JSON.stringify(draft) !== JSON.stringify(file);
  function update(next: CaseFile) {
    setDraft(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(file));
  }
  return (
    <section className="editor">
      <div className="section-head">
        <h2>Read it as your response.</h2>
        <span className="tag">
          {version.guard.accepted ? "Guard passed" : "Rejected file"}
        </span>
      </div>
      <label htmlFor="seller-note">Sent to PayPal and visible to the buyer</label>
      <textarea
        id="seller-note"
        value={draft.evidence_draft.seller_note}
        maxLength={2000}
        readOnly={disabled}
        onChange={(e) => {
          update({
            ...draft,
            evidence_draft: {
              ...draft.evidence_draft,
              seller_note: e.target.value,
            },
          });
        }}
      />
      {draft.claims.map((c, i) => (
        <div key={i}>
          <label htmlFor={`claim-${i}`}>Claim {i + 1}</label>
          <textarea
            id={`claim-${i}`}
            value={c.text}
            readOnly={disabled}
            maxLength={12000}
            onChange={(e) => {
              update({
                ...draft,
                claims: draft.claims.map((v, j) =>
                  i === j ? { ...v, text: e.target.value } : v,
                ),
              });
            }}
          />
          <InlineCitations ids={c.citations} sources={version.sources} />
        </div>
      ))}
      {dirty && (
        <div className="notice">
          Unsaved changes. Saving creates a new version and clears approval.
          Sending still uses the saved version; save your changes first.
        </div>
      )}
      <div className="editor-save">
        <button
          disabled={
            disabled ||
            !dirty ||
            !draft.evidence_draft.seller_note.trim() ||
            draft.claims.some((c) => !c.text.trim())
          }
          onClick={() => save(draft)}
        >
          Save new version
        </button>
        <p>
          Every edit is checked again. Approval applies to one saved version
          only.
        </p>
      </div>
    </section>
  );
}
function ManualCase() {
  return (
    <div className="notice">
      <h3>Continue by hand</h3>
      <p>
        Use the raw facts above to respond in the PayPal sandbox website. A
        failed investigation has no valid version to edit or approve here. Do
        not send unverified model output.
      </p>
      <a
        href="https://www.sandbox.paypal.com/"
        target="_blank"
        rel="noreferrer"
      >
        Open PayPal sandbox
      </a>
    </div>
  );
}

function InlineCitations({
  ids,
  sources,
}: {
  ids: string[];
  sources: ReadSource[];
}) {
  return (
    <div className="inline-citations">
      {ids.map((id) => (
        <details key={id}>
          <summary className="citation">{sourceName(id)}</summary>
          <aside className="inline-source">
            <strong>{sourceName(id)}</strong>
            <p className="source-id">{id}</p>
            <small>SANDBOX / Demo seller data</small>
            <Source
              data={
                sources.find((s) => s.id === id)?.data ??
                "Source unavailable. The guard must reject unread citations."
              }
            />
          </aside>
        </details>
      ))}
    </div>
  );
}

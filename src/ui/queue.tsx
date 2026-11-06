"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import type { CaseQueueRow, CasesResponse } from "@/api/contract";
import { date, money, reason, words, paypalOutcome } from "./format";
import { compareQueueDeadlines } from "./case-state";
import { queueFilterText } from "./queue-filter";
ModuleRegistry.registerModules([AllCommunityModule]);
const theme = themeQuartz.withParams({
  backgroundColor: "var(--sheet)",
  foregroundColor: "var(--ink)",
  accentColor: "var(--accent)",
  borderColor: "var(--line)",
  headerBackgroundColor: "var(--paper)",
  headerTextColor: "var(--muted)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  headerFontSize: 12,
  rowVerticalPaddingScale: 1.4,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  browserColorScheme: "light",
});
type Cell = ICellRendererParams<CaseQueueRow>;
export function Queue() {
  const router = useRouter();
  const gridReady = useRef(false);
  const [rows, setRows] = useState<CaseQueueRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<CaseQueueRow[]>([]);
  async function load() {
    setError("");
    try {
      const r = await fetch("/api/cases");
      if (!r.ok)
        throw Error(
          "The case queue could not be loaded. Your saved cases are still on file.",
        );
      const data: CasesResponse = await r.json();
      setRows(data.cases);
      setShown(data.cases);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cases", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "The case queue could not be loaded. Your saved cases are still on file.",
          );
        const data: CasesResponse = await r.json();
        setRows(data.cases);
        setShown(data.cases);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const columns = useMemo<ColDef<CaseQueueRow>[]>(
    () => [
      {
        field: "id",
        headerName: "Case / reason",
        minWidth: 280,
        getQuickFilterText: p => queueFilterText(p.data),
        flex: 1.5,
        
        cellRenderer: ({ data }: Cell) =>
          data && (
            <div className="case-cell">
              <Link href={`/cases/${data.id}`}>
                {data.title}
              </Link>
              <small>{data.id}</small>
              <small>
                {data.replay ? "Read-only replay" : "Sandbox case"} /{" "}
                {reason(data.reason)}
              </small>
            </div>
          ),
      },
      {
        field: "amount",
        headerName: "At stake",
        width: 125,
        comparator: (a, b) => Number(a?.value ?? 0) - Number(b?.value ?? 0),
        cellRenderer: ({ data }: Cell) => (
          data?.amount ? <strong className="number">{money(data.amount)}</strong> : <div className="case-cell"><span>—</span><small>Amount absent from trace</small></div>
        ),
      },
      {
        field: "deadline",
        headerName: "Respond by",
        width: 158,
        initialSort: "asc",
        comparator: (_a, _b, nodeA, nodeB) => compareQueueDeadlines(nodeA.data, nodeB.data),
        cellRenderer: ({ data }: Cell) => {
          const days = data?.deadline
            ? Math.ceil((Date.parse(data.deadline) - Date.now()) / 86400000)
            : null;
          return (
            <div className="case-cell">
              <span className={days !== null && days <= 3 ? "urgency" : ""}>
                {data?.deadline
                  ? date(data.deadline).replace(", 2026", "")
                  : "—"}
              </span>
              <small>
                {days === null
                  ? "No response due"
                  : days < 0
                    ? "Deadline passed"
                    : `${days} days remaining`}
              </small>
            </div>
          );
        },
      },
      {
        field: "stage",
        headerName: "Stage",
        width: 130,
        cellRenderer: ({ value }: Cell) => (
          <span className="tag">{words(value)}</span>
        ),
      },
      {
        field: "whoseTurn",
        headerName: "Whose turn",
        minWidth: 260,
        cellRenderer: ({ value, data }: Cell) =>
          data?.status === "RESOLVED" ? (
            <div className="case-cell"><strong>Resolved</strong><small>{paypalOutcome(data.outcome)}</small></div>
          ) : value === "paypal" ? (
            "PayPal"
          ) : value === "seller" ? (
            <strong>Your turn</strong>
          ) : value === "buyer" ? ("Buyer’s turn") : (
            words(value)
          ),
      },
      {
        field: "nextActions",
        headerName: "Next action",
        width: 170,
        valueGetter: (p) => p.data?.nextActions.join(" "),
        cellRenderer: ({ data }: Cell) =>
          data?.whoseTurn === "none"
            ? "View outcome"
            : data?.nextActions.includes("provide-evidence")
              ? "Review & respond"
              : "Wait for update",
      },
      {
        field: "evidenceStrength",
        headerName: "Evidence",
        width: 140,
        cellRenderer: ({ value }: Cell) => (
          <span className={`strength ${value}`}>{words(value)}</span>
        ),
      },
    ],
    [],
  );
  const totals = shown.reduce<Record<string, number>>((a, r) => {
    if (r.amount && r.whoseTurn !== "none")
      a[r.amount.currency_code] =
        (a[r.amount.currency_code] ?? 0) + Number(r.amount.value);
    return a;
  }, {});
  return (
    <main id="main" className="workspace">
      <div className="queue-intro">
        <div>
          <p className="folio">The seller’s case desk</p>
          <h1>
            Know what’s worth
            <br />
            fighting for.
          </h1>
          <p>
            Review the evidence. Decide your response. Send only what you
            approve.
          </p>
        </div>
        <aside className="desk-note">
          <span className="note-line" />A deadline is a decision.
          <br />
          <span className="muted">
            Start with the case due soonest.
            <br />
            The evidence comes with it.
          </span>
        </aside>
      </div>
      <section aria-label="Dispute queue" className="queue-sheet">
        <div className="queue-toolbar">
          <div>
            <h2>
              Your case queue{" "}
              <span className="count">{rows?.length ?? "—"}</span>
            </h2>
            <p className="muted">
              Saved locally. Open cases first, then soonest deadline.
            </p>
          </div>
          <label className="search">
            Find a case
            <input
              type="search"
              placeholder="Case, stage, evidence…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            <h3>We couldn’t open the queue</h3>
            <p>{error}</p>
            <button onClick={load}>Try again</button>
          </div>
        ) : rows === null ? (
          <div className="skeleton" aria-label="Loading case queue">
            <p>Opening your case files…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>No cases on the desk.</h3>
            <p>
              Synced sandbox disputes will appear here. For offline viewing, run{" "}
              <code>npm run seed-demo</code>.
            </p>
          </div>
        ) : (
          <>
            <div className="grid-wrap">
              <AgGridReact<CaseQueueRow>
                theme={theme}
                rowData={rows}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true, flex: 1, minWidth: 120 }}
                quickFilterText={filter}
                rowHeight={94}
                headerHeight={44}
                domLayout="autoHeight"
                getRowId={(p) => p.data.id}
                onRowClicked={(e) => {
                  if (e.data) router.push(`/cases/${e.data.id}`);
                }}
                onCellKeyDown={(e) => {
                  if ((e.event as KeyboardEvent)?.key === "Enter" && e.data)
                    router.push(`/cases/${e.data.id}`);
                }}
                onGridReady={(e) => {
                  try {
                    const saved = localStorage.getItem("counterclaim-sort");
                    if (saved)
                      e.api.applyColumnState({ state: JSON.parse(saved) });
                  } catch {
                    /* default sort */
                  }
                  gridReady.current = true;
                }}
                onSortChanged={(e) => {
                  if (!gridReady.current) return;
                  localStorage.setItem(
                    "counterclaim-sort",
                    JSON.stringify(
                      e.api
                        .getColumnState()
                        .map(({ colId, sort, sortIndex }) => ({
                          colId,
                          sort,
                          sortIndex,
                        })),
                    ),
                  );
                }}
                onModelUpdated={(e) => {
                  const filtered: CaseQueueRow[] = [];
                  e.api.forEachNodeAfterFilter((n) => {
                    if (n.data) filtered.push(n.data);
                  });
                  setShown(filtered);
                }}
                overlayNoRowsTemplate="No cases match your search."
              />
            </div>
            <div className="grid-status" role="status">
              <span>
                {shown.length} of {rows.length} cases{" "}
                <span className="mobile-hint"> / Swipe table for more</span>
              </span>
              <span>
                Open amount at stake{" "}
                <strong>
                  {Object.entries(totals)
                    .map(([currency_code, n]) =>
                      money({ currency_code, value: String(n) }),
                    )
                    .join(" + ") || "—"}
                </strong>
              </span>
            </div>
          </>
        )}
      </section>
      <div className="queue-foot">
        <p>
          <strong>Evidence, before action.</strong> Every claim has a source.
          Missing proof stays visible.
        </p>
        <Link href="/how-it-works">Read how Counterclaim works</Link>
      </div>
    </main>
  );
}

// Isolated test fixtures only; never run against the normal demo database.
import { randomUUID } from "node:crypto";
import { CaseStore } from "../src/cases/storage";
import { CaseService } from "../src/api/service";
import { checkCaseFile } from "../src/guard/case-file";
import { trustedFacts } from "../src/agent/facts";
import { recordsForScenario, syntheticDispute } from "../src/records";
if (!process.env.DATABASE_PATH?.endsWith("/e2e.db"))
  throw Error("Requires isolated e2e.db");
const store = new CaseStore();
for (const name of ["editable", "rejected", "failed", "running", "unknown", "waiting"]) {
  const id = `TEST-${name}`;
  if (store.get(id)) continue;
  const d = syntheticDispute("strong-delivery");
  d.dispute_id = id;
  d.disputed_transactions = [
    {
      buyer: {
        name: "PRIVATE_BUYER_SENTINEL",
        email: "private-buyer@example.invalid",
      },
    },
  ];
  if (name === "waiting") { d.status = "WAITING_FOR_BUYER_RESPONSE"; d.links = []; }
  store.save(d);
  store.assignScenario(id, "strong-delivery");
  const original = store.versions("REPLAY-strong-delivery").at(-1)!;
  const v = {
    ...structuredClone(original),
    id: randomUUID(),
    disputeId: id,
    runId: randomUUID(),
  };
  if (name === "rejected") {
    v.caseFile.claims[0]!.citations = ["unread-record"];
    v.guard = checkCaseFile(
      v.caseFile,
      v.sources,
      [],
      trustedFacts(d, recordsForScenario("strong-delivery")),
    );
  }
  if (name !== "failed" && name !== "running") store.addVersion(v);
  if (name === "failed" || name === "running")
    store.saveRun({
      id: v.runId,
      disputeId: id,
      model: "offline-test",
      status: name === "failed" ? "failed" : "running",
      startedAt: new Date().toISOString(),
      toolCalls: [
        {
          tool: "get_dispute",
          arguments: {},
          result: "Safe dispute fields read",
        },
      ],
      tokens: 0,
      tokensEstimated: false,
      sources: [],
      ...(name === "failed"
        ? {
            failure: "Provider unavailable",
            failureCode: "provider_refused" as const,
          }
        : {}),
    });
  if (name === "unknown")
    store.addAttempt({
      id: randomUUID(),
      disputeId: id,
      versionId: v.id,
      approvalId: randomUUID(),
      stage: "INQUIRY",
      action: "provide-evidence",
      contentHash: "offline-test",
      status: "unknown",
      startedAt: new Date().toISOString(),
    });
  if (name === "editable") {
    const noNetwork = {
      getDispute: async () => {
        throw Error("Network forbidden");
      },
      provideEvidence: async () => {
        throw Error("Network forbidden");
      },
      makeOffer: async () => {
        throw Error("Network forbidden");
      },
      acceptClaim: async () => {
        throw Error("Network forbidden");
      },
    };
    await new CaseService(store, noNetwork).approve(id, v.id, store.snapshotFingerprint(id));
  }
}
store.close();

import { test, expect } from "@playwright/test";
const headers = { Authorization: "Bearer local-e2e-only" };
test("offline seed uses the real guard, strength and recorded eleven-state timeline", async ({
  request,
}) => {
  for (const id of [
    "strong-delivery",
    "weak-delivery",
    "low-value",
    "injection",
  ]) {
    const data = await (await request.get(`/api/cases/REPLAY-${id}`)).json();
    expect(data.case.replay).toBe(true);
    expect(data.caseFileVersions.at(-1).guard.accepted).toBe(true);
    expect(data.case.evidenceStrength).toBe(id === "weak-delivery" ? "weak" : id === "low-value" ? "partial" : "strong");
    expect(data.runs.at(-1).model).toBe("@preset/deepseek-mistral-vibe");
    expect(data.computed.money.net_if_won).toBe(
      id === "low-value" ? "7.00" : "67.00",
    );
  }
  const trace = await (
    await request.get("/api/cases/PP-R-ZAT-10196609")
  ).json();
  expect(trace.events).toHaveLength(11);
  expect(trace.dispute.status).toBe("RESOLVED");
});
test("all replay mutation routes refuse authorized operators before providers", async ({
  request,
}) => {
  const id = "REPLAY-strong-delivery";
  const detail = await (await request.get(`/api/cases/${id}`)).json();
  const v = detail.caseFileVersions.at(-1);
  for (const [path, data] of [
    ["investigate", {}],
    ["approve", { versionId: v.id, snapshotFingerprint: detail.snapshotFingerprint }],
    ["submit", { approvalId: "00000000-0000-4000-8000-000000000000" }],
  ] as const) {
    const r = await request.post(`/api/cases/${id}/${path}`, { headers, data });
    expect(r.status()).toBe(403);
    expect(await r.text()).toContain("Read-only replay");
  }
  expect(
    (
      await request.put(`/api/cases/${id}/case-file`, {
        headers,
        data: { caseFile: v.caseFile, baseVersionId: v.id },
      })
    ).status(),
  ).toBe(403);
});
test("real rejected file is refused by approval API", async ({ request }) => {
  const d = await (await request.get("/api/cases/TEST-rejected")).json();
  const v = d.caseFileVersions.at(-1);
  expect(v.guard.accepted).toBe(false);
  const r = await request.post("/api/cases/TEST-rejected/approve", {
    headers,
    data: { versionId: v.id, snapshotFingerprint: d.snapshotFingerprint },
  });
  expect(r.status()).toBe(409);
});
test("public responses withhold private buyer data, credentials and PDF payload", async ({
  request,
}) => {
  const r = await request.get("/api/cases/TEST-editable");
  expect(r.status()).toBe(200);
  expect(await r.text()).not.toMatch(
    /PRIVATE_BUYER_SENTINEL|private-buyer@|pdfBase64|local-e2e-only/,
  );
  const pdf = await request.get("/api/cases/TEST-editable/evidence.pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});
test("unauthorized visitor writes fail closed", async ({ request }) => {
  for (const path of ["investigate", "approve", "submit"])
    expect(
      (
        await request.post(`/api/cases/TEST-editable/${path}`, { data: {} })
      ).status(),
    ).toBe(401);
  expect(
    (
      await request.put("/api/cases/TEST-editable/case-file", { data: {} })
    ).status(),
  ).toBe(401);
});

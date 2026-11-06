import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});
test("queue is an AG Grid, sorts and quick-filters", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your case queue" }),
  ).toBeVisible();
  const firstCase = page.locator('.ag-row[row-index="0"] .case-cell a').first();
  const cases = (await (await page.request.get('/api/cases')).json()).cases;
  const earliest = cases.map((c: { deadline: string | null }) => c.deadline).filter(Boolean).sort()[0];
  await expect(firstCase).toBeVisible();
  const firstId = (await firstCase.getAttribute('href'))!.split('/').at(-1);
  expect(cases.find((c: { id: string }) => c.id === firstId).deadline).toBe(earliest);
  await page.getByRole("columnheader", { name: /Respond by/ }).click();
  await expect(page.getByRole('columnheader', { name: /Respond by/ })).toHaveAttribute('aria-sort', 'descending');
  await page.reload();
  await expect(
    page.getByRole("columnheader", { name: /Respond by/ }),
  ).toHaveAttribute("aria-sort", "descending");
  await page
    .getByRole("searchbox", { name: "Find a case" })
    .fill("weak-delivery");
  const filteredRows = page.getByRole("grid").getByRole("row").filter({
    has: page.getByRole("gridcell"),
  });
  await expect(filteredRows).toHaveCount(1);
  await expect(filteredRows.getByRole("link")).toHaveAttribute(
    "href", "/cases/REPLAY-weak-delivery",
  );
});
test("citation opens the actual highlighted source beside its claim", async ({
  page,
}) => {
  await page.goto("/cases/REPLAY-strong-delivery");
  const shipmentCitation = page
    .getByRole("article")
    .filter({ hasText: "The carrier records show the parcel as delivered, the delivery was signed for, and the shipping address matches the order." })
    .getByRole("button", { name: "Open source: Shipment record", exact: true });
  await shipmentCitation.click();
  await expect(
    page.getByRole("complementary", { name: "Source record" }),
  ).toContainText("strong-delivery-shipment-01");
  await expect(
    page.getByRole("complementary", { name: "Source record" }).locator(".source-fields mark").filter({ hasText: /^DELIVERED$/ }),
  ).toBeVisible();
  await expect(
    shipmentCitation,
  ).toHaveAttribute("aria-pressed", "true");
});
test("real guard rejection cannot be approved", async ({ page }) => {
  await page.goto("/cases/TEST-rejected/approve");
  await expect(
    page.getByRole("button", { name: "Approve this version" }),
  ).toBeDisabled();
  await expect(page.getByText("Rejected, approval blocked")).toBeVisible();
  await expect(page.getByText(/missing or unread citation/)).toBeVisible();
});
test("visitor cannot write; replay is read-only even with a valid operator", async ({
  page,
  request,
}) => {
  await page.goto("/cases/TEST-editable/approve");
  await page
    .getByLabel("Sent to PayPal and visible to the buyer", { exact: true })
    .fill("A visitor edit that must never be persisted.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const response = await request.put("/api/cases/TEST-editable/case-file", {
    data: {},
  });
  expect(response.status()).toBe(401);
  const r = await request.post("/api/cases/REPLAY-strong-delivery/approve", {
    data: { versionId: "00000000-0000-4000-8000-000000000000", snapshotFingerprint: "0".repeat(64) },
    headers: { Authorization: "Bearer local-e2e-only" },
  });
  expect(r.status()).toBe(403);
  await page.goto("/cases/REPLAY-strong-delivery/approve");
  await expect(
    page.getByRole("button", { name: "Approve this version" }),
  ).toBeDisabled();
});
test("saving an edit creates a version and clears the bound approval", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/cases/TEST-editable");
  const original = await response.json();
  await request.post("/api/cases/TEST-editable/approve", {
    data: { versionId: original.caseFileVersions.at(-1).id, snapshotFingerprint: original.snapshotFingerprint },
    headers: { Authorization: "Bearer local-e2e-only" },
  });
  await page.goto("/cases/TEST-editable/approve");
  await expect(
    page.getByRole("heading", { name: "Version approved" }),
  ).toBeVisible();
  await page
    .getByLabel("Sent to PayPal and visible to the buyer", { exact: true })
    .fill(
      "Sandbox demo seller note. Please review the recorded shipment evidence.",
    );
  await page.getByRole("button", { name: "Save new version" }).click();
  await page
    .getByLabel("Operator code", { exact: true })
    .fill("local-e2e-only");
  await page.getByRole("button", { name: "Unlock this session" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Approval cleared" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Approval required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send approved response" }),
  ).toBeDisabled();
  const current = await (await request.get("/api/cases/TEST-editable")).json();
  expect(current.caseFileVersions.length).toBe(
    original.caseFileVersions.length + 1,
  );
});
test("public pages and APIs contain no private buyer fields or secrets", async ({
  page,
  request,
}) => {
  await page.goto("/cases/TEST-editable");
  await page.getByText("Read trace and raw dispute facts").click();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(
    /PRIVATE_BUYER_SENTINEL|private-buyer@|PAYPAL_CLIENT_SECRET|OPENROUTER_API_KEY|local-e2e-only/,
  );
  const raw = await (await request.get("/api/cases/TEST-editable")).text();
  expect(raw).not.toMatch(
    /PRIVATE_BUYER_SENTINEL|private-buyer@|pdfBase64|PAYPAL_CLIENT_SECRET/,
  );
});
test("screenshots at desktop and mobile cover screens and key states", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await mkdir("data/ui-shots", { recursive: true });
  const routes: Record<string, string> = {
    queue: "/",
    fight: "/cases/REPLAY-strong-delivery",
    refund: "/cases/REPLAY-weak-delivery",
    offer: "/cases/REPLAY-low-value",
    injection: "/cases/REPLAY-injection",
    waiting: "/cases/TEST-waiting",
    resolved: "/cases/PP-R-ZAT-10196609",
    approval: "/cases/REPLAY-strong-delivery/approve",
    "approval-offer": "/cases/REPLAY-low-value/approve",
    "approval-refund": "/cases/REPLAY-weak-delivery/approve",
    rejected: "/cases/TEST-rejected/approve",
    failed: "/cases/TEST-failed",
    running: "/cases/TEST-running",
    unknown: "/cases/TEST-unknown/approve",
    method: "/how-it-works",
    missing: "/cases/not-a-case",
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path] of Object.entries(routes)) {
      await page.goto(path);
      if (name !== "method" && name !== "missing")
        await expect(
          page.locator(name === "queue" ? ".ag-root" : ".file-labels"),
        ).toBeVisible();
      if (name === "missing")
        await expect(
          page.getByRole("heading", { name: "Case unavailable" }),
        ).toBeVisible();
      await page.screenshot({
        path: `data/ui-shots/${name}-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (name === "fight") {
        await page
          .getByRole("article")
          .filter({ hasText: "The carrier records show the parcel as delivered, the delivery was signed for, and the shipping address matches the order." })
          .getByRole("button", {
            name: "Open source: Shipment record",
            exact: true,
          })
          .click();
        await page.screenshot({
          path: `data/ui-shots/citation-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.goto("/cases/TEST-editable/approve");
    await page
      .getByRole("button", { name: /Approve this version|Approve again/ })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/operator-${width}.png`,
      fullPage: true,
    });
    await page.goto("/");
    await page.route("**/api/cases", (route) =>
      route.fulfill({ json: { cases: [] } }),
    );
    await page.reload();
    await expect(page.getByText("No cases on the desk.")).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/empty-${width}.png`,
      fullPage: true,
    });
    await page.unroute("**/api/cases");
    await page.route("**/api/cases", (route) =>
      route.fulfill({ status: 503, json: { error: "Unavailable" } }),
    );
    await page.reload();
    await expect(page.getByText("We couldn’t open the queue")).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/api-error-${width}.png`,
      fullPage: true,
    });
    await page.unroute("**/api/cases");
    // Network-driven states use explicit synthetic response fixtures, never a provider call.
    const base = await (await request.get("/api/cases/TEST-editable")).json();
    for (const status of ["submitting", "submitted", "failed"] as const) {
      const state = structuredClone(base);
      state.attempts = [
        {
          id: "test-attempt",
          disputeId: "TEST-editable",
          versionId: state.caseFileVersions.at(-1).id,
          approvalId: "test-approval",
          stage: state.dispute.dispute_life_cycle_stage,
          action: "provide-evidence",
          contentHash: "fixture",
          status,
          startedAt: "2026-11-06T00:00:00Z",
        },
      ];
      await page.route("**/api/cases/TEST-editable", (route) =>
        route.fulfill({ json: state }),
      );
      await page.goto("/cases/TEST-editable/approve");
      await expect(page.locator(".file-labels")).toBeVisible();
      await page.screenshot({
        path: `data/ui-shots/send-${status}-${width}.png`,
        fullPage: true,
      });
      await page.unroute("**/api/cases/TEST-editable");
    }
    const failed = await (await request.get("/api/cases/TEST-failed")).json();
    failed.runs.at(-1).failureCode = "budget";
    await page.route("**/api/cases/TEST-failed", (route) =>
      route.fulfill({ json: failed }),
    );
    await page.goto("/cases/TEST-failed");
    await expect(
      page.getByRole("heading", { name: "Spending cap reached" }),
    ).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/spending-cap-${width}.png`,
      fullPage: true,
    });
    await page.unroute("**/api/cases/TEST-failed");
    await page.route("**/api/cases/TEST-editable/investigate", (route) =>
      route.fulfill({
        status: 429,
        json: { error: "Investigation rate limit reached" },
      }),
    );
    await page.goto("/cases/TEST-editable");
    await page
      .getByRole("button", { name: "Investigate case", exact: true })
      .click();
    await page
      .getByLabel("Operator code", { exact: true })
      .fill("local-e2e-only");
    await page.getByRole("button", { name: "Unlock this session" }).click();
    await expect(page.getByRole("alert", { name: "Case action needs attention" })).toContainText("Investigation paused");
    await page.screenshot({
      path: `data/ui-shots/rate-limited-${width}.png`,
      fullPage: true,
    });
    await page.unroute("**/api/cases/TEST-editable/investigate");
    await page.evaluate(() => sessionStorage.clear());
    const current = await (
      await request.get("/api/cases/TEST-editable")
    ).json();
    await request.post("/api/cases/TEST-editable/approve", {
      headers: { Authorization: "Bearer local-e2e-only" },
      data: { versionId: current.caseFileVersions.at(-1).id, snapshotFingerprint: current.snapshotFingerprint },
    });
    await page.goto("/cases/TEST-editable/approve");
    await expect(page.getByTitle("Approved evidence PDF")).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/approved-pdf-${width}.png`,
      fullPage: true,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/cases", async (route) => {
      await gate;
      await route.fulfill({ json: { cases: [] } });
    });
    await page.goto("/");
    await expect(page.getByLabel("Loading case queue")).toBeVisible();
    await page.screenshot({
      path: `data/ui-shots/loading-${width}.png`,
      fullPage: true,
    });
    release();
    await page.unroute("**/api/cases");
  }
});

test("a successful save with a failed refresh locks the stale review", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/cases/TEST-editable")).json();
  await request.post("/api/cases/TEST-editable/approve", {
    headers: { Authorization: "Bearer local-e2e-only" },
    data: { versionId: before.caseFileVersions.at(-1).id, snapshotFingerprint: before.snapshotFingerprint },
  });
  await page.goto("/cases/TEST-editable/approve");
  await expect(
    page.getByRole("heading", { name: "Version approved" }),
  ).toBeVisible();
  await page
    .getByLabel("Sent to PayPal and visible to the buyer", { exact: true })
    .fill(
      before.caseFileVersions.at(-1).caseFile.evidence_draft.seller_note +
        " Review the refreshed file.",
    );
  let fail = true;
  await page.route("**/api/cases/TEST-editable", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: "Saved case refresh unavailable" },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await page
    .getByLabel("Operator code", { exact: true })
    .fill("local-e2e-only");
  await page.getByRole("button", { name: "Unlock this session" }).click();
  await expect(page.getByRole("status")).toContainText("Controls are locked");
  await expect(
    page.getByRole("button", { name: "Send approved response" }),
  ).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Refresh saved facts" }).click();
  await expect(
    page.getByRole("heading", { name: "Approval required" }),
  ).toBeVisible();
});
test("a new PayPal stage requires fresh approval and permits a fresh response", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/cases/TEST-editable")).json();
  state.dispute.dispute_life_cycle_stage = "CHARGEBACK";
  state.case.stage = "CHARGEBACK";
  state.attempts = [
    {
      id: "old",
      disputeId: "TEST-editable",
      versionId: state.caseFileVersions.at(-1).id,
      approvalId: "old",
      stage: "INQUIRY",
      action: "provide-evidence",
      contentHash: "fixture",
      status: "submitted",
      startedAt: "2026-11-06T00:00:00Z",
    },
  ];
  await page.route("**/api/cases/TEST-editable", (route) =>
    route.fulfill({ json: state }),
  );
  await page.goto("/cases/TEST-editable/approve");
  await expect(
    page.getByRole("button", { name: "Approve this version" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Send approved response" }),
  ).toBeDisabled();
});

test("stale edit shows the first edit and preserves the seller draft", async ({ page, request }) => {
  const before = await (await request.get('/api/cases/TEST-editable')).json();
  await page.goto('/cases/TEST-editable/approve');
  const note = page.getByLabel('Sent to PayPal and visible to the buyer', { exact: true });
  const draft = 'Sandbox demo seller note. Keep this unsaved seller draft.';
  await note.fill(draft);
  const first = structuredClone(before.caseFileVersions.at(-1).caseFile);
  first.evidence_draft.seller_note = 'Sandbox demo seller note. Another edit came first.';
  const saved = await request.put('/api/cases/TEST-editable/case-file', {
    headers: { Authorization: 'Bearer local-e2e-only' },
    data: { caseFile: first, baseVersionId: before.caseFileVersions.at(-1).id },
  });
  expect(saved.status()).toBe(200);
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByRole('dialog', { name: 'Operator access', exact: true })).toBeVisible();
  await page.getByLabel('Operator code', { exact: true }).fill('local-e2e-only');
  await page.getByRole('button', { name: 'Unlock this session' }).click();
  await expect(page.getByRole('alert', { name: 'Case action needs attention', exact: true })).toContainText('Another edit came first');
  await expect(note).toHaveValue(draft);
  await expect(page.locator('.version-label')).toContainText(`Version ${before.caseFileVersions.length + 1}`);
  await expect(page.getByRole('button', { name: 'Approve this version' })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh saved facts' }).click();
  await expect(note).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Approve this version' })).toBeDisabled();
});

test("approval sends the reviewed fingerprint and shows new state on conflict", async ({ page, request }) => {
  const reviewed = await (await request.get('/api/cases/TEST-editable')).json();
  const changed = structuredClone(reviewed);
  changed.snapshotFingerprint = 'f'.repeat(64);
  changed.case.stage = 'CHARGEBACK';
  changed.dispute.dispute_life_cycle_stage = 'CHARGEBACK';
  changed.approvals = [];
  await page.route('**/api/cases/TEST-editable', route => route.fulfill({ json: reviewed }));
  await page.route('**/api/cases/TEST-editable/approve', async route => {
    expect(route.request().postDataJSON()).toEqual({
      versionId: reviewed.caseFileVersions.at(-1).id,
      snapshotFingerprint: reviewed.snapshotFingerprint,
    });
    await route.fulfill({ status: 409, json: {
      error: 'Case state changed. Review the updated state and approve again.', case: changed,
    } });
  });
  await page.goto('/cases/TEST-editable/approve');
  await page.getByRole('button', { name: /Approve (this version|again)/ }).click();
  await page.getByLabel('Operator code', { exact: true }).fill('local-e2e-only');
  await page.getByRole('button', { name: 'Unlock this session' }).click();
  await expect(page.getByRole('alert', { name: 'Case action needs attention', exact: true })).toContainText('Review the updated state and approve again');
  await expect(page.locator('.case-nav')).toContainText('chargeback');
  await expect(page.getByRole('heading', { name: 'Approval required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send approved response' })).toBeDisabled();
});


test('synced sandbox cases show past advice, outcome and sent history without a response CTA', async ({ page, request }) => {
  const state = await (await request.get('/api/cases/REPLAY-strong-delivery')).json();
  const id = 'PP-R-CNR-10196701';
  state.case = { ...state.case, id, replay: false, status: 'RESOLVED', outcome: 'RESOLVED_SELLER_FAVOUR', stage: 'CHARGEBACK', nextActions: [], whoseTurn: 'none', deadline: null };
  state.dispute = { ...state.dispute, dispute_id: id, status: 'RESOLVED', dispute_life_cycle_stage: 'CHARGEBACK', dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' }, links: [] };
  state.attempts = [{ id: 'sent', status: 'submitted', action: 'provide-evidence', startedAt: '2026-11-05T01:00:00Z', endedAt: '2026-11-05T01:00:03Z', stage: 'CHARGEBACK' }];
  await page.route(`**/api/cases/${id}`, route => route.fulfill({ json: state }));
  await page.goto(`/cases/${id}`);
  await expect(page.locator('.sandbox')).toContainText('Real PayPal sandbox dispute. Demo seller records.');
  await expect(page.locator('.case-heading')).toContainText('Advice given');
  await expect(page.getByRole('heading', { name: 'Fight this.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Resolved in the seller's favour", exact: true })).toBeVisible();
  await expect(page.locator('.outcome')).toContainText('Sandbox settlement says nothing about real-world evidence quality or outcomes.');
  await expect(page.locator('.next-step')).toContainText('Case closed');
  await expect(page.locator('.next-step')).toContainText('Evidence response sent to PayPal on Nov 5, 2026, 01:00:03 UTC. No response is due.');
  await expect(page.getByRole('link', { name: 'Review response', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Investigate case', exact: true })).toBeDisabled();
  await page.goto(`/cases/${id}/approve`);
  await expect(page.getByRole('button', { name: /Approve this version|Approve again|Send approved response/ })).toHaveCount(0);
  await expect(page.locator('.next-step')).toContainText('No response is due.');
  state.caseFileVersions = [];
  state.attempts = [];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The case is closed.', exact: true })).toBeVisible();
  await expect(page.getByText('No response sent through Counterclaim is recorded. No response is due.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Continue by hand', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'All cases', exact: true }).click();
  await expect(page.locator('.sandbox')).toContainText('Demo seller data. Nothing here is a live customer dispute.');
  await page.goto('/cases/REPLAY-strong-delivery');
  await expect(page.locator('.sandbox')).toContainText('Demo seller data. Nothing here is a live customer dispute.');
});

test('an open case without actions has no response CTA and does not invent a submission', async ({ page, request }) => {
  const state = await (await request.get('/api/cases/REPLAY-strong-delivery')).json();
  state.case.nextActions = [];
  state.dispute.status = 'UNDER_REVIEW';
  state.attempts = [];
  await page.route('**/api/cases/REPLAY-strong-delivery', route => route.fulfill({ json: state }));
  await page.goto('/cases/REPLAY-strong-delivery');
  await expect(page.locator('.next-step')).toContainText('No response sent through Counterclaim is recorded. No response is due in the saved PayPal state.');
  await expect(page.getByRole('link', { name: 'Review response', exact: true })).toHaveCount(0);
});

test('queue defaults to open cases before resolved cases and shows searchable outcomes', async ({ page, request }) => {
  const base = (await (await request.get('/api/cases')).json()).cases[0];
  const cases = [
    { ...base, id: 'PP-closed', status: 'RESOLVED', outcome: 'RESOLVED_SELLER_FAVOUR', whoseTurn: 'none', deadline: null, nextActions: [] },
    { ...base, id: 'PP-open-no-deadline', status: 'UNDER_REVIEW', outcome: null, whoseTurn: 'paypal', deadline: null },
    { ...base, id: 'PP-open-due', status: 'WAITING_FOR_SELLER_RESPONSE', outcome: null, whoseTurn: 'seller', deadline: '2026-11-08T00:00:00Z' },
  ];
  await page.route('**/api/cases', route => route.fulfill({ json: { cases } }));
  await page.goto('/');
  await expect(page.getByText('Saved locally. Open cases first, then soonest deadline.', { exact: true })).toBeVisible();
  await expect(page.locator('.ag-row[row-index="0"] a')).toHaveAttribute('href', '/cases/PP-open-due');
  await expect(page.locator('.ag-row[row-index="1"] a')).toHaveAttribute('href', '/cases/PP-open-no-deadline');
  const closed = page.locator('.ag-row[row-index="2"]');
  await expect(closed.locator('[col-id="whoseTurn"]')).toContainText('Resolved');
  await expect(closed).toContainText("Resolved in the seller's favour");
  await page.getByRole('searchbox', { name: 'Find a case' }).fill("seller's favour");
  await expect(page.locator('.ag-row')).toHaveCount(1);
  await expect(page.locator('.ag-row a')).toHaveAttribute('href', '/cases/PP-closed');
});

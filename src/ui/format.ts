export function money(
  a: { value: string; currency_code: string } | null | undefined,
) {
  if (!a) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: a.currency_code,
  }).format(Number(a.value));
}
export function words(value: string | null | undefined) {
  return (value ?? "Not available")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}
export function date(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "No deadline provided";
}
export function sourceName(id: string) {
  if (id.startsWith("dispute.")) return `PayPal: ${words(id.slice(8))}`;
  return id.includes("tracking_event")
    ? "Carrier scan"
    : id.includes("customer_message")
      ? "Customer message"
      : id.includes("shipment")
        ? "Shipment record"
        : id.includes("cost")
          ? "Recorded costs"
          : id.includes("policy")
            ? "Store policy"
            : "Order record";
}

export function reason(value: string | null | undefined) {
  return value === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    ? "Item not received"
    : value
      ? words(value)
      : "Reason not provided";
}

export function sentence(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
export function paypalStatus(value: string) {
  return ({ WAITING_FOR_SELLER_RESPONSE: 'Waiting for your response', WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer’s response", UNDER_REVIEW: 'Under PayPal review', OPEN: 'Open', RESOLVED: 'Resolved' } as Record<string, string>)[value] ?? sentence(words(value));
}
export function fieldValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && !Number.isNaN(Date.parse(value))) return date(value);
  return String(value ?? '—');
}

export function fieldLabel(key: string) {
  return ({ value: 'Amount', amount: 'Order amount', signed: 'Signed receipt', address_matches: 'Address matches order', timestamp: 'Recorded on', item_cost: 'Item cost', shipping_cost: 'Shipping cost' } as Record<string,string>)[key] ?? sentence(words(key));
}

export function paypalOutcome(code: string | null | undefined): string {
  const labels: Record<string, string> = {
    RESOLVED_SELLER_FAVOUR: "Resolved in the seller's favour",
    RESOLVED_BUYER_FAVOUR: "Resolved in the buyer's favour",
    RESOLVED_WITH_PAYOUT: 'Resolved with a payout',
    CANCELED_BY_BUYER: 'Cancelled by the buyer',
    ACCEPTED: 'Claim accepted', DENIED: 'Claim denied',
    REFUNDED: 'Buyer refunded', CANCELED: 'Dispute cancelled', CANCELLED: 'Dispute cancelled',
    RESOLVED: 'Resolved', NONE: 'Resolved',
  };
  return !code ? 'Resolved' : labels[code] ?? `Resolved (${sentence(words(code))})`;
}

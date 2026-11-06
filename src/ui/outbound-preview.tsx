import type { OutboundPacket } from '../evidence/packet';

export function OutboundPreview({ packet }: { packet: OutboundPacket }) {
  return <section aria-label="Outbound PDF content">
    <h3>PDF content preview</h3>
    <strong>{packet.header}</strong>
    {packet.blocks.map((block, i) => block.heading
      ? <h4 key={i}>{block.text}</h4>
      : <pre key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.text}</pre>)}
    <details open={packet.excluded.length > 0}>
      <summary>Excluded from PDF ({packet.excluded.length})</summary>
      <p>These entries stay private to the seller.</p>
      {packet.excluded.map((item, i) => <article key={i}>
        <strong>{item.path}</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</pre>
        <ul>{item.reasons.map((reason, j) => <li key={j}>{reason}</li>)}</ul>
      </article>)}
    </details>
  </section>;
}

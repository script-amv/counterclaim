import Link from "next/link";
export default function HowItWorks() {
  return (
    <main id="main" className="workspace how">
      <p className="folio">A note on the method</p>
      <h1>
        Evidence first.
        <br />
        Your decision, always.
      </h1>
      <p className="how-lead">
        Counterclaim helps a small seller decide how to answer a PayPal dispute.
        It doesn’t promise a win.
      </p>
      <div className="method">
        <section>
          <span className="method-index">01</span>
          <div>
            <h2>Read the record.</h2>
            <p>
              The agent reads the dispute and available seller records. It
              builds claims with citations and lists missing proof. The advice
              may be to fight, offer a settlement, or accept the claim.
            </p>
          </div>
        </section>
        <section>
          <span className="method-index">02</span>
          <div>
            <h2>Check the case.</h2>
            <p>
              Code checks citations, typed delivery facts, figures, privacy,
              attachments and repeated instructions. It computes gaps and money
              outcomes from records. These checks cannot establish that a source
              is truthful.
            </p>
          </div>
        </section>
        <section>
          <span className="method-index">03</span>
          <div>
            <h2>Make it your response.</h2>
            <p>
              Review and edit the note and claims. Each saved edit creates a
              version and clears approval. Approval binds the response and PDF
              bytes. Inspect the PDF, then choose to send. The server checks
              PayPal’s actions again before dispatch.
            </p>
          </div>
        </section>
      </div>
      <div className="how-columns">
        <section>
          <h2>Limits are part of the file.</h2>
          <p>
            The model cannot send anything to PayPal. It has read tools only. It
            cannot verify a physical delivery, establish legal rights, predict a
            decision or invent missing proof.
          </p>
          <p>
            There is no verified Orders v2 lookup without a trusted order ID.
            That limitation stays visible as a gap.
          </p>
          <p>
            If sending ends without confirmation, the attempt is marked unknown.
            Sending stays locked. Check PayPal before retrying.
          </p>
        </section>
        <section id="demo">
          <h2>What you’re looking at.</h2>
          <p>
            <strong>SANDBOX / Demo seller data.</strong> Orders, shipments,
            costs and messages are synthetic. Offline replay case files are
            recorded model outputs. A fixture may be revalidated offline by the
            current guard.
          </p>
          <p>
            Read-only replays never call a provider. The recorded
            PP-R-ZAT-10196609 timeline uses sanitized reconstructed snapshots.
            Its sandbox seller-favour settlement says nothing about real-world
            outcomes.
          </p>
          <p>
            Non-replay cases can use the real PayPal sandbox and model only when
            an operator explicitly runs those actions. Visitors can browse
            without a code; writes need operator access because sandbox cases
            are limited.
          </p>
        </section>
      </div>
      <div className="how-end">
        <p>
          A source you can inspect.
          <br />A gap you can see.
          <br />A response you control.
        </p>
        <Link className="primary" href="/">
          Open the case queue
        </Link>
      </div>
      <p className="font-credit">
        Typography: Fraunces and DM Sans, bundled locally under the SIL Open
        Font License.
      </p>
    </main>
  );
}

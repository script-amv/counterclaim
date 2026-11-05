import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="workspace">
      <h1>That file isn’t on the desk.</h1>
      <p>Return to the queue to find a saved case.</p>
      <Link className="primary" href="/">
        Open case queue
      </Link>
    </main>
  );
}

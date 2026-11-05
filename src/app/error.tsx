"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="workspace">
      <div className="notice danger" role="alert">
        <h1>The case desk couldn’t open.</h1>
        <p>
          Your saved case files are still on record. Try opening the workspace
          again.
        </p>
        <button onClick={reset}>Try again</button>
      </div>
    </main>
  );
}

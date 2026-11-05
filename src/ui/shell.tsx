"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
const Operator = createContext<{
  execute: (work: (code: string) => void) => void;
}>({ execute: () => {} });
export const useOperator = () => useContext(Operator);
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<((code: string) => void) | null>(null);
  const [code, setCode] = useState("");
  const [operator, setOperator] = useState(false);
  function execute(work: (code: string) => void) {
    const saved = sessionStorage.getItem("counterclaim-operator");
    if (saved) {
      work(saved);
      return;
    }
    pending.current = work;
    dialog.current?.showModal();
  }
  return (
    <Operator.Provider value={{ execute }}>
      <a className="skip" href="#main">
        Skip to case workspace
      </a>
      <header className="masthead">
        <Link href="/" className="wordmark">
          Counterclaim
          <span className="wordmark-rule" aria-hidden="true" />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            Case queue
          </Link>
          <Link
            href="/how-it-works"
            aria-current={path === "/how-it-works" ? "page" : undefined}
          >
            How it works
          </Link>
        </nav>
        <button
          className="access"
          onClick={() => {
            if (sessionStorage.getItem("counterclaim-operator")) {
              sessionStorage.removeItem("counterclaim-operator");
              setOperator(false);
            } else execute(() => setOperator(true));
          }}
        >
          {operator ? "Lock session" : "Operator access"}
        </button>
      </header>
      <div className="sandbox">
        <span className="sandbox-label">SANDBOX</span>
        <span>Demo seller data. Nothing here is a live customer dispute.</span>
        <Link href="/how-it-works#demo">About this demo</Link>
      </div>
      {children}
      <footer className="footer">
        <span>Counterclaim / A sourced case. A considered response.</span>
        <span>SANDBOX / Demo seller data</span>
      </footer>
      <dialog
        ref={dialog}
        className="operator-dialog"
        aria-labelledby="operator-dialog-title"
        onClose={() => {
          pending.current = null;
          setCode("");
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim()) return;
            sessionStorage.setItem("counterclaim-operator", code);
            setOperator(true);
            const work = pending.current;
            dialog.current?.close();
            work?.(code);
          }}
        >
          <div className="section-head">
            <h2 id="operator-dialog-title">Operator access</h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Close operator access"
            >
              Close
            </button>
          </div>
          <p>
            Sandbox cases are limited. Everyone can browse; only the operator
            can edit, investigate or send.
          </p>
          <label htmlFor="operator-code">Operator code</label>
          <input
            autoFocus
            id="operator-code"
            type="password"
            autoComplete="off"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="muted">
            Kept for this browser session only. The server checks the code on
            every write.
          </p>
          <button className="primary" type="submit">
            Unlock this session
          </button>
        </form>
      </dialog>
    </Operator.Provider>
  );
}

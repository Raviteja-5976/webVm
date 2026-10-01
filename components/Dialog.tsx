"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  labelledBy = "modal-title",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the focus effect: callers often pass a
  // new function on every render (e.g. when an editor becomes dirty).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Mount only: take focus, close on Escape, restore focus on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full flex-col rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/60 outline-none ${
          wide ? "max-w-4xl" : "max-w-md"
        }`}
      >
        <div id={labelledBy} className="border-b border-line px-4 py-3 text-sm font-semibold">
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  label,
  initial = "",
  confirmLabel = "OK",
  validate,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the name without its extension, like desktop file managers.
    const dot = initial.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const submit = async () => {
    const problem = validate?.(value) ?? null;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          {label}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            className="rounded-md border border-line-strong bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
          />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="text-muted">{message}</div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            autoFocus
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
};

export function Button({ variant = "default", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = { sm: "h-7 px-2 text-xs", md: "h-8 px-3 text-sm" };
  const variants = {
    default: "border border-line-strong bg-raised text-text hover:border-muted/60 hover:bg-line",
    primary: "bg-accent text-bg hover:bg-accent/85",
    danger: "bg-danger text-bg hover:bg-danger/85",
    ghost: "text-muted hover:bg-raised hover:text-text",
  };
  return <button type={type} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}

export function IconButton({
  label,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

import { Fragment } from "react";

/** Renders `inline code` and **bold** in lesson text. Nothing else, on purpose. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`"))
          return (
            <code key={i} className="rounded bg-raised px-1 py-px font-mono text-[0.92em] text-accent">
              {part.slice(1, -1)}
            </code>
          );
        if (part.startsWith("**") && part.endsWith("**"))
          return (
            <strong key={i} className="font-semibold text-text">
              {part.slice(2, -2)}
            </strong>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

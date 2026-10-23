import React from "react";

export default function BrandMark({ className = "h-8 w-8" }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M24 3.5 41.5 12v15.5c0 9-7 15.2-17.5 17-10.5-1.8-17.5-8-17.5-17V12L24 3.5Z"
        className="fill-primary/15 stroke-primary"
        strokeWidth="2.2"
      />
      <path d="M15 17.5h11.5c3.6 0 6 2 6 5.2 0 3.3-2.4 5.3-6 5.3h-5.6V32H15V17.5Zm5.9 4.1v2.5h4.6c.9 0 1.5-.5 1.5-1.3 0-.8-.6-1.2-1.5-1.2h-4.6Z" className="fill-primary" />
      <path d="M30.5 29.5h3.6v3.6h-3.6z" className="fill-primary/70" />
    </svg>
  );
}
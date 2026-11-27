"use client";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, UtensilsCrossed } from "lucide-react";
import { databaseMeta } from "@/lib/database";
import { formatDate } from "@/lib/format";

/**
 * Chrome shared by every printable report: the screen-only action bar, the
 * page card, the Negrita lockup and the provenance footnote.
 *
 * The dish report and the plan report had each written all of this out, which
 * meant the brand block and the "how macros are calculated" note existed twice
 * and could disagree about what the app actually does.
 */
export default function ReportShell({
  backHref,
  backLabel,
  kind,
  dateIso,
  toolbar,
  footnote,
  children,
}: {
  backHref: string;
  backLabel: string;
  /** What kind of document this is, e.g. "Nutrition report". */
  kind: string;
  /** ISO timestamp shown under the document kind. */
  dateIso: string;
  /** Extra screen-only controls, placed before the print button. */
  toolbar?: ReactNode;
  /** Report-specific caveat appended to the shared provenance note. */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <div className="no-print sticky top-0 z-10 border-b border-cream-deep bg-cream/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link
            href={backHref}
            className="flex items-center gap-1.5 text-sm font-600 text-charcoal-soft hover:text-charcoal"
          >
            <ArrowLeft size={16} /> {backLabel}
          </Link>
          <div className="flex items-center gap-2">
            {toolbar}
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-xl bg-tomato px-4 py-2 text-sm font-700 text-cream hover:bg-tomato-dark"
            >
              <Printer size={16} /> Print / Save as PDF
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <article className="print-page rounded-xl2 border border-cream-deep bg-white p-6 shadow-card sm:p-8">
          <div className="flex items-center justify-between border-b border-cream-deep pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl2 bg-tomato text-cream">
                <UtensilsCrossed size={20} />
              </span>
              <div className="leading-tight">
                <div className="font-display text-lg font-700 text-charcoal">
                  Mamma Calories
                </div>
                <div className="text-[11px] font-600 uppercase tracking-[0.18em] text-tomato">
                  For Negrita
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-charcoal-soft">
              <div>{kind}</div>
              <div>{formatDate(dateIso)}</div>
            </div>
          </div>

          {children}

          <p className="mt-6 border-t border-cream-deep pt-4 text-[11px] leading-relaxed text-charcoal-soft">
            Macros are calculated from each ingredient&apos;s per-100&nbsp;g values
            as <span className="font-600">grams ÷ 100 × value per 100&nbsp;g</span>.
            Source: {databaseMeta.name} (v{databaseMeta.version}). {footnote}
          </p>
        </article>
      </main>
    </div>
  );
}

/** Full-page centred message, for loading and not-found states in a report. */
export function ReportMessage({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center text-charcoal-soft">{children}</div>
    </div>
  );
}

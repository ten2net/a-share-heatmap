import { Coffee, ExternalLink } from "lucide-react";
import supporters from "@/lib/data/supporters.json";
import { type HeatmapMessages } from "@/lib/i18n";

export function SupporterThanks({
  messages,
}: {
  messages: HeatmapMessages;
}) {
  return (
    <section className="border border-amber-600/25 bg-amber-500/5 p-3.5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center border border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <Coffee className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{messages.projectThanksTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {messages.projectThanksDescription}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {supporters.map((supporter) => (
          <li key={supporter.url ?? supporter.name} className="flex items-center py-3 text-sm font-medium">
            {supporter.url ? (
              <a
                href={supporter.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 underline decoration-border underline-offset-4 transition-colors hover:text-amber-700 focus-visible:outline-2 focus-visible:outline-offset-4 dark:hover:text-amber-400"
              >
                <span className="truncate">{supporter.name}</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            ) : (
              <span className="truncate">{supporter.name}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{messages.projectThanksNote}</p>
    </section>
  );
}

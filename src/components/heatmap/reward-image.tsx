"use client";

import { ImageIcon } from "lucide-react";
import { useCallback, useState } from "react";
import rewardCover from "../../../public/sponsor/reward-cover.jpg";
import { type HeatmapMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Static import gives every entry point the same content-hashed, cacheable URL. */
export function RewardImage({ messages }: { messages: HeatmapMessages }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    // Cached images may finish before React attaches the load handler.
    if (image?.complete) {
      setStatus(image.naturalWidth > 0 ? "loaded" : "error");
    }
  }, []);

  return (
    <span
      className="relative block w-full overflow-hidden bg-muted/50"
      style={{ aspectRatio: `${rewardCover.width} / ${rewardCover.height}` }}
      aria-busy={status === "loading"}
    >
      {status !== "loaded" && (
        <span
          role="status"
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-xs text-muted-foreground",
            status === "loading" && "motion-safe:animate-pulse"
          )}
        >
          <ImageIcon className="size-8 opacity-40" aria-hidden />
          {status === "loading" ? messages.projectSupportImageLoading : messages.projectSupportImageError}
        </span>
      )}
      <img
        ref={imageRef}
        src={rewardCover.src}
        width={rewardCover.width}
        height={rewardCover.height}
        alt={messages.projectSupportTitle}
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn("block h-auto w-full", status !== "loaded" && "opacity-0")}
      />
    </span>
  );
}

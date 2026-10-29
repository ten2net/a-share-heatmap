"use client";

import { Coffee, ZoomIn } from "lucide-react";
import { type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type HeatmapMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RewardImage } from "./reward-image";
import { useHoverCapable } from "./stream";

/** 赞赏码浮层里的内容：完整封面（不裁切）+ 扫码提示。 */
export function RewardPanel({
  messages,
  onImageClick,
}: {
  messages: HeatmapMessages;
  onImageClick?: () => void;
}) {
  const image = <RewardImage messages={messages} />;

  return (
    <>
      {onImageClick ? (
        <button
          type="button"
          onClick={onImageClick}
          onPointerDown={(event) => {
            // Keep the tooltip trigger focused until the image click is delivered.
            if (event.pointerType === "mouse") event.preventDefault();
          }}
          aria-label={messages.projectSupportZoomHint}
          className="block w-full cursor-zoom-in border border-border transition-colors hover:border-brand/60"
        >
          {image}
        </button>
      ) : (
        <div className="border border-border">{image}</div>
      )}
      <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        {messages.projectSupportScanHint}
      </p>
      {onImageClick && (
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
          <ZoomIn className="size-3 shrink-0" />
          {messages.projectSupportZoomHint}
        </p>
      )}
    </>
  );
}

/**
 * 页面顶栏/底栏的小触发点：鼠标悬停（或键盘聚焦）时用 Tooltip 浮出赞赏码。
 * 默认渲染一个咖啡图标，也可以传 children 换成别的（例如侧边栏的 logo）。
 * 触屏设备没有 hover，点击直接进设置抽屉里的完整版。
 */
export function RewardTipTrigger({
  messages,
  onOpen,
  width = 256,
  side = "right",
  className,
  children,
}: {
  messages: HeatmapMessages;
  onOpen: () => void;
  width?: number;
  side?: "right" | "left" | "top" | "bottom";
  className?: string;
  children?: ReactNode;
}) {
  const hoverCapable = useHoverCapable();
  const trigger = (
    <button
      type="button"
      onClick={onOpen}
      aria-label={messages.projectSupportTitle}
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-transparent transition-colors focus-visible:text-brand",
        className
      )}
    >
      {children ?? <Coffee className="size-3.5 opacity-80" />}
    </button>
  );

  // hover 能力未解析（null）时按“无 hover”渲染，与服务端 HTML 保持一致。
  if (hoverCapable !== true) {
    return trigger;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          side={side}
          collisionPadding={16}
          className="overflow-y-auto p-3"
          style={{
            width: `min(${width}px, calc(100vw - 32px), calc(100dvh - 96px))`,
            maxHeight: "var(--radix-tooltip-content-available-height)",
          }}
        >
          <RewardPanel messages={messages} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

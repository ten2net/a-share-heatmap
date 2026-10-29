"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * 基于 Radix Tooltip 的通用浮层。定位、翻转、边界收拢、portal、键盘与
 * aria-describedby 都由 Radix 处理，业务侧只写内容。
 *
 * 默认 delayDuration 为 0：桌面端悬停即出，不额外等待。
 */
export function TooltipProvider({
  delayDuration = 0,
  skipDelayDuration = 0,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

export function Tooltip({ ...props }: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

export function TooltipTrigger({ ...props }: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 10,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-[60] border border-border bg-card text-card-foreground shadow-[0_18px_48px_rgba(0,0,0,0.45)]",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

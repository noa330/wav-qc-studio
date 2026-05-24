import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChevronGlyph({ direction = "down", className }: { direction?: "down" | "up" | "right"; className?: string }) {
  const Icon = direction === "up" ? ChevronUp : direction === "right" ? ChevronRight : ChevronDown;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0 text-[var(--control-arrow)]", className)} strokeWidth={1.9} />;
}

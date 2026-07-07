"use client"

import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

export function Stars({
  value,
  size = 14,
  className,
  showValue = false,
}: {
  value: number
  size?: number
  className?: string
  showValue?: boolean
}) {
  const full = Math.floor(value)
  const half = value - full >= 0.5
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const filled = i < full
        const isHalf = i === full && half
        return (
          <Star
            key={i}
            size={size}
            className={
              filled || isHalf
                ? "fill-amber-400 text-amber-400"
                : "fill-zinc-200 text-zinc-200"
            }
            style={isHalf ? { clipPath: "inset(0 50% 0 0)" } : undefined}
          />
        )
      })}
      {showValue && (
        <span className="ml-1 text-xs font-medium text-muted-foreground">
          {value.toFixed(1)}
        </span>
      )}
    </div>
  )
}

"use client"

const THEMES: Record<string, { from: string; to: string; emoji: string }> = {
  stars: { from: "#f59e0b", to: "#b45309", emoji: "⭐" },
  premium: { from: "#7c3aed", to: "#4c1d95", emoji: "👑" },
  account: { from: "#0ea5e9", to: "#1e3a8a", emoji: "👤" },
  number: { from: "#10b981", to: "#065f46", emoji: "📱" },
  gift: { from: "#ec4899", to: "#9d174d", emoji: "🎁" },
  bundle: { from: "#6366f1", to: "#312e81", emoji: "📦" },
  default: { from: "#475569", to: "#1e293b", emoji: "🛒" },
}

export function ProductCover({
  image,
  title,
  className,
}: {
  image?: string
  title: string
  className?: string
}) {
  // Если image — это data: URL (загруженная аватарка) → показываем как <img>
  if (image && (image.startsWith("data:") || image.startsWith("http"))) {
    return (
      <div className={className} style={{ overflow: "hidden" }}>
        <img
          src={image}
          alt={title}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    )
  }

  // Иначе — SVG обложка с градиентом
  const theme = THEMES[image || "default"] || THEMES.default
  const gid = "g" + (title?.length || 0) + (image || "d")
  const rid = gid + "r"
  return (
    <div className={className} style={{ overflow: "hidden" }}>
      <svg
        viewBox="0 0 400 240"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={theme.from} />
            <stop offset="100%" stopColor={theme.to} />
          </linearGradient>
          <radialGradient id={rid} cx="0.3" cy="0.2" r="0.8">
            <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <rect width="400" height="240" fill={"url(#" + gid + ")"} />
        <rect width="400" height="240" fill={"url(#" + rid + ")"} />
        <circle cx="340" cy="40" r="60" fill="rgba(255,255,255,0.08)" />
        <circle cx="60" cy="200" r="80" fill="rgba(255,255,255,0.06)" />
        <text x="200" y="135" textAnchor="middle" fontSize="84" dominantBaseline="central">
          {theme.emoji}
        </text>
      </svg>
    </div>
  )
}

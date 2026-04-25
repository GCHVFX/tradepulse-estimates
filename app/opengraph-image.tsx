import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "#0D1B2E",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 60px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top-left: product name */}
        <div style={{ color: "#ffffff", fontSize: 28 }}>
          TradePulse Estimates
        </div>

        {/* Centre: headline + sub */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ color: "#ffffff", fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>
            Professional quotes in seconds.
          </div>
          <div style={{ color: "#f59e0b", fontSize: 24 }}>
            Built for Canadian contractors. $39/month.
          </div>
        </div>

        {/* Bottom-right: URL */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 20 }}>
            trytradepulse.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

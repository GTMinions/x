/**
 * ShippedWishes — the build loop's record of shipped work, shown at the top of a
 * product's wishlist as done wishes. Every iteration is filed as a wish first,
 * then built, so this is the durable record of what the loop delivered.
 */
import { Check } from "lucide-react";
import { T } from "@/app/_platform/copy";

export type Shipped = { date: string; title: string; body: string };

export function ShippedWishes({ shipped }: { shipped: Shipped[] }) {
  if (!shipped.length) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Check size={18} style={{ color: "var(--status-ok)" }} />
        <h2 style={{ margin: 0 }}><T id="site.platform.shippedwishes.h2-1" /></h2>
        <span className="pill ok"><T id="site.platform.shippedwishes.span-1" v={{ shipped: shipped.length }} /></span>
        <span className="muted" style={{ fontSize: 13 }}><T id="site.platform.shippedwishes.span-2" /></span>
      </div>
      <div className="grid">
        {shipped.map((s, i) => (
          <div key={i} className="card" style={{ display: "flex", gap: 12, alignItems: "start" }}>
            <span className="pill ok" style={{ flexShrink: 0 }}><T id="site.platform.shippedwishes.span-3" c={[<Check size={11} />]} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{s.title}</strong>
                <span className="mono muted" style={{ fontSize: 11 }}>{s.date}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

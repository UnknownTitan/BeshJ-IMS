// Small single-series charts used on the dashboard.
// Design rules (dataviz guidelines): one hue for a single series, no legend
// (the card title names it), bars <= 24px with 4px rounded data ends, hairline
// recessive gridlines, values in text colours, hover tooltip on every mark.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const SERIES_1 = '#2a78d6';
const GRID = '#e8e8e6';
const TEXT_SECONDARY = '#52514e';

const shortCedi = (n: number) => (n >= 1000 ? `₵${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `₵${Math.round(n)}`);
const cedi = (n: number) => `GH₵\u00a0${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TipBox({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, padding: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
      <div style={{ color: TEXT_SECONDARY, fontSize: 12 }}>{title}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/** Revenue per day: line with a light area, crosshair tooltip. */
export function DailySalesChart({ data }: { data: { day: string; revenue: number }[] }) {
  const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis dataKey="day" tickFormatter={label} tick={{ fill: TEXT_SECONDARY, fontSize: 12 }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickFormatter={shortCedi} tick={{ fill: TEXT_SECONDARY, fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          cursor={{ stroke: TEXT_SECONDARY, strokeWidth: 1 }}
          content={({ active, payload }) =>
            active && payload?.length ? <TipBox title={label(payload[0].payload.day)} value={cedi(payload[0].payload.revenue)} /> : null
          }
        />
        <Area isAnimationActive={false} type="linear" dataKey="revenue" stroke={SERIES_1} strokeWidth={2} fill={SERIES_1} fillOpacity={0.12} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars (top products, stock by category). */
export function RankedBarChart({ data, labelKey, valueKey }: { data: any[]; labelKey: string; valueKey: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 40 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 0 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
        <XAxis type="number" tickFormatter={shortCedi} tick={{ fill: TEXT_SECONDARY, fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={170}
          tick={{ fill: TEXT_SECONDARY, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s)}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          content={({ active, payload }) => (active && payload?.length ? <TipBox title={payload[0].payload[labelKey]} value={cedi(payload[0].payload[valueKey])} /> : null)}
        />
        <Bar
          isAnimationActive={false}
          dataKey={valueKey}
          fill={SERIES_1}
          maxBarSize={24}
          radius={[0, 4, 4, 0]}
          label={{ position: 'right', formatter: shortCedi, fill: TEXT_SECONDARY, fontSize: 12 }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

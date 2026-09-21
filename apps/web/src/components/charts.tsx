import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { fmtMoney } from '@/lib/format';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export function SpendBarChart({
  data,
  xKey,
  yKey,
  xFormatter,
  name,
  color = 'var(--chart-1)',
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  xFormatter?: (v: string) => string;
  name: string;
  color?: string;
}) {
  const config = { [yKey]: { label: name, color } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v: string) => (xFormatter ? xFormatter(v) : v)} />
        <YAxis tickLine={false} axisLine={false} tickMargin={4} width={60} tickFormatter={(v: number) => fmtMoney(v)} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel={false} labelFormatter={(l) => (xFormatter ? xFormatter(String(l)) : String(l))} formatter={(v) => <span className="text-foreground ml-auto font-mono font-medium tabular-nums">{fmtMoney(Number(v), { precise: true })}</span>} />}
        />
        <Bar dataKey={yKey} fill={`var(--color-${yKey})`} radius={4} maxBarSize={32} />
      </BarChart>
    </ChartContainer>
  );
}

export function BarList({ items, max }: { items: { label: string; value: number; sub?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it) => (
        <li key={it.label} className="text-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate font-medium">{it.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {fmtMoney(it.value, { precise: true })}
              {it.sub ? <span className="ml-2 text-xs">{it.sub}</span> : null}
            </span>
          </div>
          <div className="bg-primary/20 h-2 w-full overflow-hidden rounded-full">
            <div className="bg-chart-2 h-full rounded-full" style={{ width: `${Math.max(2, (it.value / top) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

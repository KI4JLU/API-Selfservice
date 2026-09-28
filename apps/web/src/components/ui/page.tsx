import * as React from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from './alert';

export function PageHeader({ title, subtitle, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between', className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-end gap-3', className)}>{children}</div>;
}

const icons = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck };

/** Inline status message built on the shadcn Alert. */
export function Banner({
  variant = 'info',
  title,
  children,
  className,
  testId,
}: {
  variant?: 'info' | 'warning' | 'danger' | 'success';
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const Icon = icons[variant];
  return (
    <Alert variant={variant === 'danger' ? 'destructive' : 'default'} className={className} data-testid={testId}>
      <Icon className={cn(variant === 'success' && 'text-success', variant === 'warning' && 'text-warning')} />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function DescriptionList({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]', className)}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="font-medium break-all">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

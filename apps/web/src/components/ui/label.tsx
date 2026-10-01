import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** Visual marker for required fields. Hidden from screen readers; the control itself carries `required`. */
function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive -ml-1.5">
      *
    </span>
  );
}

/** Label + control + optional hint, following the shadcn form field layout (grid gap-2). */
function Field({ label, hint, htmlFor, required, children, className }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
    </div>
  );
}

export { Label, Field, RequiredMark };

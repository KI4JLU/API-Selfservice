import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/lib/theme';

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          // Theme tokens from index.css (@theme), the shadcn default names (--popover, ...) do not exist here.
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

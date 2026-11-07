import * as React from 'react'
import * as SwitchP from '@radix-ui/react-switch'
import * as SliderP from '@radix-ui/react-slider'
import * as TooltipP from '@radix-ui/react-tooltip'
import * as SelectP from '@radix-ui/react-select'
import * as PopoverP from '@radix-ui/react-popover'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ---------------------------------------------------------------- Button */
const buttonV = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white shadow-[0_8px_24px_-10px_rgb(var(--brand)/0.9)] hover:brightness-110 active:brightness-95',
        onBrand: 'bg-white text-brand shadow-card hover:bg-white/90',
        secondary: 'bg-surface text-brand border border-brand/40 hover:border-brand hover:bg-brand/[0.05] dark:text-accent dark:border-accent/40',
        ghost: 'rounded-md font-medium text-muted hover:text-fg hover:bg-elevated',
        outline: 'border border-brand/50 text-brand hover:bg-brand/[0.06]',
        danger: 'text-bad hover:bg-bad/10',
      },
      size: { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3', lg: 'h-10 px-4 text-sm', icon: 'h-7 w-7 p-0', iconSm: 'h-6 w-6 p-0' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonV> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(buttonV({ variant, size }), className)} {...p} />
))
Button.displayName = 'Button'

/* ---------------------------------------------------------------- Switch */
export function Switch({ checked, onCheckedChange, className, size = 'md', ...rest }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; className?: string; size?: 'sm' | 'md'; 'aria-label'?: string; disabled?: boolean
}) {
  const s = size === 'sm'
  return (
    <SwitchP.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      onClick={(e) => e.stopPropagation()}
      className={cn('relative shrink-0 rounded-full border border-line bg-[rgb(var(--line))] transition-colors data-[state=checked]:bg-brand data-[state=checked]:border-brand disabled:cursor-not-allowed disabled:opacity-50',
        s ? 'h-4 w-7' : 'h-5 w-9', className)}
      {...rest}
    >
      <SwitchP.Thumb className={cn('block rounded-full bg-white shadow transition-transform will-change-transform',
        s ? 'h-3 w-3 translate-x-[1px] data-[state=checked]:translate-x-[13px]' : 'h-4 w-4 translate-x-[1px] data-[state=checked]:translate-x-[17px]')} />
    </SwitchP.Root>
  )
}

/* ---------------------------------------------------------------- Slider */
export function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <SliderP.Root className="relative flex h-4 w-full touch-none select-none items-center" value={[value]} min={min} max={max} step={step}
      onValueChange={(v) => onChange(v[0])}>
      <SliderP.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-line">
        <SliderP.Range className="absolute h-full bg-accent/80" />
      </SliderP.Track>
      <SliderP.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-surface shadow transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
    </SliderP.Root>
  )
}

/* ---------------------------------------------------------------- Tooltip */
export const TooltipProvider = TooltipP.Provider
export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>
  return (
    <TooltipP.Root delayDuration={250}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content side={side} sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-line bg-elevated px-2 py-1 text-[11.5px] leading-snug text-fg shadow-glow animate-in fade-in">
          {content}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  )
}

/* ---------------------------------------------------------------- Select */
export function Select({ value, onChange, options, className, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string; hint?: string }[]; className?: string; placeholder?: string
}) {
  return (
    <SelectP.Root value={value} onValueChange={onChange}>
      <SelectP.Trigger className={cn('inline-flex h-7 min-w-0 items-center justify-between gap-1 rounded-md border border-line bg-elevated px-2 text-xs text-fg hover:border-subtle/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50', className)}>
        <span className="truncate"><SelectP.Value placeholder={placeholder} /></span>
        <ChevronDown className="h-3 w-3 shrink-0 text-subtle" />
      </SelectP.Trigger>
      <SelectP.Portal>
        <SelectP.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-elevated shadow-glow">
          <SelectP.Viewport className="p-1">
            {options.map((o) => (
              <SelectP.Item key={o.value} value={o.value}
                className="relative flex cursor-pointer select-none flex-col rounded-md py-1.5 pl-6 pr-2 text-xs text-fg outline-none data-[highlighted]:bg-accent/15">
                <SelectP.ItemIndicator className="absolute left-1.5 top-2"><Check className="h-3 w-3 text-accent" /></SelectP.ItemIndicator>
                <SelectP.ItemText>{o.label}</SelectP.ItemText>
                {o.hint && <span className="mt-0.5 text-[11px] text-subtle">{o.hint}</span>}
              </SelectP.Item>
            ))}
          </SelectP.Viewport>
        </SelectP.Content>
      </SelectP.Portal>
    </SelectP.Root>
  )
}

/* ---------------------------------------------------------------- Segmented */
export function Segmented<T extends string | number>({ value, options, onChange, size = 'sm', className }: {
  value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'xs' | 'sm'; className?: string
}) {
  return (
    <div className={cn('inline-flex rounded-full border border-line bg-elevated p-0.5', className)}>
      {options.map((o) => (
        <button key={String(o.value)} title={o.title} onClick={() => onChange(o.value)}
          className={cn('relative rounded-full font-medium transition-colors', size === 'xs' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            value === o.value ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- Popover */
export const Popover = PopoverP.Root
export const PopoverTrigger = PopoverP.Trigger
export function PopoverContent({ className, children, align = 'end' }: { className?: string; children: React.ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <PopoverP.Portal>
      <PopoverP.Content align={align} sideOffset={6} className={cn('z-50 rounded-xl border border-line bg-elevated p-2 shadow-glow', className)}>
        {children}
      </PopoverP.Content>
    </PopoverP.Portal>
  )
}

/* ---------------------------------------------------------------- misc */
export function Badge({ className, children, tone = 'neutral', ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'good' | 'bad' | 'warn' | 'pane' }) {
  const tones = {
    neutral: 'bg-elevated text-muted border-line',
    accent: 'bg-accent/12 text-accent border-accent/30',
    good: 'bg-good/10 text-good border-good/30',
    bad: 'bg-bad/10 text-bad border-bad/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    pane: 'bg-pc-soft text-pc border-pc',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[10.5px] font-medium leading-4', tones[tone], className)} {...rest}>{children}</span>
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-elevated px-1 py-px font-mono text-[10px] text-muted">{children}</kbd>
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-elevated', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/[0.06] to-transparent" />
    </div>
  )
}

export function Empty({ icon, title, children, className }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 rounded-xl border border-line bg-elevated p-2.5 text-subtle">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs, className, right }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; className?: string; right?: React.ReactNode
}) {
  return (
    <div className={cn('flex items-center gap-0.5 border-b border-line', className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cn('relative flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold transition-colors',
            value === t.value ? 'text-brand dark:text-accent' : 'text-muted hover:text-fg')}>
          {t.icon}{t.label}
          {value === t.value && <span className="absolute inset-x-1.5 -bottom-px h-[3px] rounded-full bg-brand dark:bg-accent" />}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </div>
  )
}

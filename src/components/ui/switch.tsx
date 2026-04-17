import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

// Claude-styled switch: explicit warm tokens so it stays legible on the
// parchment canvas. Unchecked → warm sand track with ring border.
// Checked → terracotta track. Thumb is always ivory-white with a soft ring.
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[#c96442] data-[state=unchecked]:bg-[#d1cfc5]',
      'shadow-[inset_0_0_0_1px_rgba(20,20,19,0.08)]',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-[#faf9f5] ring-0 transition-transform',
        'shadow-[0_1px_3px_rgba(20,20,19,0.2),0_0_0_1px_rgba(20,20,19,0.08)]',
        'data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5'
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

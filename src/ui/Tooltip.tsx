import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

type TriggerProps = {
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
};

export type TooltipProps = {
  content: string;
  children: ReactElement<TriggerProps>;
};

/** Adds a description, never a replacement accessible name or native title. */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const disabled = children.props.disabled === true;
  const open = (hovered || focused) && !dismissed;
  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ');

  function cancelLeave() {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }

  function enter() {
    cancelLeave();
    setHovered(true);
  }

  function leave() {
    cancelLeave();
    // Allow the pointer to cross the small gap into the portalled text.
    leaveTimer.current = setTimeout(() => {
      setHovered(false);
      leaveTimer.current = null;
    }, 160);
  }

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!hovered && !focused) setDismissed(false);
  }, [hovered, focused]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDismissed(true);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    function place() {
      if (!wrapper.current || !bubble.current) return;
      const anchor = wrapper.current.getBoundingClientRect();
      if (anchor.width === 0 || anchor.height === 0) {
        setPosition(null);
        return;
      }
      const tip = bubble.current.getBoundingClientRect();
      const margin = 8;
      const gap = 8;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const above = anchor.top - tip.height - gap;
      const below = anchor.bottom + gap;
      const preferredTop = above >= margin || height - below < anchor.top ? above : below;
      let left = anchor.left + (anchor.width - tip.width) / 2;
      let top = preferredTop;
      // A focused form's explanation must not sit over its adjacent actions.
      // Place outside a floating menu when space permits, not inside its controls.
      const menu = wrapper.current.closest('.menu-body')?.getBoundingClientRect();
      if (menu) {
        if (menu.left - tip.width - gap >= margin) {
          left = menu.left - tip.width - gap;
          top = anchor.top;
        } else if (menu.right + gap + tip.width <= width - margin) {
          left = menu.right + gap;
          top = anchor.top;
        } else if (menu.bottom + gap + tip.height <= height - margin) {
          top = menu.bottom + gap;
        } else if (menu.top - gap - tip.height >= margin) {
          top = menu.top - gap - tip.height;
        }
      }
      const clamp = (left: number, top: number) => ({
        left: Math.max(margin, Math.min(left, width - tip.width - margin)),
        top: Math.max(margin, Math.min(top, height - tip.height - margin)),
      });
      const candidates = [
        clamp(left, top),
        clamp(anchor.left + (anchor.width - tip.width) / 2, below),
        clamp(anchor.left + (anchor.width - tip.width) / 2, above),
        clamp(anchor.right + gap, anchor.top),
        clamp(anchor.left - tip.width - gap, anchor.top),
      ];
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'button, input, select, summary, a, [role="tab"], [role="separator"]',
        ),
      ]
        .filter((element) => {
          // Closed details descendants can retain nonzero layout rectangles even
          // though they are not painted. Only their summary is an obstacle.
          const closed = element.closest('details:not([open])');
          return (
            (!closed || closed.querySelector(':scope > summary')?.contains(element)) &&
            getComputedStyle(element).visibility !== 'hidden'
          );
        })
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      // Clamping above a top bar can put every local candidate onto controls.
      // Reserve alternatives below whole bars, including the world toolbar, rather
      // than choosing the least-covered action. Hidden menus contribute no boxes.
      const bars = [
        ...document.querySelectorAll<HTMLElement>('header, nav, [role="toolbar"], .map-toolbar'),
      ]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      for (const bar of bars) {
        candidates.push(
          clamp(anchor.left + (anchor.width - tip.width) / 2, bar.bottom + gap),
          clamp((width - tip.width) / 2, bar.bottom + gap),
        );
      }
      // If a bar itself wraps, try below each occupied row as well. This handles
      // small viewports without covering the trigger or its neighboring actions.
      for (const box of controls) {
        candidates.push(
          clamp(anchor.left + (anchor.width - tip.width) / 2, box.bottom + gap),
          clamp((width - tip.width) / 2, box.bottom + gap),
        );
      }
      const safe = (candidate: { left: number; top: number }) =>
        controls.every(
          (box) =>
            candidate.left + tip.width <= box.left ||
            candidate.left >= box.right ||
            candidate.top + tip.height <= box.top ||
            candidate.top >= box.bottom,
        );
      const next = candidates.find(safe) ?? null;

      // No safe visible slot: keep the referenced description available to AT,
      // but never leave a pointer-persistent bubble over an actionable control.
      setPosition((previous) =>
        previous?.left === next?.left && previous?.top === next?.top ? previous : next,
      );
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (wrapper.current) observer.observe(wrapper.current);
    if (bubble.current) observer.observe(bubble.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [open, content]);

  return (
    <>
      <span
        ref={wrapper}
        className={`prosper-tooltip-trigger${disabled ? ' prosper-tooltip-trigger--disabled' : ''}`}
        tabIndex={disabled ? 0 : undefined}
        role={disabled ? 'group' : undefined}
        aria-label={disabled ? children.props['aria-label'] : undefined}
        aria-describedby={disabled ? describedBy : undefined}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {/* Only the description changes: refs, classes and all handlers remain intact. */}
        {cloneElement(children, { 'aria-describedby': describedBy })}
      </span>
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="prosper-tooltip"
            hidden={!open}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }}
            onPointerEnter={enter}
            onPointerLeave={leave}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

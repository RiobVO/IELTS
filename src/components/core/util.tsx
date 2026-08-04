import type * as React from "react";
import { useState } from "react";

/** Hover/focus/press для инлайн-стилизации через токены (псевдоклассы недоступны инлайн). */
export function useInteractive() {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(false);
  return {
    hover, focus, active,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => { setHover(false); setActive(false); },
      onFocus: () => setFocus(true),
      onBlur: () => setFocus(false),
      onMouseDown: () => setActive(true),
      onMouseUp: () => setActive(false),
    },
  };
}

/** Слить style-объекты, отбросив falsy. */
export function sx(...objs: Array<React.CSSProperties | false | null | undefined>): React.CSSProperties {
  return Object.assign({}, ...objs.filter(Boolean));
}

/** Брендовый focus-ring как inline boxShadow. Единый источник — токен --ring
 *  (двухслойный, ≥3:1); инлайн-стили ссылаются сюда, чтобы фокус совпадал с
 *  глобальным :focus-visible и не расходился по значению. */
export const RING = "var(--ring)";

import { useState } from "react";
import { Heart, Star, ThumbsUp } from "lucide-react";

export type RatingIcon = "star" | "heart" | "thumb";

type Props = {
  id?: string;
  value: string;
  onChange?: (value: string) => void;
  max?: number;
  icon?: RatingIcon;
  disabled?: boolean;
  name?: string;
};

/** Google Forms style rating (3–10 icons). Value is stored as the number as a string. */
export function StarRating({ id, value, onChange, max = 5, icon = "star", disabled, name }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.min(10, Math.max(3, Number(max) || 5));
  const current = Number(value) || 0;
  const Icon = icon === "heart" ? Heart : icon === "thumb" ? ThumbsUp : Star;
  return (
    <div className="sp-form-rating" role="radiogroup" id={id} aria-label="Rating">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const active = (hover ?? current) >= n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={`${n} of ${count}`}
            name={name}
            disabled={disabled}
            className={`sp-form-rating-btn${active ? " is-active" : ""}`}
            onMouseEnter={() => !disabled && setHover(n)}
            onMouseLeave={() => setHover(null)}
            onClick={() => !disabled && onChange?.(current === n ? "" : String(n))}
          >
            <Icon className="sp-form-rating-icon" fill={active ? "currentColor" : "none"} strokeWidth={1.75} />
          </button>
        );
      })}
      {current > 0 ? <span className="sp-form-rating-value">{current}/{count}</span> : null}
    </div>
  );
}

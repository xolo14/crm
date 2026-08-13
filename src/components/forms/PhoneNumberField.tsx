import { useEffect, useId, useRef, useState } from "react";
import {
  countryFlag,
  countryFlagUrl,
  findPhoneCountry,
  formatPhoneFieldValue,
  parsePhoneFieldValue,
  PHONE_COUNTRIES,
  type PhoneCountry,
} from "@/components/forms/phoneCountries";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Use public-form CSS classes (sp-form-*). */
  publicStyle?: boolean;
  className?: string;
};

function CountryFlagImg({ iso2, className }: { iso2: string; className?: string }) {
  const src = countryFlagUrl(iso2, 40);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className={className} aria-hidden="true">
        {countryFlag(iso2)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={20}
      height={15}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function PhoneNumberField({
  id,
  value,
  onChange,
  required,
  disabled,
  placeholder = "10-digit number",
  publicStyle = true,
  className,
}: Props) {
  const parsed = parsePhoneFieldValue(value);
  const [country, setCountry] = useState<PhoneCountry>(parsed.country);
  const national = parsed.national;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (value) setCountry(parsePhoneFieldValue(value).country);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const emit = (nextCountry: PhoneCountry, digits: string) => {
    setCountry(nextCountry);
    const cleaned = digits.replace(/\D/g, "").slice(0, 10);
    if (!cleaned) {
      onChange("");
      return;
    }
    onChange(formatPhoneFieldValue(nextCountry.dial, cleaned));
  };

  const pickCountry = (iso2: string) => {
    emit(findPhoneCountry(iso2), national);
    setOpen(false);
  };

  if (publicStyle) {
    return (
      <div ref={rootRef} className={`sp-form-phone${className ? ` ${className}` : ""}`}>
        <div className={`sp-form-phone-code-wrap${open ? " is-open" : ""}`}>
          <button
            type="button"
            className="sp-form-input sp-form-phone-code"
            aria-label={`Country code +${country.dial}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
          >
            <CountryFlagImg iso2={country.iso2} className="sp-form-phone-flag-img" />
            <span className="sp-form-phone-dial">+{country.dial}</span>
          </button>
          {open && (
            <ul id={listId} className="sp-form-phone-menu" role="listbox" aria-label="Country code">
              {PHONE_COUNTRIES.map((c) => (
                <li key={`${c.iso2}-${c.dial}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.iso2 === country.iso2}
                    className={`sp-form-phone-option${c.iso2 === country.iso2 ? " is-selected" : ""}`}
                    onClick={() => pickCountry(c.iso2)}
                  >
                    <CountryFlagImg iso2={c.iso2} className="sp-form-phone-flag-img" />
                    <span className="sp-form-phone-option-dial">+{c.dial}</span>
                    <span className="sp-form-phone-option-name">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          id={id}
          className="sp-form-input sp-form-phone-number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          pattern="[0-9]{10}"
          placeholder={placeholder}
          disabled={disabled}
          required={!!required}
          value={national}
          onChange={(e) => emit(country, e.target.value)}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`flex gap-2${className ? ` ${className}` : ""}`}>
      <div className="relative h-10 w-[8.5rem] shrink-0">
        <button
          type="button"
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
          aria-label={`Country code +${country.dial}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <CountryFlagImg iso2={country.iso2} className="h-[15px] w-5 rounded-[2px] object-cover shadow-sm" />
          <span className="font-medium tabular-nums">+{country.dial}</span>
        </button>
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Country code"
            className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-60 w-[16rem] overflow-auto rounded-md border border-input bg-background p-1 shadow-md"
          >
            {PHONE_COUNTRIES.map((c) => (
              <li key={`${c.iso2}-${c.dial}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={c.iso2 === country.iso2}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    c.iso2 === country.iso2 ? "bg-muted" : ""
                  }`}
                  onClick={() => pickCountry(c.iso2)}
                >
                  <CountryFlagImg iso2={c.iso2} className="h-[15px] w-5 shrink-0 rounded-[2px] object-cover shadow-sm" />
                  <span className="shrink-0 font-medium tabular-nums">+{c.dial}</span>
                  <span className="truncate text-muted-foreground">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        id={id}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        placeholder={placeholder}
        disabled={disabled}
        required={!!required}
        value={national}
        onChange={(e) => emit(country, e.target.value)}
      />
    </div>
  );
}

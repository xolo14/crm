/** Dial-code list for form Number (phone) fields. Flags via flagcdn images + emoji fallback. */

export type PhoneCountry = {
  iso2: string;
  name: string;
  /** Digits only, no + */
  dial: string;
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso2: "IN", name: "India", dial: "91" },
  { iso2: "US", name: "United States", dial: "1" },
  { iso2: "GB", name: "United Kingdom", dial: "44" },
  { iso2: "AE", name: "United Arab Emirates", dial: "971" },
  { iso2: "SA", name: "Saudi Arabia", dial: "966" },
  { iso2: "SG", name: "Singapore", dial: "65" },
  { iso2: "AU", name: "Australia", dial: "61" },
  { iso2: "CA", name: "Canada", dial: "1" },
  { iso2: "DE", name: "Germany", dial: "49" },
  { iso2: "FR", name: "France", dial: "33" },
  { iso2: "PK", name: "Pakistan", dial: "92" },
  { iso2: "BD", name: "Bangladesh", dial: "880" },
  { iso2: "LK", name: "Sri Lanka", dial: "94" },
  { iso2: "NP", name: "Nepal", dial: "977" },
  { iso2: "MY", name: "Malaysia", dial: "60" },
  { iso2: "PH", name: "Philippines", dial: "63" },
  { iso2: "ID", name: "Indonesia", dial: "62" },
  { iso2: "TH", name: "Thailand", dial: "66" },
  { iso2: "QA", name: "Qatar", dial: "974" },
  { iso2: "KW", name: "Kuwait", dial: "965" },
  { iso2: "OM", name: "Oman", dial: "968" },
  { iso2: "BH", name: "Bahrain", dial: "973" },
  { iso2: "NZ", name: "New Zealand", dial: "64" },
  { iso2: "IE", name: "Ireland", dial: "353" },
  { iso2: "NL", name: "Netherlands", dial: "31" },
  { iso2: "ZA", name: "South Africa", dial: "27" },
  { iso2: "NG", name: "Nigeria", dial: "234" },
  { iso2: "KE", name: "Kenya", dial: "254" },
  { iso2: "JP", name: "Japan", dial: "81" },
  { iso2: "KR", name: "South Korea", dial: "82" },
  { iso2: "CN", name: "China", dial: "86" },
  { iso2: "HK", name: "Hong Kong", dial: "852" },
  { iso2: "BR", name: "Brazil", dial: "55" },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];

export function countryFlag(iso2: string): string {
  const code = String(iso2 || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}

/** PNG flag image URL (flagcdn). Use lowercase ISO2. */
export function countryFlagUrl(iso2: string, width: 20 | 40 | 80 = 40): string {
  const code = String(iso2 || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return "";
  return `https://flagcdn.com/w${width}/${code}.png`;
}

export function findPhoneCountry(iso2OrDial: string): PhoneCountry {
  const raw = String(iso2OrDial || "").trim();
  const dial = raw.replace(/^\+/, "");
  return (
    PHONE_COUNTRIES.find((c) => c.iso2 === raw.toUpperCase()) ||
    PHONE_COUNTRIES.find((c) => c.dial === dial) ||
    DEFAULT_PHONE_COUNTRY
  );
}

/** Stored value: `+{dial}{10 digits}` e.g. +919876543210 */
export function parsePhoneFieldValue(value: string): { country: PhoneCountry; national: string } {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return { country: DEFAULT_PHONE_COUNTRY, national: "" };
  }
  // Prefer longest matching dial code, then last 10 as national when possible
  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (digits.startsWith(c.dial) && digits.length > c.dial.length) {
      return {
        country: c,
        national: digits.slice(c.dial.length).slice(0, 10),
      };
    }
  }
  if (digits.length <= 10) {
    return { country: DEFAULT_PHONE_COUNTRY, national: digits };
  }
  return {
    country: DEFAULT_PHONE_COUNTRY,
    national: digits.slice(-10),
  };
}

export function formatPhoneFieldValue(dial: string, national: string): string {
  const d = String(dial || "").replace(/\D/g, "");
  const n = String(national || "").replace(/\D/g, "").slice(0, 10);
  if (!n) return d ? `+${d}` : "";
  return `+${d}${n}`;
}

export function isCompletePhoneFieldValue(value: string): boolean {
  const { national } = parsePhoneFieldValue(value);
  return /^\d{10}$/.test(national);
}

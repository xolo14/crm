import type { CSSProperties, ReactNode } from "react";
import {
  descriptionToEditorHtml,
  looksLikeHtml,
  sanitizeFormDescriptionHtml,
} from "@/components/forms/formDescriptionHtml";
import {
  publicFormBrandToStyle,
  resolveFormCompanyName,
  type PublicFormBrand,
} from "@/components/forms/publicFormTypes";

type PublicFormShellProps = {
  brand: PublicFormBrand;
  formTitle: string;
  formDescription?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Edge-to-edge on phones (public /apply links). Off in builder preview. */
  fullPage?: boolean;
  /** Compact height for builder settings live preview. */
  preview?: boolean;
  /** Google Forms style progress bar under the description (paged sections). */
  progress?: { current: number; total: number; label?: string } | null;
  /** Rendered above the title, inside the card (e.g. "Closed" notice, prefilled banner). */
  notice?: ReactNode;
};

/**
 * Google Forms–style layout:
 * 1) Header banner image (4:1)
 * 2) Company logo + name
 * 3) Form card with bordered sections + fields
 */
export function PublicFormShell({
  brand,
  formTitle,
  formDescription,
  children,
  footer,
  className = "",
  fullPage = false,
  preview = false,
  progress = null,
  notice = null,
}: PublicFormShellProps) {
  const pageStyle = publicFormBrandToStyle(brand);
  const pageClass = `sp-form-page${fullPage ? " sp-form-page--full" : ""}${preview ? " sp-form-page--preview" : ""}`;

  return (
    <>
      <style>{`
        .sp-form-page {
          box-sizing: border-box;
          width: 100%;
          max-width: 640px;
          margin: 0 auto;
          min-height: 100dvh;
          min-height: 100svh;
          font-family: 'Inter', system-ui, sans-serif;
          color: var(--sp-text);
          background: var(--sp-form-bg);
          padding-bottom: max(24px, env(safe-area-inset-bottom));
        }
        .sp-form-page--full {
          /* Desktop: stay centered like Google Forms. Mobile full-bleed rules below. */
          max-width: 640px;
          margin: 0 auto;
        }
        .sp-form-page--preview {
          max-width: 100%;
          min-height: 0;
          width: 100%;
        }
        .sp-form-page *, .sp-form-page *::before, .sp-form-page *::after { box-sizing: border-box; }
        .sp-form-header-banner {
          width: 100%;
          aspect-ratio: 4 / 1;
          overflow: hidden;
          background: var(--sp-field-bg);
          border-bottom: var(--sp-section-border-width) solid var(--sp-section-border);
        }
        .sp-form-header-banner img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          display: block;
        }
        .sp-form-brand-bar {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 16px 16px 12px;
          border-bottom: var(--sp-section-border-width) solid var(--sp-section-border);
          background: var(--sp-form-bg);
          text-align: center;
        }
        .sp-form-brand-logo {
          width: 44px;
          height: 44px;
          object-fit: contain;
          flex-shrink: 0;
          border-radius: 8px;
          border: var(--sp-field-border-width) solid var(--sp-section-border);
          background: var(--sp-field-bg);
        }
        .sp-form-brand-name {
          font-size: var(--sp-company-name-size, 17px);
          font-weight: 800;
          line-height: 1.25;
          color: var(--sp-accent);
          word-break: break-word;
          width: 100%;
          text-align: center;
        }
        .sp-form-body-wrap { padding: 16px; }
        .sp-form-body-card {
          width: 100%;
          border: var(--sp-section-border-width) solid var(--sp-section-border);
          border-radius: 14px;
          padding: 18px 16px 20px;
          background: var(--sp-form-bg);
        }
        .sp-form-title {
          font-size: 1.45rem;
          font-weight: 800;
          margin: 0 0 6px;
          line-height: 1.2;
          color: var(--sp-text);
        }
        .sp-form-desc {
          font-size: 0.9rem;
          margin: 0 0 18px;
          color: var(--sp-description-color);
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .sp-form-desc--rich {
          white-space: normal;
        }
        .sp-form-desc p,
        .sp-form-desc div {
          margin: 0 0 0.35em;
        }
        .sp-form-desc p:last-child,
        .sp-form-desc div:last-child {
          margin-bottom: 0;
        }
        .sp-form-desc a, .sp-form-hint a, .sp-form-section-desc a, .sp-form-notice a {
          color: var(--sp-accent);
          text-decoration: underline;
          text-underline-offset: 2px;
          word-break: break-all;
        }
        .sp-form-desc ul, .sp-form-desc ol { margin: 0.2em 0 0.5em; padding-left: 1.4em; }
        .sp-form-desc li { margin: 0.15em 0; }
        .sp-form-progress {
          margin: -6px 0 18px;
        }
        .sp-form-progress-track {
          width: 100%;
          height: 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--sp-accent) 18%, transparent);
          overflow: hidden;
        }
        .sp-form-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--sp-accent);
          transition: width 0.25s ease;
        }
        .sp-form-progress-label {
          margin: 6px 0 0;
          font-size: 0.72rem;
          color: var(--sp-text-muted);
          text-align: right;
        }
        .sp-form-notice {
          border: var(--sp-field-border-width) solid var(--sp-section-border);
          border-left: 4px solid var(--sp-accent);
          border-radius: 10px;
          padding: 10px 12px;
          margin: 0 0 14px;
          font-size: 0.85rem;
          color: var(--sp-text);
          background: color-mix(in srgb, var(--sp-accent) 8%, var(--sp-form-bg));
        }
        .sp-form-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-top: 16px;
        }
        .sp-form-nav .sp-form-submit { margin-top: 0; width: auto; min-width: 120px; }
        .sp-form-nav-back {
          background: transparent;
          color: var(--sp-text);
          border: var(--sp-field-border-width) solid var(--sp-section-border);
          border-radius: 10px;
          padding: 12px 16px;
          min-height: 48px;
          font-weight: 700;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .sp-form-nav-back:disabled { opacity: 0.5; cursor: not-allowed; }
        .sp-form-error {
          margin: 4px 0 0;
          font-size: 0.78rem;
          color: #dc2626;
          font-weight: 600;
        }
        .sp-form-input.is-invalid { border-color: #dc2626; }
        .sp-form-media { display: flex; margin: 0 0 4px; }
        .sp-form-media-inner { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
        .sp-form-media img, .sp-form-media video {
          display: block; width: 100%; height: auto; border-radius: 10px;
          border: var(--sp-field-border-width) solid var(--sp-section-border);
          background: var(--sp-field-bg);
        }
        .sp-form-media-frame {
          position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden;
          border: var(--sp-field-border-width) solid var(--sp-section-border); background: #000;
        }
        .sp-form-media-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .sp-form-media-title { font-size: 0.95rem; font-weight: 700; color: var(--sp-text); }
        .sp-form-media-caption { font-size: 0.78rem; color: var(--sp-text-muted); text-align: center; }
        .sp-form-media--empty {
          border: 1px dashed var(--sp-section-border); border-radius: 10px; padding: 18px;
          justify-content: center; font-size: 0.8rem; color: var(--sp-text-muted);
        }
        .sp-form-rating { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .sp-form-rating-btn {
          background: transparent; border: 0; padding: 4px; cursor: pointer; line-height: 0;
          color: color-mix(in srgb, var(--sp-text) 35%, transparent); border-radius: 8px;
        }
        .sp-form-rating-btn.is-active { color: var(--sp-accent); }
        .sp-form-rating-btn:disabled { cursor: not-allowed; }
        .sp-form-rating-btn:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 1px; }
        .sp-form-rating-icon { width: 30px; height: 30px; }
        .sp-form-rating-value { margin-left: 6px; font-size: 0.8rem; color: var(--sp-text-muted); }
        .sp-form-after-submit {
          display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; font-size: 0.85rem;
        }
        .sp-form-after-submit a, .sp-form-after-submit button {
          color: var(--sp-accent); text-decoration: underline; background: none; border: 0; padding: 0;
          cursor: pointer; font: inherit; font-weight: 600;
        }
        .sp-form-section {
          border: var(--sp-section-border-width) solid var(--sp-section-border);
          border-radius: 12px;
          padding: 16px 14px;
          margin-bottom: 16px;
          background: var(--sp-field-bg);
          background: color-mix(in srgb, var(--sp-form-bg) 94%, var(--sp-field-bg) 6%);
        }
        .sp-form-section:last-of-type { margin-bottom: 0; }
        .sp-form-section-title {
          margin: 0 0 6px;
          font-size: 1rem;
          font-weight: 800;
          color: var(--sp-text);
          line-height: 1.3;
        }
        .sp-form-section-desc {
          margin: 0 0 14px;
          font-size: 0.85rem;
          color: var(--sp-text-muted);
          line-height: 1.45;
        }
        .sp-form-group {
          margin-bottom: 16px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
        }
        .sp-form-group:last-child { margin-bottom: 0; }
        .sp-form-label {
          display: block;
          font-size: 0.78rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--sp-text);
          line-height: 1.35;
        }
        .sp-form-required { color: #dc2626; }
        .sp-form-input {
          display: block;
          width: 100%;
          background: var(--sp-field-bg);
          border: var(--sp-field-border-width) solid var(--sp-field-border);
          color: var(--sp-text);
          padding: 14px 12px;
          min-height: 48px;
          font-size: 16px;
          border-radius: 8px;
          font-family: inherit;
          -webkit-appearance: none;
          line-height: 1.4;
        }
        .sp-form-input:focus {
          outline: none;
          border-color: var(--sp-accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--sp-accent) 25%, transparent);
        }
        .sp-form-input::placeholder { color: color-mix(in srgb, var(--sp-text) 40%, transparent); }
        .sp-form-hint { font-size: 0.75rem; color: var(--sp-text-muted); margin: 6px 0 0; }
        .sp-form-file-wrap { display: flex; flex-direction: column; gap: 6px; }
        .sp-form-file { padding: 10px 12px; cursor: pointer; }
        .sp-form-file-name { font-size: 0.8rem; color: var(--sp-text); margin: 0; }
        .sp-form-choice-list { display: flex; flex-direction: column; gap: 10px; }
        .sp-form-choice {
          display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: var(--sp-text);
        }
        .sp-form-choice-other { flex-wrap: wrap; }
        .sp-form-other-input { flex: 1; min-width: 160px; margin-top: 6px; }
        .sp-form-scale { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
        .sp-form-scale-options { display: flex; flex-wrap: wrap; gap: 8px; }
        .sp-form-scale-opt {
          display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 0.85rem;
        }
        .sp-form-scale-label { font-size: 0.75rem; color: var(--sp-text-muted); }
        .sp-form-error { font-size: 0.75rem; color: #dc2626; margin: 4px 0 0; }
        .sp-form-desc-html a, .sp-form-hint a, .sp-form-section-desc a {
          color: var(--sp-accent); text-decoration: underline;
        }
        .sp-form-progress { height: 6px; background: color-mix(in srgb, var(--sp-accent) 18%, transparent); border-radius: 99px; overflow: hidden; margin: 0 0 16px; }
        .sp-form-progress-bar { height: 100%; background: var(--sp-accent); transition: width 0.2s ease; }
        .sp-form-nav { display: flex; gap: 8px; margin-top: 8px; }
        .sp-form-nav .sp-form-submit { flex: 1; }
        .sp-form-media { display: flex; margin: 4px 0 8px; }
        .sp-form-media-inner { max-width: 100%; }
        .sp-form-media img, .sp-form-media video { display: block; width: 100%; height: auto; border-radius: 8px; }
        .sp-form-media-frame { position: relative; width: 100%; padding-top: 56.25%; }
        .sp-form-media-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 8px; }
        .sp-form-media-title { font-size: 0.9rem; font-weight: 700; margin: 0 0 8px; color: var(--sp-text); }
        .sp-form-media-caption { font-size: 0.75rem; color: var(--sp-text-muted); margin: 6px 0 0; }
        .sp-form-media--empty { font-size: 0.85rem; color: var(--sp-text-muted); padding: 16px; border: 1px dashed var(--sp-section-border); border-radius: 8px; }
        .sp-form-rating { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .sp-form-rating-btn {
          background: transparent; border: 0; padding: 4px; cursor: pointer; color: var(--sp-text-muted);
        }
        .sp-form-rating-btn.is-active { color: var(--sp-accent); }
        .sp-form-rating-icon { width: 28px; height: 28px; }
        .sp-form-rating-value { font-size: 0.8rem; color: var(--sp-text-muted); margin-left: 6px; }
        .sp-form-goto { font-size: 0.7rem; color: var(--sp-text-muted); }
        .sp-form-grid-wrap { overflow-x: auto; }
        .sp-form-grid { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .sp-form-grid th, .sp-form-grid td {
          border: 1px solid var(--sp-section-border);
          padding: 8px; text-align: center;
        }
        .sp-form-grid th[scope="row"] { text-align: left; font-weight: 700; }
        select.sp-form-input {
          appearance: none;
          background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23000000%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
          background-repeat: no-repeat;
          background-position: right 12px top 50%;
          background-size: 10px;
          padding-right: 32px;
        }
        .sp-form-phone {
          display: flex;
          gap: 8px;
          align-items: stretch;
          width: 100%;
        }
        .sp-form-phone-code-wrap {
          position: relative;
          flex: 0 0 7.5rem;
          max-width: 7.5rem;
          min-width: 7.5rem;
        }
        .sp-form-phone-code {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding-left: 8px;
          padding-right: 22px;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23666' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
          background-size: 10px;
        }
        .sp-form-phone-code:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }
        .sp-form-phone-flag-img {
          width: 20px;
          height: 15px;
          object-fit: cover;
          border-radius: 2px;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
          flex-shrink: 0;
        }
        .sp-form-phone-dial {
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--sp-text);
          font-variant-numeric: tabular-nums;
        }
        .sp-form-phone-menu {
          position: absolute;
          left: 0;
          top: calc(100% + 4px);
          z-index: 40;
          margin: 0;
          padding: 4px;
          list-style: none;
          width: min(18rem, 78vw);
          max-height: 15rem;
          overflow: auto;
          background: var(--sp-field-bg, #fff);
          border: 1px solid var(--sp-section-border, #e5e7eb);
          border-radius: 10px;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
        }
        .sp-form-phone-option {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 0;
          background: transparent;
          text-align: left;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          color: var(--sp-text);
          font: inherit;
        }
        .sp-form-phone-option:hover,
        .sp-form-phone-option.is-selected {
          background: color-mix(in srgb, var(--sp-accent, #2563eb) 12%, transparent);
        }
        .sp-form-phone-option-dial {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .sp-form-phone-option-name {
          opacity: 0.75;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sp-form-phone-number {
          flex: 1 1 auto;
          min-width: 0;
        }
        .sp-form-secure {
          display: flex;
          gap: 10px;
          border: var(--sp-section-border-width) solid var(--sp-section-border);
          border-radius: 10px;
          padding: 12px;
          margin-top: 16px;
          align-items: flex-start;
          background: color-mix(in srgb, var(--sp-form-bg) 92%, var(--sp-field-bg) 8%);
        }
        .sp-form-secure-text {
          font-size: 0.75rem;
          color: var(--sp-text-muted);
          line-height: 1.45;
        }
        .sp-form-submit {
          display: block;
          width: 100%;
          margin-top: 16px;
          background: var(--sp-accent);
          color: #000;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 14px 16px;
          min-height: 48px;
          border: var(--sp-section-border-width) solid var(--sp-section-border);
          border-radius: 10px;
          cursor: pointer;
          font-size: 0.95rem;
        }
        .sp-form-submit:disabled { opacity: 0.65; cursor: not-allowed; }
        @media (max-width: 640px) {
          .sp-form-page--full {
            max-width: none;
            width: 100%;
            min-height: 100dvh;
            min-height: 100svh;
          }
          .sp-form-page--full .sp-form-body-wrap {
            padding: 0;
          }
          .sp-form-page--full:not(.sp-form-page--preview) .sp-form-body-card {
            border-radius: 0;
            border-left: none;
            border-right: none;
            min-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
            min-height: calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
          }
          .sp-form-page--full .sp-form-brand-bar {
            padding-left: max(16px, env(safe-area-inset-left));
            padding-right: max(16px, env(safe-area-inset-right));
            padding-top: max(16px, env(safe-area-inset-top));
          }
          .sp-form-page--full .sp-form-body-card {
            padding-left: max(14px, env(safe-area-inset-left));
            padding-right: max(14px, env(safe-area-inset-right));
          }
        }
        @media (max-width: 480px) {
          .sp-form-body-wrap { padding: 10px; }
          .sp-form-body-card {
            border-radius: 12px;
            padding: 16px 12px 18px;
          }
          .sp-form-section {
            padding: 14px 12px;
            border-radius: 10px;
          }
          .sp-form-brand-bar { padding: 14px 12px 10px; }
          .sp-form-title { font-size: 1.3rem; }
          .sp-form-input { min-height: 50px; }
        }
      `}</style>
      <div className={`${pageClass} ${className}`.trim()} style={pageStyle}>
        {brand.headerImageUrl ? (
          <div className="sp-form-header-banner">
            <img src={brand.headerImageUrl} alt="" decoding="async" fetchPriority="high" />
          </div>
        ) : null}
        {brand.logoUrl || brand.companyName.trim() ? (
          <div className="sp-form-brand-bar">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.companyName || "Company logo"} className="sp-form-brand-logo" decoding="async" loading="lazy" />
            ) : null}
            {brand.companyName.trim() ? (
              <div className="sp-form-brand-name">{brand.companyName}</div>
            ) : null}
          </div>
        ) : null}
        <div className="sp-form-body-wrap">
          <div className="sp-form-body-card">
            {notice ? <div className="sp-form-notice">{notice}</div> : null}
            <h2 className="sp-form-title">{formTitle}</h2>
            {formDescription ? (
              looksLikeHtml(formDescription) ? (
                <div
                  className="sp-form-desc sp-form-desc--rich"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeFormDescriptionHtml(descriptionToEditorHtml(formDescription)),
                  }}
                />
              ) : (
                <p className="sp-form-desc">{formDescription}</p>
              )
            ) : null}
            {progress && progress.total > 1 ? (
              <div className="sp-form-progress" aria-label="Progress">
                <div className="sp-form-progress-track">
                  <div
                    className="sp-form-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(4, Math.round((progress.current / progress.total) * 100)))}%` }}
                  />
                </div>
                <p className="sp-form-progress-label">
                  {progress.label || `Page ${progress.current} of ${progress.total}`}
                </p>
              </div>
            ) : null}
            {children}
          </div>
          {footer}
        </div>
      </div>
    </>
  );
}

export function builderBrandFromState(state: {
  companyName: string;
  companyLogoUrl: string;
  headerImageUrl: string;
  formBg: string;
  fieldBg: string;
  textColor: string;
  accentColor: string;
  fieldBorderColor: string;
  fieldBorderWidth: number;
  sectionBorderColor: string;
  sectionBorderWidth: number;
  descriptionColor: string;
  companyNameFontSize: number;
}): PublicFormBrand {
  return {
    companyName: resolveFormCompanyName(state.companyName),
    logoUrl: state.companyLogoUrl,
    headerImageUrl: state.headerImageUrl,
    formBg: state.formBg,
    fieldBg: state.fieldBg,
    textColor: state.textColor,
    accentColor: state.accentColor,
    fieldBorderColor: state.fieldBorderColor,
    fieldBorderWidth: state.fieldBorderWidth,
    sectionBorderColor: state.sectionBorderColor,
    sectionBorderWidth: state.sectionBorderWidth,
    descriptionColor: state.descriptionColor,
    companyNameFontSize: state.companyNameFontSize,
  };
}

import type { ComponentType, ReactNode, SelectHTMLAttributes, SVGProps } from "react";

/* ------------------------------------------------------------------ Badge */

export type BadgeTone =
  | "positive"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "pending";

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Show a leading dot. Defaults to true. */
  dot?: boolean;
}

export function Badge({ tone = "neutral", children, dot = true }: BadgeProps) {
  return (
    <span className={`admin-badge admin-badge--${tone}`}>
      {dot ? <span className="admin-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- PageHeader */

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="admin-page__header">
      <div className="admin-page__heading">
        {eyebrow ? <p className="admin-page__eyebrow">{eyebrow}</p> : null}
        <h1 className="admin-page__title">{title}</h1>
        {subtitle ? <p className="admin-page__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="admin-page__actions">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------- CommandBar */

export function CommandBar({ children }: { children: ReactNode }) {
  return <div className="admin-commandbar">{children}</div>;
}

interface CommandSearchProps {
  placeholder: string;
  /** Accessible label for the input. */
  label: string;
  /** Name attribute (useful if the form ever posts). */
  name?: string;
  defaultValue?: string;
}

export function CommandSearch({ placeholder, label, name, defaultValue }: CommandSearchProps) {
  return (
    <div className="admin-commandbar__search">
      <SearchGlyph />
      <input
        type="search"
        className="admin-commandbar__search-input"
        placeholder={placeholder}
        aria-label={label}
        name={name}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg
      className="admin-commandbar__search-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

interface CommandSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export function CommandSelect({ label, options, ...rest }: CommandSelectProps) {
  return (
    <select className="admin-commandbar__select" aria-label={label} {...rest}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface CommandButtonProps {
  children: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  onClick?: () => void;
  variant?: "default" | "primary";
  label: string;
  type?: "button" | "submit";
}

export function CommandButton({
  children,
  icon: Icon,
  onClick,
  label,
  type = "button",
}: CommandButtonProps) {
  return (
    <button
      type={type}
      className="admin-commandbar__button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {Icon ? <Icon className="admin-commandbar__button-icon" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function CommandSpacer() {
  return <span className="admin-commandbar__spacer" />;
}

/* --------------------------------------------------------------- Section */

interface SectionProps {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}

export function Section({ title, sub, actions, children, padded }: SectionProps) {
  return (
    <section className="admin-section">
      <div className="admin-section__head">
        <div>
          <h2 className="admin-section__title">{title}</h2>
          {sub ? <div className="admin-section__sub">{sub}</div> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      <div className={padded ? "admin-section__body admin-section__body--padded" : "admin-section__body"}>
        {children}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Banner */

interface BannerProps {
  tone?: "info" | "warning" | "danger";
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  children?: ReactNode;
}

export function Banner({ tone = "info", icon: Icon, title, children }: BannerProps) {
  return (
    <div className={`admin-banner${tone !== "info" ? ` admin-banner--${tone}` : ""}`} role="status">
      {Icon ? <Icon className="admin-banner__icon" /> : null}
      <span>
        <span className="admin-banner__title">{title}</span>
        {children ? <> {children}</> : null}
      </span>
    </div>
  );
}

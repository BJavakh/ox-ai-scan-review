import type { ReactNode } from 'react';

/** Full-bleed band. Tones alternate paper/white down the page, as in the reference. */
export function Band({
  tone,
  id,
  labelledBy,
  children,
  className = '',
}: {
  tone: 'paper' | 'white';
  id?: string;
  labelledBy?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`band band-${tone} ${className}`}>
      <div className="wrap">{children}</div>
    </section>
  );
}

/** Centered section heading: "01 / FIX FIRST", title, one-line lead. */
export function SectionHead({
  index,
  label,
  title,
  titleId,
  lead,
}: {
  index?: string;
  label: string;
  title: ReactNode;
  titleId: string;
  lead?: ReactNode;
}) {
  return (
    <header className="section-head">
      <p className="eyebrow">
        {index !== undefined && <strong>{index}</strong>}
        {index !== undefined && <span aria-hidden="true"> / </span>}
        {label}
      </p>
      <h2 id={titleId} className="section-title">
        {title}
      </h2>
      {lead !== undefined && <p className="section-lead">{lead}</p>}
    </header>
  );
}

/** A product-surface panel with an optional toolbar row. */
export function Panel({
  toolbar,
  children,
  className = '',
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel ${className}`}>
      {toolbar !== undefined && <div className="panel-toolbar">{toolbar}</div>}
      <div className="panel-body">{children}</div>
    </div>
  );
}

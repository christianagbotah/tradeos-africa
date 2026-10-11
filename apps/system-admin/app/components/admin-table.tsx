import type { CSSProperties, ReactNode } from "react";

export type ColumnAlign = "left" | "right" | "center";

export interface AdminColumn<T> {
  /** Stable key for the column. */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** Optional explicit width (any CSS width string). */
  width?: string;
  /** Cell alignment. Defaults to "left". */
  align?: ColumnAlign;
  /** Cell renderer. */
  render: (row: T) => ReactNode;
}

interface AdminTableProps<T> {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional caption for screen readers. */
  caption?: string;
  /** Optional row click handler (rows become focusable/clickable when set). */
  onRowClick?: (row: T) => void;
  /** Wrap the table in a scroll container with a max height. */
  scrollable?: boolean;
  /** Max height for the scroll container (CSS string). Ignored unless scrollable. */
  maxHeight?: string;
  /**
   * Content rendered inside a full-width row when `rows` is empty.
   * Use this to surface honest "pending backend" states without faking data.
   */
  emptyState?: ReactNode;
}

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  onRowClick,
  scrollable,
  maxHeight,
  emptyState,
}: AdminTableProps<T>) {
  const hasRows = rows.length > 0;

  const table = (
    <table className="admin-table">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <colgroup>
        {columns.map((col) => (
          <col
            key={col.key}
            style={col.width ? ({ width: col.width } as CSSProperties) : undefined}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} scope="col" data-align={col.align ?? "left"}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {hasRows ? (
          rows.map((row) => {
            const key = rowKey(row);
            const clickable = Boolean(onRowClick);
            return (
              <tr
                key={key}
                data-clickable={clickable ? "true" : "false"}
                tabIndex={clickable ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} data-align={col.align ?? "left"}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })
        ) : (
          <tr className="admin-table__empty-row">
            <td colSpan={columns.length}>
              {emptyState ?? null}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  if (!scrollable) {
    return <div className="admin-table-wrap">{table}</div>;
  }

  return (
    <div className="admin-table-wrap">
      <div className="admin-scroll" style={maxHeight ? ({ maxHeight } as CSSProperties) : undefined}>
        {table}
      </div>
    </div>
  );
}

/** Small helpers for common cell compositions. */
export function CellMain({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="admin-table__cell-main">
      <span className="admin-table__cell-title">{title}</span>
      {sub ? <span className="admin-table__cell-sub">{sub}</span> : null}
    </span>
  );
}

export function CellMono({ children }: { children: ReactNode }) {
  return <span className="admin-table__mono">{children}</span>;
}

export function CellStrong({ children }: { children: ReactNode }) {
  return <span className="admin-table__strong">{children}</span>;
}

export function CellMuted({ children }: { children: ReactNode }) {
  return <span className="admin-table__muted">{children}</span>;
}

// One table for every screen. On laptops and tablets it is an ordinary table; on a
// phone (index.css, max-width 575px) each row becomes a card, and every value is
// labelled with its column's title. Pages use it exactly like Ant Design's Table.
import { Table as AntTable } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';

/** The column's title as plain text, for the label in the phone card. */
const labelOf = (title: unknown): string => {
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  return '';
};

function withLabels<T>(columns: TableProps<T>['columns']): TableProps<T>['columns'] {
  return columns?.map((col) => {
    const c = col as ColumnType<T> & { children?: unknown[] };
    if (c.children) return { ...c, children: withLabels(c.children as TableProps<T>['columns']) } as typeof col;
    const label = labelOf(c.title);
    const own = c.onCell;
    return {
      ...c,
      onCell: (record: T, index?: number) => ({ ...(own ? own(record, index) : {}), 'data-label': label }) as any,
    } as typeof col;
  });
}

function ResponsiveTable<T extends object>(props: TableProps<T>) {
  const { columns, className, ...rest } = props;
  return <AntTable<T> {...rest} columns={withLabels(columns)} className={['rt-cards', className].filter(Boolean).join(' ')} />;
}

// Keep Table.Summary, Table.Column … available, as with Ant Design's Table.
const Table = Object.assign(ResponsiveTable, {
  Summary: AntTable.Summary,
  Column: AntTable.Column,
  ColumnGroup: AntTable.ColumnGroup,
  SELECTION_ALL: AntTable.SELECTION_ALL,
  EXPAND_COLUMN: AntTable.EXPAND_COLUMN,
});

export default Table;

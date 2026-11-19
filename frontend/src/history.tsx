// Timestamps (FR12): "added / last changed" on records, and a step-by-step
// timeline on documents. Both read what the database records automatically.
import { ClockCircleOutlined } from '@ant-design/icons';
import { Skeleton, Space, Timeline, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get } from './api/client';
import { ORDER_STATUS, PAYMENT_METHODS, cedi, dateTime } from './format';

/** Labels for every status a document can move to. */
const STATUS_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label])),
  // purchase orders
  APPROVED: 'Approved',
  SENT: 'Sent to supplier',
  PARTIAL: 'Partly received',
  RECEIVED: 'Fully received',
  // write-offs
  PENDING_APPROVAL: 'Awaiting approval',
  REJECTED: 'Rejected',
  // van trips
  LOADED: 'Loaded',
  RECONCILED: 'Reconciled',
  // stocktakes
  COUNTING: 'Counting',
  POSTED: 'Posted',
};
const label = (s: string | null) => (s ? STATUS_LABEL[s] ?? s : '');

const COLOR: Record<string, string> = { CANCELLED: 'red', REJECTED: 'red', PAID: 'green', RECEIVED: 'green', APPROVED: 'green', POSTED: 'green', RECONCILED: 'green' };

/** "Added 19 Nov 2026, 10:01 by Kwame Mensah · Last changed …" */
export function RecordStamp({ entity, id }: { entity: string; id?: number | null }) {
  const [s, setS] = useState<any | null>(null);
  useEffect(() => {
    setS(null);
    if (id) get(`/stamps/${entity}/${id}`).then(setS).catch(() => setS(null));
  }, [entity, id]);
  if (!id || !s) return null;
  const by = (name?: string | null) => (name ? ` by ${name}` : '');
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
      <ClockCircleOutlined style={{ marginRight: 6 }} />
      {s.created_at ? `Added ${dateTime(s.created_at)}${by(s.created_by_name)}` : 'Part of the original data'}
      {s.updated_at && ` · Last changed ${dateTime(s.updated_at)}${by(s.updated_by_name)}`}
    </Typography.Text>
  );
}

/** Table column: the last time a record was changed (or added). */
export const lastChangedColumn = {
  title: 'Last changed',
  key: 'last_changed',
  width: 150,
  responsive: ['lg'] as ('lg')[],
  sorter: (a: any, b: any) => +new Date(a.updated_at ?? a.created_at ?? 0) - +new Date(b.updated_at ?? b.created_at ?? 0),
  render: (_: unknown, r: any) => (
    <Typography.Text type="secondary">{r.updated_at || r.created_at ? dateTime(r.updated_at ?? r.created_at) : 'Original data'}</Typography.Text>
  ),
};

/** Every step of an order, purchase order, write-off, van trip or stocktake. */
export function DocumentTimeline({ doc, id, refreshKey }: { doc: string; id?: number | null; refreshKey?: unknown }) {
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => {
    setEvents(null);
    if (id) get(`/history/${doc}/${id}`).then(setEvents).catch(() => setEvents([]));
  }, [doc, id, refreshKey]);
  if (!id) return null;
  if (!events) return <Skeleton active paragraph={{ rows: 2 }} />;

  // "Invoice issued" already says it; the status change to Invoiced – to deliver adds nothing.
  const shown = events.some((e) => e.event === 'INVOICED') ? events.filter((e) => !(e.event === 'STATUS' && e.to_status === 'PICKING')) : events;

  const describe = (e: any) => {
    switch (e.event) {
      case 'CREATED':
        return `Created${e.to_status ? ` (${label(e.to_status)})` : ''}`;
      case 'INVOICED':
        return `Invoice ${e.detail} issued · ${cedi(e.amount)}`;
      case 'PAYMENT':
        return `Payment received · ${cedi(e.amount)} by ${(PAYMENT_METHODS[e.detail] ?? e.detail ?? '').toLowerCase()}`;
      case 'RECEIVED':
        return `Delivery received · ${e.detail}`;
      default:
        return label(e.to_status);
    }
  };

  return (
    <Timeline
      style={{ marginTop: 8 }}
      items={shown.map((e) => ({
        color: COLOR[e.to_status] ?? (e.event === 'PAYMENT' || e.event === 'RECEIVED' ? 'green' : 'blue'),
        children: (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{describe(e)}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dateTime(e.event_at)}
              {e.user_name ? ` · ${e.user_name}` : ''}
              {e.event === 'CREATED' && e.detail ? ` · ${e.detail.toLowerCase()}` : ''}
            </Typography.Text>
          </Space>
        ),
      }))}
    />
  );
}

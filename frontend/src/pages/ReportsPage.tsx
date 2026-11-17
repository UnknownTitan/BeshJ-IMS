import { Button, Card, DatePicker, InputNumber, Segmented, Select, Space, Table, Typography, message } from 'antd';
import { FileExcelOutlined, FilePdfOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { get, tokenStore } from '../api/client';
import { cedi } from '../format';

const REPORTS: Record<string, { label: string; dates?: boolean; groupBy?: boolean; days?: number }> = {
  sales: { label: 'Sales', dates: true, groupBy: true },
  movers: { label: 'Fast & slow movers', days: 30 },
  losses: { label: 'Stock losses', dates: true },
  valuation: { label: 'Stock valuation' },
  receivables: { label: 'Money owed (ageing)' },
  expiry: { label: 'Expiring soon', days: 90 },
};

const GROUPS = [
  { value: 'product', label: 'Product' },
  { value: 'brand', label: 'Brand' },
  { value: 'category', label: 'Category' },
  { value: 'customer', label: 'Customer' },
  { value: 'rep', label: 'Sales rep' },
  { value: 'channel', label: 'Warehouse vs van' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
];

/** UC8 - reports with Excel and PDF export (FR11). */
export default function ReportsPage() {
  const [name, setName] = useState('sales');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [groupBy, setGroupBy] = useState('product');
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const def = REPORTS[name];

  const params = () => {
    const q = new URLSearchParams();
    if (def.dates && range?.[0]) q.set('from', range[0].format('YYYY-MM-DD'));
    if (def.dates && range?.[1]) q.set('to', range[1].format('YYYY-MM-DD'));
    if (def.groupBy) q.set('groupBy', groupBy);
    if (def.days) q.set('days', String(days));
    return q;
  };

  const run = () => {
    setLoading(true);
    get(`/reports/${name}?${params()}`)
      .then(setReport)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(run, [name, groupBy]);

  /** Files need the login token, so fetch them as a blob rather than a plain link. */
  const download = async (format: 'xlsx' | 'pdf') => {
    setDownloading(format);
    try {
      const q = params();
      q.set('format', format);
      const res = await fetch(`/api/reports/${name}/export?${q}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Download failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? `report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setDownloading(null);
    }
  };

  const fmt = (type: string, v: any) =>
    v === null || v === undefined || v === ''
      ? '—'
      : type === 'money'
        ? cedi(v)
        : type === 'int'
          ? Number(v).toLocaleString()
          : type === 'percent'
            ? `${Number(v).toFixed(1)}%`
            : type === 'date'
              ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              : v;

  return (
    <Card>
      <Typography.Title level={4}>Reports</Typography.Title>
      <Segmented
        options={Object.entries(REPORTS).map(([value, r]) => ({ value, label: r.label }))}
        value={name}
        onChange={(v) => {
          setReport(null);
          setDays(REPORTS[v as string].days ?? 30);
          setName(v as string);
        }}
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space wrap>
          {def.dates && <DatePicker.RangePicker value={range} onChange={(r) => setRange(r as any)} format="DD MMM YYYY" allowEmpty={[true, true]} />}
          {def.groupBy && <Select value={groupBy} onChange={setGroupBy} options={GROUPS} style={{ width: 190 }} prefix="By" />}
          {def.days && (
            <Space>
              {name === 'movers' ? 'Last' : 'Within'}
              <InputNumber min={1} max={730} value={days} onChange={(v) => setDays(v ?? 30)} style={{ width: 90 }} />
              days
            </Space>
          )}
          <Button icon={<ReloadOutlined />} onClick={run} loading={loading}>
            Run
          </Button>
        </Space>
        <Space>
          <Button icon={<FileExcelOutlined />} loading={downloading === 'xlsx'} onClick={() => download('xlsx')}>
            Excel
          </Button>
          <Button icon={<FilePdfOutlined />} loading={downloading === 'pdf'} onClick={() => download('pdf')}>
            PDF
          </Button>
        </Space>
      </Space>

      {report && (
        <>
          <Typography.Title level={5} style={{ marginBottom: 0 }}>
            {report.title}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{report.subtitle}</Typography.Paragraph>
          <Table
            size="small"
            loading={loading}
            rowKey={(_, i) => String(i)}
            dataSource={report.rows}
            pagination={report.rows.length > 50 ? { pageSize: 50 } : false}
            scroll={{ x: true }}
            columns={report.columns.map((c: any) => ({
              title: c.label,
              dataIndex: c.key,
              align: ['money', 'int', 'percent'].includes(c.type) ? 'right' : 'left',
              render: (v: any) => fmt(c.type, v),
              sorter: (a: any, b: any) =>
                ['money', 'int', 'percent'].includes(c.type) ? Number(a[c.key] ?? 0) - Number(b[c.key] ?? 0) : String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? '')),
            }))}
            summary={() =>
              report.rows.length ? (
                <Table.Summary.Row>
                  {report.columns.map((c: any, i: number) => (
                    <Table.Summary.Cell key={c.key} index={i} align={['money', 'int', 'percent'].includes(c.type) ? 'right' : 'left'}>
                      <strong>{i === 0 ? 'Total' : c.key in report.totals ? fmt(c.type, report.totals[c.key]) : ''}</strong>
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              ) : null
            }
          />
        </>
      )}
    </Card>
  );
}

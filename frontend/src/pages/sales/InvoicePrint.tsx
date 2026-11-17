import { Button, Spin } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get } from '../../api/client';
import { PAYMENT_METHODS, cedi, date } from '../../format';

/**
 * Printable VAT invoice (opens in its own tab, outside the app layout).
 * Tax is shown per component: VAT 15%, NHIL 2.5%, GETFund 2.5%, all on the same base.
 */
export default function InvoicePrint() {
  const { id } = useParams();
  const [o, setO] = useState<any | null>(null);
  const [rates, setRates] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([get(`/invoices/${id}`), get('/tax-rates')]).then(([order, r]) => {
      setO(order);
      setRates(r);
    });
  }, [id]);

  if (!o) return <Spin fullscreen />;
  const inv = o.invoice;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="invoice-page">
      <style>{`
        .invoice-page { max-width: 820px; margin: 24px auto; background: #fff; padding: 40px; font-family: system-ui, sans-serif; color: #111; }
        .invoice-page table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        .invoice-page th, .invoice-page td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; font-size: 14px; }
        .invoice-page th { background: #f5f6f8; }
        .invoice-page .r { text-align: right; white-space: nowrap; }
        .invoice-page .totals td { border: none; padding: 3px 8px; }
        .invoice-page .muted { color: #666; font-size: 13px; }
        @media print { body { background: #fff; } .no-print { display: none; } .invoice-page { margin: 0; padding: 0; } }
      `}</style>

      <div className="no-print" style={{ textAlign: 'right', marginBottom: 16 }}>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>BESH. J LIMITED</div>
          <div className="muted">Beverage distribution · Accra, Ghana</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>TAX INVOICE</div>
          <div>{inv.invoice_no}</div>
          <div className="muted">Order {o.order_no}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <div>
          <div className="muted">Bill to</div>
          <div style={{ fontWeight: 600 }}>{o.customer_name}</div>
          <div>{o.customer_phone}</div>
          <div>GPS: {o.gps_address}</div>
          {o.customer_tin && <div>TIN: {o.customer_tin}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>
            <span className="muted">Invoice date: </span>
            {date(inv.invoice_date)}
          </div>
          <div>
            <span className="muted">Due date: </span>
            {date(inv.due_date)}
          </div>
          <div>
            <span className="muted">Terms: </span>
            {o.payment_terms === 'CREDIT' ? 'Credit, 30 days' : 'Cash'}
          </div>
          <div>
            <span className="muted">Sales rep: </span>
            {o.sales_rep_name}
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="r">Qty</th>
            <th className="r">Unit price</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l: any) => (
            <tr key={l.line_no}>
              <td>{l.product_name}</td>
              <td className="r">{l.quantity}</td>
              <td className="r">{cedi(l.unit_price)}</td>
              <td className="r">{cedi(l.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="totals" style={{ width: 360, marginLeft: 'auto' }}>
        <tbody>
          <tr>
            <td>Subtotal (excl. tax)</td>
            <td className="r">{cedi(inv.subtotal)}</td>
          </tr>
          {rates.map((r) => (
            <tr key={r.tax_code}>
              <td>
                {r.tax_name} {r.rate_percent}%
              </td>
              <td className="r">{cedi(round2((inv.subtotal * r.rate_percent) / 100))}</td>
            </tr>
          ))}
          <tr>
            <td>Total tax ({inv.tax_rate}%)</td>
            <td className="r">{cedi(inv.vat_amount)}</td>
          </tr>
          <tr>
            <td>Container deposit (refundable)</td>
            <td className="r">{cedi(inv.deposit_amount)}</td>
          </tr>
          <tr style={{ fontWeight: 700, fontSize: 16 }}>
            <td>Total</td>
            <td className="r">{cedi(inv.total_amount)}</td>
          </tr>
          <tr>
            <td>Paid</td>
            <td className="r">{cedi(inv.amount_paid)}</td>
          </tr>
          <tr style={{ fontWeight: 700 }}>
            <td>Balance due</td>
            <td className="r">{cedi(inv.outstanding)}</td>
          </tr>
        </tbody>
      </table>

      {o.picked.length > 0 && (
        <>
          <div style={{ marginTop: 24, fontWeight: 600 }}>Batches supplied</div>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="r">Qty</th>
              </tr>
            </thead>
            <tbody>
              {o.picked.map((p: any) => (
                <tr key={`${p.product_id}-${p.batch_no}`}>
                  <td>{p.product_name}</td>
                  <td>{p.batch_no}</td>
                  <td>{date(p.expiry_date)}</td>
                  <td className="r">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {o.payments.length > 0 && (
        <div className="muted" style={{ marginTop: 16 }}>
          Payments received:{' '}
          {o.payments.map((p: any) => `${date(p.payment_date)} ${PAYMENT_METHODS[p.payment_method]} ${cedi(p.amount)}`).join(' · ')}
        </div>
      )}

      <div className="muted" style={{ marginTop: 32, borderTop: '1px solid #e5e5e5', paddingTop: 12 }}>
        GRA E-VAT code: {inv.gra_sdc_code ?? 'pending signature'}
        {inv.gra_sdc_code?.startsWith('SIM-') && ' (simulated: this demo system is not connected to GRA)'}. Container deposits are refunded when the
        crates, bottles or kegs are returned in good condition.
      </div>
    </div>
  );
}

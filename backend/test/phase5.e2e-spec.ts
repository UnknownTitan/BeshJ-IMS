/**
 * Phase 5 end-to-end tests: dashboard and reports with Excel/PDF export (UC8, FR11).
 * The checks compare report figures with the transactions they come from.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, createTestApp } from './helpers';

const VOLTIC = 8;

describe('Phase 5 - dashboard and reports (UC8, FR11) (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const mgmt = () => as(app, 'aadjei');

  /** Download a file and return its bytes (supertest buffers binary bodies with .buffer(true)). */
  const download = async (url: string) => {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'aadjei', password: 'Password123!' });
    return request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  };

  it('dashboard: key figures, pending work and a 14-day sales series', async () => {
    const d = (await (await as(app, 'kasante')).get('/api/dashboard').expect(200)).body;
    for (const k of ['sales_today', 'sales_month', 'receivables', 'overdue', 'stock_value', 'reorder_count', 'near_expiry_count', 'losses_month']) {
      expect(typeof d.kpi[k]).toBe('number');
    }
    expect(d.pending).toHaveProperty('credit_approvals');
    expect(d.sales_last_14_days).toHaveLength(14);
  });

  it('a sale invoiced today shows up in today\'s sales (revenue before tax)', async () => {
    const before = (await (await mgmt()).get('/api/dashboard').expect(200)).body.kpi.sales_today;
    const rep = await as(app, 'kasante');
    const o = (await rep.post('/api/orders', { customer_id: 1, lines: [{ product_id: VOLTIC, quantity: 24 }] }).expect(201)).body;
    await rep.post(`/api/orders/${o.order_id}/submit`).expect(200);
    await rep.post(`/api/orders/${o.order_id}/invoice`, {}).expect(200);
    const after = (await (await mgmt()).get('/api/dashboard').expect(200)).body.kpi.sales_today;
    expect(after).toBeCloseTo(before + 72, 2); // 24 x GH₵ 3.00
  });

  it('sales report: grouping changes the rows, not the totals', async () => {
    const m = await mgmt();
    const byBrand = (await m.get('/api/reports/sales?groupBy=brand').expect(200)).body;
    const byCustomer = (await m.get('/api/reports/sales?groupBy=customer').expect(200)).body;
    expect(byBrand.totals.revenue).toBeCloseTo(byCustomer.totals.revenue, 2);
    expect(byBrand.totals.invoices).toBe(byCustomer.totals.invoices);
    expect(byBrand.totals.margin).toBeCloseTo(byBrand.totals.revenue - byBrand.totals.cost, 2);
  });

  it('sales report rejects an unknown grouping and a bad date', async () => {
    const m = await mgmt();
    await m.get('/api/reports/sales?groupBy=colour').expect(400);
    await m.get('/api/reports/sales?from=yesterday').expect(400);
  });

  it('reports are for managers, accountants and management only', async () => {
    await (await as(app, 'kasante')).get('/api/reports/sales').expect(403);
    await (await as(app, 'edarko')).get('/api/reports/receivables').expect(200);
  });

  it('valuation and receivables reports agree with the dashboard', async () => {
    const m = await mgmt();
    const d = (await m.get('/api/dashboard').expect(200)).body.kpi;
    const val = (await m.get('/api/reports/valuation').expect(200)).body;
    const rec = (await m.get('/api/reports/receivables').expect(200)).body;
    expect(val.totals.value_at_cost).toBeCloseTo(d.stock_value, 2);
    expect(rec.totals.total_outstanding).toBeCloseTo(d.receivables, 2);
  });

  it('a write-off appears in the losses report at cost', async () => {
    await (await as(app, 'aowusu'))
      .post('/api/write-offs', { batch_id: 8, quantity: 12, reason_code: 'LEAKING', description: 'Seals failed' })
      .expect(201);
    const losses = (await (await mgmt()).get('/api/reports/losses').expect(200)).body;
    const row = losses.rows.find((r: any) => r.loss_type === 'Write-off' && r.reason?.startsWith('Leaking'));
    expect(row.value_at_cost).toBeCloseTo(12 * 2.4, 2);
  });

  it('fast and slow movers ranks every active product', async () => {
    const r = (await (await mgmt()).get('/api/reports/movers?days=400').expect(200)).body;
    expect(r.rows.length).toBeGreaterThan(5);
    for (const row of r.rows) expect(['Fast', 'Normal', 'Slow', 'Not selling']).toContain(row.movement);
  });

  it('exports a real Excel workbook and a real PDF', async () => {
    const x = await download('/api/reports/sales/export?format=xlsx&groupBy=brand');
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // .xlsx is a zip file

    const p = await download('/api/reports/valuation/export?format=pdf');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const bad = await download('/api/reports/sales/export?format=docx');
    expect(bad.status).toBe(400);
  });
});

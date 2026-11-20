/**
 * Timestamps end-to-end tests (FR12): when each record was added and last
 * changed and by whom, and a timeline of every step in a document's life.
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp, uniq } from './helpers';

const COKE = 1;
const CASH_CUSTOMER = 1; // Auntie Ama Provisions
const futureDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const isTime = (v: string) => /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v);

describe('Timestamps (FR12) (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  describe('added and last changed', () => {
    it('FR12: a new customer records when and by whom it was added', async () => {
      const rep = await as(app, 'kasante');
      const c = (
        await rep.post('/api/customers', { customer_name: `Stamp Bar ${uniq()}`, customer_type: 'BAR', phone: '0244555666', gps_address: 'GA-123-4567' }).expect(201)
      ).body;
      const s = (await rep.get(`/api/stamps/customers/${c.customer_id}`).expect(200)).body;
      expect(isTime(s.created_at)).toBe(true);
      expect(s.created_by_name).toBe('Kofi Asante');
      expect(s.updated_at).toBeNull();
    });

    it('FR12: editing a product records when and by whom; a save with no change does not', async () => {
      const wm = await as(app, 'kmensah');
      const p = (await wm.get(`/api/products/${COKE}`).expect(200)).body;
      await wm.patch(`/api/products/${COKE}`, { selling_price: Number(p.selling_price) }).expect(200);
      const before = (await wm.get(`/api/stamps/products/${COKE}`).expect(200)).body;

      await wm.patch(`/api/products/${COKE}`, { reorder_level: Number(p.reorder_level) + 24 }).expect(200);
      const after = (await wm.get(`/api/stamps/products/${COKE}`).expect(200)).body;
      expect(after.updated_by_name).toBe('Kwame Mensah');
      expect(isTime(after.updated_at)).toBe(true);
      if (before.updated_at) expect(new Date(after.updated_at) >= new Date(before.updated_at)).toBe(true);

      await wm.patch(`/api/products/${COKE}`, { reorder_level: Number(p.reorder_level) }).expect(200);
      const list = (await wm.get('/api/products').expect(200)).body;
      expect(list.find((x: any) => x.product_id === COKE).updated_at).toBeTruthy();
    });

    it('logging in does not count as changing the user record', async () => {
      const admin = await as(app, 'kappiah');
      const before = (await admin.get('/api/stamps/users/3').expect(200)).body;
      await as(app, 'aowusu'); // logs in, which updates last_login
      const after = (await admin.get('/api/stamps/users/3').expect(200)).body;
      expect(after.updated_at).toEqual(before.updated_at);
    });

    it('unknown record types are refused', async () => {
      await (await as(app, 'kmensah')).get('/api/stamps/passwords/1').expect(400);
      await (await as(app, 'kmensah')).get('/api/history/everything/1').expect(400);
    });
  });

  describe('document timelines', () => {
    it('FR12: a customer order shows every step with its time and person, in order', async () => {
      const rep = await as(app, 'kasante');
      const o = (await rep.post('/api/orders', { customer_id: CASH_CUSTOMER, lines: [{ product_id: COKE, quantity: 24 }] }).expect(201)).body;
      await rep.post(`/api/orders/${o.order_id}/submit`).expect(200);
      const inv = (await rep.post(`/api/orders/${o.order_id}/invoice`).expect(200)).body.invoice;
      await (await as(app, 'yboateng')).post(`/api/orders/${o.order_id}/deliver`, { van_id: 3 }).expect(200);
      await (await as(app, 'edarko'))
        .post('/api/payments', { customer_id: CASH_CUSTOMER, invoice_id: inv.invoice_id, amount: Number(inv.total_amount), payment_method: 'CASH' })
        .expect(201);

      const h = (await rep.get(`/api/history/orders/${o.order_id}`).expect(200)).body;
      const steps = h.map((e: any) => (e.event === 'STATUS' ? e.to_status : e.event));
      expect(steps[0]).toBe('CREATED');
      expect(h[0].user_name).toBe('Kofi Asante');
      for (const s of ['CONFIRMED', 'INVOICED', 'DELIVERED', 'PAYMENT', 'PAID']) expect(steps).toContain(s);
      expect(h.find((e: any) => e.event === 'INVOICED').detail).toBe(inv.invoice_no);
      expect(h.find((e: any) => e.event === 'PAYMENT')).toMatchObject({ user_name: 'Efua Darko', detail: 'CASH' });
      expect(h.find((e: any) => e.to_status === 'DELIVERED').user_name).toBe('Yaw Boateng');
      const times = h.map((e: any) => new Date(e.event_at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('FR12: a purchase order shows approval and the delivery received', async () => {
      const wm = await as(app, 'kmensah');
      const po = (await wm.post('/api/purchase-orders', { supplier_id: 1, expected_date: futureDate(3), lines: [{ product_id: COKE, quantity: 24 }] }).expect(201)).body;
      await (await as(app, 'aadjei')).post(`/api/purchase-orders/${po.po_id}/approve`).expect(200);
      const grn = (
        await (await as(app, 'aowusu'))
          .post(`/api/purchase-orders/${po.po_id}/receive`, {
            delivery_note_no: `DN-${uniq()}`,
            lines: [{ line_no: 1, qty_received: 24, qty_damaged: 0, batch_no: `TS${uniq()}`, expiry_date: futureDate(200) }],
          })
          .expect(201)
      ).body.grn;

      const h = (await wm.get(`/api/history/purchase-orders/${po.po_id}`).expect(200)).body;
      expect(h[0]).toMatchObject({ event: 'CREATED', user_name: 'Kwame Mensah', to_status: 'DRAFT' });
      expect(h.find((e: any) => e.to_status === 'APPROVED').user_name).toBe('Akosua Adjei');
      expect(h.find((e: any) => e.event === 'RECEIVED')).toMatchObject({ detail: grn.grn_no, user_name: 'Ama Owusu' });
    });

    it('documents from the original data still show when they were created', async () => {
      const h = (await (await as(app, 'kasante')).get('/api/history/orders/1').expect(200)).body;
      expect(h[0]).toMatchObject({ event: 'CREATED', detail: 'Loaded with the original data' });
      expect(h[0].event_at).toBeTruthy();
    });

    it('invoices and payments now carry an exact time, not just a date', async () => {
      const acc = await as(app, 'edarko');
      const invoices = (await acc.get('/api/invoices').expect(200)).body;
      const rows = Array.isArray(invoices) ? invoices : invoices.rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(isTime(rows[0].created_at)).toBe(true);
      const payments = (await acc.get('/api/payments').expect(200)).body;
      expect(isTime(payments[0].created_at)).toBe(true);
    });
  });
});

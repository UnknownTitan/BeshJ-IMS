/**
 * Phase 3 end-to-end tests: customer orders, credit control, FEFO invoicing
 * and payments (UC9, FR5, FR9, FR10).
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp } from './helpers';

const COKE = 1; // CC-300-GL: GH₵ 4.00, cost 3.20, crate of 24 (GH₵ 25 deposit)
const VOLTIC = 8; // VOL-500-PET: GH₵ 3.00, no returnable container
const CASH_CUSTOMER = 1; // Auntie Ama Provisions
const KANESHIE = 2; // credit limit 20,000, small balance
const OSU = 3; // credit limit 5,000, already owes more than that

describe('Phase 3 - sales, invoicing and payments (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const rep = () => as(app, 'kasante');
  const accountant = () => as(app, 'edarko');

  const warehouseQty = async (productId: number) => {
    const wm = await as(app, 'kmensah');
    const list = (await wm.get('/api/products').expect(200)).body;
    return list.find((p: any) => p.product_id === productId).warehouse_qty as number;
  };

  const newOrder = async (customerId: number, lines: object[]) =>
    (await (await rep()).post('/api/orders', { customer_id: customerId, lines }).expect(201)).body;

  describe('placing orders', () => {
    it('a Sales Rep creates a DRAFT at list prices; totals include 20% tax and crate deposit', async () => {
      const o = await newOrder(CASH_CUSTOMER, [{ product_id: COKE, quantity: 48 }]);
      expect(o.status).toBe('DRAFT');
      expect(o.order_no).toMatch(/^SO-\d{4}-\d{5}$/);
      expect(o.lines[0].unit_price).toBe(4);
      expect(o.lines[0].containers).toBe(2); // 48 bottles = 2 crates
      expect(o.totals).toEqual({ subtotal: 192, tax_rate: 20, tax: 38.4, deposit: 50, total: 280.4 });
    });

    it('Ghana tax components in force: VAT 15% + NHIL 2.5% + GETFund 2.5%', async () => {
      const rates = (await (await rep()).get('/api/tax-rates').expect(200)).body;
      expect(rates.map((r: any) => r.tax_code).sort()).toEqual(['GETFUND', 'NHIL', 'VAT']);
      expect(rates.reduce((s: number, r: any) => s + r.rate_percent, 0)).toBe(20);
    });

    it('a Sales Rep cannot change prices', async () => {
      await (await rep())
        .post('/api/orders', { customer_id: CASH_CUSTOMER, lines: [{ product_id: COKE, quantity: 24, unit_price: 3.5 }] })
        .expect(403);
    });

    it('nobody can sell below cost price', async () => {
      const res = await (await as(app, 'kmensah'))
        .post('/api/orders', { customer_id: CASH_CUSTOMER, lines: [{ product_id: COKE, quantity: 24, unit_price: 3 }] })
        .expect(400);
      expect(res.body.message).toMatch(/below the cost price/);
    });

    it('an order for more than is in stock is refused on submit', async () => {
      const o = await newOrder(CASH_CUSTOMER, [{ product_id: COKE, quantity: 999999 }]);
      const res = await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(400);
      expect(res.body.message).toMatch(/Not enough stock/);
    });
  });

  describe('credit control (FR9)', () => {
    it('a cash customer\'s order is confirmed straight away', async () => {
      const o = await newOrder(CASH_CUSTOMER, [{ product_id: VOLTIC, quantity: 24 }]);
      const res = await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200);
      expect(res.body.status).toBe('CONFIRMED');
    });

    it('a credit customer within their limit is confirmed', async () => {
      const o = await newOrder(KANESHIE, [{ product_id: VOLTIC, quantity: 24 }]);
      const res = await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200);
      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.credit_check.available).toBeGreaterThan(res.body.credit_check.order_total);
    });

    it('over the limit: waits for an Accountant, who can approve it', async () => {
      const o = await newOrder(OSU, [{ product_id: VOLTIC, quantity: 24 }]);
      const submitted = (await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200)).body;
      expect(submitted.status).toBe('PENDING_CREDIT_APPROVAL');

      await (await rep()).post(`/api/orders/${o.order_id}/approve-credit`).expect(403); // Sales Reps can't approve
      const approved = (await (await accountant()).post(`/api/orders/${o.order_id}/approve-credit`).expect(200)).body;
      expect(approved.status).toBe('CONFIRMED');
      expect(approved.credit_approved_by_name).toBe('Efua Darko');
    });

    it('order lines are locked after submitting', async () => {
      const o = await newOrder(CASH_CUSTOMER, [{ product_id: VOLTIC, quantity: 24 }]);
      await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200);
      await (await rep()).patch(`/api/orders/${o.order_id}`, { lines: [{ product_id: VOLTIC, quantity: 1 }] }).expect(400);
    });
  });

  describe('invoicing, FEFO picking and payment (FR5, FR10)', () => {
    it('full flow: invoice picks earliest expiry first, then delivery and payment complete the order', async () => {
      const before = await warehouseQty(COKE);
      const o = await newOrder(CASH_CUSTOMER, [{ product_id: COKE, quantity: 48 }]);
      await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200);

      const invoiced = (await (await rep()).post(`/api/orders/${o.order_id}/invoice`).expect(200)).body;
      expect(invoiced.status).toBe('PICKING');
      expect(invoiced.invoice.invoice_no).toMatch(/^INV-\d{4}-\d{5}$/);
      expect(invoiced.invoice.total_amount).toBe(280.4);
      expect(invoiced.invoice.status).toBe('SIGNED');
      expect(invoiced.invoice.gra_sdc_code).toBe(`SIM-${invoiced.invoice.invoice_no}`);
      expect(await warehouseQty(COKE)).toBe(before - 48);

      // FEFO: batches taken in expiry order, adding up to the quantity sold
      const dates = invoiced.picked.map((p: any) => p.expiry_date);
      expect([...dates].sort()).toEqual(dates);
      expect(invoiced.picked.reduce((s: number, p: any) => s + p.quantity, 0)).toBe(48);

      // Overpayment is refused by the database trigger
      const acc = await accountant();
      const over = await acc
        .post('/api/payments', { customer_id: CASH_CUSTOMER, invoice_id: invoiced.invoice.invoice_id, amount: 300, payment_method: 'CASH' })
        .expect(400);
      expect(over.body.message).toMatch(/more than the 280.4/);

      // Pay in two parts, then deliver -> PAID
      await acc
        .post('/api/payments', {
          customer_id: CASH_CUSTOMER,
          invoice_id: invoiced.invoice.invoice_id,
          amount: 200,
          payment_method: 'MOBILE_MONEY',
          reference: 'MOMO-123456',
        })
        .expect(201);
      const driver = await as(app, 'yboateng');
      await driver.post(`/api/orders/${o.order_id}/deliver`, {}).expect(400); // a delivery needs a van
      const delivered = (await driver.post(`/api/orders/${o.order_id}/deliver`, { van_id: 3 }).expect(200)).body;
      expect(delivered.status).toBe('DELIVERED'); // 80.40 still owed
      expect(delivered.van_name).toBeTruthy();
      const last = (
        await acc
          .post('/api/payments', { customer_id: CASH_CUSTOMER, invoice_id: invoiced.invoice.invoice_id, amount: 80.4, payment_method: 'CASH' })
          .expect(201)
      ).body;
      expect(last.order_status).toBe('PAID');
    });

    it('mobile money payments need a transaction reference', async () => {
      const res = await (await accountant())
        .post('/api/payments', { customer_id: KANESHIE, amount: 50, payment_method: 'MOBILE_MONEY' })
        .expect(400);
      expect(String(res.body.message)).toMatch(/transaction reference/);
    });

    it('a payment cannot be put against another customer\'s invoice', async () => {
      const invoices = (await (await accountant()).get(`/api/invoices?customerId=${KANESHIE}`).expect(200)).body;
      const res = await (await accountant())
        .post('/api/payments', { customer_id: CASH_CUSTOMER, invoice_id: invoices[0].invoice_id, amount: 1, payment_method: 'CASH' })
        .expect(400);
      expect(res.body.message).toMatch(/belongs to another customer/);
    });

    it('returnable crates are recorded as issued to the customer', async () => {
      const o = await newOrder(KANESHIE, [{ product_id: COKE, quantity: 24 }]);
      await (await rep()).post(`/api/orders/${o.order_id}/submit`).expect(200);
      const before = (await (await accountant()).get(`/api/customers/${KANESHIE}`).expect(200)).body.empties;
      await (await rep()).post(`/api/orders/${o.order_id}/invoice`).expect(200);
      const after = (await (await accountant()).get(`/api/customers/${KANESHIE}`).expect(200)).body.empties;
      const crates = (list: any[]) => list.find((e) => e.container_name === 'Crate (24 x 300 ml)')?.containers_held ?? 0;
      expect(crates(after)).toBe(crates(before) + 1);
    });

    it('an invoiced order can no longer be cancelled; a confirmed one can', async () => {
      const a = await newOrder(CASH_CUSTOMER, [{ product_id: VOLTIC, quantity: 24 }]);
      await (await rep()).post(`/api/orders/${a.order_id}/submit`).expect(200);
      expect((await (await rep()).post(`/api/orders/${a.order_id}/cancel`).expect(200)).body.status).toBe('CANCELLED');

      const b = await newOrder(CASH_CUSTOMER, [{ product_id: VOLTIC, quantity: 24 }]);
      await (await rep()).post(`/api/orders/${b.order_id}/submit`).expect(200);
      await (await rep()).post(`/api/orders/${b.order_id}/invoice`).expect(200);
      await (await rep()).post(`/api/orders/${b.order_id}/cancel`).expect(400);
    });
  });
});

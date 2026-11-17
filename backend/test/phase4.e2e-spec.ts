/**
 * Phase 4 end-to-end tests: write-offs (UC3, FR6), empties (UC7),
 * van loading and reconciliation (UC6, FR7), stocktake (UC4, FR8).
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp } from './helpers';

const COKE = 1; // cost GH₵ 3.20, batch 2 = CC27L004 in the Main Warehouse
const VOLTIC = 8; // cost GH₵ 2.40, batch 8 = VO27L015
const COKE_BATCH = 2;
const VOLTIC_BATCH = 8;
const KANESHIE = 2; // holds 10 crates (24 x 300 ml) in the sample data
const CRATE_24 = 1;
const VAN_2 = 4; // Van 2 - Tema, driver kofori
const KUMASI_DEPOT = 2;

describe('Phase 4 - warehouse operations (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const wm = () => as(app, 'kmensah');
  const keeper = () => as(app, 'aowusu');

  const warehouseQty = async (productId: number) => {
    const list = (await (await wm()).get('/api/products').expect(200)).body;
    return list.find((p: any) => p.product_id === productId).warehouse_qty as number;
  };
  const balance = async (customerId: number) =>
    (await (await as(app, 'edarko')).get(`/api/customers/${customerId}`).expect(200)).body.balance as number;

  // -------------------------------------------------------------- write-offs
  describe('breakages and write-offs (UC3)', () => {
    it('a small breakage is posted straight away and leaves stock', async () => {
      const before = await warehouseQty(VOLTIC);
      const wo = (
        await (await keeper())
          .post('/api/write-offs', { batch_id: VOLTIC_BATCH, quantity: 24, reason_code: 'BROKEN', description: 'Pack dropped from forklift' })
          .expect(201)
      ).body;
      expect(wo.status).toBe('APPROVED'); // 24 x 2.40 = 57.60, under the GH₵ 200 limit
      expect(wo.write_off_value).toBe(57.6);
      expect(wo.write_off_no).toMatch(/^WO-\d{4}-\d{4}$/);
      expect(await warehouseQty(VOLTIC)).toBe(before - 24);
    });

    it('a large write-off waits for a Warehouse Manager; stock only leaves on approval', async () => {
      const before = await warehouseQty(COKE);
      const wo = (
        await (await keeper())
          .post('/api/write-offs', { batch_id: COKE_BATCH, quantity: 96, reason_code: 'DAMAGED_IN_TRANSIT', description: '4 crates crushed', responsible_user_id: 6 })
          .expect(201)
      ).body;
      expect(wo.status).toBe('PENDING_APPROVAL'); // 96 x 3.20 = 307.20
      expect(await warehouseQty(COKE)).toBe(before);

      await (await keeper()).post(`/api/write-offs/${wo.write_off_id}/approve`).expect(403);
      const approved = (await (await wm()).post(`/api/write-offs/${wo.write_off_id}/approve`, {}).expect(200)).body;
      expect(approved.status).toBe('APPROVED');
      expect(await warehouseQty(COKE)).toBe(before - 96);
    });

    it('a manager cannot approve a large write-off they recorded themselves', async () => {
      const m = await wm();
      const wo = (
        await m.post('/api/write-offs', { batch_id: COKE_BATCH, quantity: 96, reason_code: 'EXPIRED', description: 'Old stock' }).expect(201)
      ).body;
      const res = await m.post(`/api/write-offs/${wo.write_off_id}/approve`, {}).expect(400);
      expect(res.body.message).toMatch(/you recorded/);
    });

    it('rejecting needs a reason and leaves stock untouched', async () => {
      const before = await warehouseQty(COKE);
      const wo = (
        await (await keeper()).post('/api/write-offs', { batch_id: COKE_BATCH, quantity: 120, reason_code: 'THEFT', description: 'Missing after weekend' }).expect(201)
      ).body;
      await (await wm()).post(`/api/write-offs/${wo.write_off_id}/reject`, {}).expect(400);
      const rejected = (await (await wm()).post(`/api/write-offs/${wo.write_off_id}/reject`, { note: 'Found in bay 4' }).expect(200)).body;
      expect(rejected.status).toBe('REJECTED');
      expect(await warehouseQty(COKE)).toBe(before);
    });

    it('cannot write off more than the batch holds', async () => {
      await (await keeper())
        .post('/api/write-offs', { batch_id: VOLTIC_BATCH, quantity: 999999, reason_code: 'BROKEN', description: 'x' })
        .expect(400);
    });
  });

  // ----------------------------------------------------------------- empties
  describe('empties and deposits (UC7)', () => {
    it('returned crates credited to the account lower the balance by their deposit', async () => {
      const before = await balance(KANESHIE);
      const res = (
        await (await keeper())
          .post('/api/empties/returns', { customer_id: KANESHIE, refund_method: 'CREDIT', lines: [{ container_type_id: CRATE_24, quantity: 2 }] })
          .expect(201)
      ).body;
      expect(res.deposit_refunded).toBe(50);
      expect(await balance(KANESHIE)).toBeCloseTo(before - 50, 2);
    });

    it('a cash refund does not change the balance', async () => {
      const before = await balance(KANESHIE);
      await (await keeper())
        .post('/api/empties/returns', { customer_id: KANESHIE, refund_method: 'CASH', lines: [{ container_type_id: CRATE_24, quantity: 1 }] })
        .expect(201);
      expect(await balance(KANESHIE)).toBeCloseTo(before, 2);
    });

    it('a customer cannot return more containers than they hold (database trigger)', async () => {
      const res = await (await keeper())
        .post('/api/empties/returns', { customer_id: KANESHIE, refund_method: 'CREDIT', lines: [{ container_type_id: CRATE_24, quantity: 500 }] })
        .expect(400);
      expect(res.body.message).toMatch(/only holds/);
    });
  });

  // -------------------------------------------------------------- van trips
  describe('van loading, van sales and reconciliation (UC6)', () => {
    it('load → sell from the van → reconcile with breakage and shortage', async () => {
      const k = await keeper();
      const cokeBefore = await warehouseQty(COKE);

      // Morning: load Van 2
      const trip = (
        await k
          .post('/api/van-trips', { van_id: VAN_2, lines: [{ product_id: COKE, quantity: 96 }, { product_id: VOLTIC, quantity: 48 }] })
          .expect(201)
      ).body;
      expect(trip.trip_no).toMatch(/^TRIP-\d{4}-\d{4}$/);
      expect(trip.driver_name).toBe('Kwesi Ofori');
      expect(await warehouseQty(COKE)).toBe(cokeBefore - 96);
      const onVan = (p: number) => trip.on_van.find((x: any) => x.product_id === p)?.qty;
      expect(onVan(COKE)).toBe(96);

      // A van can only have one open trip
      await k.post('/api/van-trips', { van_id: VAN_2, lines: [{ product_id: COKE, quantity: 24 }] }).expect(400);

      // Day: a van sale of 24 Coke, paid in cash to the driver
      const rep = await as(app, 'kasante');
      const order = (await rep.post('/api/orders', { customer_id: 1, lines: [{ product_id: COKE, quantity: 24 }] }).expect(201)).body;
      await rep.post(`/api/orders/${order.order_id}/submit`).expect(200);
      const sold = (await rep.post(`/api/orders/${order.order_id}/invoice`, { van_id: VAN_2 }).expect(200)).body;
      expect(sold.status).toBe('LOADED_ON_VAN');
      const driver = await as(app, 'kofori');
      await driver
        .post('/api/payments', { customer_id: 1, invoice_id: sold.invoice.invoice_id, amount: sold.invoice.total_amount, payment_method: 'CASH' })
        .expect(201);
      expect((await driver.post(`/api/orders/${order.order_id}/deliver`, {}).expect(200)).body.status).toBe('PAID');

      // Evening: counting more than the van holds is refused
      await k
        .post(`/api/van-trips/${trip.trip_id}/reconcile`, { cash_declared: 0, lines: [{ product_id: COKE, qty_returned: 100, qty_damaged: 0 }] })
        .expect(400);

      // 72 Coke should be on the van: 60 back good, 6 broken, 6 missing. All 48 Voltic back.
      const done = (
        await k
          .post(`/api/van-trips/${trip.trip_id}/reconcile`, {
            cash_declared: sold.invoice.total_amount,
            lines: [
              { product_id: COKE, qty_returned: 60, qty_damaged: 6 },
              { product_id: VOLTIC, qty_returned: 48, qty_damaged: 0 },
            ],
          })
          .expect(200)
      ).body;
      expect(done.status).toBe('RECONCILED');
      const coke = done.lines.find((l: any) => l.product_id === COKE);
      expect(coke).toMatchObject({ qty_loaded: 96, qty_sold: 24, qty_expected: 72, qty_returned: 60, qty_damaged: 6, qty_short: 6 });
      expect(Number(done.cash_expected)).toBeGreaterThanOrEqual(sold.invoice.total_amount);
      expect(await warehouseQty(COKE)).toBe(cokeBefore - 96 + 60);

      // The van is empty afterwards
      const stock = (await k.get(`/api/vans/${VAN_2}/stock`).expect(200)).body;
      expect(stock).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------- stocktake
  describe('stocktake (UC4)', () => {
    it('count, then the Warehouse Manager posts the difference as an adjustment', async () => {
      const k = await keeper();
      const st = (await k.post('/api/stocktakes', { location_id: KUMASI_DEPOT }).expect(201)).body;
      expect(st.stocktake_no).toMatch(/^ST-\d{4}-\d{4}$/);
      const line = st.lines[0];

      const counted = (
        await k.patch(`/api/stocktakes/${st.stocktake_id}/counts`, { counts: [{ batch_id: line.batch_id, counted_qty: line.system_qty - 2 }] }).expect(200)
      ).body;
      expect(counted.summary).toMatchObject({ counted: 1, differences: 1, units_short: 2 });

      // A manager re-saving the same number does not take over the count
      const resaved = (
        await (await wm()).patch(`/api/stocktakes/${st.stocktake_id}/counts`, { counts: [{ batch_id: line.batch_id, counted_qty: line.system_qty - 2 }] }).expect(200)
      ).body;
      expect(resaved.lines[0].counted_by_name).toBe('Ama Owusu');

      await k.post(`/api/stocktakes/${st.stocktake_id}/post`).expect(403); // Store Keepers count, managers post
      const posted = (await (await wm()).post(`/api/stocktakes/${st.stocktake_id}/post`).expect(200)).body;
      expect(posted.status).toBe('POSTED');

      const again = (await k.post('/api/stocktakes', { location_id: KUMASI_DEPOT }).expect(201)).body;
      expect(again.lines.find((l: any) => l.batch_id === line.batch_id).system_qty).toBe(line.system_qty - 2);
      await (await wm()).post(`/api/stocktakes/${again.stocktake_id}/cancel`).expect(200);
    });

    it('cannot post until every batch is counted', async () => {
      const st = (await (await keeper()).post('/api/stocktakes', { location_id: 1 }).expect(201)).body;
      const res = await (await wm()).post(`/api/stocktakes/${st.stocktake_id}/post`).expect(400);
      expect(res.body.message).toMatch(/not been counted/);
      await (await wm()).post(`/api/stocktakes/${st.stocktake_id}/cancel`).expect(200);
    });
  });
});

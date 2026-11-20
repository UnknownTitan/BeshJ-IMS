/**
 * Phase 2 end-to-end tests: purchase orders (UC2, FR4) and receiving (UC5, FR2, FR3).
 * Follows one order from draft to fully received, plus the rules that guard it.
 */
import { INestApplication } from '@nestjs/common';
import { as, createTestApp, uniq } from './helpers';

const COKE = 1; // CC-300-GL, supplier 1, cost 3.20
const SPRITE = 3; // SP-300-GL, supplier 1, below its reorder level in the sample data
const MALTA = 4; // supplier 2

const futureDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

describe('Phase 2 - purchasing and receiving (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const warehouseQty = async (productId: number) => {
    const wm = await as(app, 'kmensah');
    const list = (await wm.get('/api/products').expect(200)).body;
    return list.find((p: any) => p.product_id === productId).warehouse_qty as number;
  };

  const newPo = async () => {
    const wm = await as(app, 'kmensah');
    const res = await wm
      .post('/api/purchase-orders', {
        supplier_id: 1,
        expected_date: futureDate(3),
        lines: [
          { product_id: COKE, quantity: 480 },
          { product_id: SPRITE, quantity: 240, unit_cost: 3.1 },
        ],
      })
      .expect(201);
    return res.body;
  };

  const approve = async (id: number) => (await as(app, 'aadjei')).post(`/api/purchase-orders/${id}/approve`).expect(200);

  describe('raising and approving orders (UC2, FR4)', () => {
    it('Warehouse Manager raises a DRAFT order with a PO number and default costs', async () => {
      const po = await newPo();
      expect(po.status).toBe('DRAFT');
      expect(po.po_no).toMatch(/^PO-\d{4}-\d{4}$/);
      expect(po.lines[0].unit_cost).toBe(3.2); // taken from the product's cost price
      expect(po.lines[1].unit_cost).toBe(3.1); // given explicitly
    });

    it('a product from another supplier is rejected', async () => {
      const wm = await as(app, 'kmensah');
      const res = await wm
        .post('/api/purchase-orders', { supplier_id: 1, lines: [{ product_id: MALTA, quantity: 24 }] })
        .expect(400);
      expect(res.body.message).toMatch(/not supplied by this supplier/);
    });

    it('a Store Keeper cannot raise purchase orders', async () => {
      const keeper = await as(app, 'aowusu');
      await keeper.post('/api/purchase-orders', { supplier_id: 1, lines: [{ product_id: COKE, quantity: 24 }] }).expect(403);
    });

    it('separation of duties: the creator cannot approve their own order', async () => {
      const po = await newPo();
      const wm = await as(app, 'kmensah');
      const res = await wm.post(`/api/purchase-orders/${po.po_id}/approve`).expect(400);
      expect(res.body.message).toMatch(/cannot approve a purchase order you created/);
    });

    it('Management approves; lines are then locked', async () => {
      const po = await newPo();
      const res = await approve(po.po_id);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approved_by_name).toBe('Akosua Adjei');

      const wm = await as(app, 'kmensah');
      await wm.patch(`/api/purchase-orders/${po.po_id}`, { lines: [{ product_id: COKE, quantity: 1 }] }).expect(400);
    });

    it('FR4: a product at its reorder level is suggested, rounded up to whole crates', async () => {
      const wm = await as(app, 'kmensah');
      // Put Sprite exactly at its reorder level so the test does not depend on earlier tests.
      const sprite = (await wm.get(`/api/products/${SPRITE}`).expect(200)).body;
      const qty = await warehouseQty(SPRITE);
      await wm.patch(`/api/products/${SPRITE}`, { reorder_level: qty }).expect(200);
      try {
        const list = (await wm.get('/api/purchase-orders/suggestions').expect(200)).body;
        const s = list.find((x: any) => x.product_id === SPRITE);
        expect(s).toBeDefined();
        expect(s.suggested_qty % 24).toBe(0);
        expect(s.suggested_qty).toBeGreaterThanOrEqual(0);
      } finally {
        await wm.patch(`/api/products/${SPRITE}`, { reorder_level: sprite.reorder_level }).expect(200);
      }
    });
  });

  describe('receiving goods (UC5, FR2)', () => {
    it('a partial delivery with breakages: good units go into stock, the order becomes PARTIAL', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const before = await warehouseQty(COKE);
      const batch = `T${uniq()}`;

      const keeper = await as(app, 'aowusu');
      const res = await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: `DN-${uniq()}`,
          lines: [
            {
              line_no: 1,
              qty_received: 456,
              qty_damaged: 24,
              damage_note: 'One crate broken in transit',
              batch_no: batch,
              expiry_date: futureDate(180),
            },
          ],
        })
        .expect(201);

      expect(res.body.status).toBe('PARTIAL');
      expect(res.body.grn.grn_no).toMatch(/^GRN-\d{4}-\d{4}$/);
      expect(res.body.lines[0].qty_received).toBe(456);
      expect(res.body.lines[0].qty_outstanding).toBe(24); // damaged units are still owed by the supplier
      expect(await warehouseQty(COKE)).toBe(before + 456); // only good units are added (trigger)

      // FR3: the receipt is in the stock ledger with the GRN number
      const wm = await as(app, 'kmensah');
      const ledger = (await wm.get(`/api/stock/movements?productId=${COKE}&type=RECEIPT`).expect(200)).body;
      expect(ledger[0].batch_no).toBe(batch);
      expect(ledger[0].reference).toBe(res.body.grn.grn_no);
    });

    it('receiving the rest completes the order (RECEIVED)', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const keeper = await as(app, 'aowusu');
      const exp = futureDate(200);
      await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: `DN-${uniq()}`,
          lines: [{ line_no: 1, qty_received: 480, batch_no: `A${uniq()}`, expiry_date: exp }],
        })
        .expect(201);
      const res = await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: `DN-${uniq()}`,
          lines: [{ line_no: 2, qty_received: 240, batch_no: `B${uniq()}`, expiry_date: exp }],
        })
        .expect(201);
      expect(res.body.status).toBe('RECEIVED');
      expect(res.body.receipts).toHaveLength(2);
    });

    it('cannot receive more than is outstanding', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const keeper = await as(app, 'aowusu');
      const res = await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: 'DN-OVER',
          lines: [{ line_no: 1, qty_received: 500, batch_no: `O${uniq()}`, expiry_date: futureDate(90) }],
        })
        .expect(400);
      expect(res.body.message).toMatch(/only 480 are outstanding/);
    });

    it('expired goods are refused', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const keeper = await as(app, 'aowusu');
      const res = await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: 'DN-OLD',
          lines: [{ line_no: 1, qty_received: 24, batch_no: `X${uniq()}`, expiry_date: '2020-01-01' }],
        })
        .expect(400);
      expect(res.body.message).toMatch(/already expired/);
    });

    it('a failed delivery changes nothing (one transaction)', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const before = await warehouseQty(COKE);
      const keeper = await as(app, 'aowusu');
      // line 1 is fine, line 2 is over-delivered -> whole receipt must roll back
      await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: 'DN-ROLLBACK',
          lines: [
            { line_no: 1, qty_received: 48, batch_no: `R${uniq()}`, expiry_date: futureDate(90) },
            { line_no: 2, qty_received: 999, batch_no: `R${uniq()}`, expiry_date: futureDate(90) },
          ],
        })
        .expect(400);
      expect(await warehouseQty(COKE)).toBe(before);
      const after = (await keeper.get(`/api/purchase-orders/${po.po_id}`).expect(200)).body;
      expect(after.status).toBe('APPROVED');
      expect(after.receipts).toHaveLength(0);
    });

    it('a draft order cannot be received until approved', async () => {
      const po = await newPo();
      const keeper = await as(app, 'aowusu');
      await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: 'DN-DRAFT',
          lines: [{ line_no: 1, qty_received: 24, batch_no: 'D1', expiry_date: futureDate(90) }],
        })
        .expect(400);
    });

    it('a partly delivered order can be closed but not cancelled', async () => {
      const po = await newPo();
      await approve(po.po_id);
      const keeper = await as(app, 'aowusu');
      await keeper
        .post(`/api/purchase-orders/${po.po_id}/receive`, {
          delivery_note_no: `DN-${uniq()}`,
          lines: [{ line_no: 1, qty_received: 240, batch_no: `C${uniq()}`, expiry_date: futureDate(120) }],
        })
        .expect(201);
      const wm = await as(app, 'kmensah');
      await wm.post(`/api/purchase-orders/${po.po_id}/cancel`).expect(400);
      const res = await wm.post(`/api/purchase-orders/${po.po_id}/close`).expect(200);
      expect(res.body.status).toBe('RECEIVED');
    });
  });

  describe('stock ledger integrity (FR3, database rules)', () => {
    it('lists the sample receipt for Coca-Cola batch CC27L004', async () => {
      const wm = await as(app, 'kmensah');
      const ledger = (await wm.get(`/api/stock/movements?productId=${COKE}&limit=1000`).expect(200)).body;
      expect(ledger.some((m: any) => m.batch_no === 'CC27L004' && m.movement_type === 'RECEIPT')).toBe(true);
    });
  });
});

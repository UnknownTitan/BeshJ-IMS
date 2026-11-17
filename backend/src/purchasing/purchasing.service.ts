import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CreatePurchaseOrderDto, PoLineDto, ReceiveGoodsDto, UpdatePurchaseOrderDto } from './purchasing.dto';

/** Purchase orders still waiting for goods. */
const OPEN_STATUSES = ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL'];

/**
 * UC2 Reorder & purchase orders (FR4) and UC5 Receive stock (FR2, FR3).
 *
 * Purchase order life cycle:
 *   DRAFT --approve--> APPROVED --send--> SENT --receive--> PARTIAL --receive--> RECEIVED
 *     \-----------------cancel (before any goods arrive)-----------> CANCELLED
 *   PARTIAL --close (supplier won't deliver the rest)--> RECEIVED
 */
@Injectable()
export class PurchasingService {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------------ reads

  list(status?: string) {
    return this.db.query(
      `SELECT po.po_id, po.po_no, po.status, po.po_date, po.expected_date,
              s.supplier_id, s.supplier_name,
              cu.full_name AS created_by_name, au.full_name AS approved_by_name,
              SUM(ls.line_total)        AS total_value,
              COUNT(ls.line_no)::int    AS line_count,
              SUM(ls.qty_outstanding)::int AS qty_outstanding
         FROM purchase_order po
         JOIN supplier s  ON s.supplier_id = po.supplier_id
         JOIN app_user cu ON cu.user_id = po.created_by
         LEFT JOIN app_user au ON au.user_id = po.approved_by
         LEFT JOIN v_po_line_status ls ON ls.po_id = po.po_id
        WHERE ($1::text IS NULL OR po.status = ANY (string_to_array($1, ',')))
        GROUP BY po.po_id, s.supplier_id, cu.full_name, au.full_name
        ORDER BY po.po_id DESC`,
      [status || null],
    );
  }

  async get(id: number) {
    const po = await this.db.one(
      `SELECT po.*, s.supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
              cu.full_name AS created_by_name, au.full_name AS approved_by_name
         FROM purchase_order po
         JOIN supplier s  ON s.supplier_id = po.supplier_id
         JOIN app_user cu ON cu.user_id = po.created_by
         LEFT JOIN app_user au ON au.user_id = po.approved_by
        WHERE po.po_id = $1`,
      [id],
    );
    if (!po) throw new NotFoundException('Purchase order not found');

    const [lines, receipts] = await Promise.all([
      this.db.query(`SELECT * FROM v_po_line_status WHERE po_id = $1 ORDER BY line_no`, [id]),
      this.db.query(
        `SELECT g.grn_id, g.grn_no, g.received_at, g.delivery_note_no, g.notes,
                l.location_name, u.full_name AS received_by_name,
                json_agg(json_build_object(
                  'line_no', gl.line_no, 'product_name', p.product_name,
                  'batch_no', b.batch_no, 'expiry_date', b.expiry_date,
                  'qty_received', gl.qty_received, 'qty_damaged', gl.qty_damaged,
                  'damage_note', gl.damage_note) ORDER BY gl.line_no) AS lines
           FROM goods_receipt g
           JOIN stock_location l ON l.location_id = g.location_id
           JOIN app_user u ON u.user_id = g.received_by
           JOIN goods_receipt_line gl ON gl.grn_id = g.grn_id
           JOIN purchase_order_line pl ON pl.po_id = gl.po_id AND pl.line_no = gl.line_no
           JOIN product p ON p.product_id = pl.product_id
           LEFT JOIN stock_batch b ON b.batch_id = gl.batch_id
          WHERE g.po_id = $1
          GROUP BY g.grn_id, l.location_name, u.full_name
          ORDER BY g.received_at`,
        [id],
      ),
    ]);
    return { ...po, lines, receipts };
  }

  /**
   * FR4: what to reorder. For each product at or below its reorder level,
   * suggest enough to reach twice the reorder level, minus what is already
   * on open orders, rounded up to whole crates/cartons.
   */
  suggestions() {
    return this.db.query(
      `WITH on_order AS (
         SELECT ls.product_id, SUM(ls.qty_outstanding)::int AS qty
           FROM v_po_line_status ls JOIN purchase_order po ON po.po_id = ls.po_id
          WHERE po.status = ANY ($1)
          GROUP BY ls.product_id
       ), pack AS (
         SELECT product_id, MAX(base_qty) AS pack_qty FROM unit_conversion GROUP BY product_id
       )
       SELECT a.product_id, a.sku, a.product_name, a.supplier_id, a.supplier_name,
              a.warehouse_qty, a.reorder_level, p.cost_price, p.base_unit,
              COALESCE(o.qty, 0) AS on_order,
              COALESCE(k.pack_qty, 1) AS pack_qty,
              GREATEST(0, CEIL((2 * a.reorder_level - a.warehouse_qty - COALESCE(o.qty, 0))::numeric
                               / COALESCE(k.pack_qty, 1)) * COALESCE(k.pack_qty, 1))::int AS suggested_qty
         FROM v_reorder_alerts a
         JOIN product p ON p.product_id = a.product_id
         LEFT JOIN on_order o ON o.product_id = a.product_id
         LEFT JOIN pack k ON k.product_id = a.product_id
        ORDER BY a.supplier_name, a.product_name`,
      [OPEN_STATUSES],
    );
  }

  // ----------------------------------------------------------------- writes

  async create(dto: CreatePurchaseOrderDto, userId: number) {
    const id = await this.db.transaction(userId, async (c) => {
      const lines = await this.priceLines(c, dto.supplier_id, dto.lines);
      const { rows } = await c.query(
        `INSERT INTO purchase_order (po_no, supplier_id, created_by, po_date, expected_date)
         VALUES (fn_next_doc_no('PO', 'po_no_seq'), $1, $2, CURRENT_DATE, $3)
         RETURNING po_id`,
        [dto.supplier_id, userId, dto.expected_date || null],
      );
      await this.insertLines(c, rows[0].po_id, lines);
      return rows[0].po_id as number;
    });
    return this.get(id);
  }

  async update(id: number, dto: UpdatePurchaseOrderDto, userId: number) {
    await this.db.transaction(userId, async (c) => {
      const po = await this.lock(c, id);
      this.requireStatus(po, ['DRAFT'], 'edit');
      if (dto.expected_date !== undefined) {
        await c.query(`UPDATE purchase_order SET expected_date = $1 WHERE po_id = $2`, [dto.expected_date || null, id]);
      }
      if (dto.lines) {
        const lines = await this.priceLines(c, po.supplier_id, dto.lines);
        await c.query(`DELETE FROM purchase_order_line WHERE po_id = $1`, [id]);
        await this.insertLines(c, id, lines);
      }
    });
    return this.get(id);
  }

  /** Separation of duties: the approver must not be the person who raised the order. */
  async approve(id: number, userId: number) {
    await this.db.transaction(userId, async (c) => {
      const po = await this.lock(c, id);
      this.requireStatus(po, ['DRAFT'], 'approve');
      if (po.created_by === userId) {
        throw new BadRequestException('You cannot approve a purchase order you created; ask another manager');
      }
      await c.query(`UPDATE purchase_order SET status = 'APPROVED', approved_by = $1 WHERE po_id = $2`, [userId, id]);
    });
    return this.get(id);
  }

  async send(id: number, userId: number) {
    await this.setStatus(id, userId, ['APPROVED'], 'SENT', 'mark as sent');
    return this.get(id);
  }

  async cancel(id: number, userId: number) {
    await this.db.transaction(userId, async (c) => {
      const po = await this.lock(c, id);
      this.requireStatus(po, ['DRAFT', 'APPROVED', 'SENT'], 'cancel');
      await c.query(`UPDATE purchase_order SET status = 'CANCELLED' WHERE po_id = $1`, [id]);
    });
    return this.get(id);
  }

  /** Supplier will not deliver the rest: stop waiting for it. */
  async close(id: number, userId: number) {
    await this.setStatus(id, userId, ['PARTIAL'], 'RECEIVED', 'close');
    return this.get(id);
  }

  /**
   * UC5: record a delivery against a purchase order, in ONE transaction:
   *  - a goods received note (GRN) with its lines
   *  - a stock batch per product (batch no. + expiry date), new or existing
   *  - a RECEIPT stock movement per line; the database trigger
   *    trg_apply_stock_movement adds it to the batch's quantity
   *  - the order's status becomes PARTIAL or RECEIVED
   */
  async receive(id: number, dto: ReceiveGoodsDto, userId: number) {
    const grnId = await this.db.transaction(userId, async (c) => {
      const po = await this.lock(c, id);
      this.requireStatus(po, ['APPROVED', 'SENT', 'PARTIAL'], 'receive goods for');

      const locationId = dto.location_id ?? 1;
      const { rows: loc } = await c.query(`SELECT location_type FROM stock_location WHERE location_id = $1`, [locationId]);
      if (loc[0]?.location_type !== 'WAREHOUSE') throw new BadRequestException('Goods can only be received into a warehouse');

      const { rows: status } = await c.query(`SELECT * FROM v_po_line_status WHERE po_id = $1`, [id]);
      const byLine = new Map(status.map((l: any) => [l.line_no, l]));

      const { rows: grn } = await c.query(
        `INSERT INTO goods_receipt (grn_no, po_id, location_id, received_by, delivery_note_no, notes)
         VALUES (fn_next_doc_no('GRN', 'grn_no_seq'), $1, $2, $3, $4, $5) RETURNING grn_id, grn_no`,
        [id, locationId, userId, dto.delivery_note_no.trim(), dto.notes || null],
      );
      const { grn_id, grn_no } = grn[0];

      for (const line of dto.lines) {
        const ordered = byLine.get(line.line_no);
        if (!ordered) throw new BadRequestException(`Line ${line.line_no} is not on this purchase order`);
        const damaged = line.qty_damaged ?? 0;
        if (line.qty_received + damaged === 0) continue; // nothing arrived for this line
        if (line.qty_received > ordered.qty_outstanding) {
          throw new BadRequestException(
            `${ordered.product_name}: receiving ${line.qty_received} but only ${ordered.qty_outstanding} are outstanding`,
          );
        }

        let batchId: number | null = null;
        if (line.qty_received > 0) {
          batchId = await this.findOrCreateBatch(c, ordered.product_id, locationId, line.batch_no!, line.expiry_date!);
          await c.query(
            `INSERT INTO stock_movement (batch_id, movement_type, quantity, to_location_id, user_id, reference)
             VALUES ($1, 'RECEIPT', $2, $3, $4, $5)`,
            [batchId, line.qty_received, locationId, userId, grn_no],
          );
        }

        await c.query(
          `INSERT INTO goods_receipt_line (grn_id, po_id, line_no, batch_id, qty_received, qty_damaged, damage_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [grn_id, id, line.line_no, batchId, line.qty_received, damaged, damaged ? line.damage_note : null],
        );
      }

      const { rows: lines } = await c.query(`SELECT COUNT(*)::int AS n FROM goods_receipt_line WHERE grn_id = $1`, [grn_id]);
      if (lines[0].n === 0) throw new BadRequestException('Enter a quantity for at least one product');

      const { rows: left } = await c.query(
        `SELECT COALESCE(SUM(qty_outstanding), 0)::int AS outstanding FROM v_po_line_status WHERE po_id = $1`,
        [id],
      );
      await c.query(`UPDATE purchase_order SET status = $1 WHERE po_id = $2`, [
        left[0].outstanding === 0 ? 'RECEIVED' : 'PARTIAL',
        id,
      ]);
      return grn_id as number;
    });

    const po = await this.get(id);
    return { ...po, grn: po.receipts.find((r: any) => r.grn_id === grnId) };
  }

  // ---------------------------------------------------------------- helpers

  /** Lock the order row so two people cannot change it at the same time. */
  private async lock(c: PoolClient, id: number) {
    const { rows } = await c.query(`SELECT * FROM purchase_order WHERE po_id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new NotFoundException('Purchase order not found');
    return rows[0];
  }

  private requireStatus(po: any, allowed: string[], action: string) {
    if (!allowed.includes(po.status)) {
      throw new BadRequestException(`Cannot ${action} purchase order ${po.po_no}: it is ${po.status}`);
    }
  }

  private async setStatus(id: number, userId: number, from: string[], to: string, action: string) {
    await this.db.transaction(userId, async (c) => {
      const po = await this.lock(c, id);
      this.requireStatus(po, from, action);
      await c.query(`UPDATE purchase_order SET status = $1 WHERE po_id = $2`, [to, id]);
    });
  }

  /** Products must be active and come from the order's supplier; fill in default costs. */
  private async priceLines(c: PoolClient, supplierId: number, lines: PoLineDto[]) {
    const { rows } = await c.query(
      `SELECT product_id, product_name, supplier_id, cost_price, is_active FROM product WHERE product_id = ANY ($1)`,
      [lines.map((l) => l.product_id)],
    );
    const products = new Map(rows.map((p: any) => [p.product_id, p]));
    return lines.map((l) => {
      const p = products.get(l.product_id);
      if (!p) throw new BadRequestException(`Product ${l.product_id} does not exist`);
      if (!p.is_active) throw new BadRequestException(`${p.product_name} is inactive`);
      if (p.supplier_id !== supplierId) throw new BadRequestException(`${p.product_name} is not supplied by this supplier`);
      return { ...l, unit_cost: l.unit_cost ?? p.cost_price };
    });
  }

  private async insertLines(c: PoolClient, poId: number, lines: Required<PoLineDto>[]) {
    for (const [i, l] of lines.entries()) {
      await c.query(
        `INSERT INTO purchase_order_line (po_id, line_no, product_id, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5)`,
        [poId, i + 1, l.product_id, l.quantity, l.unit_cost],
      );
    }
  }

  /**
   * Same batch number already in this warehouse (e.g. a split delivery)? Add to it,
   * but only if the expiry date matches. Otherwise start a new batch at 0;
   * the RECEIPT movement then brings it up to the received quantity.
   */
  private async findOrCreateBatch(c: PoolClient, productId: number, locationId: number, batchNo: string, expiry: string) {
    const expiryDate = expiry.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (expiryDate <= today) throw new BadRequestException(`Batch ${batchNo} has already expired; do not accept it`);

    const { rows } = await c.query(
      `SELECT batch_id, to_char(expiry_date, 'YYYY-MM-DD') AS expiry FROM stock_batch
        WHERE product_id = $1 AND location_id = $2 AND batch_no = $3`,
      [productId, locationId, batchNo.trim().toUpperCase()],
    );
    if (rows[0]) {
      if (rows[0].expiry !== expiryDate) {
        throw new BadRequestException(`Batch ${batchNo} is already in stock with expiry ${rows[0].expiry}; check the date`);
      }
      return rows[0].batch_id as number;
    }
    const { rows: created } = await c.query(
      `INSERT INTO stock_batch (product_id, location_id, batch_no, received_date, expiry_date, qty_on_hand)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 0) RETURNING batch_id`,
      [productId, locationId, batchNo.trim().toUpperCase(), expiryDate],
    );
    return created[0].batch_id as number;
  }
}

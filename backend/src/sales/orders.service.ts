import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser, Role } from '../common/roles';
import { CreateOrderDto, OrderLineDto } from './sales.dto';

const MAIN_WAREHOUSE = 1;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * UC9 Customer orders, invoicing and payment (FR9, FR10).
 *
 * Order life cycle (warehouse sales; van sales come in Phase 4):
 *   DRAFT --submit--> CONFIRMED                     (within credit limit / cash customer)
 *         --submit--> PENDING_CREDIT_APPROVAL --approve (Accountant)--> CONFIRMED
 *   CONFIRMED --invoice--> PICKING   (stock picked FEFO, VAT invoice issued: one transaction)
 *   PICKING --deliver--> DELIVERED --paid in full--> PAID
 *   DRAFT / PENDING_CREDIT_APPROVAL / CONFIRMED --cancel--> CANCELLED
 */
@Injectable()
export class OrdersService {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------------ reads

  list(filters: { status?: string; customerId?: number; repId?: number }) {
    return this.db.query(
      `SELECT o.order_id, o.order_no, o.order_date, o.status, o.customer_id, c.customer_name, c.payment_terms,
              u.full_name AS sales_rep_name, v.subtotal, v.deposit, v.line_count,
              i.invoice_no, i.total_amount, ib.outstanding
         FROM customer_order o
         JOIN customer c ON c.customer_id = o.customer_id
         JOIN app_user u ON u.user_id = o.sales_rep_id
         JOIN v_order_value v ON v.order_id = o.order_id
         LEFT JOIN invoice i ON i.order_id = o.order_id AND i.status <> 'VOID'
         LEFT JOIN v_invoice_balance ib ON ib.invoice_id = i.invoice_id
        WHERE ($1::text IS NULL OR o.status = ANY (string_to_array($1, ',')))
          AND ($2::int IS NULL OR o.customer_id = $2)
          AND ($3::int IS NULL OR o.sales_rep_id = $3)
        ORDER BY o.order_id DESC`,
      [filters.status || null, filters.customerId ?? null, filters.repId ?? null],
    );
  }

  async get(id: number) {
    const order = await this.db.one(
      `SELECT o.*, c.customer_name, c.customer_type, c.phone AS customer_phone, c.gps_address, c.tin AS customer_tin,
              c.payment_terms, c.credit_limit, cb.balance AS customer_balance,
              u.full_name AS sales_rep_name, ca.full_name AS credit_approved_by_name,
              v.subtotal, v.deposit, van.location_name AS van_name, van.vehicle_reg
         FROM customer_order o
         LEFT JOIN stock_location van ON van.location_id = o.van_id
         JOIN customer c ON c.customer_id = o.customer_id
         JOIN v_customer_balance cb ON cb.customer_id = c.customer_id
         JOIN app_user u ON u.user_id = o.sales_rep_id
         LEFT JOIN app_user ca ON ca.user_id = o.credit_approved_by
         JOIN v_order_value v ON v.order_id = o.order_id
        WHERE o.order_id = $1`,
      [id],
    );
    if (!order) throw new NotFoundException('Order not found');

    const [lines, invoice, rate] = await Promise.all([
      this.db.query(`SELECT * FROM v_order_line_value WHERE order_id = $1 ORDER BY line_no`, [id]),
      this.db.one(
        `SELECT i.*, ib.amount_paid, ib.outstanding, ib.days_overdue
           FROM invoice i LEFT JOIN v_invoice_balance ib ON ib.invoice_id = i.invoice_id
          WHERE i.order_id = $1 AND i.status <> 'VOID'`,
        [id],
      ),
      this.db.one<{ rate: number }>(`SELECT fn_tax_rate() AS rate`),
    ]);

    // Before invoicing, show what the invoice will come to at today's tax rate.
    const taxRate = invoice?.tax_rate ?? rate!.rate;
    const tax = invoice ? invoice.vat_amount : round2((order.subtotal * taxRate) / 100);
    const totals = {
      subtotal: order.subtotal,
      tax_rate: taxRate,
      tax,
      deposit: invoice ? invoice.deposit_amount : order.deposit,
      total: invoice ? invoice.total_amount : round2(order.subtotal + tax + order.deposit),
    };

    let picked: any[] = [];
    let payments: any[] = [];
    if (invoice) {
      [picked, payments] = await Promise.all([this.pickedBatches(invoice.invoice_no), this.paymentsFor(invoice.invoice_id)]);
    }
    return { ...order, lines, totals, invoice, picked, payments };
  }

  /** The batches taken from stock for an invoice (FEFO), from the stock ledger. */
  pickedBatches(invoiceNo: string) {
    return this.db.query(
      `SELECT p.product_id, p.product_name, b.batch_no, b.expiry_date, m.quantity
         FROM stock_movement m
         JOIN stock_batch b ON b.batch_id = m.batch_id
         JOIN product p ON p.product_id = b.product_id
        WHERE m.reference = $1 AND m.movement_type = 'SALE'
        ORDER BY p.product_name, b.expiry_date`,
      [invoiceNo],
    );
  }

  paymentsFor(invoiceId: number) {
    return this.db.query(
      `SELECT p.payment_id, p.amount, p.payment_method, p.payment_date, p.reference, u.full_name AS received_by_name
         FROM payment p JOIN app_user u ON u.user_id = p.received_by
        WHERE p.invoice_id = $1 ORDER BY p.payment_id`,
      [invoiceId],
    );
  }

  // ----------------------------------------------------------------- writes

  async create(dto: CreateOrderDto, user: AuthUser) {
    const id = await this.db.transaction(user.userId, async (c) => {
      const { rows: cust } = await c.query(`SELECT customer_id FROM customer WHERE customer_id = $1`, [dto.customer_id]);
      if (!cust[0]) throw new BadRequestException('Customer not found');
      const lines = await this.priceLines(c, dto.lines, user);
      const { rows } = await c.query(
        `INSERT INTO customer_order (order_no, customer_id, sales_rep_id)
         VALUES (fn_next_doc_no('SO', 'so_no_seq', 5), $1, $2) RETURNING order_id`,
        [dto.customer_id, user.userId],
      );
      await this.insertLines(c, rows[0].order_id, lines);
      return rows[0].order_id as number;
    });
    return this.get(id);
  }

  async update(id: number, lines: OrderLineDto[], user: AuthUser) {
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['DRAFT'], 'edit');
      const priced = await this.priceLines(c, lines, user);
      await c.query(`DELETE FROM order_line WHERE order_id = $1`, [id]);
      await this.insertLines(c, id, priced);
    });
    return this.get(id);
  }

  /**
   * Submit a draft: check stock, then credit (FR9).
   * Credit customers whose balance + this order would pass their limit
   * wait for an Accountant's approval.
   */
  async submit(id: number, user: AuthUser) {
    let creditCheck: any = null;
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['DRAFT'], 'submit');
      await this.checkStock(c, id);

      const { rows } = await c.query(
        `SELECT c.payment_terms, c.credit_limit, cb.balance, v.subtotal, v.deposit, fn_tax_rate() AS rate
           FROM customer_order o
           JOIN customer c ON c.customer_id = o.customer_id
           JOIN v_customer_balance cb ON cb.customer_id = c.customer_id
           JOIN v_order_value v ON v.order_id = o.order_id
          WHERE o.order_id = $1`,
        [id],
      );
      const r = rows[0];
      const orderTotal = round2(r.subtotal + round2((r.subtotal * r.rate) / 100) + r.deposit);
      let status = 'CONFIRMED';
      if (r.payment_terms === 'CREDIT') {
        const available = round2(r.credit_limit - r.balance);
        creditCheck = { credit_limit: r.credit_limit, balance: r.balance, available, order_total: orderTotal };
        if (orderTotal > available) status = 'PENDING_CREDIT_APPROVAL';
      }
      await c.query(`UPDATE customer_order SET status = $1 WHERE order_id = $2`, [status, id]);
    });
    return { ...(await this.get(id)), credit_check: creditCheck };
  }

  /** An Accountant lets an over-limit order go ahead. */
  async approveCredit(id: number, user: AuthUser) {
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['PENDING_CREDIT_APPROVAL'], 'approve credit for');
      if (o.sales_rep_id === user.userId) throw new BadRequestException('You cannot approve credit on your own order');
      await c.query(`UPDATE customer_order SET status = 'CONFIRMED', credit_approved_by = $1 WHERE order_id = $2`, [
        user.userId,
        id,
      ]);
    });
    return this.get(id);
  }

  async cancel(id: number, user: AuthUser) {
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['DRAFT', 'PENDING_CREDIT_APPROVAL', 'CONFIRMED'], 'cancel');
      await c.query(`UPDATE customer_order SET status = 'CANCELLED' WHERE order_id = $1`, [id]);
    });
    return this.get(id);
  }

  /**
   * Issue the VAT invoice and take the goods out of stock, in ONE transaction:
   *  1. pick each product from the Main Warehouse, earliest expiry first
   *     (fn_fefo_allocate) and record SALE movements; the trigger lowers
   *     each batch's quantity and refuses to go below zero
   *  2. invoice: subtotal + tax (VAT 15% + NHIL 2.5% + GETFund 2.5%) + container deposit
   *  3. record the crates/kegs issued to the customer (empties)
   *  4. order status -> PICKING
   * If anything fails (e.g. not enough unexpired stock), nothing is saved.
   */
  async invoice(id: number, user: AuthUser) {
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['CONFIRMED'], 'invoice');

      const { rows: inv } = await c.query(`SELECT fn_next_doc_no('INV', 'inv_no_seq', 5) AS no, fn_tax_rate() AS rate`);
      const invoiceNo: string = inv[0].no;
      const rate: number = inv[0].rate;

      const { rows: lines } = await c.query(`SELECT * FROM v_order_line_value WHERE order_id = $1 ORDER BY line_no`, [id]);
      for (const line of lines) {
        const { rows: picks } = await c.query(`SELECT * FROM fn_fefo_allocate($1, $2::smallint, $3)`, [
          line.product_id,
          MAIN_WAREHOUSE,
          line.quantity,
        ]);
        for (const pick of picks) {
          await c.query(
            `INSERT INTO stock_movement (batch_id, movement_type, quantity, from_location_id, user_id, reference)
             VALUES ($1, 'SALE', $2, $3, $4, $5)`,
            [pick.batch_id, pick.qty_to_pick, MAIN_WAREHOUSE, user.userId, invoiceNo],
          );
        }
      }

      const subtotal = round2(lines.reduce((s: number, l: any) => s + l.line_total, 0));
      const deposit = round2(lines.reduce((s: number, l: any) => s + l.deposit, 0));
      const tax = round2((subtotal * rate) / 100);
      const { rows: cust } = await c.query(`SELECT payment_terms FROM customer WHERE customer_id = $1`, [o.customer_id]);
      const days = cust[0].payment_terms === 'CREDIT' ? 30 : 0;

      // GRA E-VAT signing is simulated: a real system would send the invoice to GRA's
      // signing device (SDC) and store the code it returns.
      const { rows: created } = await c.query(
        `INSERT INTO invoice (invoice_no, order_id, invoice_date, due_date, subtotal, vat_amount, deposit_amount,
                              total_amount, tax_rate, gra_sdc_code, status)
         VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + $3::int, $4, $5, $6, $7, $8, $9, 'SIGNED')
         RETURNING invoice_id`,
        [invoiceNo, id, days, subtotal, tax, deposit, round2(subtotal + tax + deposit), rate, `SIM-${invoiceNo}`],
      );

      // Containers handed over with the goods (empties tracking, UC7).
      const byContainer = new Map<number, { qty: number; value: number }>();
      for (const l of lines.filter((l: any) => l.containers > 0)) {
        const cur = byContainer.get(l.container_type_id) ?? { qty: 0, value: 0 };
        byContainer.set(l.container_type_id, { qty: cur.qty + l.containers, value: cur.value + l.deposit });
      }
      for (const [containerTypeId, v] of byContainer) {
        await c.query(
          `INSERT INTO empties_transaction (container_type_id, customer_id, order_id, direction, quantity, deposit_value, txn_date, recorded_by)
           VALUES ($1, $2, $3, 'ISSUED', $4, $5, CURRENT_DATE, $6)`,
          [containerTypeId, o.customer_id, id, v.qty, round2(v.value), user.userId],
        );
      }

      await c.query(`UPDATE customer_order SET status = 'PICKING' WHERE order_id = $1`, [id]);
      return created[0].invoice_id;
    });
    return this.get(id);
  }

  /**
   * Goods handed to the customer by a van (the schema requires a van for every
   * delivery: chk_order_van). If the invoice is already paid, the order is complete.
   */
  async deliver(id: number, vanId: number | undefined, user: AuthUser) {
    await this.db.transaction(user.userId, async (c) => {
      const o = await this.lock(c, id);
      this.requireStatus(o, ['PICKING', 'LOADED_ON_VAN'], 'mark as delivered');
      const van = vanId ?? o.van_id;
      if (!van) throw new BadRequestException('Choose the van that made the delivery');
      const { rows: loc } = await c.query(`SELECT location_type FROM stock_location WHERE location_id = $1`, [van]);
      if (loc[0]?.location_type !== 'VAN') throw new BadRequestException('That location is not a delivery van');

      const { rows } = await c.query(
        `SELECT ib.outstanding FROM invoice i JOIN v_invoice_balance ib ON ib.invoice_id = i.invoice_id WHERE i.order_id = $1`,
        [id],
      );
      const paid = rows[0] && Number(rows[0].outstanding) === 0;
      await c.query(`UPDATE customer_order SET status = $1, van_id = $2 WHERE order_id = $3`, [paid ? 'PAID' : 'DELIVERED', van, id]);
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- helpers

  private async lock(c: PoolClient, id: number) {
    const { rows } = await c.query(`SELECT * FROM customer_order WHERE order_id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new NotFoundException('Order not found');
    return rows[0];
  }

  private requireStatus(o: any, allowed: string[], action: string) {
    if (!allowed.includes(o.status)) {
      throw new BadRequestException(`Cannot ${action} order ${o.order_no}: it is ${o.status.replace(/_/g, ' ')}`);
    }
  }

  /** List price unless a manager or accountant sets another; never below cost. */
  private async priceLines(c: PoolClient, lines: OrderLineDto[], user: AuthUser) {
    const { rows } = await c.query(
      `SELECT product_id, product_name, selling_price, cost_price, is_active FROM product WHERE product_id = ANY ($1)`,
      [lines.map((l) => l.product_id)],
    );
    const products = new Map(rows.map((p: any) => [p.product_id, p]));
    const canPrice = [Role.ADMIN, Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT].includes(user.role);
    return lines.map((l) => {
      const p = products.get(l.product_id);
      if (!p) throw new BadRequestException(`Product ${l.product_id} does not exist`);
      if (!p.is_active) throw new BadRequestException(`${p.product_name} is no longer sold`);
      let price = p.selling_price;
      if (l.unit_price !== undefined && l.unit_price !== p.selling_price) {
        if (!canPrice) throw new ForbiddenException('Only a Warehouse Manager or Accountant can change prices');
        if (l.unit_price < p.cost_price) {
          throw new BadRequestException(`${p.product_name}: GH₵ ${l.unit_price} is below the cost price (GH₵ ${p.cost_price})`);
        }
        price = l.unit_price;
      }
      return { product_id: l.product_id, quantity: l.quantity, unit_price: price };
    });
  }

  private async insertLines(c: PoolClient, orderId: number, lines: { product_id: number; quantity: number; unit_price: number }[]) {
    for (const [i, l] of lines.entries()) {
      await c.query(`INSERT INTO order_line (order_id, line_no, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)`, [
        orderId,
        i + 1,
        l.product_id,
        l.quantity,
        l.unit_price,
      ]);
    }
  }

  /** Unexpired stock in the Main Warehouse must cover every line. */
  private async checkStock(c: PoolClient, orderId: number) {
    const { rows } = await c.query(
      `SELECT l.product_name, l.quantity, l.base_unit,
              COALESCE((SELECT SUM(b.qty_on_hand) FROM stock_batch b
                         WHERE b.product_id = l.product_id AND b.location_id = $2
                           AND b.expiry_date >= CURRENT_DATE), 0)::int AS available
         FROM v_order_line_value l WHERE l.order_id = $1`,
      [orderId, MAIN_WAREHOUSE],
    );
    const short = rows.filter((r: any) => r.available < r.quantity);
    if (short.length) {
      throw new BadRequestException(
        'Not enough stock: ' +
          short.map((s: any) => `${s.product_name} (ordered ${s.quantity}, ${s.available} available)`).join('; '),
      );
    }
    if (!rows.length) throw new BadRequestException('The order has no products');
  }
}

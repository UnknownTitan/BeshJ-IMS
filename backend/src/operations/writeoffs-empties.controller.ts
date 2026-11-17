import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { CreateWriteOffDto, CustomerReturnDto, DecisionDto, SupplierReturnDto } from './operations.dto';

const REASON_TEXT: Record<string, string> = {
  BROKEN: 'Broken',
  LEAKING: 'Leaking',
  EXPIRED: 'Expired',
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  THEFT: 'Theft / missing',
  OTHER: 'Other',
};

/**
 * UC3 Breakages and write-offs (FR6).
 * Small write-offs post straight away; anything above the approval limit
 * (app_setting WRITE_OFF_APPROVAL_LIMIT, valued at cost) waits for a
 * Warehouse Manager who did not record it.
 */
@Controller('write-offs')
@Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER, Role.MANAGEMENT, Role.ACCOUNTANT)
export class WriteOffsController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/write-offs?status=PENDING_APPROVAL */
  @Get()
  list(@Query('status') status?: string) {
    return this.db.query(
      `SELECT w.*, p.product_id, p.product_name, b.batch_no, b.expiry_date, l.location_name,
              rb.full_name AS recorded_by_name, db.full_name AS decided_by_name, ru.full_name AS responsible_name
         FROM write_off w
         JOIN stock_batch b ON b.batch_id = w.batch_id
         JOIN product p ON p.product_id = b.product_id
         JOIN stock_location l ON l.location_id = b.location_id
         JOIN app_user rb ON rb.user_id = w.recorded_by
         LEFT JOIN app_user db ON db.user_id = w.decided_by
         LEFT JOIN app_user ru ON ru.user_id = w.responsible_user_id
        WHERE ($1::text IS NULL OR w.status = ANY (string_to_array($1, ',')))
        ORDER BY w.write_off_id DESC`,
      [status || null],
    );
  }

  /** GET /api/write-offs/settings - the approval limit */
  @Get('settings')
  async settings() {
    const row = await this.db.one(`SELECT setting_value FROM app_setting WHERE setting_key = 'WRITE_OFF_APPROVAL_LIMIT'`);
    return { approval_limit: row?.setting_value ?? 0 };
  }

  /** POST /api/write-offs - record a breakage, leak, expiry or loss */
  @Post()
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async create(@Body() dto: CreateWriteOffDto, @CurrentUser() u: AuthUser) {
    const id = await this.db.transaction(u.userId, async (c) => {
      const { rows } = await c.query(
        `SELECT b.qty_on_hand, b.batch_no, p.product_name, p.cost_price
           FROM stock_batch b JOIN product p ON p.product_id = b.product_id WHERE b.batch_id = $1 FOR UPDATE OF b`,
        [dto.batch_id],
      );
      const batch = rows[0];
      if (!batch) throw new BadRequestException('Batch not found');
      if (dto.quantity > batch.qty_on_hand) {
        throw new BadRequestException(`Batch ${batch.batch_no} only has ${batch.qty_on_hand} on hand`);
      }
      const { rows: limit } = await c.query(
        `SELECT setting_value FROM app_setting WHERE setting_key = 'WRITE_OFF_APPROVAL_LIMIT'`,
      );
      const value = dto.quantity * batch.cost_price;
      const { rows: created } = await c.query(
        `INSERT INTO write_off (write_off_no, batch_id, quantity, reason_code, description, responsible_user_id, unit_cost, recorded_by)
         VALUES (fn_next_doc_no('WO', 'wo_no_seq'), $1, $2, $3, $4, $5, $6, $7) RETURNING write_off_id`,
        [dto.batch_id, dto.quantity, dto.reason_code, dto.description, dto.responsible_user_id ?? null, batch.cost_price, u.userId],
      );
      const woId = created[0].write_off_id;
      if (value <= Number(limit[0].setting_value)) {
        await this.post(c, woId, u.userId, 'Within the approval limit: posted automatically');
      }
      return woId;
    });
    return this.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      const wo = await this.lockPending(c, id);
      if (wo.recorded_by === u.userId) throw new BadRequestException('You cannot approve a write-off you recorded');
      await this.post(c, id, u.userId, dto.note || null);
    });
    return this.get(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser) {
    if (!dto.note?.trim()) throw new BadRequestException('Give a reason for rejecting');
    await this.db.transaction(u.userId, async (c) => {
      const wo = await this.lockPending(c, id);
      if (wo.recorded_by === u.userId) throw new BadRequestException('You cannot decide on a write-off you recorded');
      await c.query(
        `UPDATE write_off SET status = 'REJECTED', decided_by = $1, decided_at = CURRENT_TIMESTAMP, decision_note = $2 WHERE write_off_id = $3`,
        [u.userId, dto.note, id],
      );
    });
    return this.get(id);
  }

  private async get(id: number) {
    const rows = await this.db.query(
      `SELECT w.*, p.product_name, b.batch_no, l.location_name FROM write_off w
         JOIN stock_batch b ON b.batch_id = w.batch_id JOIN product p ON p.product_id = b.product_id
         JOIN stock_location l ON l.location_id = b.location_id WHERE w.write_off_id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Write-off not found');
    return rows[0];
  }

  private async lockPending(c: PoolClient, id: number) {
    const { rows } = await c.query(`SELECT * FROM write_off WHERE write_off_id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new NotFoundException('Write-off not found');
    if (rows[0].status !== 'PENDING_APPROVAL') throw new BadRequestException(`${rows[0].write_off_no} is already ${rows[0].status}`);
    return rows[0];
  }

  /** Take the stock out (BREAKAGE movement; the trigger lowers the batch) and mark approved. */
  private async post(c: PoolClient, id: number, approverId: number, note: string | null) {
    const { rows } = await c.query(
      `SELECT w.*, b.location_id FROM write_off w JOIN stock_batch b ON b.batch_id = w.batch_id WHERE w.write_off_id = $1`,
      [id],
    );
    const wo = rows[0];
    const { rows: mv } = await c.query(
      `INSERT INTO stock_movement (batch_id, movement_type, quantity, from_location_id, user_id, reference, reason)
       VALUES ($1, 'BREAKAGE', $2, $3, $4, $5, $6) RETURNING movement_id`,
      [wo.batch_id, wo.quantity, wo.location_id, approverId, wo.write_off_no, `${REASON_TEXT[wo.reason_code]}: ${wo.description}`.slice(0, 200)],
    );
    await c.query(
      `UPDATE write_off SET status = 'APPROVED', decided_by = $1, decided_at = CURRENT_TIMESTAMP,
              decision_note = $2, movement_id = $3 WHERE write_off_id = $4`,
      [approverId, note, mv[0].movement_id, id],
    );
  }
}

/** UC7 Empties and deposits. */
@Controller('empties')
@Roles(Role.STORE_KEEPER, Role.DRIVER, Role.SALES_REP, Role.ACCOUNTANT, Role.WAREHOUSE_MANAGER, Role.MANAGEMENT)
export class EmptiesController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/empties/positions?customerId= - containers each customer holds and their deposit value */
  @Get('positions')
  positions(@Query('customerId') customerId?: string) {
    return this.db.query(
      `SELECT * FROM v_empties_position
        WHERE containers_held <> 0 AND ($1::int IS NULL OR customer_id = $1)
        ORDER BY customer_name, container_name`,
      [customerId ? Number(customerId) : null],
    );
  }

  /** GET /api/empties/transactions?customerId= */
  @Get('transactions')
  transactions(@Query('customerId') customerId?: string) {
    return this.db.query(
      `SELECT e.*, ct.container_name, c.customer_name, s.supplier_name, o.order_no, u.full_name AS recorded_by_name
         FROM empties_transaction e
         JOIN container_type ct ON ct.container_type_id = e.container_type_id
         LEFT JOIN customer c ON c.customer_id = e.customer_id
         LEFT JOIN supplier s ON s.supplier_id = e.supplier_id
         LEFT JOIN customer_order o ON o.order_id = e.order_id
         JOIN app_user u ON u.user_id = e.recorded_by
        WHERE ($1::int IS NULL OR e.customer_id = $1)
        ORDER BY e.empties_txn_id DESC LIMIT 200`,
      [customerId ? Number(customerId) : null],
    );
  }

  /**
   * POST /api/empties/returns - a customer brings back crates/kegs/bottles.
   * The deposit is credited to their account (lowers their balance) or paid in cash.
   * The database refuses returning more than the customer holds.
   */
  @Post('returns')
  @Roles(Role.STORE_KEEPER, Role.DRIVER, Role.SALES_REP, Role.ACCOUNTANT)
  async customerReturn(@Body() dto: CustomerReturnDto, @CurrentUser() u: AuthUser) {
    return this.db.transaction(u.userId, async (c) => {
      let total = 0;
      for (const l of dto.lines) {
        const value = await this.depositValue(c, l.container_type_id, l.quantity);
        total += value;
        await c.query(
          `INSERT INTO empties_transaction (container_type_id, customer_id, direction, quantity, deposit_value, txn_date, recorded_by, refund_method)
           VALUES ($1, $2, 'RETURNED', $3, $4, CURRENT_DATE, $5, $6)`,
          [l.container_type_id, dto.customer_id, l.quantity, value, u.userId, dto.refund_method],
        );
      }
      const { rows } = await c.query(`SELECT balance FROM v_customer_balance WHERE customer_id = $1`, [dto.customer_id]);
      return { deposit_refunded: Math.round(total * 100) / 100, refund_method: dto.refund_method, new_balance: rows[0]?.balance };
    });
  }

  /** POST /api/empties/supplier-returns - empties sent back to the manufacturer */
  @Post('supplier-returns')
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async supplierReturn(@Body() dto: SupplierReturnDto, @CurrentUser() u: AuthUser) {
    return this.db.transaction(u.userId, async (c) => {
      let total = 0;
      for (const l of dto.lines) {
        const value = await this.depositValue(c, l.container_type_id, l.quantity);
        total += value;
        await c.query(
          `INSERT INTO empties_transaction (container_type_id, supplier_id, direction, quantity, deposit_value, txn_date, recorded_by)
           VALUES ($1, $2, 'RETURNED', $3, $4, CURRENT_DATE, $5)`,
          [l.container_type_id, dto.supplier_id, l.quantity, value, u.userId],
        );
      }
      return { deposit_value: Math.round(total * 100) / 100 };
    });
  }

  private async depositValue(c: PoolClient, containerTypeId: number, qty: number) {
    const { rows } = await c.query(`SELECT deposit_amount FROM container_type WHERE container_type_id = $1`, [containerTypeId]);
    if (!rows[0]) throw new BadRequestException('Unknown container type');
    return qty * rows[0].deposit_amount;
  }
}

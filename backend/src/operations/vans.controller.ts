import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { CreateTripDto, CreateVanDto, ReconcileTripDto, UpdateVanDto } from './operations.dto';
import { insertRow, updateRow } from '../common/sql';

const VAN_COLUMNS = ['location_name', 'vehicle_reg', 'home_location_id', 'driver_id', 'is_active'] as const;
const VIEW = [Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER, Role.DRIVER, Role.SALES_REP, Role.MANAGEMENT, Role.ACCOUNTANT];

/**
 * UC6 Van loading and end-of-day reconciliation (FR7).
 *
 * Each van has a home depot (a warehouse) and usually a regular driver.
 * Morning: the Store Keeper loads a van. Stock is picked from the van's home
 * depot earliest expiry first, and each pick is one VAN_LOAD movement;
 * the trigger moves it from the warehouse batch into the same batch on the van.
 * During the day: sales are invoiced from the van's stock.
 * Evening: everything left on the van is counted back. Good stock returns to
 * the depot it came from (VAN_RETURN), broken stock is written off (BREAKAGE), and any
 * shortage is recorded against the driver (ADJUSTMENT). The van ends empty.
 */
@Controller()
@Roles(...VIEW)
export class VansController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/vans - each van, its depot, driver, open trip and stock on board (retired vans last) */
  @Get('vans')
  vans() {
    return this.db.query(
      `SELECT l.location_id AS van_id, l.location_name, l.vehicle_reg, l.is_active,
              l.home_location_id, h.location_name AS home_name,
              l.driver_id, u.full_name AS driver_name, u.is_active AS driver_active, l.created_at, l.updated_at,
              t.trip_id AS open_trip_id, t.trip_no AS open_trip_no,
              COALESCE((SELECT SUM(qty_on_hand) FROM stock_batch b WHERE b.location_id = l.location_id), 0)::int AS units_on_board,
              (SELECT COUNT(*) FROM van_trip x WHERE x.van_id = l.location_id)::int AS trips
         FROM stock_location l
         LEFT JOIN stock_location h ON h.location_id = l.home_location_id
         LEFT JOIN app_user u ON u.user_id = l.driver_id
         LEFT JOIN van_trip t ON t.van_id = l.location_id AND t.status = 'LOADED'
        WHERE l.location_type = 'VAN'
        ORDER BY l.is_active DESC, l.location_name`,
    );
  }

  /** POST /api/vans - add a van (Warehouse Manager) */
  @Post('vans')
  @Roles(Role.WAREHOUSE_MANAGER)
  async createVan(@Body() dto: CreateVanDto, @CurrentUser() u: AuthUser) {
    const id = await this.db.transaction(u.userId, async (c) => {
      await this.checkUnique(c, dto, null);
      const row = await insertRow(c, 'stock_location', { ...dto, location_type: 'VAN' }, [...VAN_COLUMNS, 'location_type']);
      return row.location_id as number;
    });
    return this.van(id);
  }

  /** PATCH /api/vans/:id - rename, change registration, depot or driver, retire or bring back */
  @Patch('vans/:id')
  @Roles(Role.WAREHOUSE_MANAGER)
  async updateVan(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVanDto, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      const { rows } = await c.query(`SELECT location_type FROM stock_location WHERE location_id = $1 FOR UPDATE`, [id]);
      if (rows[0]?.location_type !== 'VAN') throw new NotFoundException('Van not found');
      await this.checkUnique(c, dto, id);
      await updateRow(c, 'stock_location', 'location_id', id, { ...dto }, VAN_COLUMNS);
    });
    return this.van(id);
  }

  /** GET /api/vans/:id/stock - batches on the van */
  @Get('vans/:id/stock')
  vanStock(@Param('id', ParseIntPipe) id: number) {
    return this.db.query(
      `SELECT b.batch_id, b.batch_no, b.expiry_date, b.qty_on_hand, p.product_id, p.product_name, p.selling_price
         FROM stock_batch b JOIN product p ON p.product_id = b.product_id
        WHERE b.location_id = $1 AND b.qty_on_hand > 0
        ORDER BY p.product_name, b.expiry_date`,
      [id],
    );
  }

  /** GET /api/van-trips?status=LOADED */
  @Get('van-trips')
  trips(@Query('status') status?: string) {
    return this.db.query(
      `SELECT t.*, l.location_name AS van_name, l.vehicle_reg, d.full_name AS driver_name, lb.full_name AS loaded_by_name,
              dp.location_name AS depot_name,
              (SELECT SUM(qty_loaded) FROM van_trip_line x WHERE x.trip_id = t.trip_id)::int AS units_loaded,
              (SELECT SUM(qty_short) FROM van_trip_line x WHERE x.trip_id = t.trip_id)::int AS units_short
         FROM van_trip t
         JOIN stock_location l ON l.location_id = t.van_id
         JOIN stock_location dp ON dp.location_id = t.depot_id
         JOIN app_user d ON d.user_id = t.driver_id
         JOIN app_user lb ON lb.user_id = t.loaded_by
        WHERE ($1::text IS NULL OR t.status = $1)
        ORDER BY t.trip_id DESC`,
      [status || null],
    );
  }

  /** GET /api/van-trips/:id - trip, lines, what is on the van now, sales and cash so far */
  @Get('van-trips/:id')
  async trip(@Param('id', ParseIntPipe) id: number) {
    const trip = await this.db.one(
      `SELECT t.*, l.location_name AS van_name, l.vehicle_reg, d.full_name AS driver_name,
              lb.full_name AS loaded_by_name, rb.full_name AS reconciled_by_name, dp.location_name AS depot_name
         FROM van_trip t
         JOIN stock_location l ON l.location_id = t.van_id
         JOIN stock_location dp ON dp.location_id = t.depot_id
         JOIN app_user d ON d.user_id = t.driver_id
         JOIN app_user lb ON lb.user_id = t.loaded_by
         LEFT JOIN app_user rb ON rb.user_id = t.reconciled_by
        WHERE t.trip_id = $1`,
      [id],
    );
    if (!trip) throw new NotFoundException('Trip not found');
    const [lines, onVan, sales, cash] = await Promise.all([
      this.db.query(
        `SELECT x.*, p.product_name, p.cost_price FROM van_trip_line x JOIN product p ON p.product_id = x.product_id
          WHERE x.trip_id = $1 ORDER BY p.product_name`,
        [id],
      ),
      this.db.query(
        `SELECT p.product_id, p.product_name, SUM(b.qty_on_hand)::int AS qty
           FROM stock_batch b JOIN product p ON p.product_id = b.product_id
          WHERE b.location_id = $1 AND b.qty_on_hand > 0
          GROUP BY p.product_id, p.product_name ORDER BY p.product_name`,
        [trip.van_id],
      ),
      this.soldFromVan(this.db, trip),
      this.cashCollected(this.db, trip),
    ]);
    return { ...trip, lines, on_van: trip.status === 'LOADED' ? onVan : [], sales, cash_collected: cash };
  }

  /** POST /api/van-trips - load a van (one transaction) */
  @Post('van-trips')
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async load(@Body() dto: CreateTripDto, @CurrentUser() u: AuthUser) {
    const tripId = await this.db.transaction(u.userId, async (c) => {
      const { rows: van } = await c.query(
        `SELECT location_type, driver_id, location_name, home_location_id, is_active FROM stock_location WHERE location_id = $1 FOR UPDATE`,
        [dto.van_id],
      );
      if (van[0]?.location_type !== 'VAN') throw new BadRequestException('Choose a van');
      if (!van[0].is_active) throw new BadRequestException(`${van[0].location_name} is retired`);
      const depot: number = van[0].home_location_id;
      const driverId = dto.driver_id ?? van[0].driver_id;
      if (!driverId) throw new BadRequestException(`${van[0].location_name} has no driver assigned; choose one`);
      const { rows: drv } = await c.query(`SELECT role, is_active FROM app_user WHERE user_id = $1`, [driverId]);
      if (drv[0]?.role !== 'DRIVER' || !drv[0].is_active) throw new BadRequestException('The driver must be an active user with the Driver role');

      const { rows: open } = await c.query(`SELECT trip_no FROM van_trip WHERE van_id = $1 AND status = 'LOADED'`, [dto.van_id]);
      if (open[0]) throw new BadRequestException(`${van[0].location_name} is still out on ${open[0].trip_no}; reconcile it first`);

      const { rows: t } = await c.query(
        `INSERT INTO van_trip (trip_no, van_id, driver_id, loaded_by, notes, depot_id)
         VALUES (fn_next_doc_no('TRIP', 'trip_no_seq'), $1, $2, $3, $4, $5) RETURNING trip_id, trip_no`,
        [dto.van_id, driverId, u.userId, dto.notes || null, depot],
      );
      const { trip_id, trip_no } = t[0];

      for (const line of dto.lines) {
        const { rows: picks } = await c.query(`SELECT * FROM fn_fefo_allocate($1, $2::smallint, $3)`, [
          line.product_id,
          depot,
          line.quantity,
        ]);
        for (const pick of picks) {
          await c.query(
            `INSERT INTO stock_movement (batch_id, movement_type, quantity, from_location_id, to_location_id, user_id, reference)
             VALUES ($1, 'VAN_LOAD', $2, $3, $4, $5, $6)`,
            [pick.batch_id, pick.qty_to_pick, depot, dto.van_id, u.userId, trip_no],
          );
        }
        await c.query(`INSERT INTO van_trip_line (trip_id, product_id, qty_loaded) VALUES ($1, $2, $3)`, [
          trip_id,
          line.product_id,
          line.quantity,
        ]);
      }
      return trip_id as number;
    });
    return this.trip(tripId);
  }

  /** POST /api/van-trips/:id/reconcile - end of day (one transaction) */
  @Post('van-trips/:id/reconcile')
  @HttpCode(200)
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async reconcile(@Param('id', ParseIntPipe) id: number, @Body() dto: ReconcileTripDto, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      const { rows: t } = await c.query(
        `SELECT t.*, d.full_name AS driver_name FROM van_trip t JOIN app_user d ON d.user_id = t.driver_id
          WHERE t.trip_id = $1 FOR UPDATE OF t`,
        [id],
      );
      const trip = t[0];
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'LOADED') throw new BadRequestException(`${trip.trip_no} is already reconciled`);

      const counted = new Map(dto.lines.map((l) => [l.product_id, l]));
      const { rows: batches } = await c.query(
        `SELECT b.batch_id, b.product_id, b.qty_on_hand, p.product_name
           FROM stock_batch b JOIN product p ON p.product_id = b.product_id
          WHERE b.location_id = $1 AND b.qty_on_hand > 0
          ORDER BY b.product_id, b.expiry_date
          FOR UPDATE OF b`,
        [trip.van_id],
      );
      const byProduct = new Map<number, any[]>();
      for (const b of batches) byProduct.set(b.product_id, [...(byProduct.get(b.product_id) ?? []), b]);
      for (const pid of counted.keys()) {
        if (!byProduct.has(pid)) throw new BadRequestException(`Product ${pid} is not on the van`);
      }

      const sold = new Map((await this.soldFromVan(c, trip)).map((s: any) => [s.product_id, s.quantity]));

      for (const [productId, list] of byProduct) {
        const expected = list.reduce((s, b) => s + b.qty_on_hand, 0);
        const line = counted.get(productId) ?? { qty_returned: 0, qty_damaged: 0 };
        if (line.qty_returned + line.qty_damaged > expected) {
          throw new BadRequestException(
            `${list[0].product_name}: ${line.qty_returned + line.qty_damaged} counted but the van should only hold ${expected}`,
          );
        }
        const short = expected - line.qty_returned - line.qty_damaged;

        // Damaged first from the earliest-expiring batches, then shortage, then good returns.
        const take = (qty: number) => {
          const parts: { batch_id: number; qty: number }[] = [];
          for (const b of list) {
            if (qty === 0) break;
            const q = Math.min(qty, b.qty_on_hand);
            if (q > 0) {
              parts.push({ batch_id: b.batch_id, qty: q });
              b.qty_on_hand -= q;
              qty -= q;
            }
          }
          return parts;
        };
        for (const p of take(line.qty_damaged)) {
          await this.move(c, p, 'BREAKAGE', trip.van_id, null, u.userId, trip.trip_no, `Damaged on van trip ${trip.trip_no}`);
        }
        for (const p of take(short)) {
          await this.move(c, p, 'ADJUSTMENT', trip.van_id, null, u.userId, trip.trip_no, `Van shortage on ${trip.trip_no} (driver ${trip.driver_name})`);
        }
        for (const p of take(line.qty_returned)) {
          await this.move(c, p, 'VAN_RETURN', trip.van_id, trip.depot_id, u.userId, trip.trip_no, null);
        }

        await c.query(
          `INSERT INTO van_trip_line (trip_id, product_id, qty_loaded, qty_sold, qty_expected, qty_returned, qty_damaged, qty_short)
           VALUES ($1, $2, 0, $3, $4, $5, $6, $7)
           ON CONFLICT (trip_id, product_id) DO UPDATE SET qty_sold = EXCLUDED.qty_sold, qty_expected = EXCLUDED.qty_expected,
             qty_returned = EXCLUDED.qty_returned, qty_damaged = EXCLUDED.qty_damaged, qty_short = EXCLUDED.qty_short`,
          [id, productId, sold.get(productId) ?? 0, expected, line.qty_returned, line.qty_damaged, short],
        );
      }
      // Products loaded but fully sold: record their sales too.
      await c.query(
        `UPDATE van_trip_line SET qty_sold = COALESCE($2::jsonb ->> product_id::text, '0')::int,
                qty_expected = 0, qty_returned = 0, qty_damaged = 0, qty_short = 0
          WHERE trip_id = $1 AND qty_expected IS NULL`,
        [id, JSON.stringify(Object.fromEntries(sold))],
      );

      const cash = await this.cashCollected(c, trip);
      await c.query(
        `UPDATE van_trip SET status = 'RECONCILED', reconciled_by = $1, reconciled_at = CURRENT_TIMESTAMP,
                cash_expected = $2, cash_declared = $3, notes = COALESCE($4, notes) WHERE trip_id = $5`,
        [u.userId, cash, dto.cash_declared, dto.notes || null, id],
      );
    });
    return this.trip(id);
  }

  // ---------------------------------------------------------------- helpers

  private async van(id: number) {
    const rows = await this.vans();
    return rows.find((v: any) => v.van_id === id);
  }

  /** Clear messages for the database's UNIQUE rules on name, registration and driver. */
  private async checkUnique(c: PoolClient, dto: { location_name?: string; vehicle_reg?: string; driver_id?: number | null }, id: number | null) {
    const checks: [string, unknown, (name: string) => string][] = [
      ['lower(location_name) = lower(btrim($1))', dto.location_name, (n) => `There is already a location called ${n}`],
      ['vehicle_reg = upper(btrim($1))', dto.vehicle_reg, (n) => `${n} already has that registration number`],
      ['driver_id = $1', dto.driver_id, (n) => `That driver is already assigned to ${n}; remove them there first`],
    ];
    for (const [where, value, message] of checks) {
      if (value === undefined || value === null) continue;
      const { rows } = await c.query(
        `SELECT location_name FROM stock_location WHERE ${where} AND location_id IS DISTINCT FROM $2::smallint`,
        [value, id],
      );
      if (rows[0]) throw new BadRequestException(message(rows[0].location_name));
    }
  }

  private move(c: PoolClient, p: { batch_id: number; qty: number }, type: string, from: number, to: number | null, userId: number, ref: string, reason: string | null) {
    return c.query(
      `INSERT INTO stock_movement (batch_id, movement_type, quantity, from_location_id, to_location_id, user_id, reference, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.batch_id, type, p.qty, from, to, userId, ref, reason],
    );
  }

  /** Units invoiced from the van since it was loaded. */
  private async soldFromVan(db: { query: (sql: string, p: unknown[]) => Promise<any> }, trip: any): Promise<any[]> {
    const res = await db.query(
      `SELECT b.product_id, p.product_name, SUM(m.quantity)::int AS quantity, string_agg(DISTINCT m.reference, ', ') AS invoices
         FROM stock_movement m JOIN stock_batch b ON b.batch_id = m.batch_id JOIN product p ON p.product_id = b.product_id
        WHERE m.movement_type = 'SALE' AND m.from_location_id = $1 AND m.movement_time >= $2
        GROUP BY b.product_id, p.product_name`,
      [trip.van_id, trip.loaded_at],
    );
    return Array.isArray(res) ? res : res.rows;
  }

  /** Cash the driver received since the trip started (to compare with what they hand in). */
  private async cashCollected(db: { query: (sql: string, p: unknown[]) => Promise<any> }, trip: any): Promise<number> {
    const res = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS cash FROM payment
        WHERE received_by = $1 AND payment_method = 'CASH' AND payment_date >= $2`,
      [trip.driver_id, trip.trip_date],
    );
    const rows = Array.isArray(res) ? res : res.rows;
    return Number(rows[0].cash);
  }
}

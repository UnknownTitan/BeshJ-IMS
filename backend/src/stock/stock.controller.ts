import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Role, Roles } from '../common/roles';

/** Stock look-ups backed by the views and functions in the database. */
@Controller('stock')
export class StockController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/stock/on-hand  (view v_stock_on_hand) */
  @Get('on-hand')
  onHand() {
    return this.db.query(`SELECT * FROM v_stock_on_hand ORDER BY product_name, location_name`);
  }

  /** GET /api/stock/reorder-alerts  (view v_reorder_alerts) - FR4 */
  @Get('reorder-alerts')
  @Roles(Role.WAREHOUSE_MANAGER, Role.STORE_KEEPER, Role.MANAGEMENT)
  reorderAlerts() {
    return this.db.query(`SELECT * FROM v_reorder_alerts ORDER BY warehouse_qty`);
  }

  /** GET /api/stock/near-expiry  (view v_near_expiry) - FR5 */
  @Get('near-expiry')
  nearExpiry() {
    return this.db.query(`SELECT * FROM v_near_expiry ORDER BY expiry_date`);
  }

  /** GET /api/stock/valuation  (view v_stock_valuation) - FR11 */
  @Get('valuation')
  @Roles(Role.WAREHOUSE_MANAGER, Role.ACCOUNTANT, Role.MANAGEMENT)
  valuation() {
    return this.db.query(`SELECT * FROM v_stock_valuation ORDER BY value_at_cost DESC`);
  }

  /**
   * GET /api/stock/fefo?productId=1&locationId=1&quantity=500
   * Preview which batches would be picked (function fn_fefo_allocate) - FR5
   */
  @Get('fefo')
  fefo(
    @Query('productId', ParseIntPipe) productId: number,
    @Query('locationId', ParseIntPipe) locationId: number,
    @Query('quantity', ParseIntPipe) quantity: number,
  ) {
    return this.db.query(`SELECT * FROM fn_fefo_allocate($1, $2::smallint, $3)`, [productId, locationId, quantity]);
  }

  /**
   * GET /api/stock/movements?productId=1&type=RECEIPT&from=2026-01-01&to=2026-12-31&limit=100
   * The stock ledger: every receipt, sale, transfer, breakage and adjustment.
   */
  @Get('movements')
  @Roles(Role.WAREHOUSE_MANAGER, Role.STORE_KEEPER, Role.MANAGEMENT, Role.ACCOUNTANT)
  movements(
    @Query('productId') productId?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '100',
  ) {
    return this.db.query(
      `SELECT m.movement_id, m.movement_time, m.movement_type, m.quantity, m.reference, m.reason,
              p.product_id, p.sku, p.product_name, b.batch_no, b.expiry_date,
              fl.location_name AS from_location, tl.location_name AS to_location,
              u.full_name AS user_name
         FROM stock_movement m
         JOIN stock_batch b ON b.batch_id = m.batch_id
         JOIN product p     ON p.product_id = b.product_id
         JOIN app_user u    ON u.user_id = m.user_id
         LEFT JOIN stock_location fl ON fl.location_id = m.from_location_id
         LEFT JOIN stock_location tl ON tl.location_id = m.to_location_id
        WHERE ($1::int  IS NULL OR p.product_id = $1)
          AND ($2::text IS NULL OR m.movement_type = $2)
          AND ($3::date IS NULL OR m.movement_time >= $3)
          AND ($4::date IS NULL OR m.movement_time < $4::date + 1)
        ORDER BY m.movement_id DESC
        LIMIT LEAST($5::int, 1000)`,
      [productId ? Number(productId) : null, type || null, from || null, to || null, Number(limit) || 100],
    );
  }
}

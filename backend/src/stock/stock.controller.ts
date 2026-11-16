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
}

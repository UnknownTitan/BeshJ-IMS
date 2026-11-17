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
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CurrentUser, Role, Roles } from '../common/roles';
import { SaveCountsDto, StartStocktakeDto } from './operations.dto';

/**
 * UC4 Stocktake (FR8).
 * 1. Start: the system snapshots every batch at the location (system_qty).
 * 2. Count: staff enter what is physically there, batch by batch.
 * 3. Post (Warehouse Manager): each difference becomes an ADJUSTMENT
 *    movement, so stock matches the count, with a full audit trail.
 */
@Controller('stocktakes')
@Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER, Role.MANAGEMENT, Role.ACCOUNTANT)
export class StocktakeController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list() {
    return this.db.query(
      `SELECT s.*, l.location_name, sb.full_name AS started_by_name, pb.full_name AS posted_by_name,
              COUNT(x.batch_id)::int AS batches, COUNT(x.counted_qty)::int AS counted,
              COUNT(*) FILTER (WHERE x.counted_qty IS NOT NULL AND x.counted_qty <> x.system_qty)::int AS differences
         FROM stocktake s
         JOIN stock_location l ON l.location_id = s.location_id
         JOIN app_user sb ON sb.user_id = s.started_by
         LEFT JOIN app_user pb ON pb.user_id = s.posted_by
         LEFT JOIN stocktake_line x ON x.stocktake_id = s.stocktake_id
        GROUP BY s.stocktake_id, l.location_name, sb.full_name, pb.full_name
        ORDER BY s.stocktake_id DESC`,
    );
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const st = await this.db.one(
      `SELECT s.*, l.location_name, sb.full_name AS started_by_name, pb.full_name AS posted_by_name
         FROM stocktake s JOIN stock_location l ON l.location_id = s.location_id
         JOIN app_user sb ON sb.user_id = s.started_by LEFT JOIN app_user pb ON pb.user_id = s.posted_by
        WHERE s.stocktake_id = $1`,
      [id],
    );
    if (!st) throw new NotFoundException('Stocktake not found');
    const lines = await this.db.query(
      `SELECT v.*, u.full_name AS counted_by_name FROM v_stocktake_variance v
         JOIN stocktake_line l ON l.stocktake_id = v.stocktake_id AND l.batch_id = v.batch_id
         LEFT JOIN app_user u ON u.user_id = l.counted_by
        WHERE v.stocktake_id = $1 ORDER BY v.product_name, v.expiry_date`,
      [id],
    );
    const counted = lines.filter((l: any) => l.counted_qty !== null);
    const summary = {
      batches: lines.length,
      counted: counted.length,
      differences: counted.filter((l: any) => l.variance !== 0).length,
      units_over: counted.reduce((s: number, l: any) => s + Math.max(l.variance, 0), 0),
      units_short: counted.reduce((s: number, l: any) => s + Math.max(-l.variance, 0), 0),
      net_value: Math.round(counted.reduce((s: number, l: any) => s + l.variance_value, 0) * 100) / 100,
    };
    return { ...st, lines, summary };
  }

  /** POST /api/stocktakes - start counting a location (snapshot of system quantities) */
  @Post()
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async start(@Body() dto: StartStocktakeDto, @CurrentUser() u: AuthUser) {
    const id = await this.db.transaction(u.userId, async (c) => {
      const { rows: loc } = await c.query(`SELECT location_name FROM stock_location WHERE location_id = $1`, [dto.location_id]);
      if (!loc[0]) throw new BadRequestException('Location not found');
      const { rows: open } = await c.query(
        `SELECT stocktake_no FROM stocktake WHERE location_id = $1 AND status = 'COUNTING'`,
        [dto.location_id],
      );
      if (open[0]) throw new BadRequestException(`${open[0].stocktake_no} is already counting ${loc[0].location_name}`);
      const { rows } = await c.query(
        `INSERT INTO stocktake (stocktake_no, location_id, started_by, notes)
         VALUES (fn_next_doc_no('ST', 'st_no_seq'), $1, $2, $3) RETURNING stocktake_id`,
        [dto.location_id, u.userId, dto.notes || null],
      );
      const { rowCount } = await c.query(
        `INSERT INTO stocktake_line (stocktake_id, batch_id, system_qty)
         SELECT $1, batch_id, qty_on_hand FROM stock_batch WHERE location_id = $2 AND qty_on_hand > 0`,
        [rows[0].stocktake_id, dto.location_id],
      );
      if (!rowCount) throw new BadRequestException(`${loc[0].location_name} has no stock to count`);
      return rows[0].stocktake_id as number;
    });
    return this.get(id);
  }

  /** PATCH /api/stocktakes/:id/counts - save counted quantities (can be done in several sittings) */
  @Patch(':id/counts')
  @Roles(Role.STORE_KEEPER, Role.WAREHOUSE_MANAGER)
  async saveCounts(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveCountsDto, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      await this.lockCounting(c, id);
      for (const ct of dto.counts) {
        const { rowCount } = await c.query(
          // Keep the original counter unless the number actually changes.
          `UPDATE stocktake_line
              SET counted_by = CASE WHEN counted_qty IS DISTINCT FROM $1 THEN $2 ELSE counted_by END,
                  counted_qty = $1
            WHERE stocktake_id = $3 AND batch_id = $4`,
          [ct.counted_qty, u.userId, id, ct.batch_id],
        );
        if (!rowCount) throw new BadRequestException(`Batch ${ct.batch_id} is not on this count sheet`);
      }
    });
    return this.get(id);
  }

  /** POST /api/stocktakes/:id/post - apply the differences (Warehouse Manager) */
  @Post(':id/post')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  async post(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      const st = await this.lockCounting(c, id);
      const { rows: lines } = await c.query(`SELECT * FROM v_stocktake_variance WHERE stocktake_id = $1`, [id]);
      const uncounted = lines.filter((l: any) => l.counted_qty === null);
      if (uncounted.length) throw new BadRequestException(`${uncounted.length} batches have not been counted yet`);

      for (const l of lines.filter((l: any) => l.variance !== 0)) {
        const over = l.variance > 0;
        await c.query(
          `INSERT INTO stock_movement (batch_id, movement_type, quantity, from_location_id, to_location_id, user_id, reference, reason)
           VALUES ($1, 'ADJUSTMENT', $2, $3, $4, $5, $6, $7)`,
          [
            l.batch_id,
            Math.abs(l.variance),
            over ? null : st.location_id,
            over ? st.location_id : null,
            u.userId,
            st.stocktake_no,
            `Stocktake ${st.stocktake_no}: counted ${l.counted_qty}, system ${l.system_qty}`,
          ],
        );
      }
      await c.query(`UPDATE stocktake SET status = 'POSTED', posted_by = $1, posted_at = CURRENT_TIMESTAMP WHERE stocktake_id = $2`, [
        u.userId,
        id,
      ]);
    });
    return this.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.WAREHOUSE_MANAGER)
  async cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) {
    await this.db.transaction(u.userId, async (c) => {
      await this.lockCounting(c, id);
      await c.query(`UPDATE stocktake SET status = 'CANCELLED' WHERE stocktake_id = $1`, [id]);
    });
    return this.get(id);
  }

  private async lockCounting(c: PoolClient, id: number) {
    const { rows } = await c.query(`SELECT * FROM stocktake WHERE stocktake_id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new NotFoundException('Stocktake not found');
    if (rows[0].status !== 'COUNTING') throw new BadRequestException(`${rows[0].stocktake_no} is ${rows[0].status}`);
    return rows[0];
  }
}

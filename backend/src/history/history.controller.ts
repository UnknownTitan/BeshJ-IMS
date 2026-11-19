import { BadRequestException, Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Timestamps (FR12).
 * - GET /api/history/:doc/:id  every step of a document, with time and person
 * - GET /api/stamps/:entity/:id when a record was added and last changed, and by whom
 * Both read what the database already records: the audit trail and the
 * created/updated columns stamped by trg_stamp. Open to every signed-in user.
 */

// Document -> table, and the columns used when a document predates the audit trail.
const DOCS: Record<string, { table: string; pk: string; at: string; by: string; firstStatus: string }> = {
  orders: { table: 'customer_order', pk: 'order_id', at: 'order_date', by: 'sales_rep_id', firstStatus: 'DRAFT' },
  'purchase-orders': { table: 'purchase_order', pk: 'po_id', at: 'created_at', by: 'created_by', firstStatus: 'DRAFT' },
  'write-offs': { table: 'write_off', pk: 'write_off_id', at: 'recorded_at', by: 'recorded_by', firstStatus: 'PENDING_APPROVAL' },
  'van-trips': { table: 'van_trip', pk: 'trip_id', at: 'loaded_at', by: 'loaded_by', firstStatus: 'LOADED' },
  stocktakes: { table: 'stocktake', pk: 'stocktake_id', at: 'started_at', by: 'started_by', firstStatus: 'COUNTING' },
};

const ENTITIES: Record<string, { table: string; pk: string }> = {
  products: { table: 'product', pk: 'product_id' },
  customers: { table: 'customer', pk: 'customer_id' },
  suppliers: { table: 'supplier', pk: 'supplier_id' },
  vans: { table: 'stock_location', pk: 'location_id' },
  locations: { table: 'stock_location', pk: 'location_id' },
  users: { table: 'app_user', pk: 'user_id' },
};

@Controller()
export class HistoryController {
  constructor(private readonly db: DatabaseService) {}

  @Get('history/:doc/:id')
  async history(@Param('doc') doc: string, @Param('id', ParseIntPipe) id: number) {
    const d = DOCS[doc];
    if (!d) throw new BadRequestException('Unknown document type');

    // The document itself, for documents created before the audit trail (the sample data).
    const head = await this.db.one(
      `SELECT x.${d.at}::timestamp AS at, x.status, u.full_name AS user_name
         FROM ${d.table} x LEFT JOIN app_user u ON u.user_id = x.${d.by}
        WHERE x.${d.pk} = $1`,
      [id],
    );
    if (!head) throw new NotFoundException('Not found');

    const events = await this.db.query(
      `SELECT event_at, user_name, event, from_status, to_status, detail, amount
         FROM v_document_timeline
        WHERE doc_table = $1 AND doc_id = $2
        ORDER BY event_at, CASE event WHEN 'CREATED' THEN 0 WHEN 'STATUS' THEN 2 ELSE 1 END`,
      [d.table, id],
    );
    if (!events.some((e: any) => e.event === 'CREATED')) {
      events.unshift({
        event_at: head.at, user_name: head.user_name, event: 'CREATED',
        from_status: null, to_status: events.find((e: any) => e.from_status)?.from_status ?? head.status ?? d.firstStatus,
        detail: 'Loaded with the original data', amount: null,
      });
    }
    return events;
  }

  @Get('stamps/:entity/:id')
  async stamps(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number) {
    const e = ENTITIES[entity];
    if (!e) throw new BadRequestException('Unknown record type');
    const row = await this.db.one(
      `SELECT x.created_at, cu.full_name AS created_by_name, x.updated_at, uu.full_name AS updated_by_name
         FROM ${e.table} x
         LEFT JOIN app_user cu ON cu.user_id = x.created_by
         LEFT JOIN app_user uu ON uu.user_id = x.updated_by
        WHERE x.${e.pk} = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Not found');
    return row;
  }
}

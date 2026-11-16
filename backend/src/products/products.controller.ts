import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * UC1 Manage products - read side (Phase 0).
 * Create / edit / deactivate endpoints are added in Phase 1.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/products?search=coke&includeInactive=false */
  @Get()
  list(@Query('search') search?: string, @Query('includeInactive') includeInactive?: string) {
    return this.db.query(
      `SELECT p.product_id, p.sku, p.barcode, p.brand, p.product_name,
              c.category_name, s.supplier_name, p.pack_size_ml, p.packaging, p.base_unit,
              p.cost_price, p.selling_price, p.reorder_level, p.is_active,
              COALESCE(SUM(b.qty_on_hand) FILTER (WHERE l.location_type = 'WAREHOUSE'), 0)::int AS warehouse_qty
         FROM product p
         JOIN category c  ON c.category_id = p.category_id
         JOIN supplier s  ON s.supplier_id = p.supplier_id
         LEFT JOIN stock_batch b    ON b.product_id = p.product_id
         LEFT JOIN stock_location l ON l.location_id = b.location_id
        WHERE ($1::text IS NULL OR p.product_name ILIKE '%' || $1 || '%' OR p.brand ILIKE '%' || $1 || '%'
               OR p.sku ILIKE '%' || $1 || '%' OR p.barcode = $1)
          AND ($2::boolean OR p.is_active)
        GROUP BY p.product_id, c.category_name, s.supplier_name
        ORDER BY p.brand, p.product_name`,
      [search?.trim() || null, includeInactive === 'true'],
    );
  }

  /** GET /api/products/:id - product with its unit conversions and batches */
  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const product = await this.db.one(
      `SELECT p.*, c.category_name, s.supplier_name, ct.container_name, ct.deposit_amount
         FROM product p
         JOIN category c ON c.category_id = p.category_id
         JOIN supplier s ON s.supplier_id = p.supplier_id
         LEFT JOIN container_type ct ON ct.container_type_id = p.container_type_id
        WHERE p.product_id = $1`,
      [id],
    );
    if (!product) throw new NotFoundException('Product not found');

    const [conversions, batches] = await Promise.all([
      this.db.query(`SELECT unit_name, base_qty FROM unit_conversion WHERE product_id = $1 ORDER BY base_qty`, [id]),
      this.db.query(
        `SELECT b.batch_id, b.batch_no, l.location_name, b.received_date, b.expiry_date, b.qty_on_hand
           FROM stock_batch b JOIN stock_location l ON l.location_id = b.location_id
          WHERE b.product_id = $1 ORDER BY b.expiry_date`,
        [id],
      ),
    ]);
    return { ...product, conversions, batches };
  }
}

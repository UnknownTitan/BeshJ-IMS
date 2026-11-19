import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { insertRow, updateRow } from '../common/sql';
import { CreateProductDto, PRODUCT_COLUMNS, UnitConversionDto, UpdateProductDto } from './products.dto';

/** UC1 Manage products (FR1). */
@Injectable()
export class ProductsService {
  constructor(private readonly db: DatabaseService) {}

  list(search?: string, includeInactive = false) {
    return this.db.query(
      `SELECT p.product_id, p.sku, p.barcode, p.brand, p.product_name,
              p.category_id, c.category_name, p.supplier_id, s.supplier_name,
              p.pack_size_ml, p.packaging, p.base_unit,
              p.cost_price, p.selling_price, p.reorder_level, p.container_type_id, p.is_active,
              p.created_at, p.updated_at,
              (SELECT MAX(uc.base_qty) FROM unit_conversion uc WHERE uc.product_id = p.product_id) AS pack_qty,
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
      [search?.trim() || null, includeInactive],
    );
  }

  async get(id: number) {
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

  /** Barcode scanners type the code like a keyboard; this finds the product it belongs to. */
  async byBarcode(code: string) {
    const row = await this.db.one(`SELECT product_id FROM product WHERE barcode = $1 OR sku = $1`, [code.trim()]);
    if (!row) throw new NotFoundException(`No product with barcode or SKU ${code}`);
    return this.get(row.product_id);
  }

  async create(dto: CreateProductDto, userId: number) {
    this.checkBusinessRules(dto);
    const id = await this.db.transaction(userId, async (c) => {
      const row = await insertRow(c, 'product', { ...dto }, PRODUCT_COLUMNS);
      await this.saveConversions(c, row.product_id, dto.conversions ?? []);
      return row.product_id as number;
    });
    return this.get(id);
  }

  async update(id: number, dto: UpdateProductDto, userId: number) {
    const current = await this.db.one(`SELECT * FROM product WHERE product_id = $1`, [id]);
    if (!current) throw new NotFoundException('Product not found');
    this.checkBusinessRules({ ...current, ...dto });

    await this.db.transaction(userId, async (c) => {
      const fields = Object.keys(dto).filter((k) => (PRODUCT_COLUMNS as readonly string[]).includes(k));
      if (fields.length) await updateRow(c, 'product', 'product_id', id, { ...dto }, PRODUCT_COLUMNS);
      if (dto.conversions) await this.saveConversions(c, id, dto.conversions);
    });
    return this.get(id);
  }

  /** Replace the product's unit conversions (e.g. 1 crate = 24 bottles). */
  private async saveConversions(c: PoolClient, productId: number, list: UnitConversionDto[]) {
    await c.query(`DELETE FROM unit_conversion WHERE product_id = $1`, [productId]);
    for (const conv of list) {
      await c.query(`INSERT INTO unit_conversion (product_id, unit_name, base_qty) VALUES ($1, $2, $3)`, [
        productId,
        conv.unit_name,
        conv.base_qty,
      ]);
    }
  }

  /** Mirrors chk_product_price and chk_product_returnable with readable messages. */
  private checkBusinessRules(p: Partial<CreateProductDto>) {
    if (p.selling_price !== undefined && p.cost_price !== undefined && Number(p.selling_price) < Number(p.cost_price)) {
      throw new BadRequestException('Selling price cannot be lower than cost price');
    }
    if (p.container_type_id && p.packaging && !['GLASS', 'KEG'].includes(p.packaging)) {
      throw new BadRequestException('Only glass bottles and kegs can have a returnable container');
    }
  }
}

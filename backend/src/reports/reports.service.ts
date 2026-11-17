import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Every report has the same shape, so one screen and one exporter handle them all. */
export type ColumnType = 'text' | 'int' | 'money' | 'percent' | 'date';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export interface Report {
  name: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  /** Column key -> total, for the columns that are summed. */
  totals: Record<string, number>;
}

export interface ReportParams {
  from?: string;
  to?: string;
  groupBy?: string;
  days?: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const SALES_GROUPS: Record<string, { expr: string; label: string }> = {
  product: { expr: 'product_name', label: 'Product' },
  brand: { expr: 'brand', label: 'Brand' },
  category: { expr: 'category_name', label: 'Category' },
  customer: { expr: 'customer_name', label: 'Customer' },
  rep: { expr: 'sales_rep_name', label: 'Sales rep' },
  channel: { expr: 'channel', label: 'Channel' },
  day: { expr: `to_char(invoice_date, 'YYYY-MM-DD')`, label: 'Day' },
  month: { expr: `to_char(invoice_date, 'YYYY-MM')`, label: 'Month' },
};

export const REPORTS = ['sales', 'movers', 'losses', 'valuation', 'receivables', 'expiry'] as const;

/** UC8 Reports (FR11). All figures come from the reporting views in 07_phase5_reports.sql. */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  run(name: string, p: ReportParams): Promise<Report> {
    switch (name) {
      case 'sales':
        return this.sales(p);
      case 'movers':
        return this.movers(p);
      case 'losses':
        return this.losses(p);
      case 'valuation':
        return this.valuation();
      case 'receivables':
        return this.receivables();
      case 'expiry':
        return this.expiry(p);
      default:
        throw new BadRequestException(`Unknown report "${name}". Choose one of: ${REPORTS.join(', ')}`);
    }
  }

  private period(p: ReportParams) {
    if (p.from && p.to) return `${p.from} to ${p.to}`;
    if (p.from) return `from ${p.from}`;
    if (p.to) return `up to ${p.to}`;
    return 'all dates';
  }

  private totals(rows: any[], keys: string[]) {
    return Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0))]));
  }

  // ------------------------------------------------------------------ sales
  async sales(p: ReportParams): Promise<Report> {
    const g = SALES_GROUPS[p.groupBy ?? 'product'];
    if (!g) throw new BadRequestException(`Group by one of: ${Object.keys(SALES_GROUPS).join(', ')}`);
    // g.expr comes from the fixed list above, never from the request.
    const rows = await this.db.query(
      `SELECT ${g.expr} AS grp,
              COUNT(DISTINCT invoice_id)::int AS invoices,
              SUM(quantity)::int AS quantity,
              SUM(revenue) AS revenue, SUM(cost) AS cost, SUM(margin) AS margin,
              CASE WHEN SUM(revenue) > 0 THEN ROUND(SUM(margin) / SUM(revenue) * 100, 1) ELSE 0 END AS margin_pct
         FROM v_sales_line
        WHERE ($1::date IS NULL OR invoice_date >= $1) AND ($2::date IS NULL OR invoice_date <= $2)
        GROUP BY 1
        ORDER BY ${p.groupBy === 'day' || p.groupBy === 'month' ? '1' : 'revenue DESC'}`,
      [p.from || null, p.to || null],
    );
    const totals = this.totals(rows, ['quantity', 'revenue', 'cost', 'margin']);
    // An invoice can cover several products/brands, so count invoices once overall.
    const inv = await this.db.one<{ n: number }>(
      `SELECT COUNT(DISTINCT invoice_id)::int AS n FROM v_sales_line
        WHERE ($1::date IS NULL OR invoice_date >= $1) AND ($2::date IS NULL OR invoice_date <= $2)`,
      [p.from || null, p.to || null],
    );
    totals.invoices = inv?.n ?? 0;
    totals.margin_pct = totals.revenue ? Math.round((totals.margin / totals.revenue) * 1000) / 10 : 0;
    return {
      name: 'sales',
      title: `Sales by ${g.label.toLowerCase()}`,
      subtitle: `Invoiced sales, ${this.period(p)}. Revenue excludes tax and container deposits; cost at current cost price.`,
      columns: [
        { key: 'grp', label: g.label, type: 'text' },
        { key: 'invoices', label: 'Invoices', type: 'int' },
        { key: 'quantity', label: 'Units', type: 'int' },
        { key: 'revenue', label: 'Revenue', type: 'money' },
        { key: 'cost', label: 'Cost', type: 'money' },
        { key: 'margin', label: 'Margin', type: 'money' },
        { key: 'margin_pct', label: 'Margin %', type: 'percent' },
      ],
      rows,
      totals,
    };
  }

  // ----------------------------------------------------------------- movers
  async movers(p: ReportParams): Promise<Report> {
    const days = Math.min(Math.max(Number(p.days) || 30, 1), 365);
    const rows = await this.db.query(
      `WITH sold AS (
         SELECT product_id, SUM(quantity)::int AS units
           FROM v_sales_line WHERE invoice_date >= CURRENT_DATE - $1::int GROUP BY product_id
       ), stock AS (
         SELECT b.product_id, SUM(b.qty_on_hand)::int AS qty
           FROM stock_batch b JOIN stock_location l ON l.location_id = b.location_id
          WHERE l.location_type = 'WAREHOUSE' GROUP BY b.product_id
       ), ranked AS (
         SELECT p.product_id, p.product_name, p.brand,
                COALESCE(s.units, 0) AS units_sold,
                ROUND(COALESCE(s.units, 0)::numeric / $1, 1) AS per_day,
                COALESCE(st.qty, 0) AS in_stock,
                CASE WHEN COALESCE(s.units, 0) > 0 THEN ROUND(COALESCE(st.qty, 0) / (s.units::numeric / $1)) END AS days_of_cover,
                PERCENT_RANK() OVER (ORDER BY COALESCE(s.units, 0)) AS pr
           FROM product p LEFT JOIN sold s ON s.product_id = p.product_id LEFT JOIN stock st ON st.product_id = p.product_id
          WHERE p.is_active
       )
       SELECT product_name, brand, units_sold, per_day, in_stock, days_of_cover,
              CASE WHEN units_sold = 0 THEN 'Not selling' WHEN pr >= 0.67 THEN 'Fast' WHEN pr <= 0.33 THEN 'Slow' ELSE 'Normal' END AS movement
         FROM ranked ORDER BY units_sold DESC, product_name`,
      [days],
    );
    return {
      name: 'movers',
      title: 'Fast and slow movers',
      subtitle: `Units invoiced in the last ${days} days, ranked. Days of cover = warehouse stock ÷ average daily sales.`,
      columns: [
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'brand', label: 'Brand', type: 'text' },
        { key: 'units_sold', label: 'Units sold', type: 'int' },
        { key: 'per_day', label: 'Per day', type: 'int' },
        { key: 'in_stock', label: 'In warehouse', type: 'int' },
        { key: 'days_of_cover', label: 'Days of cover', type: 'int' },
        { key: 'movement', label: 'Movement', type: 'text' },
      ],
      rows,
      totals: this.totals(rows, ['units_sold', 'in_stock']),
    };
  }

  // ----------------------------------------------------------------- losses
  async losses(p: ReportParams): Promise<Report> {
    const rows = await this.db.query(
      `SELECT to_char(movement_time, 'YYYY-MM-DD') AS date, loss_type, product_name, batch_no, location_name,
              quantity, value_at_cost, reference, reason, recorded_by_name
         FROM v_stock_losses
        WHERE ($1::date IS NULL OR movement_time >= $1) AND ($2::date IS NULL OR movement_time < $2::date + 1)
        ORDER BY movement_time DESC`,
      [p.from || null, p.to || null],
    );
    const byType = rows.reduce((m: Record<string, number>, r: any) => ((m[r.loss_type] = (m[r.loss_type] ?? 0) + Number(r.value_at_cost)), m), {});
    const summary = Object.entries(byType)
      .map(([t, v]) => `${t} GHS ${round2(v as number).toFixed(2)}`)
      .join(' · ');
    return {
      name: 'losses',
      title: 'Stock losses',
      subtitle: `Breakages, write-offs, van shortages and stocktake shortfalls, ${this.period(p)}, at cost.${summary ? ` ${summary}.` : ''}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'loss_type', label: 'Type', type: 'text' },
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'batch_no', label: 'Batch', type: 'text' },
        { key: 'location_name', label: 'Where', type: 'text' },
        { key: 'quantity', label: 'Units', type: 'int' },
        { key: 'value_at_cost', label: 'Value', type: 'money' },
        { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      rows,
      totals: this.totals(rows, ['quantity', 'value_at_cost']),
    };
  }

  // -------------------------------------------------------------- valuation
  async valuation(): Promise<Report> {
    const rows = await this.db.query(
      `SELECT v.sku, v.product_name, c.category_name, v.qty_on_hand, v.cost_price, v.selling_price,
              v.value_at_cost, v.value_at_selling, v.value_at_selling - v.value_at_cost AS potential_margin
         FROM v_stock_valuation v JOIN product p ON p.product_id = v.product_id JOIN category c ON c.category_id = p.category_id
        ORDER BY v.value_at_cost DESC`,
    );
    return {
      name: 'valuation',
      title: 'Stock valuation',
      subtitle: `All locations (warehouses and vans), as at ${new Date().toISOString().slice(0, 10)}.`,
      columns: [
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'category_name', label: 'Category', type: 'text' },
        { key: 'qty_on_hand', label: 'Units', type: 'int' },
        { key: 'cost_price', label: 'Unit cost', type: 'money' },
        { key: 'selling_price', label: 'Unit price', type: 'money' },
        { key: 'value_at_cost', label: 'Value at cost', type: 'money' },
        { key: 'value_at_selling', label: 'Value at price', type: 'money' },
        { key: 'potential_margin', label: 'Potential margin', type: 'money' },
      ],
      rows,
      totals: this.totals(rows, ['qty_on_hand', 'value_at_cost', 'value_at_selling', 'potential_margin']),
    };
  }

  // ------------------------------------------------------------ receivables
  async receivables(): Promise<Report> {
    const rows = await this.db.query(
      `SELECT r.customer_name, c.payment_terms, c.credit_limit, r.invoices, r.total_outstanding,
              COALESCE(r.days_0_30, 0) AS days_0_30, COALESCE(r.days_31_60, 0) AS days_31_60,
              COALESCE(r.days_61_90, 0) AS days_61_90, COALESCE(r.days_over_90, 0) AS days_over_90,
              COALESCE(r.overdue, 0) AS overdue
         FROM v_receivables_ageing r JOIN customer c ON c.customer_id = r.customer_id
        ORDER BY r.total_outstanding DESC`,
    );
    return {
      name: 'receivables',
      title: 'Money owed by customers (ageing)',
      subtitle: `Unpaid invoices by age since invoice date, as at ${new Date().toISOString().slice(0, 10)}. Overdue = past the due date.`,
      columns: [
        { key: 'customer_name', label: 'Customer', type: 'text' },
        { key: 'payment_terms', label: 'Terms', type: 'text' },
        { key: 'credit_limit', label: 'Credit limit', type: 'money' },
        { key: 'invoices', label: 'Invoices', type: 'int' },
        { key: 'total_outstanding', label: 'Owed', type: 'money' },
        { key: 'days_0_30', label: '0–30 days', type: 'money' },
        { key: 'days_31_60', label: '31–60', type: 'money' },
        { key: 'days_61_90', label: '61–90', type: 'money' },
        { key: 'days_over_90', label: '90+', type: 'money' },
        { key: 'overdue', label: 'Overdue', type: 'money' },
      ],
      rows,
      totals: this.totals(rows, ['invoices', 'total_outstanding', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90', 'overdue']),
    };
  }

  // ----------------------------------------------------------------- expiry
  async expiry(p: ReportParams): Promise<Report> {
    const days = Math.min(Math.max(Number(p.days) || 90, 1), 730);
    const rows = await this.db.query(
      `SELECT p.product_name, b.batch_no, l.location_name, to_char(b.expiry_date, 'YYYY-MM-DD') AS expiry_date,
              (b.expiry_date - CURRENT_DATE) AS days_left, b.qty_on_hand, b.qty_on_hand * p.cost_price AS value_at_cost
         FROM stock_batch b JOIN product p ON p.product_id = b.product_id JOIN stock_location l ON l.location_id = b.location_id
        WHERE b.qty_on_hand > 0 AND b.expiry_date <= CURRENT_DATE + $1::int
        ORDER BY b.expiry_date`,
      [days],
    );
    return {
      name: 'expiry',
      title: 'Stock expiring soon',
      subtitle: `Batches with stock that expire within ${days} days (negative days = already expired). Sell these first or plan a promotion.`,
      columns: [
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'batch_no', label: 'Batch', type: 'text' },
        { key: 'location_name', label: 'Where', type: 'text' },
        { key: 'expiry_date', label: 'Expires', type: 'date' },
        { key: 'days_left', label: 'Days left', type: 'int' },
        { key: 'qty_on_hand', label: 'Units', type: 'int' },
        { key: 'value_at_cost', label: 'Value at cost', type: 'money' },
      ],
      rows,
      totals: this.totals(rows, ['qty_on_hand', 'value_at_cost']),
    };
  }

  // -------------------------------------------------------------- dashboard
  /** UC8 dashboard: key figures, things waiting for someone, and chart series. */
  async dashboard() {
    const [kpi, pending, daily, top, byCategory, stockByCategory] = await Promise.all([
      this.db.one(
        `SELECT
           (SELECT COALESCE(SUM(revenue), 0) FROM v_sales_line WHERE invoice_date = CURRENT_DATE) AS sales_today,
           (SELECT COUNT(*) FROM invoice WHERE invoice_date = CURRENT_DATE AND status <> 'VOID')::int AS invoices_today,
           (SELECT COALESCE(SUM(revenue), 0) FROM v_sales_line WHERE date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)) AS sales_month,
           (SELECT COALESCE(SUM(margin), 0) FROM v_sales_line WHERE date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)) AS margin_month,
           (SELECT COALESCE(SUM(outstanding), 0) FROM v_invoice_balance WHERE outstanding > 0) AS receivables,
           (SELECT COALESCE(SUM(outstanding), 0) FROM v_invoice_balance WHERE days_overdue > 0) AS overdue,
           (SELECT COALESCE(SUM(value_at_cost), 0) FROM v_stock_valuation) AS stock_value,
           (SELECT COUNT(*) FROM v_reorder_alerts)::int AS reorder_count,
           (SELECT COUNT(*) FROM v_near_expiry)::int AS near_expiry_count,
           (SELECT COALESCE(SUM(value_at_cost), 0) FROM v_stock_losses WHERE movement_time >= date_trunc('month', CURRENT_DATE)) AS losses_month`,
      ),
      this.db.one(
        `SELECT
           (SELECT COUNT(*) FROM customer_order WHERE status = 'PENDING_CREDIT_APPROVAL')::int AS credit_approvals,
           (SELECT COUNT(*) FROM customer_order WHERE status = 'CONFIRMED')::int AS orders_to_invoice,
           (SELECT COUNT(*) FROM customer_order WHERE status IN ('PICKING', 'LOADED_ON_VAN'))::int AS orders_to_deliver,
           (SELECT COUNT(*) FROM write_off WHERE status = 'PENDING_APPROVAL')::int AS write_offs,
           (SELECT COUNT(*) FROM purchase_order WHERE status = 'DRAFT')::int AS pos_to_approve,
           (SELECT COUNT(*) FROM purchase_order WHERE status IN ('APPROVED', 'SENT', 'PARTIAL'))::int AS pos_awaiting_delivery,
           (SELECT COUNT(*) FROM van_trip WHERE status = 'LOADED')::int AS vans_out,
           (SELECT COUNT(*) FROM stocktake WHERE status = 'COUNTING')::int AS counts_open`,
      ),
      this.db.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(s.revenue), 0) AS revenue
           FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d
           LEFT JOIN v_sales_line s ON s.invoice_date = d::date
          GROUP BY d ORDER BY d`,
      ),
      this.db.query(
        `SELECT product_name, SUM(quantity)::int AS quantity, SUM(revenue) AS revenue
           FROM v_sales_line GROUP BY product_name ORDER BY revenue DESC LIMIT 5`,
      ),
      this.db.query(
        `SELECT category_name, SUM(revenue) AS revenue FROM v_sales_line GROUP BY category_name ORDER BY revenue DESC`,
      ),
      this.db.query(
        `SELECT c.category_name, COALESCE(SUM(v.value_at_cost), 0) AS value_at_cost
           FROM v_stock_valuation v JOIN product p ON p.product_id = v.product_id JOIN category c ON c.category_id = p.category_id
          GROUP BY c.category_name ORDER BY value_at_cost DESC`,
      ),
    ]);
    return { kpi, pending, sales_last_14_days: daily, top_products: top, sales_by_category: byCategory, stock_by_category: stockByCategory };
  }
}

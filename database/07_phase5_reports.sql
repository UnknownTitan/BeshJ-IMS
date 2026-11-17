-- =====================================================================
-- BESH. J Limited IMS - Phase 5: reporting views (UC8, FR11)
-- Run after 06_phase4_operations.sql. Views only: nothing is stored twice,
-- so reports always agree with the transactions they come from.
--
--   v_sales_line         every invoiced order line with revenue, cost, margin
--   v_stock_losses       stock that left without being sold (write-offs,
--                        van breakage and shortages, stocktake shortfalls)
--   v_receivables_ageing outstanding invoices in 0-30 / 31-60 / 61-90 / 90+ day bands
-- =====================================================================

SET search_path TO ims;

BEGIN;

-- Revenue is before tax and deposits (tax belongs to GRA; deposits are refundable).
-- Cost uses the product's current cost price.
CREATE VIEW v_sales_line AS
SELECT i.invoice_id, i.invoice_no, i.invoice_date,
       o.order_id, o.order_no, o.customer_id, c.customer_name, c.customer_type,
       o.sales_rep_id, u.full_name AS sales_rep_name,
       CASE WHEN o.van_id IS NOT NULL AND o.status IN ('LOADED_ON_VAN','DELIVERED','PAID') THEN 'VAN' ELSE 'WAREHOUSE' END AS channel,
       l.product_id, p.sku, p.product_name, p.brand, cat.category_name,
       l.quantity, l.unit_price,
       l.quantity * l.unit_price                       AS revenue,
       l.quantity * p.cost_price                       AS cost,
       l.quantity * (l.unit_price - p.cost_price)      AS margin
FROM   invoice i
JOIN   customer_order o ON o.order_id = i.order_id
JOIN   customer c       ON c.customer_id = o.customer_id
JOIN   app_user u       ON u.user_id = o.sales_rep_id
JOIN   order_line l     ON l.order_id = o.order_id
JOIN   product p        ON p.product_id = l.product_id
JOIN   category cat     ON cat.category_id = p.category_id
WHERE  i.status <> 'VOID';

-- Stock that left without a sale, valued at cost.
CREATE VIEW v_stock_losses AS
SELECT m.movement_id, m.movement_time, m.movement_type,
       CASE
         WHEN m.movement_type = 'BREAKAGE' AND m.reference LIKE 'TRIP-%' THEN 'Van breakage'
         WHEN m.movement_type = 'BREAKAGE'                               THEN 'Write-off'
         WHEN m.reference LIKE 'TRIP-%'                                  THEN 'Van shortage'
         WHEN m.reference LIKE 'ST-%' OR m.reference LIKE 'STK-%'        THEN 'Stocktake shortfall'
         ELSE 'Other adjustment'
       END                                    AS loss_type,
       m.reference, m.reason,
       p.product_id, p.product_name, p.brand, b.batch_no, l.location_name,
       u.full_name                            AS recorded_by_name,
       m.quantity,
       m.quantity * p.cost_price              AS value_at_cost
FROM   stock_movement m
JOIN   stock_batch b    ON b.batch_id = m.batch_id
JOIN   product p        ON p.product_id = b.product_id
JOIN   stock_location l ON l.location_id = m.from_location_id
JOIN   app_user u       ON u.user_id = m.user_id
WHERE  m.movement_type IN ('BREAKAGE','ADJUSTMENT')
AND    m.from_location_id IS NOT NULL
AND    m.to_location_id IS NULL;

-- What customers owe, by how long it has been owed.
CREATE VIEW v_receivables_ageing AS
SELECT customer_id, customer_name,
       SUM(outstanding)                                                              AS total_outstanding,
       SUM(outstanding) FILTER (WHERE CURRENT_DATE - invoice_date <= 30)             AS days_0_30,
       SUM(outstanding) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 31 AND 60) AS days_31_60,
       SUM(outstanding) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 61 AND 90) AS days_61_90,
       SUM(outstanding) FILTER (WHERE CURRENT_DATE - invoice_date > 90)              AS days_over_90,
       SUM(outstanding) FILTER (WHERE days_overdue > 0)                              AS overdue,
       COUNT(*)::int                                                                 AS invoices
FROM   v_invoice_balance
WHERE  outstanding > 0
GROUP  BY customer_id, customer_name;

CREATE INDEX ix_movement_type_time ON stock_movement (movement_type, movement_time);
CREATE INDEX ix_invoice_date ON invoice (invoice_date);

COMMIT;

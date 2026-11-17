-- =====================================================================
-- BESH. J Limited IMS - Phase 3: sales, invoicing and payments (UC9, FR9, FR10)
-- Run after 04_phase2_purchasing.sql.
--
--   1. tax_rate: Ghana VAT components kept as data, not code.
--      From 1 Jan 2026 (VAT Act 2025, Act 1151): VAT 15% + NHIL 2.5% +
--      GETFund 2.5%, all on the same tax-exclusive value = 20% in total.
--   2. invoice.tax_rate and invoice.due_date
--   3. fn_containers_needed(): how many crates/kegs/bottles carry a deposit
--   4. v_order_value: subtotal and container deposit per order (derived)
--   5. v_invoice_balance: paid vs outstanding per invoice, days overdue
--   6. Payments can never exceed what is owed on an invoice (trigger)
--   7. Order lines are frozen once the order leaves DRAFT (trigger)
--   8. Document numbers SO-YYYY-NNNNN / INV-YYYY-NNNNN
-- =====================================================================

SET search_path TO ims;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tax rates
-- ---------------------------------------------------------------------
CREATE TABLE tax_rate (
	tax_code       	VARCHAR(10)   NOT NULL,
	tax_name       	VARCHAR(60)   NOT NULL,
	rate_percent   	NUMERIC(5,2)  NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
	effective_from 	DATE      	NOT NULL,
	effective_to   	DATE,
	PRIMARY KEY (tax_code, effective_from),
	CONSTRAINT chk_tax_rate_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

INSERT INTO tax_rate (tax_code, tax_name, rate_percent, effective_from) VALUES
	('VAT',     'Value Added Tax',                  15.00, '2026-01-01'),
	('NHIL',    'National Health Insurance Levy',    2.50, '2026-01-01'),
	('GETFUND', 'Ghana Education Trust Fund Levy',   2.50, '2026-01-01');

-- Total tax percent in force on a date (all components share the same base).
CREATE OR REPLACE FUNCTION fn_tax_rate(p_date DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
	SELECT COALESCE(SUM(rate_percent), 0)
	FROM   ims.tax_rate
	WHERE  effective_from <= p_date
	AND   (effective_to IS NULL OR effective_to > p_date);
$$;

-- ---------------------------------------------------------------------
-- 2. Invoices remember the rate used and when payment is due
-- ---------------------------------------------------------------------
ALTER TABLE invoice ADD COLUMN tax_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00;
ALTER TABLE invoice ADD COLUMN due_date DATE;

-- Sample invoices: credit customers get 30 days, cash customers pay on the day.
UPDATE invoice i
SET    due_date = i.invoice_date + CASE WHEN c.payment_terms = 'CREDIT' THEN 30 ELSE 0 END
FROM   customer_order o JOIN customer c ON c.customer_id = o.customer_id
WHERE  o.order_id = i.order_id;

ALTER TABLE invoice ALTER COLUMN due_date SET NOT NULL;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_due CHECK (due_date >= invoice_date);

-- ---------------------------------------------------------------------
-- 3. Returnable containers needed for a quantity of a product
--    Crate of 24: 48 bottles -> 2 crates. Keg or loose bottle: 1 each.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_containers_needed(p_container_type_id SMALLINT, p_quantity INTEGER)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
	SELECT CASE
	         WHEN p_container_type_id IS NULL THEN 0
	         WHEN ct.units_held IS NULL       THEN p_quantity
	         ELSE CEIL(p_quantity::NUMERIC / ct.units_held)::INTEGER
	       END
	FROM   (SELECT 1) one
	LEFT JOIN ims.container_type ct ON ct.container_type_id = p_container_type_id;
$$;

-- ---------------------------------------------------------------------
-- 4. Order value: what the customer will be charged (before tax)
-- ---------------------------------------------------------------------
CREATE VIEW v_order_line_value AS
SELECT l.order_id, l.line_no, l.product_id, p.sku, p.product_name, p.base_unit,
       l.quantity, l.unit_price,
       l.quantity * l.unit_price                                        AS line_total,
       p.container_type_id, ct.container_name,
       fn_containers_needed(p.container_type_id, l.quantity)            AS containers,
       fn_containers_needed(p.container_type_id, l.quantity)
         * COALESCE(ct.deposit_amount, 0)                               AS deposit
FROM   order_line l
JOIN   product p ON p.product_id = l.product_id
LEFT JOIN container_type ct ON ct.container_type_id = p.container_type_id;

CREATE VIEW v_order_value AS
SELECT o.order_id,
       COALESCE(SUM(v.line_total), 0) AS subtotal,
       COALESCE(SUM(v.deposit), 0)    AS deposit,
       COUNT(v.line_no)::int          AS line_count
FROM   customer_order o
LEFT JOIN v_order_line_value v ON v.order_id = o.order_id
GROUP  BY o.order_id;

-- ---------------------------------------------------------------------
-- 5. Invoice balances
-- ---------------------------------------------------------------------
CREATE VIEW v_invoice_balance AS
SELECT i.invoice_id, i.invoice_no, i.order_id, o.customer_id, c.customer_name,
       i.invoice_date, i.due_date, i.total_amount, i.status,
       COALESCE(SUM(p.amount), 0)                       AS amount_paid,
       i.total_amount - COALESCE(SUM(p.amount), 0)      AS outstanding,
       CASE WHEN i.total_amount - COALESCE(SUM(p.amount), 0) > 0 AND i.due_date < CURRENT_DATE
            THEN CURRENT_DATE - i.due_date ELSE 0 END   AS days_overdue
FROM   invoice i
JOIN   customer_order o ON o.order_id = i.order_id
JOIN   customer c       ON c.customer_id = o.customer_id
LEFT JOIN payment p     ON p.invoice_id = i.invoice_id
WHERE  i.status <> 'VOID'
GROUP  BY i.invoice_id, o.customer_id, c.customer_name;

-- ---------------------------------------------------------------------
-- 6. No overpaying an invoice, and the payer must be the invoice's customer
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_payment_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_total     NUMERIC;
	v_paid      NUMERIC;
	v_customer  INTEGER;
	v_no        VARCHAR;
BEGIN
	IF NEW.invoice_id IS NULL THEN
		RETURN NEW;   -- money on account, not tied to one invoice
	END IF;

	SELECT i.total_amount, o.customer_id, i.invoice_no
	INTO   v_total, v_customer, v_no
	FROM   ims.invoice i JOIN ims.customer_order o ON o.order_id = i.order_id
	WHERE  i.invoice_id = NEW.invoice_id
	FOR UPDATE OF i;

	IF v_customer <> NEW.customer_id THEN
		RAISE EXCEPTION 'Invoice % belongs to another customer', v_no;
	END IF;

	SELECT COALESCE(SUM(amount), 0) INTO v_paid
	FROM   ims.payment
	WHERE  invoice_id = NEW.invoice_id AND payment_id <> COALESCE(NEW.payment_id, -1);

	IF v_paid + NEW.amount > v_total THEN
		RAISE EXCEPTION 'Payment of % is more than the % still owed on invoice %',
		                NEW.amount, v_total - v_paid, v_no;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_check
BEFORE INSERT OR UPDATE ON payment
FOR EACH ROW EXECUTE FUNCTION fn_payment_check();

-- ---------------------------------------------------------------------
-- 7. Order lines are frozen once the order leaves DRAFT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_order_line_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_status VARCHAR;
BEGIN
	SELECT status INTO v_status FROM ims.customer_order
	WHERE  order_id = COALESCE(NEW.order_id, OLD.order_id);

	IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
		RAISE EXCEPTION 'Order lines can only be changed while the order is a DRAFT (it is %)', v_status;
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_order_line_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON order_line
FOR EACH ROW EXECUTE FUNCTION fn_order_line_draft_only();

CREATE TRIGGER trg_audit_order_line AFTER INSERT OR UPDATE OR DELETE ON order_line
FOR EACH ROW EXECUTE FUNCTION fn_audit('order_id');

-- ---------------------------------------------------------------------
-- 8. Document numbers (sample data uses 5 digits: SO-2027-00001)
-- ---------------------------------------------------------------------
-- A 3-argument version alongside the 4-digit one from 04 (no DROP needed).
CREATE OR REPLACE FUNCTION fn_next_doc_no(p_prefix TEXT, p_seq REGCLASS, p_width INTEGER)
RETURNS TEXT LANGUAGE sql AS $$
	SELECT p_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval(p_seq)::text, p_width, '0');
$$;

CREATE SEQUENCE so_no_seq  START 8;   -- sample: SO-2027-00001..00007
CREATE SEQUENCE inv_no_seq START 6;   -- sample: INV-2027-00001..00005

CREATE INDEX ix_payment_invoice ON payment (invoice_id);

COMMIT;

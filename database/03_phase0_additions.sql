-- =====================================================================
-- BESH. J Limited IMS - Implementation additions (Phase 0)
-- Run after 01_schema.sql and 02_sample_data.sql.
--
-- Adds what the running application needs on top of the Assignment 7
-- design:
--   1. Login passwords (bcrypt hashes) on app_user          -> FR12 / UC10
--   2. An append-only audit_log filled by triggers          -> FR12
--   3. Reporting views: near-expiry stock, stock valuation  -> FR5, FR11
--   4. fn_fefo_allocate(): First-Expired, First-Out picking -> FR5
-- =====================================================================

SET search_path TO ims;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Passwords
-- Demo password for every sample user: Password123!
-- pgcrypto's bf (bcrypt) hashes are compatible with bcryptjs in the API.
-- ---------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN password_hash VARCHAR(72);

UPDATE app_user
SET    password_hash = public.crypt('Password123!', public.gen_salt('bf', 10));

ALTER TABLE app_user ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE app_user ADD COLUMN last_login TIMESTAMP;

-- ---------------------------------------------------------------------
-- 2. Audit trail
-- The API runs each request in a transaction and sets
--   SET LOCAL app.user_id = '<id>'
-- so the trigger knows who made the change.
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
	audit_id    	BIGSERIAL 	PRIMARY KEY,
	table_name  	VARCHAR(40)   NOT NULL,
	operation   	VARCHAR(6)    NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE','LOGIN')),
	record_key  	VARCHAR(60),
	user_id     	INTEGER   	REFERENCES app_user (user_id),
	changed_at  	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	old_data    	JSONB,
	new_data    	JSONB
);

CREATE INDEX ix_audit_table_time ON audit_log (table_name, changed_at DESC);
CREATE INDEX ix_audit_user       ON audit_log (user_id);

-- Audit rows can be added but never changed or removed.
CREATE OR REPLACE FUNCTION fn_audit_log_readonly() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER trg_audit_log_readonly
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION fn_audit_log_readonly();

-- Generic row-level audit trigger. TG_ARGV[0] names the key column.
CREATE OR REPLACE FUNCTION fn_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_user  INTEGER := NULLIF(current_setting('app.user_id', true), '')::INTEGER;
	v_old   JSONB   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
	v_new   JSONB   := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
BEGIN
	-- Never copy password hashes into the audit trail.
	v_old := v_old - 'password_hash';
	v_new := v_new - 'password_hash';

	-- A login only stamps last_login; the LOGIN audit row already covers it.
	IF TG_OP = 'UPDATE' AND (v_old - 'last_login') = (v_new - 'last_login') THEN
		RETURN NULL;
	END IF;

	INSERT INTO ims.audit_log (table_name, operation, record_key, user_id, old_data, new_data)
	VALUES (TG_TABLE_NAME, TG_OP,
	        COALESCE(v_new ->> TG_ARGV[0], v_old ->> TG_ARGV[0]),
	        v_user, v_old, v_new);
	RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_product          AFTER INSERT OR UPDATE OR DELETE ON product          FOR EACH ROW EXECUTE FUNCTION fn_audit('product_id');
CREATE TRIGGER trg_audit_customer         AFTER INSERT OR UPDATE OR DELETE ON customer         FOR EACH ROW EXECUTE FUNCTION fn_audit('customer_id');
CREATE TRIGGER trg_audit_supplier         AFTER INSERT OR UPDATE OR DELETE ON supplier         FOR EACH ROW EXECUTE FUNCTION fn_audit('supplier_id');
CREATE TRIGGER trg_audit_app_user         AFTER INSERT OR UPDATE OR DELETE ON app_user         FOR EACH ROW EXECUTE FUNCTION fn_audit('user_id');
CREATE TRIGGER trg_audit_stock_batch      AFTER INSERT OR UPDATE OR DELETE ON stock_batch      FOR EACH ROW EXECUTE FUNCTION fn_audit('batch_id');
CREATE TRIGGER trg_audit_stock_movement   AFTER INSERT OR UPDATE OR DELETE ON stock_movement   FOR EACH ROW EXECUTE FUNCTION fn_audit('movement_id');
CREATE TRIGGER trg_audit_customer_order   AFTER INSERT OR UPDATE OR DELETE ON customer_order   FOR EACH ROW EXECUTE FUNCTION fn_audit('order_id');
CREATE TRIGGER trg_audit_invoice          AFTER INSERT OR UPDATE OR DELETE ON invoice          FOR EACH ROW EXECUTE FUNCTION fn_audit('invoice_id');
CREATE TRIGGER trg_audit_payment          AFTER INSERT OR UPDATE OR DELETE ON payment          FOR EACH ROW EXECUTE FUNCTION fn_audit('payment_id');
CREATE TRIGGER trg_audit_empties          AFTER INSERT OR UPDATE OR DELETE ON empties_transaction FOR EACH ROW EXECUTE FUNCTION fn_audit('empties_txn_id');
CREATE TRIGGER trg_audit_purchase_order   AFTER INSERT OR UPDATE OR DELETE ON purchase_order   FOR EACH ROW EXECUTE FUNCTION fn_audit('po_id');

-- ---------------------------------------------------------------------
-- 3. Reporting views
-- ---------------------------------------------------------------------

-- Batches with stock that expire within 30 days (FR5).
CREATE VIEW v_near_expiry AS
SELECT b.batch_id, p.product_id, p.sku, p.brand, p.product_name,
       l.location_name, b.batch_no, b.expiry_date, b.qty_on_hand,
       (b.expiry_date - CURRENT_DATE) AS days_to_expiry,
       CASE WHEN b.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE 'NEAR_EXPIRY' END AS expiry_status
FROM   stock_batch b
JOIN   product p        ON p.product_id = b.product_id
JOIN   stock_location l ON l.location_id = b.location_id
WHERE  b.qty_on_hand > 0
AND    b.expiry_date <= CURRENT_DATE + 30;

-- Stock value at cost and at selling price, per product (FR11).
CREATE VIEW v_stock_valuation AS
SELECT p.product_id, p.sku, p.brand, p.product_name,
       COALESCE(SUM(b.qty_on_hand), 0)                       AS qty_on_hand,
       p.cost_price, p.selling_price,
       COALESCE(SUM(b.qty_on_hand), 0) * p.cost_price        AS value_at_cost,
       COALESCE(SUM(b.qty_on_hand), 0) * p.selling_price     AS value_at_selling
FROM   product p
LEFT JOIN stock_batch b ON b.product_id = p.product_id
WHERE  p.is_active
GROUP  BY p.product_id, p.sku, p.brand, p.product_name, p.cost_price, p.selling_price;

-- Warehouse products at or below their reorder level (FR4).
CREATE VIEW v_reorder_alerts AS
SELECT p.product_id, p.sku, p.brand, p.product_name, p.reorder_level,
       COALESCE(SUM(b.qty_on_hand), 0) AS warehouse_qty,
       s.supplier_id, s.supplier_name
FROM   product p
JOIN   supplier s ON s.supplier_id = p.supplier_id
LEFT JOIN stock_batch b
       ON b.product_id = p.product_id
      AND b.location_id IN (SELECT location_id FROM stock_location WHERE location_type = 'WAREHOUSE')
WHERE  p.is_active
GROUP  BY p.product_id, p.sku, p.brand, p.product_name, p.reorder_level, s.supplier_id, s.supplier_name
HAVING COALESCE(SUM(b.qty_on_hand), 0) <= p.reorder_level;

-- ---------------------------------------------------------------------
-- 4. FEFO allocation (FR5)
-- Returns which batches to pick, earliest expiry first, for a quantity
-- of a product at a location. Expired batches are skipped. Raises an
-- error if there is not enough stock.
--   SELECT * FROM ims.fn_fefo_allocate(1, 1, 500);
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fefo_allocate(p_product_id INTEGER,
                                            p_location_id SMALLINT,
                                            p_quantity INTEGER)
RETURNS TABLE (batch_id INTEGER, batch_no VARCHAR, expiry_date DATE, qty_to_pick INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
	r          RECORD;
	v_left     INTEGER := p_quantity;
	v_take     INTEGER;
BEGIN
	IF p_quantity <= 0 THEN
		RAISE EXCEPTION 'Quantity must be greater than zero';
	END IF;

	FOR r IN
		SELECT b.batch_id, b.batch_no, b.expiry_date, b.qty_on_hand
		FROM   ims.stock_batch b
		WHERE  b.product_id = p_product_id
		AND    b.location_id = p_location_id
		AND    b.qty_on_hand > 0
		AND    b.expiry_date >= CURRENT_DATE
		ORDER  BY b.expiry_date, b.batch_id
	LOOP
		EXIT WHEN v_left = 0;
		v_take := LEAST(v_left, r.qty_on_hand);
		batch_id    := r.batch_id;
		batch_no    := r.batch_no;
		expiry_date := r.expiry_date;
		qty_to_pick := v_take;
		v_left      := v_left - v_take;
		RETURN NEXT;
	END LOOP;

	IF v_left > 0 THEN
		RAISE EXCEPTION 'Insufficient stock: % units short for product % at location %',
		                v_left, p_product_id, p_location_id;
	END IF;
END;
$$;

COMMIT;

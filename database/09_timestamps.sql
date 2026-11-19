-- =====================================================================
-- BESH. J Limited IMS - 09: timestamps (FR12)
-- 1. Every master record shows when it was added and last changed, and by whom.
-- 2. Invoices, payments, empties and purchase orders get an exact time, not just a date.
-- 3. A timeline of each document's steps (created, approved, invoiced, delivered,
--    paid ...), built from the audit trail so nothing is recorded twice.
-- Safe to run on a database that already has scripts 01-08.
-- =====================================================================
SET search_path TO ims, public;

-- 1. Columns ---------------------------------------------------------------
-- Master records: who added it and when, who last changed it and when.
DO $$
DECLARE t TEXT;
BEGIN
	FOREACH t IN ARRAY ARRAY['product','customer','supplier','stock_location','app_user',
	                         'category','container_type','app_setting','tax_rate'] LOOP
		EXECUTE format('ALTER TABLE %I
			ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
			ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES app_user (user_id),
			ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
			ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES app_user (user_id)', t);
	END LOOP;
	-- Transactions that only had a date: the exact time they were recorded.
	FOREACH t IN ARRAY ARRAY['invoice','payment','empties_transaction','purchase_order'] LOOP
		EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMP', t);
	END LOOP;
END;
$$;

-- 2. Fill in existing rows from the audit trail --------------------------------
-- Rows loaded before the audit trail existed (the sample data) keep created_at
-- empty on master records; the screens show them as "original data".
DO $$
DECLARE r RECORD;
BEGIN
	FOR r IN SELECT * FROM (VALUES
		('product','product_id'), ('customer','customer_id'), ('supplier','supplier_id'),
		('stock_location','location_id'), ('app_user','user_id')) v(tbl, pk) LOOP
		EXECUTE format($f$
			UPDATE %1$I x SET created_at = a.changed_at, created_by = a.user_id
			FROM audit_log a
			WHERE a.table_name = %1$L AND a.operation = 'INSERT' AND a.record_key = x.%2$I::text
			  AND x.created_at IS NULL$f$, r.tbl, r.pk);
		EXECUTE format($f$
			UPDATE %1$I x SET updated_at = a.changed_at, updated_by = a.user_id
			FROM (SELECT DISTINCT ON (record_key) record_key, changed_at, user_id
			        FROM audit_log
			       WHERE table_name = %1$L AND operation = 'UPDATE'
			       ORDER BY record_key, changed_at DESC) a
			WHERE a.record_key = x.%2$I::text AND x.updated_at IS NULL$f$, r.tbl, r.pk);
	END LOOP;
END;
$$;

-- Transactions: the audit time if there is one, otherwise the start of their date.
UPDATE invoice x SET created_at = COALESCE(
	(SELECT changed_at FROM audit_log WHERE table_name = 'invoice' AND operation = 'INSERT' AND record_key = x.invoice_id::text),
	x.invoice_date::timestamp) WHERE created_at IS NULL;
UPDATE payment x SET created_at = COALESCE(
	(SELECT changed_at FROM audit_log WHERE table_name = 'payment' AND operation = 'INSERT' AND record_key = x.payment_id::text),
	x.payment_date::timestamp) WHERE created_at IS NULL;
UPDATE empties_transaction x SET created_at = COALESCE(
	(SELECT changed_at FROM audit_log WHERE table_name = 'empties_transaction' AND operation = 'INSERT' AND record_key = x.empties_txn_id::text),
	x.txn_date::timestamp) WHERE created_at IS NULL;
UPDATE purchase_order x SET created_at = COALESCE(
	(SELECT changed_at FROM audit_log WHERE table_name = 'purchase_order' AND operation = 'INSERT' AND record_key = x.po_id::text),
	x.po_date::timestamp) WHERE created_at IS NULL;

ALTER TABLE invoice             ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE payment             ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE empties_transaction ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE purchase_order      ALTER COLUMN created_at SET NOT NULL;

-- Invoice lists show the exact time an invoice was issued (column added at the end).
CREATE OR REPLACE VIEW v_invoice_balance AS
SELECT i.invoice_id, i.invoice_no, i.order_id, o.customer_id, c.customer_name,
       i.invoice_date, i.due_date, i.total_amount, i.status,
       COALESCE(SUM(p.amount), 0)                       AS amount_paid,
       i.total_amount - COALESCE(SUM(p.amount), 0)      AS outstanding,
       CASE WHEN i.total_amount - COALESCE(SUM(p.amount), 0) > 0 AND i.due_date < CURRENT_DATE
            THEN CURRENT_DATE - i.due_date ELSE 0 END   AS days_overdue,
       i.created_at
FROM   invoice i
JOIN   customer_order o ON o.order_id = i.order_id
JOIN   customer c       ON c.customer_id = o.customer_id
LEFT JOIN payment p     ON p.invoice_id = i.invoice_id
WHERE  i.status <> 'VOID'
GROUP  BY i.invoice_id, o.customer_id, c.customer_name;

-- 3. One trigger stamps every table ------------------------------------------
-- On insert: created_at (+ created_by where the table has it).
-- On update: updated_at and updated_by, and created_* can't be changed.
-- An update that changes nothing (or only a login time) is not a change.
CREATE OR REPLACE FUNCTION fn_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_user INTEGER := NULLIF(current_setting('app.user_id', true), '')::INTEGER;
	v_old  JSONB;
BEGIN
	IF TG_OP = 'INSERT' THEN
		-- created_by is only filled where the row doesn't already say who created it
		RETURN jsonb_populate_record(NEW, jsonb_strip_nulls(jsonb_build_object(
			'created_at', now(),
			'created_by', COALESCE(NULLIF(to_jsonb(NEW) -> 'created_by', 'null'::jsonb), to_jsonb(v_user)))));
	END IF;

	v_old := to_jsonb(OLD);
	IF (to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'last_login')
	 = (v_old         - 'updated_at' - 'updated_by' - 'last_login') THEN
		RETURN NEW;
	END IF;

	RETURN jsonb_populate_record(NEW, jsonb_build_object(
		'created_at', v_old -> 'created_at',
		'created_by', v_old -> 'created_by',
		'updated_at', now(),
		'updated_by', v_user));
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
	FOREACH t IN ARRAY ARRAY['product','customer','supplier','stock_location','app_user',
	                         'category','container_type','app_setting','tax_rate',
	                         'invoice','payment','empties_transaction','purchase_order'] LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp ON %I', t);
		EXECUTE format('CREATE TRIGGER trg_stamp BEFORE INSERT OR UPDATE ON %I
		                FOR EACH ROW EXECUTE FUNCTION fn_stamp()', t);
	END LOOP;
END;
$$;

-- 4. Document timelines ---------------------------------------------------------
-- Every step in the life of an order, purchase order, write-off, van trip or
-- stocktake, with the exact time and the person. Read straight from the audit
-- trail: status changes, plus the invoice, payments and deliveries received.
CREATE OR REPLACE VIEW v_document_timeline AS
-- created, and every change of status
SELECT a.table_name AS doc_table, a.record_key::int AS doc_id, a.changed_at AS event_at,
       a.user_id, u.full_name AS user_name,
       CASE WHEN a.operation = 'INSERT' THEN 'CREATED' ELSE 'STATUS' END AS event,
       a.old_data ->> 'status' AS from_status, a.new_data ->> 'status' AS to_status,
       NULL::text AS detail, NULL::numeric AS amount
FROM   audit_log a
LEFT   JOIN app_user u ON u.user_id = a.user_id
WHERE  a.table_name IN ('customer_order','purchase_order','write_off','van_trip','stocktake')
  AND  (a.operation = 'INSERT'
        OR (a.operation = 'UPDATE' AND a.old_data ->> 'status' IS DISTINCT FROM a.new_data ->> 'status'))
UNION ALL
-- an invoice issued for an order
SELECT 'customer_order', (a.new_data ->> 'order_id')::int, a.changed_at, a.user_id, u.full_name,
       'INVOICED', NULL, NULL, a.new_data ->> 'invoice_no', (a.new_data ->> 'total_amount')::numeric
FROM   audit_log a
LEFT   JOIN app_user u ON u.user_id = a.user_id
WHERE  a.table_name = 'invoice' AND a.operation = 'INSERT'
UNION ALL
-- a payment against an order's invoice
SELECT 'customer_order', i.order_id, a.changed_at, a.user_id, u.full_name,
       'PAYMENT', NULL, NULL, a.new_data ->> 'payment_method', (a.new_data ->> 'amount')::numeric
FROM   audit_log a
JOIN   invoice i ON i.invoice_id = (a.new_data ->> 'invoice_id')::int
LEFT   JOIN app_user u ON u.user_id = a.user_id
WHERE  a.table_name = 'payment' AND a.operation = 'INSERT'
UNION ALL
-- a delivery received against a purchase order
SELECT 'purchase_order', (a.new_data ->> 'po_id')::int, a.changed_at, a.user_id, u.full_name,
       'RECEIVED', NULL, NULL, a.new_data ->> 'grn_no', NULL
FROM   audit_log a
LEFT   JOIN app_user u ON u.user_id = a.user_id
WHERE  a.table_name = 'goods_receipt' AND a.operation = 'INSERT';

-- The timeline looks rows up by table and key.
CREATE INDEX IF NOT EXISTS ix_audit_table_key ON audit_log (table_name, record_key);

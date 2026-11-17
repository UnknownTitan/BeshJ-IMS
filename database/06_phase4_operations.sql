-- =====================================================================
-- BESH. J Limited IMS - Phase 4: warehouse operations
--   UC3 Breakages & write-offs   UC7 Empties & deposits
--   UC6 Van loading & reconciliation   UC4 Stocktake
-- Run after 05_phase3_sales.sql. Makes no destructive changes, so it can
-- be applied to a live database without losing data.
--
--   1. app_setting: business limits kept as data (write-off approval limit)
--   2. write_off: breakages/expiries with reason, person responsible, value,
--      and manager approval above the limit (approver <> recorder)
--   3. Transfer-aware stock trigger: one movement from one location to
--      another (van load, van return, depot transfer) takes stock out of the
--      source batch and puts it into the same batch at the destination
--   4. Empties: refund method, no returning more than a customer holds,
--      deposits credited to the account reduce the customer's balance
--   5. van_trip / van_trip_line: load sheet and end-of-day reconciliation
--   6. stocktake / stocktake_line: count sheet and variances
-- =====================================================================

SET search_path TO ims;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
CREATE TABLE app_setting (
	setting_key   	VARCHAR(40)   PRIMARY KEY,
	setting_value 	NUMERIC(12,2) NOT NULL,
	description   	VARCHAR(200)  NOT NULL
);

INSERT INTO app_setting VALUES
	('WRITE_OFF_APPROVAL_LIMIT', 200.00, 'Write-offs worth more than this (GH₵ at cost) need a Warehouse Manager''s approval');

-- ---------------------------------------------------------------------
-- 2. Write-offs (UC3)
-- ---------------------------------------------------------------------
CREATE TABLE write_off (
	write_off_id        	SERIAL    	PRIMARY KEY,
	write_off_no        	VARCHAR(20)   NOT NULL UNIQUE,
	batch_id            	INTEGER   	NOT NULL REFERENCES stock_batch (batch_id),
	quantity            	INTEGER   	NOT NULL CHECK (quantity > 0),
	reason_code         	VARCHAR(18)   NOT NULL CHECK (reason_code IN
	                    	('BROKEN','LEAKING','EXPIRED','DAMAGED_IN_TRANSIT','THEFT','OTHER')),
	description         	VARCHAR(200)  NOT NULL,
	responsible_user_id 	INTEGER   	REFERENCES app_user (user_id),
	unit_cost           	NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
	write_off_value     	NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
	status              	VARCHAR(16)   NOT NULL DEFAULT 'PENDING_APPROVAL'
	                    	CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
	recorded_by         	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	recorded_at         	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	decided_by          	INTEGER   	REFERENCES app_user (user_id),
	decided_at          	TIMESTAMP,
	decision_note       	VARCHAR(200),
	movement_id         	BIGINT    	REFERENCES stock_movement (movement_id),
	CONSTRAINT chk_write_off_decision CHECK (
		(status = 'PENDING_APPROVAL' AND decided_by IS NULL) OR
		(status <> 'PENDING_APPROVAL' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
	CONSTRAINT chk_write_off_posted CHECK (status <> 'APPROVED' OR movement_id IS NOT NULL),
	CONSTRAINT chk_write_off_reject_note CHECK (status <> 'REJECTED' OR decision_note IS NOT NULL)
);

CREATE INDEX ix_write_off_status ON write_off (status);

CREATE TRIGGER trg_audit_write_off AFTER INSERT OR UPDATE OR DELETE ON write_off
FOR EACH ROW EXECUTE FUNCTION fn_audit('write_off_id');

-- ---------------------------------------------------------------------
-- 3. Stock movements, now transfer-aware
-- The movement names the SOURCE batch for anything leaving a location:
--   from_location = batch location            -> out of that batch
--   to_location   = another location as well  -> into the same batch number
--                                                at the destination (created
--                                                if needed)
--   only to_location = batch location         -> into that batch (receipts,
--                                                positive adjustments)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_batch ims.stock_batch%ROWTYPE;
BEGIN
	SELECT * INTO v_batch FROM ims.stock_batch WHERE batch_id = NEW.batch_id FOR UPDATE;

	IF NEW.from_location_id = v_batch.location_id THEN
		IF v_batch.qty_on_hand < NEW.quantity THEN
			RAISE EXCEPTION 'Not enough stock in batch %: % on hand, % requested',
			                v_batch.batch_no, v_batch.qty_on_hand, NEW.quantity;
		END IF;
		UPDATE ims.stock_batch SET qty_on_hand = qty_on_hand - NEW.quantity WHERE batch_id = v_batch.batch_id;

		IF NEW.to_location_id IS NOT NULL AND NEW.to_location_id <> v_batch.location_id THEN
			INSERT INTO ims.stock_batch (product_id, location_id, batch_no, received_date, expiry_date, qty_on_hand)
			VALUES (v_batch.product_id, NEW.to_location_id, v_batch.batch_no,
			        LEAST(CURRENT_DATE, v_batch.expiry_date - 1), v_batch.expiry_date, NEW.quantity)
			ON CONFLICT ON CONSTRAINT uq_batch_location
			DO UPDATE SET qty_on_hand = ims.stock_batch.qty_on_hand + EXCLUDED.qty_on_hand;
		END IF;

	ELSIF NEW.to_location_id = v_batch.location_id THEN
		UPDATE ims.stock_batch SET qty_on_hand = qty_on_hand + NEW.quantity WHERE batch_id = v_batch.batch_id;

	ELSE
		RAISE EXCEPTION 'Movement % does not touch the location of batch %', NEW.movement_type, v_batch.batch_no;
	END IF;

	RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Empties and deposits (UC7)
-- ---------------------------------------------------------------------
-- How a customer got their deposit back: credited to their account or paid in cash.
ALTER TABLE empties_transaction ADD COLUMN refund_method VARCHAR(6)
	CHECK (refund_method IN ('CREDIT','CASH'));
ALTER TABLE empties_transaction ADD CONSTRAINT chk_empties_refund CHECK (
	refund_method IS NULL OR (direction = 'RETURNED' AND customer_id IS NOT NULL));

-- A customer cannot return more containers than they hold.
CREATE OR REPLACE FUNCTION fn_empties_return_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_held INTEGER;
BEGIN
	IF NEW.direction = 'RETURNED' AND NEW.customer_id IS NOT NULL THEN
		SELECT COALESCE(SUM(CASE direction WHEN 'ISSUED' THEN quantity ELSE -quantity END), 0)
		INTO   v_held
		FROM   ims.empties_transaction
		WHERE  customer_id = NEW.customer_id AND container_type_id = NEW.container_type_id;

		IF NEW.quantity > v_held THEN
			RAISE EXCEPTION 'The customer only holds % of these containers', v_held;
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER trg_empties_return_check
BEFORE INSERT ON empties_transaction
FOR EACH ROW EXECUTE FUNCTION fn_empties_return_check();

CREATE TRIGGER trg_audit_empties_txn AFTER UPDATE OR DELETE ON empties_transaction
FOR EACH ROW EXECUTE FUNCTION fn_audit('empties_txn_id');

-- Balance now also subtracts deposits credited back to the account.
CREATE OR REPLACE VIEW v_customer_balance AS
SELECT c.customer_id, c.customer_name, c.credit_limit,
       COALESCE(i.invoiced, 0.00) - COALESCE(pay.paid, 0.00) - COALESCE(cr.credited, 0.00) AS balance
FROM   customer c
LEFT JOIN (SELECT o.customer_id, SUM(inv.total_amount) AS invoiced
           FROM   invoice inv JOIN customer_order o ON o.order_id = inv.order_id
           WHERE  inv.status <> 'VOID' GROUP BY o.customer_id) i ON i.customer_id = c.customer_id
LEFT JOIN (SELECT customer_id, SUM(amount) AS paid FROM payment GROUP BY customer_id) pay
       ON pay.customer_id = c.customer_id
LEFT JOIN (SELECT customer_id, SUM(deposit_value) AS credited FROM empties_transaction
           WHERE  direction = 'RETURNED' AND refund_method = 'CREDIT' GROUP BY customer_id) cr
       ON cr.customer_id = c.customer_id;

-- Containers held and the deposit value they represent, per customer.
CREATE VIEW v_empties_position AS
SELECT c.customer_id, c.customer_name, ct.container_type_id, ct.container_name, ct.deposit_amount,
       SUM(CASE e.direction WHEN 'ISSUED' THEN e.quantity ELSE -e.quantity END)::int AS containers_held,
       SUM(CASE e.direction WHEN 'ISSUED' THEN e.quantity ELSE -e.quantity END) * ct.deposit_amount AS deposit_held
FROM   empties_transaction e
JOIN   customer c        ON c.customer_id = e.customer_id
JOIN   container_type ct ON ct.container_type_id = e.container_type_id
GROUP  BY c.customer_id, c.customer_name, ct.container_type_id, ct.container_name, ct.deposit_amount;

-- ---------------------------------------------------------------------
-- 5. Van trips (UC6)
-- ---------------------------------------------------------------------
CREATE TABLE van_trip (
	trip_id        	SERIAL    	PRIMARY KEY,
	trip_no        	VARCHAR(20)   NOT NULL UNIQUE,
	van_id         	SMALLINT  	NOT NULL REFERENCES stock_location (location_id),
	driver_id      	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	trip_date      	DATE      	NOT NULL DEFAULT CURRENT_DATE,
	status         	VARCHAR(10)   NOT NULL DEFAULT 'LOADED' CHECK (status IN ('LOADED','RECONCILED')),
	loaded_by      	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	loaded_at      	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	reconciled_by  	INTEGER   	REFERENCES app_user (user_id),
	reconciled_at  	TIMESTAMP,
	cash_expected  	NUMERIC(12,2),
	cash_declared  	NUMERIC(12,2) CHECK (cash_declared >= 0),
	notes          	VARCHAR(200),
	CONSTRAINT chk_trip_reconciled CHECK (
		status = 'LOADED' OR (reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL AND cash_declared IS NOT NULL))
);

-- A van has at most one open trip at a time.
CREATE UNIQUE INDEX uq_van_open_trip ON van_trip (van_id) WHERE status = 'LOADED';

CREATE TABLE van_trip_line (
	trip_id      	INTEGER   	NOT NULL REFERENCES van_trip (trip_id) ON DELETE CASCADE,
	product_id   	INTEGER   	NOT NULL REFERENCES product (product_id),
	qty_loaded   	INTEGER   	NOT NULL DEFAULT 0 CHECK (qty_loaded >= 0),
	qty_sold     	INTEGER   	CHECK (qty_sold >= 0),
	qty_expected 	INTEGER   	CHECK (qty_expected >= 0),   -- on the van by the system at close
	qty_returned 	INTEGER   	CHECK (qty_returned >= 0),   -- counted back into the warehouse
	qty_damaged  	INTEGER   	CHECK (qty_damaged >= 0),
	qty_short    	INTEGER   	CHECK (qty_short >= 0),
	PRIMARY KEY (trip_id, product_id),
	CONSTRAINT chk_trip_line_balance CHECK (
		qty_expected IS NULL OR qty_expected = qty_returned + qty_damaged + qty_short)
);

CREATE TRIGGER trg_audit_van_trip AFTER INSERT OR UPDATE OR DELETE ON van_trip
FOR EACH ROW EXECUTE FUNCTION fn_audit('trip_id');

-- ---------------------------------------------------------------------
-- 6. Stocktake (UC4)
-- ---------------------------------------------------------------------
CREATE TABLE stocktake (
	stocktake_id   	SERIAL    	PRIMARY KEY,
	stocktake_no   	VARCHAR(20)   NOT NULL UNIQUE,
	location_id    	SMALLINT  	NOT NULL REFERENCES stock_location (location_id),
	status         	VARCHAR(9)	NOT NULL DEFAULT 'COUNTING' CHECK (status IN ('COUNTING','POSTED','CANCELLED')),
	started_by     	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	started_at     	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	posted_by      	INTEGER   	REFERENCES app_user (user_id),
	posted_at      	TIMESTAMP,
	notes          	VARCHAR(200),
	CONSTRAINT chk_stocktake_posted CHECK (status <> 'POSTED' OR (posted_by IS NOT NULL AND posted_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_location_open_stocktake ON stocktake (location_id) WHERE status = 'COUNTING';

CREATE TABLE stocktake_line (
	stocktake_id 	INTEGER   	NOT NULL REFERENCES stocktake (stocktake_id) ON DELETE CASCADE,
	batch_id     	INTEGER   	NOT NULL REFERENCES stock_batch (batch_id),
	system_qty   	INTEGER   	NOT NULL CHECK (system_qty >= 0),   -- snapshot when counting started
	counted_qty  	INTEGER   	CHECK (counted_qty >= 0),
	counted_by   	INTEGER   	REFERENCES app_user (user_id),
	PRIMARY KEY (stocktake_id, batch_id)
);

CREATE VIEW v_stocktake_variance AS
SELECT l.stocktake_id, l.batch_id, p.product_id, p.sku, p.product_name, b.batch_no, b.expiry_date,
       l.system_qty, l.counted_qty, l.counted_qty - l.system_qty AS variance,
       (l.counted_qty - l.system_qty) * p.cost_price AS variance_value
FROM   stocktake_line l
JOIN   stock_batch b ON b.batch_id = l.batch_id
JOIN   product p     ON p.product_id = b.product_id;

CREATE TRIGGER trg_audit_stocktake AFTER INSERT OR UPDATE OR DELETE ON stocktake
FOR EACH ROW EXECUTE FUNCTION fn_audit('stocktake_id');

-- ---------------------------------------------------------------------
-- Document numbers
-- ---------------------------------------------------------------------
CREATE SEQUENCE wo_no_seq   START 1;
CREATE SEQUENCE trip_no_seq START 1;
CREATE SEQUENCE st_no_seq   START 1;

COMMIT;

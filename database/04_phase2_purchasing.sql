-- =====================================================================
-- BESH. J Limited IMS - Phase 2: purchasing and receiving (UC2, UC5)
-- Run after 03_phase0_additions.sql.
--
--   1. Purchase orders can be PARTIAL (some goods delivered)
--   2. goods_receipt / goods_receipt_line: each delivery (GRN) against a
--      PO, with batch number, expiry date and damaged-on-arrival quantity
--   3. v_po_line_status: ordered vs received vs outstanding, per PO line
--      (derived, not stored, so it can never drift out of step)
--   4. trg_apply_stock_movement: every stock_movement row updates
--      stock_batch.qty_on_hand automatically. The movement ledger is the
--      single source of truth; stock can never go negative.
--   5. PO lines can only change while the PO is a DRAFT
--   6. fn_next_doc_no(): PO-2026-0006, GRN-2026-0001, ...
-- =====================================================================

SET search_path TO ims;

BEGIN;

-- ---------------------------------------------------------------------
-- 1. PARTIAL status for purchase orders
-- ---------------------------------------------------------------------
ALTER TABLE purchase_order DROP CONSTRAINT purchase_order_status_check;
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_status_check
	CHECK (status IN ('DRAFT','APPROVED','SENT','PARTIAL','RECEIVED','CANCELLED'));

-- ---------------------------------------------------------------------
-- 2. Goods received notes (GRN)
-- ---------------------------------------------------------------------
CREATE TABLE goods_receipt (
	grn_id           	SERIAL    	PRIMARY KEY,
	grn_no           	VARCHAR(20)   NOT NULL UNIQUE,
	po_id            	INTEGER   	NOT NULL REFERENCES purchase_order (po_id),
	location_id      	SMALLINT  	NOT NULL REFERENCES stock_location (location_id),
	received_by      	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	received_at      	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	delivery_note_no 	VARCHAR(30)   NOT NULL,
	notes            	VARCHAR(200)
);

CREATE TABLE goods_receipt_line (
	grn_id       	INTEGER   	NOT NULL REFERENCES goods_receipt (grn_id) ON DELETE CASCADE,
	po_id        	INTEGER   	NOT NULL,
	line_no      	SMALLINT  	NOT NULL,
	batch_id     	INTEGER   	REFERENCES stock_batch (batch_id),
	qty_received 	INTEGER   	NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
	qty_damaged  	INTEGER   	NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
	damage_note  	VARCHAR(200),
	PRIMARY KEY (grn_id, line_no),
	FOREIGN KEY (po_id, line_no) REFERENCES purchase_order_line (po_id, line_no),
	CONSTRAINT chk_grn_line_qty     CHECK (qty_received + qty_damaged > 0),
	CONSTRAINT chk_grn_line_batch   CHECK (qty_received = 0 OR batch_id IS NOT NULL),
	CONSTRAINT chk_grn_line_damage  CHECK (qty_damaged = 0 OR damage_note IS NOT NULL)
);

CREATE INDEX ix_grn_po ON goods_receipt (po_id);

CREATE TRIGGER trg_audit_goods_receipt AFTER INSERT OR UPDATE OR DELETE ON goods_receipt
FOR EACH ROW EXECUTE FUNCTION fn_audit('grn_id');

-- ---------------------------------------------------------------------
-- 3. Ordered vs received, per PO line
-- Damaged goods do not count as received: the supplier still owes them.
-- ---------------------------------------------------------------------
CREATE VIEW v_po_line_status AS
SELECT l.po_id, l.line_no, l.product_id, p.sku, p.product_name, p.base_unit,
       l.quantity                                   AS qty_ordered,
       l.unit_cost,
       l.quantity * l.unit_cost                     AS line_total,
       COALESCE(SUM(g.qty_received), 0)::int        AS qty_received,
       COALESCE(SUM(g.qty_damaged), 0)::int         AS qty_damaged,
       GREATEST(l.quantity - COALESCE(SUM(g.qty_received), 0), 0)::int AS qty_outstanding
FROM   purchase_order_line l
JOIN   product p ON p.product_id = l.product_id
LEFT JOIN goods_receipt_line g ON g.po_id = l.po_id AND g.line_no = l.line_no
GROUP  BY l.po_id, l.line_no, l.product_id, p.sku, p.product_name, p.base_unit, l.quantity, l.unit_cost;

-- ---------------------------------------------------------------------
-- 4. Stock movements keep batch quantities up to date
-- Rule: a movement changes the batch it names, at that batch's location:
--   to_location_id   = batch location  -> stock comes IN  (+quantity)
--   from_location_id = batch location  -> stock goes OUT  (-quantity)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_batch ims.stock_batch%ROWTYPE;
	v_change INTEGER;
BEGIN
	SELECT * INTO v_batch FROM ims.stock_batch WHERE batch_id = NEW.batch_id FOR UPDATE;

	IF NEW.to_location_id = v_batch.location_id THEN
		v_change := NEW.quantity;
	ELSIF NEW.from_location_id = v_batch.location_id THEN
		v_change := -NEW.quantity;
	ELSE
		RAISE EXCEPTION 'Movement % does not touch the location of batch %', NEW.movement_type, v_batch.batch_no;
	END IF;

	IF v_batch.qty_on_hand + v_change < 0 THEN
		RAISE EXCEPTION 'Not enough stock in batch %: % on hand, % requested',
		                v_batch.batch_no, v_batch.qty_on_hand, NEW.quantity;
	END IF;

	UPDATE ims.stock_batch SET qty_on_hand = qty_on_hand + v_change WHERE batch_id = NEW.batch_id;
	RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON stock_movement
FOR EACH ROW EXECUTE FUNCTION fn_apply_stock_movement();

-- The ledger is history: movements are never edited or deleted.
-- Mistakes are corrected with a new ADJUSTMENT movement.
CREATE OR REPLACE FUNCTION fn_stock_movement_readonly() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Stock movements cannot be changed; record an ADJUSTMENT instead';
END;
$$;

CREATE TRIGGER trg_stock_movement_readonly
BEFORE UPDATE OR DELETE ON stock_movement
FOR EACH ROW EXECUTE FUNCTION fn_stock_movement_readonly();

-- ---------------------------------------------------------------------
-- 5. PO lines are frozen once the PO leaves DRAFT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_po_line_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_status VARCHAR;
BEGIN
	SELECT status INTO v_status FROM ims.purchase_order
	WHERE  po_id = COALESCE(NEW.po_id, OLD.po_id);

	IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
		RAISE EXCEPTION 'Purchase order lines can only be changed while the order is a DRAFT (it is %)', v_status;
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_po_line_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_line
FOR EACH ROW EXECUTE FUNCTION fn_po_line_draft_only();

-- ---------------------------------------------------------------------
-- 6. Document numbers: PREFIX-YYYY-NNNN
-- ---------------------------------------------------------------------
CREATE SEQUENCE po_no_seq  START 6;   -- sample data uses PO-2027-0001..0005
CREATE SEQUENCE grn_no_seq START 1;

CREATE OR REPLACE FUNCTION fn_next_doc_no(p_prefix TEXT, p_seq REGCLASS)
RETURNS TEXT LANGUAGE sql AS $$
	SELECT p_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval(p_seq)::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- 7. Sample data: delivery records for the two RECEIVED sample orders
-- (02_sample_data.sql marks PO-2027-0001 and -0002 as RECEIVED but has no
-- goods receipts). Inserted directly: their stock is already in the batches.
-- ---------------------------------------------------------------------
INSERT INTO goods_receipt (grn_no, po_id, location_id, received_by, received_at, delivery_note_no) VALUES
	('GRN-2027-0001', 1, 1, 3, '2027-12-02 09:40', 'DN-CCBG-77812'),
	('GRN-2027-0002', 2, 1, 3, '2027-12-03 11:15', 'DN-ABL-30155');

INSERT INTO goods_receipt_line (grn_id, po_id, line_no, batch_id, qty_received) VALUES
	((SELECT grn_id FROM goods_receipt WHERE grn_no = 'GRN-2027-0001'), 1, 1, 2,  2880),
	((SELECT grn_id FROM goods_receipt WHERE grn_no = 'GRN-2027-0001'), 1, 2, 11, 480),
	((SELECT grn_id FROM goods_receipt WHERE grn_no = 'GRN-2027-0002'), 2, 1, 7,  10),
	((SELECT grn_id FROM goods_receipt WHERE grn_no = 'GRN-2027-0002'), 2, 2, 6,  600);

COMMIT;

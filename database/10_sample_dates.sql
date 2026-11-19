-- =====================================================================
-- BESH. J Limited IMS - 10: bring the sample data up to date
-- The sample data from the SAD assignments is dated in the future (late 2027).
-- This moves every sample record back by the same number of whole days so the
-- latest sample activity is two days before today. Times of day, gaps between
-- events and shelf lives stay exactly as they were, and document numbers take
-- the year of their new date (SO-2027-00001 -> SO-2026-00001).
--
-- Only rows dated after today are moved, so real records are never touched,
-- and running it again does nothing. Safe on a database with scripts 01-09.
-- =====================================================================
SET search_path TO ims, public;

DO $$
DECLARE
	v_latest DATE;
	v_shift  INTEGER;              -- days to move back
	v_iv     INTERVAL;             -- the same, for timestamps
	t        TEXT;
	v_tables TEXT[] := ARRAY['customer_order','purchase_order','invoice','payment','empties_transaction',
	                         'stock_batch','stock_movement','goods_receipt','write_off','van_trip','stocktake'];
BEGIN
	-- The latest sample activity: anything that happened "after today".
	SELECT MAX(d) INTO v_latest FROM (
		SELECT order_date::date AS d FROM customer_order WHERE order_date > now()
		UNION ALL SELECT po_date            FROM purchase_order     WHERE po_date > CURRENT_DATE
		UNION ALL SELECT invoice_date       FROM invoice            WHERE invoice_date > CURRENT_DATE
		UNION ALL SELECT payment_date       FROM payment            WHERE payment_date > CURRENT_DATE
		UNION ALL SELECT txn_date           FROM empties_transaction WHERE txn_date > CURRENT_DATE
		UNION ALL SELECT movement_time::date FROM stock_movement    WHERE movement_time > now()
		UNION ALL SELECT received_at::date  FROM goods_receipt      WHERE received_at > now()
		UNION ALL SELECT received_date      FROM stock_batch        WHERE received_date > CURRENT_DATE
	) x;

	IF v_latest IS NULL THEN
		RAISE NOTICE 'No future-dated sample data; nothing to move';
		RETURN;
	END IF;

	v_shift := v_latest - (CURRENT_DATE - 2);
	v_iv := make_interval(days => v_shift);
	RAISE NOTICE 'Moving sample data back % days (latest activity % -> %)', v_shift, v_latest, CURRENT_DATE - 2;

	-- History is read-only and every change is normally audited and stamped;
	-- this is a one-off correction of loaded data, so those triggers are paused.
	FOREACH t IN ARRAY v_tables LOOP
		EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
	END LOOP;

	-- Customer orders
	UPDATE customer_order SET
		order_date = order_date - v_iv,
		order_no   = regexp_replace(order_no, '-20[0-9]{2}-', '-' || to_char(order_date - v_iv, 'YYYY') || '-')
	WHERE order_date > now();

	-- Purchase orders and the deliveries received against them
	UPDATE purchase_order SET
		po_date       = po_date - v_shift,
		expected_date = expected_date - v_shift,
		created_at    = created_at - v_iv,
		po_no         = regexp_replace(po_no, '-20[0-9]{2}-', '-' || to_char(po_date - v_shift, 'YYYY') || '-')
	WHERE po_date > CURRENT_DATE;

	UPDATE goods_receipt SET
		received_at = received_at - v_iv,
		grn_no      = regexp_replace(grn_no, '-20[0-9]{2}-', '-' || to_char(received_at - v_iv, 'YYYY') || '-')
	WHERE received_at > now();

	-- Invoices (and their simulated GRA codes) and payments
	UPDATE invoice SET
		invoice_date = invoice_date - v_shift,
		due_date     = due_date - v_shift,
		created_at   = created_at - v_iv,
		invoice_no   = regexp_replace(invoice_no, '-20[0-9]{2}-', '-' || to_char(invoice_date - v_shift, 'YYYY') || '-'),
		gra_sdc_code = regexp_replace(gra_sdc_code, '-20[0-9]{2}-', '-' || to_char(invoice_date - v_shift, 'YYYY') || '-')
	WHERE invoice_date > CURRENT_DATE;

	UPDATE payment SET
		payment_date = payment_date - v_shift,
		created_at   = created_at - v_iv
	WHERE payment_date > CURRENT_DATE;

	UPDATE empties_transaction SET
		txn_date   = txn_date - v_shift,
		created_at = created_at - v_iv
	WHERE txn_date > CURRENT_DATE;

	-- Stock: batches keep their shelf life; the ledger keeps its references in step
	UPDATE stock_batch SET
		received_date = received_date - v_shift,
		expiry_date   = expiry_date - v_shift
	WHERE received_date > CURRENT_DATE;

	UPDATE stock_movement SET
		movement_time = movement_time - v_iv,
		reference     = regexp_replace(reference, '-20[0-9]{2}-', '-' || to_char(movement_time - v_iv, 'YYYY') || '-')
	WHERE movement_time > now();

	-- Operations (no sample rows today, included for completeness)
	UPDATE write_off SET
		recorded_at = recorded_at - v_iv,
		decided_at  = decided_at - v_iv
	WHERE recorded_at > now();

	UPDATE van_trip SET
		trip_date     = trip_date - v_shift,
		loaded_at     = loaded_at - v_iv,
		reconciled_at = reconciled_at - v_iv
	WHERE loaded_at > now();

	UPDATE stocktake SET
		started_at = started_at - v_iv,
		posted_at  = posted_at - v_iv
	WHERE started_at > now();

	FOREACH t IN ARRAY v_tables LOOP
		EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
	END LOOP;
END;
$$;

-- Renumbered sample documents now share the current year with new ones, so each
-- number sequence must continue after the highest number already used.
SELECT setval('so_no_seq',  GREATEST((SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM so_no_seq),  (SELECT MAX(split_part(order_no,   '-', 3)::int) FROM customer_order)));
SELECT setval('inv_no_seq', GREATEST((SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM inv_no_seq), (SELECT MAX(split_part(invoice_no, '-', 3)::int) FROM invoice)));
SELECT setval('po_no_seq',  GREATEST((SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM po_no_seq),  (SELECT MAX(split_part(po_no,      '-', 3)::int) FROM purchase_order)));
SELECT setval('grn_no_seq', GREATEST((SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM grn_no_seq), COALESCE((SELECT MAX(split_part(grn_no, '-', 3)::int) FROM goods_receipt), 1)));

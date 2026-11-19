-- =====================================================================
-- BESH. J Limited IMS - 08: van management (UC6, FR6)
-- Vans can be added, edited and retired from the app. Each van has a home
-- depot: it loads from that warehouse and returns unsold stock to it.
-- Safe to run on a database that already has scripts 01-07.
-- =====================================================================
SET search_path TO ims, public;

-- 1. New columns ------------------------------------------------------
ALTER TABLE stock_location
	ADD COLUMN IF NOT EXISTS is_active        BOOLEAN  NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS home_location_id SMALLINT REFERENCES stock_location (location_id);

-- Existing vans: the Kumasi van is based at the Kumasi Depot, the rest at the Main Warehouse.
UPDATE stock_location v
SET    home_location_id = COALESCE(
	       (SELECT w.location_id FROM stock_location w
	         WHERE w.location_type = 'WAREHOUSE' AND v.location_name ILIKE '%Kumasi%' AND w.location_name ILIKE '%Kumasi%'
	         LIMIT 1),
	       (SELECT MIN(w.location_id) FROM stock_location w WHERE w.location_type = 'WAREHOUSE'))
WHERE  v.location_type = 'VAN' AND v.home_location_id IS NULL;

-- Every van has a home depot; a warehouse has none.
ALTER TABLE stock_location DROP CONSTRAINT IF EXISTS chk_location_home;
ALTER TABLE stock_location ADD CONSTRAINT chk_location_home
	CHECK ((location_type = 'VAN') = (home_location_id IS NOT NULL));

-- A trip remembers the depot it was loaded from, so returns go back there.
ALTER TABLE van_trip ADD COLUMN IF NOT EXISTS depot_id SMALLINT REFERENCES stock_location (location_id);
UPDATE van_trip t SET depot_id = l.home_location_id
FROM   stock_location l
WHERE  l.location_id = t.van_id AND t.depot_id IS NULL;
ALTER TABLE van_trip ALTER COLUMN depot_id SET NOT NULL;

-- 2. Rules for locations ------------------------------------------------
CREATE OR REPLACE FUNCTION fn_location_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_open_trip VARCHAR(20);
BEGIN
	NEW.location_name := btrim(NEW.location_name);
	NEW.vehicle_reg   := NULLIF(upper(btrim(NEW.vehicle_reg)), '');

	IF TG_OP = 'UPDATE' AND NEW.location_type <> OLD.location_type THEN
		RAISE EXCEPTION 'A location cannot change between warehouse and van';
	END IF;

	-- A retired van has no driver, so the driver is free for another van.
	IF NOT NEW.is_active THEN
		NEW.driver_id := NULL;
	END IF;

	IF NEW.location_type = 'VAN' THEN
		IF (TG_OP = 'INSERT' OR NEW.home_location_id IS DISTINCT FROM OLD.home_location_id)
		   AND NOT EXISTS (SELECT 1 FROM stock_location w
		                    WHERE w.location_id = NEW.home_location_id
		                      AND w.location_type = 'WAREHOUSE' AND w.is_active) THEN
			RAISE EXCEPTION 'A van''s home depot must be an active warehouse';
		END IF;

		IF NEW.driver_id IS NOT NULL
		   AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id)
		   AND NOT EXISTS (SELECT 1 FROM app_user u
		                    WHERE u.user_id = NEW.driver_id AND u.role = 'DRIVER' AND u.is_active) THEN
			RAISE EXCEPTION 'The driver must be an active user with the Driver role';
		END IF;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		SELECT trip_no INTO v_open_trip FROM van_trip WHERE van_id = NEW.location_id AND status = 'LOADED';
		IF v_open_trip IS NOT NULL AND (
		       NEW.driver_id        IS DISTINCT FROM OLD.driver_id
		    OR NEW.home_location_id IS DISTINCT FROM OLD.home_location_id
		    OR (OLD.is_active AND NOT NEW.is_active)) THEN
			RAISE EXCEPTION '% is out on trip %; reconcile it before changing its driver, depot or status',
				NEW.location_name, v_open_trip;
		END IF;

		IF OLD.is_active AND NOT NEW.is_active THEN
			IF EXISTS (SELECT 1 FROM stock_batch WHERE location_id = NEW.location_id AND qty_on_hand > 0) THEN
				RAISE EXCEPTION '% still holds stock, so it cannot be retired', NEW.location_name;
			END IF;
			IF NEW.location_type = 'WAREHOUSE' AND EXISTS (
			       SELECT 1 FROM stock_location v
			        WHERE v.home_location_id = NEW.location_id AND v.is_active) THEN
				RAISE EXCEPTION 'Vans are based at %; move them to another depot first', NEW.location_name;
			END IF;
		END IF;
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_location_guard ON stock_location;
CREATE TRIGGER trg_location_guard
BEFORE INSERT OR UPDATE ON stock_location
FOR EACH ROW EXECUTE FUNCTION fn_location_guard();

-- A retired van cannot go out on a trip.
CREATE OR REPLACE FUNCTION fn_trip_van_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM stock_location
	                WHERE location_id = NEW.van_id AND location_type = 'VAN' AND is_active) THEN
		RAISE EXCEPTION 'Only an active van can be loaded';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_van_active ON van_trip;
CREATE TRIGGER trg_trip_van_active
BEFORE INSERT ON van_trip
FOR EACH ROW EXECUTE FUNCTION fn_trip_van_active();

-- 3. Audit every change to vans and warehouses (FR12) ------------------
DROP TRIGGER IF EXISTS trg_audit_stock_location ON stock_location;
CREATE TRIGGER trg_audit_stock_location
AFTER INSERT OR UPDATE OR DELETE ON stock_location
FOR EACH ROW EXECUTE FUNCTION fn_audit('location_id');

-- New vans get ids after the sample ones.
SELECT setval(pg_get_serial_sequence('ims.stock_location', 'location_id'),
              (SELECT MAX(location_id) FROM stock_location));

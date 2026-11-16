-- =====================================================================
-- BESH. J Limited Inventory Management System (IMS)
-- Practical Assignment 7 – Relational schema (PostgreSQL 16)
-- All tables are in Third Normal Form (3NF). Quantities of stock are
-- always held in BASE UNITS (bottle, can or keg); unit_conversion
-- converts crates, cartons and packs to base units.
-- =====================================================================
 
DROP SCHEMA IF EXISTS ims CASCADE;
CREATE SCHEMA ims;
SET search_path TO ims;
 
-- ---------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------
CREATE TABLE supplier (
	supplier_id 	SERIAL    	PRIMARY KEY,
	supplier_name   VARCHAR(100)  NOT NULL UNIQUE,
	contact_person  VARCHAR(80),
	phone       	VARCHAR(15)   NOT NULL,
	email       	VARCHAR(100)  UNIQUE,
	address     	VARCHAR(150)  NOT NULL,
	tin         	VARCHAR(15)   NOT NULL UNIQUE,
	CONSTRAINT chk_supplier_email CHECK (email IS NULL OR email LIKE '%_@_%._%')
);
 
CREATE TABLE category (
	category_id 	SMALLSERIAL   PRIMARY KEY,
	category_name   VARCHAR(40)   NOT NULL UNIQUE,
	description 	VARCHAR(150)
);
 
CREATE TABLE container_type (
	container_type_id  SMALLSERIAL   PRIMARY KEY,
	container_name 	VARCHAR(50)   NOT NULL UNIQUE,
	units_held     	SMALLINT  	CHECK (units_held IS NULL OR units_held > 0),
	deposit_amount 	NUMERIC(8,2)  NOT NULL CHECK (deposit_amount >= 0)
);
 
CREATE TABLE product (
	product_id     	SERIAL     	PRIMARY KEY,
	sku            	VARCHAR(20)	NOT NULL UNIQUE,
	barcode        	VARCHAR(13)	UNIQUE CHECK (barcode ~ '^[0-9]{8,13}$'),
	brand          	VARCHAR(50)	NOT NULL,
	product_name   	VARCHAR(100)   NOT NULL,
	category_id    	SMALLINT   	NOT NULL REFERENCES category (category_id),
	supplier_id    	INTEGER    	NOT NULL REFERENCES supplier (supplier_id),
	pack_size_ml   	INTEGER    	NOT NULL CHECK (pack_size_ml > 0),
	packaging      	VARCHAR(5) 	NOT NULL CHECK (packaging IN ('CAN','PET','GLASS','KEG')),
	base_unit      	VARCHAR(6) 	NOT NULL CHECK (base_unit IN ('BOTTLE','CAN','KEG')),
	cost_price     	NUMERIC(10,2)  NOT NULL CHECK (cost_price >= 0),
	selling_price  	NUMERIC(10,2)  NOT NULL,
	reorder_level  	INTEGER    	NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
	container_type_id  SMALLINT       REFERENCES container_type (container_type_id),
	is_active      	BOOLEAN    	NOT NULL DEFAULT TRUE,
	CONSTRAINT chk_product_price 	CHECK (selling_price >= cost_price),
	CONSTRAINT chk_product_returnable CHECK (packaging IN ('GLASS','KEG') OR container_type_id IS NULL)
);
 
CREATE TABLE unit_conversion (
	product_id   INTEGER      NOT NULL REFERENCES product (product_id) ON DELETE CASCADE,
	unit_name	VARCHAR(8)   NOT NULL CHECK (unit_name IN ('CRATE','CARTON','PACK','KEG')),
	base_qty 	INTEGER  	NOT NULL CHECK (base_qty > 0),
	PRIMARY KEY (product_id, unit_name)
);
 
-- ---------------------------------------------------------------------
-- People and locations
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
	user_id 	SERIAL   	PRIMARY KEY,
	full_name   VARCHAR(80)  NOT NULL,
	username	VARCHAR(30)  NOT NULL UNIQUE,
	role    	VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN','WAREHOUSE_MANAGER','STORE_KEEPER',
                                                     'SALES_REP','DRIVER','ACCOUNTANT','MANAGEMENT')),
	phone   	VARCHAR(15)  NOT NULL,
	is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);
 
CREATE TABLE stock_location (
	location_id 	SMALLSERIAL  PRIMARY KEY,
	location_name   VARCHAR(50)  NOT NULL UNIQUE,
	location_type   VARCHAR(9)   NOT NULL CHECK (location_type IN ('WAREHOUSE','VAN')),
	vehicle_reg 	VARCHAR(12)  UNIQUE,
	driver_id   	INTEGER  	UNIQUE REFERENCES app_user (user_id),
	CONSTRAINT chk_location_van CHECK (
    	(location_type = 'VAN'   	AND vehicle_reg IS NOT NULL) OR
    	(location_type = 'WAREHOUSE' AND vehicle_reg IS NULL AND driver_id IS NULL))
);
 
CREATE TABLE customer (
	customer_id 	SERIAL     	PRIMARY KEY,
	customer_name   VARCHAR(100)   NOT NULL,
	customer_type   VARCHAR(10)	NOT NULL CHECK (customer_type IN ('RETAILER','WHOLESALER','BAR','RESTAURANT')),
	contact_person  VARCHAR(80),
	phone       	VARCHAR(15)	NOT NULL,
	gps_address 	VARCHAR(15)	NOT NULL CHECK (gps_address ~ '^[A-Z]{2}-[0-9]{3,4}-[0-9]{4}$'),
	tin         	VARCHAR(15)	UNIQUE,
	payment_terms   VARCHAR(6) 	NOT NULL CHECK (payment_terms IN ('CASH','CREDIT')),
	credit_limit	NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
	CONSTRAINT chk_customer_credit CHECK (payment_terms = 'CREDIT' OR credit_limit = 0)
);
 
-- ---------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------
CREATE TABLE stock_batch (
	batch_id   	SERIAL   	PRIMARY KEY,
	product_id 	INTEGER  	NOT NULL REFERENCES product (product_id),
	location_id	SMALLINT     NOT NULL REFERENCES stock_location (location_id),
	batch_no   	VARCHAR(20)  NOT NULL,
	received_date  DATE         NOT NULL,
	expiry_date	DATE         NOT NULL,
	qty_on_hand	INTEGER      NOT NULL CHECK (qty_on_hand >= 0),
	CONSTRAINT uq_batch_location UNIQUE (product_id, location_id, batch_no),
	CONSTRAINT chk_batch_dates   CHECK (expiry_date > received_date)
);
 
CREATE TABLE stock_movement (
	movement_id   	BIGSERIAL 	PRIMARY KEY,
	batch_id      	INTEGER   	NOT NULL REFERENCES stock_batch (batch_id),
	movement_type 	VARCHAR(10)   NOT NULL CHECK (movement_type IN
                         ('RECEIPT','SALE','VAN_LOAD','VAN_RETURN','TRANSFER','BREAKAGE','ADJUSTMENT')),
	quantity      	INTEGER   	NOT NULL CHECK (quantity > 0),
	from_location_id  SMALLINT      REFERENCES stock_location (location_id),
	to_location_id	SMALLINT  	REFERENCES stock_location (location_id),
	user_id       	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	movement_time 	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	reference     	VARCHAR(30),
	reason        	VARCHAR(200),
	CONSTRAINT chk_movement_location CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
	CONSTRAINT chk_movement_reason   CHECK (movement_type NOT IN ('BREAKAGE','ADJUSTMENT') OR reason IS NOT NULL)
);
 
-- ---------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------
CREATE TABLE customer_order (
	order_id        	SERIAL    	PRIMARY KEY,
	order_no        	VARCHAR(20)   NOT NULL UNIQUE,
	customer_id     	INTEGER   	NOT NULL REFERENCES customer (customer_id),
	sales_rep_id    	INTEGER   	NOT NULL REFERENCES app_user (user_id),
	order_date      	TIMESTAMP 	NOT NULL DEFAULT CURRENT_TIMESTAMP,
	status          	VARCHAR(25)   NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                           ('DRAFT','PENDING_CREDIT_APPROVAL','CONFIRMED','PICKING','LOADED_ON_VAN',
                            'DELIVERED','OVERDUE','PAID','RETURNED','CANCELLED')),
	van_id          	SMALLINT  	REFERENCES stock_location (location_id),
	credit_approved_by  INTEGER       REFERENCES app_user (user_id),
	CONSTRAINT chk_order_van CHECK (status NOT IN ('LOADED_ON_VAN','DELIVERED') OR van_id IS NOT NULL)
);
 
CREATE TABLE order_line (
	order_id	INTEGER    	NOT NULL REFERENCES customer_order (order_id) ON DELETE CASCADE,
	line_no 	SMALLINT   	NOT NULL CHECK (line_no > 0),
	product_id  INTEGER        NOT NULL REFERENCES product (product_id),
	quantity	INTEGER    	NOT NULL CHECK (quantity > 0),
	unit_price  NUMERIC(10,2)  NOT NULL CHECK (unit_price >= 0),
	PRIMARY KEY (order_id, line_no),
	CONSTRAINT uq_order_product UNIQUE (order_id, product_id)
);
 
CREATE TABLE invoice (
	invoice_id  	SERIAL     	PRIMARY KEY,
	invoice_no  	VARCHAR(20)	NOT NULL UNIQUE,
	order_id    	INTEGER    	NOT NULL UNIQUE REFERENCES customer_order (order_id),
	invoice_date	DATE       	NOT NULL,
	subtotal    	NUMERIC(12,2)  NOT NULL CHECK (subtotal >= 0),
	vat_amount  	NUMERIC(12,2)  NOT NULL CHECK (vat_amount >= 0),
	deposit_amount  NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
	total_amount	NUMERIC(12,2)  NOT NULL,
	gra_sdc_code	VARCHAR(30)	UNIQUE,
	status      	VARCHAR(17)	NOT NULL CHECK (status IN ('PENDING_SIGNATURE','SIGNED','VOID')),
	CONSTRAINT chk_invoice_total  CHECK (total_amount = subtotal + vat_amount + deposit_amount),
	CONSTRAINT chk_invoice_signed CHECK (status <> 'SIGNED' OR gra_sdc_code IS NOT NULL)
);
 
CREATE TABLE payment (
	payment_id  	SERIAL     	PRIMARY KEY,
	customer_id 	INTEGER    	NOT NULL REFERENCES customer (customer_id),
	invoice_id  	INTEGER    	REFERENCES invoice (invoice_id),
	amount      	NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
	payment_method  VARCHAR(13)    NOT NULL CHECK (payment_method IN ('CASH','MOBILE_MONEY','BANK_TRANSFER','CHEQUE')),
	payment_date	DATE       	NOT NULL,
	received_by 	INTEGER    	NOT NULL REFERENCES app_user (user_id),
	reference   	VARCHAR(30)
);
 
CREATE TABLE empties_transaction (
	empties_txn_id 	SERIAL     	PRIMARY KEY,
	container_type_id  SMALLINT       NOT NULL REFERENCES container_type (container_type_id),
	customer_id    	INTEGER    	REFERENCES customer (customer_id),
	supplier_id    	INTEGER    	REFERENCES supplier (supplier_id),
	order_id       	INTEGER    	REFERENCES customer_order (order_id),
	direction      	VARCHAR(8) 	NOT NULL CHECK (direction IN ('ISSUED','RETURNED')),
	quantity       	INTEGER    	NOT NULL CHECK (quantity > 0),
	deposit_value  	NUMERIC(10,2)  NOT NULL CHECK (deposit_value >= 0),
	txn_date       	DATE       	NOT NULL,
	recorded_by    	INTEGER    	NOT NULL REFERENCES app_user (user_id),
	CONSTRAINT chk_empties_party CHECK ((customer_id IS NOT NULL) <> (supplier_id IS NOT NULL))
);
 
-- ---------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------
CREATE TABLE purchase_order (
	po_id      	SERIAL   	PRIMARY KEY,
	po_no      	VARCHAR(20)  NOT NULL UNIQUE,
	supplier_id	INTEGER      NOT NULL REFERENCES supplier (supplier_id),
	created_by 	INTEGER  	NOT NULL REFERENCES app_user (user_id),
	approved_by	INTEGER      REFERENCES app_user (user_id),
	po_date    	DATE     	NOT NULL,
	expected_date  DATE,
	status     	VARCHAR(9)   NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SENT','RECEIVED','CANCELLED')),
	CONSTRAINT chk_po_approval CHECK (status IN ('DRAFT','CANCELLED') OR approved_by IS NOT NULL),
	CONSTRAINT chk_po_duties   CHECK (approved_by IS NULL OR approved_by <> created_by),
	CONSTRAINT chk_po_dates	CHECK (expected_date IS NULL OR expected_date >= po_date)
);
 
CREATE TABLE purchase_order_line (
	po_id   	INTEGER    	NOT NULL REFERENCES purchase_order (po_id) ON DELETE CASCADE,
	line_no 	SMALLINT   	NOT NULL CHECK (line_no > 0),
	product_id  INTEGER        NOT NULL REFERENCES product (product_id),
	quantity	INTEGER    	NOT NULL CHECK (quantity > 0),
	unit_cost   NUMERIC(10,2)  NOT NULL CHECK (unit_cost >= 0),
	PRIMARY KEY (po_id, line_no),
	CONSTRAINT uq_po_product UNIQUE (po_id, product_id)
);
 
-- ---------------------------------------------------------------------
-- Indexes on foreign keys used in frequent look-ups
-- ---------------------------------------------------------------------
CREATE INDEX ix_product_category   ON product (category_id);
CREATE INDEX ix_product_supplier   ON product (supplier_id);
CREATE INDEX ix_batch_fefo         ON stock_batch (product_id, location_id, expiry_date);
CREATE INDEX ix_movement_batch     ON stock_movement (batch_id);
CREATE INDEX ix_order_customer     ON customer_order (customer_id);
CREATE INDEX ix_payment_customer   ON payment (customer_id);
CREATE INDEX ix_empties_customer   ON empties_transaction (customer_id);
 
-- ---------------------------------------------------------------------
-- Derived data is calculated in views, not stored (keeps 3NF)
-- ---------------------------------------------------------------------
CREATE VIEW v_stock_on_hand AS
SELECT p.product_id, p.sku, p.product_name, l.location_name,
   	SUM(b.qty_on_hand) AS qty_on_hand, p.reorder_level,
   	CASE WHEN l.location_type = 'WAREHOUSE'
        	THEN SUM(b.qty_on_hand) <= p.reorder_level END AS reorder_needed
FROM   product p
JOIN   stock_batch b	ON b.product_id = p.product_id
JOIN   stock_location l ON l.location_id = b.location_id
GROUP  BY p.product_id, p.sku, p.product_name, l.location_name, l.location_type, p.reorder_level;
 
CREATE VIEW v_customer_balance AS
SELECT c.customer_id, c.customer_name, c.credit_limit,
   	COALESCE(i.invoiced, 0.00) - COALESCE(pay.paid, 0.00) AS balance
FROM   customer c
LEFT JOIN (SELECT o.customer_id, SUM(inv.total_amount) AS invoiced
       	FROM invoice inv JOIN customer_order o ON o.order_id = inv.order_id
       	WHERE inv.status <> 'VOID' GROUP BY o.customer_id) i ON i.customer_id = c.customer_id
LEFT JOIN (SELECT customer_id, SUM(amount) AS paid FROM payment GROUP BY customer_id) pay
   	ON pay.customer_id = c.customer_id;
 
CREATE VIEW v_empties_balance AS
SELECT c.customer_id, c.customer_name, ct.container_name,
   	SUM(CASE e.direction WHEN 'ISSUED' THEN e.quantity ELSE -e.quantity END) AS containers_held
FROM   empties_transaction e
JOIN   customer c    	ON c.customer_id = e.customer_id
JOIN   container_type ct ON ct.container_type_id = e.container_type_id
GROUP  BY c.customer_id, c.customer_name, ct.container_name;
 

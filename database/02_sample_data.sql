-- =====================================================================
-- BESH. J Limited IMS - Practical Assignment 7 - Sample data
-- Run after 01_schema.sql. Contact details, TINs and SDC codes are fictitious.
-- VAT and levies are calculated at an illustrative combined rate of 20%.
-- =====================================================================
SET search_path TO ims;
BEGIN;
 
-- supplier (5 rows)
INSERT INTO supplier (supplier_id, supplier_name, contact_person, phone, email, address, tin) VALUES
  (1, 'Coca-Cola Bottling Company of Ghana', 'Sales Desk', '0302000101', 'orders@ccbg.example.com', 'Spintex Road, Accra', 'C0000000101'),
  (2, 'Guinness Ghana Breweries', 'Distributor Desk', '0302000102', 'orders@ggb.example.com', 'Kaasi Industrial Area, Kumasi', 'C0000000102'),
  (3, 'Accra Brewery', 'Trade Sales', '0302000103', 'orders@abl.example.com', 'Graphic Road, Accra', 'C0000000103'),
  (4, 'Voltic (GH) Ltd', 'Customer Service', '0302000104', 'orders@voltic.example.com', 'Akwadum, Eastern Region', 'C0000000104'),
  (5, 'Kasapreko Company Ltd', 'Key Accounts', '0302000105', 'orders@kasapreko.example.com', 'Spintex Road, Accra', 'C0000000105');
 
-- category (5 rows)
INSERT INTO category (category_id, category_name, description) VALUES
  (1, 'Soft Drinks', 'Carbonated soft drinks'),
  (2, 'Malt Drinks', 'Non-alcoholic malt beverages'),
  (3, 'Beer & Stout', 'Lager beers and stouts'),
  (4, 'Bottled Water', 'Mineral and purified water'),
  (5, 'Spirits & Bitters', 'Alcoholic bitters and spirits');
 
-- container_type (5 rows)
INSERT INTO container_type (container_type_id, container_name, units_held, deposit_amount) VALUES
  (1, 'Crate (24 x 300 ml)', 24, 25.00),
  (2, 'Crate (12 x 625 ml)', 12, 25.00),
  (3, 'Glass bottle 300 ml', NULL, 1.50),
  (4, 'Glass bottle 625 ml', NULL, 2.00),
  (5, 'Keg 50 L', NULL, 400.00);
 
-- product (9 rows)
INSERT INTO product (product_id, sku, barcode, brand, product_name, category_id, supplier_id, pack_size_ml, packaging, base_unit, cost_price, selling_price, reorder_level, container_type_id, is_active) VALUES
  (1, 'CC-300-GL', '5449000000101', 'Coca-Cola', 'Coca-Cola Original 300 ml glass', 1, 1, 300, 'GLASS', 'BOTTLE', 3.20, 4.00, 480, 1, TRUE),
  (2, 'FN-500-PET', '5449000000102', 'Fanta', 'Fanta Orange 500 ml PET', 1, 1, 500, 'PET', 'BOTTLE', 5.60, 7.00, 240, NULL, TRUE),
  (3, 'SP-300-GL', '5449000000103', 'Sprite', 'Sprite 300 ml glass', 1, 1, 300, 'GLASS', 'BOTTLE', 3.20, 4.00, 240, 1, TRUE),
  (4, 'MG-330-CAN', '5000213000104', 'Malta Guinness', 'Malta Guinness 330 ml can', 2, 2, 330, 'CAN', 'CAN', 7.20, 9.00, 240, NULL, TRUE),
  (5, 'GFES-625-GL', '5000213000105', 'Guinness', 'Guinness Foreign Extra Stout 625 ml', 3, 2, 625, 'GLASS', 'BOTTLE', 14.40, 18.00, 120, 2, TRUE),
  (6, 'CLUB-625-GL', '6001108000106', 'Club', 'Club Premium Lager 625 ml', 3, 3, 625, 'GLASS', 'BOTTLE', 12.00, 15.00, 120, 2, TRUE),
  (7, 'CLUB-KEG-50', '6001108000107', 'Club', 'Club Premium Lager draught keg 50 L', 3, 3, 50000, 'KEG', 'KEG', 1100.00, 1350.00, 4, 5, TRUE),
  (8, 'VOL-500-PET', '6034000000108', 'Voltic', 'Voltic Natural Mineral Water 500 ml', 4, 4, 500, 'PET', 'BOTTLE', 2.40, 3.00, 360, NULL, TRUE),
  (9, 'ALB-200-GL', '6034000000109', 'Alomo', 'Alomo Bitters 200 ml', 5, 5, 200, 'GLASS', 'BOTTLE', 16.00, 20.00, 96, NULL, TRUE);
 
-- unit_conversion (9 rows)
INSERT INTO unit_conversion (product_id, unit_name, base_qty) VALUES
  (1, 'CRATE', 24),
  (2, 'PACK', 12),
  (3, 'CRATE', 24),
  (4, 'CARTON', 24),
  (5, 'CRATE', 12),
  (6, 'CRATE', 12),
  (7, 'KEG', 1),
  (8, 'PACK', 12),
  (9, 'CARTON', 24);
 
-- app_user (9 rows)
INSERT INTO app_user (user_id, full_name, username, role, phone, is_active) VALUES
  (1, 'Kojo Appiah', 'kappiah', 'ADMIN', '0244000101', TRUE),
  (2, 'Kwame Mensah', 'kmensah', 'WAREHOUSE_MANAGER', '0244000102', TRUE),
  (3, 'Ama Owusu', 'aowusu', 'STORE_KEEPER', '0244000103', TRUE),
  (4, 'Kofi Asante', 'kasante', 'SALES_REP', '0244000104', TRUE),
  (5, 'Abena Nyarko', 'anyarko', 'SALES_REP', '0244000105', TRUE),
  (6, 'Yaw Boateng', 'yboateng', 'DRIVER', '0244000106', TRUE),
  (7, 'Kwesi Ofori', 'kofori', 'DRIVER', '0244000107', TRUE),
  (8, 'Efua Darko', 'edarko', 'ACCOUNTANT', '0244000108', TRUE),
  (9, 'Akosua Adjei', 'aadjei', 'MANAGEMENT', '0244000109', TRUE);
 
-- stock_location (5 rows)
INSERT INTO stock_location (location_id, location_name, location_type, vehicle_reg, driver_id) VALUES
  (1, 'Main Warehouse - Accra', 'WAREHOUSE', NULL, NULL),
  (2, 'Kumasi Depot', 'WAREHOUSE', NULL, NULL),
  (3, 'Van 1 - Accra Central', 'VAN', 'GR-4521-22', 6),
  (4, 'Van 2 - Tema', 'VAN', 'GR-7310-23', 7),
  (5, 'Van 3 - Kumasi', 'VAN', 'AS-1186-21', NULL);
 
-- customer (6 rows)
INSERT INTO customer (customer_id, customer_name, customer_type, contact_person, phone, gps_address, tin, payment_terms, credit_limit) VALUES
  (1, 'Auntie Ama Provisions', 'RETAILER', 'Ama Serwaa', '0244100201', 'GA-183-8164', NULL, 'CASH', 0),
  (2, 'Kaneshie Wholesale Drinks', 'WHOLESALER', 'Samuel Tetteh', '0244100202', 'GA-246-1123', 'C0000200202', 'CREDIT', 20000.00),
  (3, 'Osu Night Spot Bar', 'BAR', 'Edem Kpodo', '0244100203', 'GA-052-7741', 'C0000200203', 'CREDIT', 5000.00),
  (4, 'Golden Plate Restaurant', 'RESTAURANT', 'Mary Quaye', '0244100204', 'GA-075-3302', 'C0000200204', 'CREDIT', 3000.00),
  (5, 'Madina Mini Mart', 'RETAILER', 'Ibrahim Musah', '0244100205', 'GE-213-5590', NULL, 'CASH', 0),
  (6, 'Tema Community 1 Cold Store', 'RETAILER', 'Grace Lamptey', '0244100206', 'GT-001-4478', NULL, 'CREDIT', 1500.00);
 
-- stock_batch (11 rows)
INSERT INTO stock_batch (batch_id, product_id, location_id, batch_no, received_date, expiry_date, qty_on_hand) VALUES
  (1, 1, 1, 'CC27K112', '2027-11-20', '2028-05-20', 1920),
  (2, 1, 1, 'CC27L004', '2027-12-02', '2028-06-02', 2880),
  (3, 2, 1, 'FN27K090', '2027-11-15', '2028-02-15', 600),
  (4, 4, 1, 'MG27J221', '2027-10-30', '2028-04-30', 720),
  (5, 5, 1, 'GF27L010', '2027-12-01', '2028-12-01', 480),
  (6, 6, 1, 'CL27K301', '2027-11-25', '2028-05-25', 600),
  (7, 7, 1, 'CK27L002', '2027-12-03', '2028-01-31', 10),
  (8, 8, 1, 'VO27L015', '2027-12-04', '2028-12-04', 1440),
  (9, 9, 2, 'AB27H120', '2027-08-10', '2029-08-10', 192),
  (10, 1, 3, 'CC27K112', '2027-12-06', '2028-05-20', 48),
  (11, 3, 1, 'SP27K077', '2027-11-18', '2028-05-18', 96);
 
-- stock_movement (7 rows)
INSERT INTO stock_movement (movement_id, batch_id, movement_type, quantity, from_location_id, to_location_id, user_id, movement_time, reference, reason) VALUES
  (1, 2, 'RECEIPT', 2880, NULL, 1, 3, '2027-12-02 07:45', 'DN-CCBG-77812', NULL),
  (2, 7, 'RECEIPT', 10, NULL, 1, 3, '2027-12-03 08:10', 'DN-ABL-30155', NULL),
  (3, 1, 'VAN_LOAD', 96, 1, 3, 3, '2027-12-06 07:05', 'SO-2027-00001', NULL),
  (4, 10, 'SALE', 48, 3, NULL, 6, '2027-12-06 11:30', 'INV-2027-00001', NULL),
  (5, 1, 'BREAKAGE', 6, 1, NULL, 3, '2027-12-06 15:20', 'BR-0001', 'Crate dropped during loading'),
  (6, 9, 'TRANSFER', 48, 2, 1, 3, '2027-12-07 09:00', 'TR-0003', NULL),
  (7, 3, 'ADJUSTMENT', 12, 1, NULL, 2, '2027-12-08 17:00', 'STK-2027-12', 'Stocktake count lower than system');
 
-- customer_order (7 rows)
INSERT INTO customer_order (order_id, order_no, customer_id, sales_rep_id, order_date, status, van_id, credit_approved_by) VALUES
  (1, 'SO-2027-00001', 1, 4, '2027-12-06 08:15', 'PAID', 3, NULL),
  (2, 'SO-2027-00002', 2, 4, '2027-12-06 09:40', 'DELIVERED', 3, NULL),
  (3, 'SO-2027-00003', 3, 5, '2027-12-06 10:05', 'LOADED_ON_VAN', 4, 8),
  (4, 'SO-2027-00004', 4, 5, '2027-12-07 11:20', 'CONFIRMED', NULL, NULL),
  (5, 'SO-2027-00005', 5, 4, '2027-12-07 12:30', 'PAID', 3, NULL),
  (6, 'SO-2027-00006', 6, 5, '2027-12-07 14:10', 'PENDING_CREDIT_APPROVAL', NULL, NULL),
  (7, 'SO-2027-00007', 1, 4, '2027-12-08 08:05', 'DRAFT', NULL, NULL);
 
-- order_line (14 rows)
INSERT INTO order_line (order_id, line_no, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 48, 4.00),
  (1, 2, 8, 24, 3.00),
  (2, 1, 1, 240, 4.00),
  (2, 2, 5, 120, 18.00),
  (2, 3, 4, 96, 9.00),
  (3, 1, 6, 120, 15.00),
  (3, 2, 7, 2, 1350.00),
  (4, 1, 2, 48, 7.00),
  (4, 2, 8, 48, 3.00),
  (5, 1, 9, 24, 20.00),
  (5, 2, 1, 24, 4.00),
  (6, 1, 5, 96, 18.00),
  (6, 2, 6, 48, 15.00),
  (7, 1, 3, 24, 4.00);
 
-- invoice (5 rows)
INSERT INTO invoice (invoice_id, invoice_no, order_id, invoice_date, subtotal, vat_amount, deposit_amount, total_amount, gra_sdc_code, status) VALUES
  (1, 'INV-2027-00001', 1, '2027-12-06', 264.00, 52.80, 50.00, 366.80, 'SDC-2027-100231', 'SIGNED'),
  (2, 'INV-2027-00002', 2, '2027-12-06', 3984.00, 796.80, 500.00, 5280.80, 'SDC-2027-100232', 'SIGNED'),
  (3, 'INV-2027-00003', 3, '2027-12-06', 4500.00, 900.00, 1050.00, 6450.00, 'SDC-2027-100233', 'SIGNED'),
  (4, 'INV-2027-00004', 4, '2027-12-07', 480.00, 96.00, 0.00, 576.00, NULL, 'PENDING_SIGNATURE'),
  (5, 'INV-2027-00005', 5, '2027-12-07', 576.00, 115.20, 25.00, 716.20, 'SDC-2027-100235', 'SIGNED');
 
-- payment (5 rows)
INSERT INTO payment (payment_id, customer_id, invoice_id, amount, payment_method, payment_date, received_by, reference) VALUES
  (1, 1, 1, 366.80, 'CASH', '2027-12-06', 8, 'RCPT-000101'),
  (2, 5, 5, 716.20, 'MOBILE_MONEY', '2027-12-07', 8, 'MOMO-88213450'),
  (3, 2, 2, 3000.00, 'BANK_TRANSFER', '2027-12-08', 8, 'GCB-TRF-554021'),
  (4, 2, 2, 1500.00, 'CHEQUE', '2027-12-10', 8, 'CHQ-004417'),
  (5, 3, NULL, 1000.00, 'MOBILE_MONEY', '2027-12-09', 8, 'MOMO-88219877');
 
-- empties_transaction (9 rows)
INSERT INTO empties_transaction (empties_txn_id, container_type_id, customer_id, supplier_id, order_id, direction, quantity, deposit_value, txn_date, recorded_by) VALUES
  (1, 1, 1, NULL, 1, 'ISSUED', 2, 50.00, '2027-12-06', 6),
  (2, 1, 2, NULL, 2, 'ISSUED', 10, 250.00, '2027-12-06', 6),
  (3, 2, 2, NULL, 2, 'ISSUED', 10, 250.00, '2027-12-06', 6),
  (4, 2, 3, NULL, 3, 'ISSUED', 10, 250.00, '2027-12-06', 6),
  (5, 5, 3, NULL, 3, 'ISSUED', 2, 800.00, '2027-12-06', 6),
  (6, 1, 5, NULL, 5, 'ISSUED', 1, 25.00, '2027-12-07', 6),
  (7, 1, 1, NULL, NULL, 'RETURNED', 2, 50.00, '2027-12-08', 6),
  (8, 2, 2, NULL, NULL, 'RETURNED', 6, 150.00, '2027-12-09', 6),
  (9, 2, NULL, 2, NULL, 'RETURNED', 30, 750.00, '2027-12-10', 3);
 
-- purchase_order (5 rows)
INSERT INTO purchase_order (po_id, po_no, supplier_id, created_by, approved_by, po_date, expected_date, status) VALUES
  (1, 'PO-2027-0001', 1, 2, 9, '2027-11-28', '2027-12-02', 'RECEIVED'),
  (2, 'PO-2027-0002', 3, 2, 9, '2027-11-30', '2027-12-03', 'RECEIVED'),
  (3, 'PO-2027-0003', 2, 2, 9, '2027-12-06', '2027-12-10', 'SENT'),
  (4, 'PO-2027-0004', 4, 2, 9, '2027-12-07', '2027-12-11', 'APPROVED'),
  (5, 'PO-2027-0005', 5, 2, NULL, '2027-12-08', NULL, 'DRAFT');
 
-- purchase_order_line (8 rows)
INSERT INTO purchase_order_line (po_id, line_no, product_id, quantity, unit_cost) VALUES
  (1, 1, 1, 2880, 3.20),
  (1, 2, 3, 480, 3.20),
  (2, 1, 7, 10, 1100.00),
  (2, 2, 6, 600, 12.00),
  (3, 1, 5, 480, 14.40),
  (3, 2, 4, 720, 7.20),
  (4, 1, 8, 1440, 2.40),
  (5, 1, 9, 96, 16.00);
 
SELECT setval(pg_get_serial_sequence('ims.supplier', 'supplier_id'), (SELECT MAX(supplier_id) FROM supplier));
SELECT setval(pg_get_serial_sequence('ims.category', 'category_id'), (SELECT MAX(category_id) FROM category));
SELECT setval(pg_get_serial_sequence('ims.container_type', 'container_type_id'), (SELECT MAX(container_type_id) FROM container_type));
SELECT setval(pg_get_serial_sequence('ims.product', 'product_id'), (SELECT MAX(product_id) FROM product));
SELECT setval(pg_get_serial_sequence('ims.app_user', 'user_id'), (SELECT MAX(user_id) FROM app_user));
SELECT setval(pg_get_serial_sequence('ims.stock_location', 'location_id'), (SELECT MAX(location_id) FROM stock_location));
SELECT setval(pg_get_serial_sequence('ims.customer', 'customer_id'), (SELECT MAX(customer_id) FROM customer));
SELECT setval(pg_get_serial_sequence('ims.stock_batch', 'batch_id'), (SELECT MAX(batch_id) FROM stock_batch));
SELECT setval(pg_get_serial_sequence('ims.stock_movement', 'movement_id'), (SELECT MAX(movement_id) FROM stock_movement));
SELECT setval(pg_get_serial_sequence('ims.customer_order', 'order_id'), (SELECT MAX(order_id) FROM customer_order));
SELECT setval(pg_get_serial_sequence('ims.invoice', 'invoice_id'), (SELECT MAX(invoice_id) FROM invoice));
SELECT setval(pg_get_serial_sequence('ims.payment', 'payment_id'), (SELECT MAX(payment_id) FROM payment));
SELECT setval(pg_get_serial_sequence('ims.empties_transaction', 'empties_txn_id'), (SELECT MAX(empties_txn_id) FROM empties_transaction));
SELECT setval(pg_get_serial_sequence('ims.purchase_order', 'po_id'), (SELECT MAX(po_id) FROM purchase_order));
 
COMMIT;
 




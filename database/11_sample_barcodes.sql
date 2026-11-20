-- 11_sample_barcodes.sql
-- The sample barcodes in 02_sample_data.sql were made up, and seven of them break the
-- EAN-13 check-digit rule, so no scanner or camera could ever read them from a label.
-- This gives those sample products valid EAN-13 codes (Coca-Cola's and Voltic's were
-- already valid). Only rows still holding the old made-up code are changed.
SET search_path = ims, public;

UPDATE product SET barcode = v.new_code
  FROM (VALUES
    ('5449000000102', '5449000000118'),
    ('5449000000103', '5449000000125'),
    ('5000213000104', '5000213000106'),
    ('5000213000105', '5000213000113'),
    ('6001108000106', '6001108000101'),
    ('6001108000107', '6001108000118'),
    ('6034000000109', '6034000000115')
  ) AS v(old_code, new_code)
 WHERE product.barcode = v.old_code
   AND NOT EXISTS (SELECT 1 FROM product p2 WHERE p2.barcode = v.new_code);

# BESH. J IMS – API endpoint list

Base URL: `http://localhost:3000/api`. Every endpoint except **login** and **health** needs the header
`Authorization: Bearer <accessToken>`. ADMIN may call every endpoint.

Status: ✅ built (Phases 0–5): all 10 use cases · ⬜ planned (phase number shown)

The table is the team's contract: the frontend and backend developers agree on these paths and payloads before building a phase.

## Auth and users (UC10, FR12)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | POST | `/auth/login` | public | `{username, password}` → `{accessToken, user}`; writes a LOGIN audit row |
| ✅ | GET | `/auth/me` | any | The logged-in user |
| ✅ | GET | `/health` | public | API up and database connected |
| ✅ | GET | `/users` | ADMIN | List users |
| ✅ | POST | `/users` | ADMIN | Create a user with a temporary password |
| ✅ | PATCH | `/users/:id` | ADMIN | Change name, role, phone; deactivate (not yourself) |
| ✅ | POST | `/users/:id/reset-password` | ADMIN | Set a new temporary password |
| ✅ | POST | `/auth/change-password` | any | Change own password (`current_password`, `new_password`) |
| ✅ | GET | `/audit-log?table=&limit=` | ADMIN, MANAGEMENT | Audit trail (who did what, when) |

## Master data (UC1, FR1)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/products?search=&includeInactive=` | any | Catalogue with warehouse stock; search by name, brand, SKU or barcode |
| ✅ | GET | `/products/:id` | any | Product, unit conversions, batches |
| ✅ | POST | `/products` | WAREHOUSE_MANAGER | Create product with `conversions: [{unit_name, base_qty}]` |
| ✅ | PATCH | `/products/:id` | WAREHOUSE_MANAGER | Edit any field or conversions; deactivate with `is_active: false` |
| ✅ | GET | `/products/barcode/:code` | any | Look up by scanned barcode or SKU, with pack sizes; used by the scan bar on Products, Receive stock and Stocktake |
| ✅ | GET | `/suppliers`, `/suppliers/:id` | any | Suppliers with product counts |
| ✅ | POST/PATCH | `/suppliers`, `/suppliers/:id` | WAREHOUSE_MANAGER | Add / edit supplier |
| ✅ | GET | `/customers?search=`, `/customers/:id` | any | Customers with balance owed and empties held |
| ✅ | POST/PATCH | `/customers`, `/customers/:id` | SALES_REP, ACCOUNTANT, WAREHOUSE_MANAGER | Add / edit; **only ACCOUNTANT may set credit terms** |
| ✅ | GET | `/categories`, `/container-types`, `/locations` | any | Lookup lists for forms |

## Stock (FR3, FR4, FR5)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/stock/on-hand` | any | View `v_stock_on_hand` |
| ✅ | GET | `/stock/reorder-alerts` | WAREHOUSE_MANAGER, STORE_KEEPER, MANAGEMENT | View `v_reorder_alerts` |
| ✅ | GET | `/stock/near-expiry` | any | View `v_near_expiry` (≤ 30 days) |
| ✅ | GET | `/stock/valuation` | WAREHOUSE_MANAGER, ACCOUNTANT, MANAGEMENT | View `v_stock_valuation` |
| ✅ | GET | `/stock/fefo?productId=&locationId=&quantity=` | any | Preview FEFO picking (`fn_fefo_allocate`) |
| ✅ | GET | `/stock/movements?productId=&type=&from=&to=&limit=` | WAREHOUSE_MANAGER, STORE_KEEPER, MANAGEMENT, ACCOUNTANT | Stock ledger |
| ⬜ 4 | POST | `/stock/transfers` | STORE_KEEPER | Move stock between warehouses |

## Purchasing and receiving (UC2, UC5, FR2, FR3, FR4)

Roles for all of these: WAREHOUSE_MANAGER, STORE_KEEPER, MANAGEMENT, ACCOUNTANT can view; actions as listed.

Life cycle: `DRAFT → APPROVED → SENT → PARTIAL → RECEIVED`, or `CANCELLED` before any goods arrive. A `PARTIAL` order can be closed short.

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/purchase-orders?status=APPROVED,SENT` | view roles | List POs with value and outstanding units |
| ✅ | GET | `/purchase-orders/suggestions` | WAREHOUSE_MANAGER | What to reorder: up to 2× reorder level, minus open orders, in whole crates |
| ✅ | GET | `/purchase-orders/:id` | view roles | PO with lines (ordered / received / damaged / outstanding) and deliveries |
| ✅ | POST | `/purchase-orders` | WAREHOUSE_MANAGER | Create DRAFT: `{supplier_id, expected_date?, lines:[{product_id, quantity, unit_cost?}]}`; products must belong to the supplier |
| ✅ | PATCH | `/purchase-orders/:id` | WAREHOUSE_MANAGER | Edit a DRAFT (lines replaced as a whole) |
| ✅ | POST | `/purchase-orders/:id/approve` | WAREHOUSE_MANAGER, MANAGEMENT | Approve; **approver ≠ creator** (`chk_po_duties`) |
| ✅ | POST | `/purchase-orders/:id/send` | WAREHOUSE_MANAGER | APPROVED → SENT |
| ✅ | POST | `/purchase-orders/:id/cancel` | WAREHOUSE_MANAGER | Cancel before any goods arrive |
| ✅ | POST | `/purchase-orders/:id/close` | WAREHOUSE_MANAGER | PARTIAL → RECEIVED (supplier won't deliver the rest) |
| ✅ | POST | `/purchase-orders/:id/receive` | STORE_KEEPER, WAREHOUSE_MANAGER | Record a delivery (GRN): `{delivery_note_no, notes?, lines:[{line_no, qty_received, qty_damaged?, damage_note?, batch_no, expiry_date}]}`. One transaction: batches, RECEIPT movements, GRN, status |

## Sales, invoices and payments (UC9, FR5, FR9, FR10)

View roles: SALES_REP, ACCOUNTANT, WAREHOUSE_MANAGER, STORE_KEEPER, MANAGEMENT, DRIVER.

Life cycle: `DRAFT → (submit) → CONFIRMED`, or `PENDING_CREDIT_APPROVAL → (Accountant approves) → CONFIRMED`; then `→ (invoice) → PICKING → (deliver, with van) → DELIVERED → (paid in full) → PAID`. Cancel is allowed before invoicing.

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/orders?status=&customerId=&mine=true` | view roles | List orders with invoice total and amount outstanding |
| ✅ | GET | `/orders/:id` | view roles | Order, lines with container deposits, totals (tax at today's rate before invoicing), invoice, FEFO batches picked, payments |
| ✅ | POST | `/orders` | SALES_REP, WAREHOUSE_MANAGER, ACCOUNTANT | Create DRAFT `{customer_id, lines:[{product_id, quantity, unit_price?}]}`; list price unless a manager/accountant sets one; never below cost |
| ✅ | PATCH | `/orders/:id` | same | Replace lines of a DRAFT |
| ✅ | POST | `/orders/:id/submit` | same | Check unexpired stock and credit limit → CONFIRMED or PENDING_CREDIT_APPROVAL |
| ✅ | POST | `/orders/:id/approve-credit` | ACCOUNTANT | Approve an over-limit order (not your own) |
| ✅ | POST | `/orders/:id/cancel` | SALES_REP, WAREHOUSE_MANAGER, ACCOUNTANT | Cancel before invoicing |
| ✅ | POST | `/orders/:id/invoice` | SALES_REP, ACCOUNTANT, WAREHOUSE_MANAGER, STORE_KEEPER | One transaction: FEFO pick from Main Warehouse + SALE movements, VAT invoice (simulated GRA code), empties issued |
| ✅ | POST | `/orders/:id/deliver` | SALES_REP, DRIVER, STORE_KEEPER, WAREHOUSE_MANAGER | `{van_id}`: delivered by a van (`chk_order_van`); PAID if already paid |
| ✅ | GET | `/invoices?unpaid=true&customerId=` | view roles | Invoices with paid, outstanding, days overdue (`v_invoice_balance`) |
| ✅ | GET | `/invoices/:id` | view roles | Full invoice (same shape as an order) |
| ✅ | GET | `/tax-rates` | view roles | Tax components in force (VAT 15%, NHIL 2.5%, GETFund 2.5%) |
| ✅ | GET | `/payments?customerId=` | view roles | Payments received |
| ✅ | POST | `/payments` | ACCOUNTANT, SALES_REP, DRIVER | `{customer_id, invoice_id?, amount, payment_method, reference?, payment_date?}`; reference required except cash; overpayment refused by `trg_payment_check` |

## Write-offs, empties, vans, stocktake (UC3, UC7, UC6, UC4; FR6, FR7, FR8)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/write-offs?status=PENDING_APPROVAL` | STORE_KEEPER, WAREHOUSE_MANAGER, MANAGEMENT, ACCOUNTANT | Write-offs with product, batch, value, who recorded/decided |
| ✅ | GET | `/write-offs/settings` | same | Approval limit (`app_setting`) |
| ✅ | POST | `/write-offs` | STORE_KEEPER, WAREHOUSE_MANAGER | `{batch_id, quantity, reason_code, description, responsible_user_id?}`; at or under the limit it posts at once (BREAKAGE movement) |
| ✅ | POST | `/write-offs/:id/approve` | WAREHOUSE_MANAGER | Approve and post (not your own) |
| ✅ | POST | `/write-offs/:id/reject` | WAREHOUSE_MANAGER | `{note}` required |
| ✅ | GET | `/empties/positions?customerId=` | empties roles | Containers each customer holds and deposit value (`v_empties_position`) |
| ✅ | GET | `/empties/transactions?customerId=` | empties roles | History of issues and returns |
| ✅ | POST | `/empties/returns` | STORE_KEEPER, DRIVER, SALES_REP, ACCOUNTANT | `{customer_id, refund_method: CREDIT\|CASH, lines:[{container_type_id, quantity}]}`; CREDIT lowers the balance; can't return more than held (trigger) |
| ✅ | POST | `/empties/supplier-returns` | STORE_KEEPER, WAREHOUSE_MANAGER | Empties sent back to a supplier |
| ✅ | GET | `/vans` | van roles | Vans with home depot, driver, open trip, units on board, trip count; retired vans last |
| ✅ | POST | `/vans` | WAREHOUSE_MANAGER | `{location_name, vehicle_reg, home_location_id, driver_id?}`; name, registration and driver must be unique |
| ✅ | PATCH | `/vans/:id` | WAREHOUSE_MANAGER | Any of the above, `driver_id: null` to remove, `is_active` to retire or restore; driver, depot and status locked while out on a trip; a van holding stock can't be retired |
| ✅ | GET | `/vans/:id/stock` | van roles | Batches on a van |
| ✅ | GET | `/van-trips?status=` · `/van-trips/:id` | van roles | Trips; detail includes stock on board, sales from the van, cash collected by the driver |
| ✅ | POST | `/van-trips` | STORE_KEEPER, WAREHOUSE_MANAGER | `{van_id, driver_id?, lines:[{product_id, quantity}]}`; FEFO from the van's home depot; active vans only; one open trip per van |
| ✅ | POST | `/van-trips/:id/reconcile` | STORE_KEEPER, WAREHOUSE_MANAGER | `{cash_declared, lines:[{product_id, qty_returned, qty_damaged}]}`; returns to the trip's depot (VAN_RETURN), breakage (BREAKAGE), shortage (ADJUSTMENT against the driver); van ends empty |
| ✅ | POST | `/orders/:id/invoice` with `{van_id}` | as invoicing | **Van sale**: picks from the van's stock; order becomes LOADED_ON_VAN |
| ✅ | GET | `/stocktakes` · `/stocktakes/:id` | STORE_KEEPER, WAREHOUSE_MANAGER, MANAGEMENT, ACCOUNTANT | Counts with summary (differences, units short/over, net value) |
| ✅ | POST | `/stocktakes` | STORE_KEEPER, WAREHOUSE_MANAGER | `{location_id}`: snapshot of every batch; one open count per location |
| ✅ | PATCH | `/stocktakes/:id/counts` | STORE_KEEPER, WAREHOUSE_MANAGER | `{counts:[{batch_id, counted_qty}]}` (can be saved in several sittings) |
| ✅ | POST | `/stocktakes/:id/post` | WAREHOUSE_MANAGER | Every difference becomes an ADJUSTMENT; all batches must be counted |
| ✅ | POST | `/stocktakes/:id/cancel` | WAREHOUSE_MANAGER | Cancel an open count |
| ✅ | GET | `/staff` | any | Active staff names (for "person responsible") |

## Dashboard and reports (UC8, FR11)

Every report returns the same shape: `{name, title, subtitle, columns:[{key, label, type}], rows, totals}`. The screen and both exporters work from it.

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/dashboard` | any | Key figures (sales today/month, margin, owed, overdue, stock value, reorder, near-expiry, losses), pending work counts, 14-day sales series, top products, sales and stock by category |
| ✅ | GET | `/reports/sales?from=&to=&groupBy=product\|brand\|category\|customer\|rep\|channel\|day\|month` | WAREHOUSE_MANAGER, ACCOUNTANT, MANAGEMENT | Units, revenue (before tax and deposits), cost, margin, margin % |
| ✅ | GET | `/reports/movers?days=30` | same | Units sold, per day, warehouse stock, days of cover, Fast / Normal / Slow / Not selling |
| ✅ | GET | `/reports/losses?from=&to=` | same | Write-offs, van breakage and shortages, stocktake shortfalls, at cost (`v_stock_losses`) |
| ✅ | GET | `/reports/valuation` | same | Stock at cost and selling price, potential margin |
| ✅ | GET | `/reports/receivables` | same | Money owed by customer in 0–30 / 31–60 / 61–90 / 90+ day bands, overdue (`v_receivables_ageing`) |
| ✅ | GET | `/reports/expiry?days=90` | same | Batches expiring within N days |
| ✅ | GET | `/reports/:name/export?format=xlsx\|pdf&…` | same | Same report as an Excel workbook (live SUM totals, GH₵ formats, frozen header, filters) or a PDF |

## Error format

```json
{ "statusCode": 400, "message": "Insufficient stock: 120 units short for product 3 at location 1" }
```

Database constraint errors come back as 400/409 with the constraint name (see `common/pg-exception.filter.ts`).

## Timestamps (FR12)

| | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ✅ | GET | `/history/:doc/:id` | any signed-in user | Every step of a document with time and person. `doc` = `orders`, `purchase-orders`, `write-offs`, `van-trips`, `stocktakes`. Read from `v_document_timeline` (built on the audit trail): created, each status change, invoice issued, payments, deliveries received |
| ✅ | GET | `/stamps/:entity/:id` | any signed-in user | When a record was added and last changed, and by whom. `entity` = `products`, `customers`, `suppliers`, `vans`, `users` |

Lists of products, customers, suppliers, users, vans, invoices and payments also return `created_at` / `updated_at`.

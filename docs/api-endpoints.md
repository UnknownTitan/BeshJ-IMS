# BESH. J IMS – API endpoint list

Base URL: `http://localhost:3000/api`. Every endpoint except **login** and **health** needs the header
`Authorization: Bearer <accessToken>`. ADMIN may call every endpoint.

Status: ✅ built (Phases 0–3) · ⬜ planned (phase number shown)

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
| ✅ | GET | `/products/barcode/:code` | any | Look up by scanned barcode or SKU |
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

## Losses, empties, vans, stocktake (UC3, UC7, UC6, UC4)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ⬜ 4 | POST | `/write-offs` | STORE_KEEPER, WAREHOUSE_MANAGER | Record breakage / expiry with reason and person responsible |
| ⬜ 4 | POST | `/write-offs/:id/approve` | WAREHOUSE_MANAGER | Approve above the value threshold |
| ⬜ 4 | GET | `/empties/balances` | STORE_KEEPER, ACCOUNTANT | View `v_empties_balance` |
| ⬜ 4 | POST | `/empties/transactions` | STORE_KEEPER, DRIVER | Containers issued / returned, deposit value |
| ⬜ 4 | POST | `/vans/:id/load` | STORE_KEEPER | Load sheet → VAN_LOAD movements (FEFO) |
| ⬜ 4 | POST | `/vans/:id/reconcile` | STORE_KEEPER, DRIVER | End-of-day: loaded vs sold vs returned vs damaged |
| ⬜ 4 | POST | `/stocktakes` · `/stocktakes/:id/counts` · `/stocktakes/:id/post` | WAREHOUSE_MANAGER, STORE_KEEPER | Count, show variances, post adjustments |

## Reports and dashboard (UC8, FR11)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ⬜ 5 | GET | `/dashboard` | WAREHOUSE_MANAGER, ACCOUNTANT, MANAGEMENT | Key metrics in one call |
| ⬜ 5 | GET | `/reports/sales?from=&to=&groupBy=product\|brand\|customer` | ACCOUNTANT, MANAGEMENT | Sales report |
| ⬜ 5 | GET | `/reports/fast-slow-movers?days=` | WAREHOUSE_MANAGER, MANAGEMENT | Fast- and slow-moving products |
| ⬜ 5 | GET | `/reports/losses?from=&to=` | WAREHOUSE_MANAGER, MANAGEMENT | Breakages and write-offs |
| ⬜ 5 | GET | `/reports/:name/export?format=pdf\|xlsx` | as report | PDF / Excel export |

## Error format

```json
{ "statusCode": 400, "message": "Insufficient stock: 120 units short for product 3 at location 1" }
```

Database constraint errors come back as 400/409 with the constraint name (see `common/pg-exception.filter.ts`).

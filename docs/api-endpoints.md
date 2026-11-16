# BESH. J IMS – API endpoint list

Base URL: `http://localhost:3000/api`. Every endpoint except **login** and **health** needs the header
`Authorization: Bearer <accessToken>`. ADMIN may call every endpoint.

Status: ✅ built (Phases 0–1) · ⬜ planned (phase number shown)

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
| ⬜ 2 | GET | `/stock/movements?productId=&from=&to=` | WAREHOUSE_MANAGER | Stock ledger |
| ⬜ 4 | POST | `/stock/transfers` | STORE_KEEPER | Move stock between warehouses |

## Purchasing and receiving (UC2, UC5, FR2, FR4)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ⬜ 2 | GET | `/purchase-orders?status=` | WAREHOUSE_MANAGER, STORE_KEEPER | List POs |
| ⬜ 2 | POST | `/purchase-orders` | WAREHOUSE_MANAGER | Create PO (can prefill from reorder alerts) |
| ⬜ 2 | GET | `/purchase-orders/:id` | WAREHOUSE_MANAGER, STORE_KEEPER | PO with lines |
| ⬜ 2 | POST | `/purchase-orders/:id/approve` | WAREHOUSE_MANAGER | Approve (must differ from creator: `chk_po_duties`) |
| ⬜ 2 | POST | `/purchase-orders/:id/send` | WAREHOUSE_MANAGER | Mark as sent to supplier |
| ⬜ 2 | POST | `/purchase-orders/:id/receive` | STORE_KEEPER | Receive lines with batch no., expiry, damaged qty → creates batches + RECEIPT movements in one transaction |

## Sales (UC9, FR9)

| Status | Method | Path | Roles | Purpose |
|---|---|---|---|---|
| ⬜ 3 | GET | `/orders?status=&customerId=` | SALES_REP, ACCOUNTANT | List orders |
| ⬜ 3 | POST | `/orders` | SALES_REP | Create order; checks stock and credit limit (`v_customer_balance`) |
| ⬜ 3 | GET | `/orders/:id` | SALES_REP, ACCOUNTANT | Order with lines and invoice |
| ⬜ 3 | POST | `/orders/:id/approve-credit` | ACCOUNTANT, WAREHOUSE_MANAGER | Approve an order over the credit limit |
| ⬜ 3 | POST | `/orders/:id/confirm` | SALES_REP | Allocate stock FEFO, deduct stock, issue invoice with VAT (one transaction) |
| ⬜ 3 | POST | `/orders/:id/cancel` | SALES_REP, ACCOUNTANT | Cancel and release stock |
| ⬜ 3 | GET | `/invoices/:id` · `/invoices/:id/pdf` | SALES_REP, ACCOUNTANT | Invoice data / printable PDF |
| ⬜ 3 | POST | `/payments` | ACCOUNTANT, SALES_REP | Record payment against invoice |
| ⬜ 3 | GET | `/customers/:id/statement` | ACCOUNTANT | Balance and history |

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

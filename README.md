# BESH. J Limited – Inventory Management System (IMS)

GIMPA · GSOT707 Database & Programming Concepts · group mini project

A web-based inventory system for a Ghanaian beverage distributor: products and unit conversions, batch and expiry tracking with FEFO picking, purchasing, customer orders and VAT invoices, empties and deposits, van reconciliation, an audit trail and reports. It implements the design in our System Analysis & Design Assignments 1–8.

**Current status: Phase 2 (purchasing and receiving) complete.**
- Phase 0: login, 7 roles, audit trail, dashboard with reorder alerts, stock valuation and near-expiry stock.
- Phase 1: manage users (create, edit, deactivate, reset password), change your own password, products with unit conversions and barcode lookup, suppliers, and customers with credit control (only an Accountant can give credit).
- Phase 2: purchase orders (draft → approve → send → receive), reorder suggestions, receiving deliveries with batch numbers, expiry dates and damaged-on-arrival counts, split deliveries, and a stock movement ledger.

## Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16, schema `ims` (17 tables from Assignment 7 + `audit_log`) |
| API | Node.js 20+ · NestJS 10 · plain SQL via `pg` (no ORM, so the SQL is visible) |
| Auth | JWT + bcrypt, role guard on every endpoint |
| Frontend | React 18 + TypeScript · Vite · Ant Design |
| Tests | Jest + Supertest (end-to-end against the real database) |

## Folder layout

```
besh-ims/
├─ database/
│  ├─ 01_schema.sql            Assignment 7 schema (17 tables, 3 views, indexes)
│  ├─ 02_sample_data.sql       Assignment 7 sample data
│  ├─ 03_phase0_additions.sql  passwords, audit_log + triggers, views, fn_fefo_allocate()
│  ├─ 04_phase2_purchasing.sql goods receipts, stock-movement trigger, PO numbering
│  └─ reset_db.sh              rebuild the database from scratch
├─ backend/                    NestJS REST API  (src/<module>/...)
├─ frontend/                   React app        (src/pages, src/layout, src/api)
├─ docs/api-endpoints.md       endpoint list: built and planned, by phase
└─ docker-compose.yml          PostgreSQL 16 for development
```

## Getting started

You need **Node.js 20+** and either **Docker Desktop** or a local **PostgreSQL 16**.

### 1. Database

With Docker (recommended):

```bash
docker compose up -d          # first start loads 01, 02 and 03 automatically
```

Without Docker, create a database and user, then run the scripts:

```bash
createuser -P besh            # password: besh_dev_pw
createdb -O besh besh_ims
PGUSER=besh PGDATABASE=besh_ims PGHOST=localhost ./database/reset_db.sh
```

`reset_db.sh` runs every numbered script in order (01, 02, 03, 04, ...).

Note: `03_phase0_additions.sql` runs `CREATE EXTENSION pgcrypto`. If the `besh` user is not a superuser, run that one line as `postgres` first.

### 2. API

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev             # http://localhost:3000/api/health
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### Demo logins (password for all: `Password123!`)

| Username | Role |
|---|---|
| kappiah | Admin |
| kmensah | Warehouse Manager |
| aowusu | Store Keeper |
| kasante / anyarko | Sales Rep |
| yboateng / kofori | Driver |
| edarko | Accountant |
| aadjei | Management |

## Tests

```bash
./database/reset_db.sh        # or: docker compose down -v && docker compose up -d
cd backend && npm run test:e2e
```

42 tests cover login, roles, the audit trail, reorder alerts, FEFO picking, product rules (price, returnable containers, duplicate SKU), suppliers, customer credit control, user management, and the full purchase-order flow (separation of duties, partial and damaged deliveries, over-delivery, expired goods, rollback of a failed delivery). Each test names the requirement it checks (FR1–FR12), so the results can go straight into the report's testing chapter.

The tests add their own rows (e.g. "Test Spot 0385155"), so **reset the database before a demo**.

## Database features worth showing in the report and Q&A

- **Constraints:** CHECK rules for prices, packaging, roles and statuses; a rule that a PO approver must differ from its creator (`chk_po_duties`); invoice total = subtotal + VAT + deposit.
- **Views:** `v_stock_on_hand`, `v_customer_balance`, `v_empties_balance`, `v_reorder_alerts`, `v_near_expiry`, `v_stock_valuation`, `v_po_line_status` (ordered vs received vs outstanding). Derived figures are calculated, not stored, which keeps the schema in 3NF.
- **Trigger:** `fn_audit()` records every insert, update and delete with before and after values and the logged-in user. The API passes the user through `set_config('app.user_id', …)`. `audit_log` is append-only, enforced by a trigger.
- **Trigger:** `trg_apply_stock_movement` keeps every batch's quantity in step with the stock ledger and refuses to let stock go negative. Movements can't be edited or deleted; mistakes are corrected with an ADJUSTMENT.
- **Trigger:** purchase order lines are frozen once the order leaves DRAFT.
- **Stored function:** `fn_fefo_allocate(product, location, qty)` picks batches earliest-expiry-first and refuses to oversell.
- **Transactions and locking:** `DatabaseService.transaction()` wraps multi-step operations so they succeed or fail together. Receiving a delivery writes the GRN, batches, stock movements and the order status in one transaction, with the order row locked (`SELECT … FOR UPDATE`) so two people can't receive the same goods twice.

## How to work on the code

1. Pull the latest `main`, then create a branch per feature: `feature/receiving`, `feature/orders`.
2. Agree the endpoint in `docs/api-endpoints.md` before building it.
3. Database changes go in a **new numbered script** (`04_...sql`). Never edit 01–03 after others have run them.
4. Add at least one e2e test per feature, named after its FR.
5. Open a pull request; one teammate reviews before merging.

## Roadmap

| Phase | Weeks | Scope |
|---|---|---|
| 0 Setup ✅ | 1 | Repo, database, API and UI skeletons, auth, audit, endpoint list |
| 1 Foundation ✅ | 2 | Users CRUD, products/suppliers/customers CRUD (UC10, UC1) |
| 2 Stock in ✅ | 3 | Purchase orders, approvals, receiving with batch and expiry (UC2, UC5) |
| 3 Stock out | 4 | Orders, credit check, FEFO, VAT invoice, payments (UC9): **main demo flow** |
| 4 Extras | 5 | Breakages, empties, van reconciliation, stocktake (UC3, UC7, UC6, UC4) |
| 5 Insight | 5–6 | Dashboard and reports, PDF/Excel export (UC8) |
| 6 Testing | 6 | Unit and API tests, FR traceability, UAT |
| 7 Wrap-up | 7 | Report, slides, demo script |

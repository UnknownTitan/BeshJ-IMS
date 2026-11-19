// Shared display helpers.

export const cedi = (n: number | null | undefined) =>
  n == null ? '—' : `GH₵\u00a0${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Dates and times use non-breaking spaces so a narrow column never splits them.
const keep = (s: string) => s.replace(/ /g, '\u00a0');

export const date = (d: string | null | undefined) =>
  d ? keep(new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })) : '—';

export const dateTime = (d: string | null | undefined) =>
  d ? keep(new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })).replace(',\u00a0', ', ') : '—';

/** "480 bottles (20 crates)" when a whole-pack conversion exists. */
export const qtyWithPacks = (qty: number, baseUnit: string, packQty?: number, packName = 'crate') => {
  const unit = `${baseUnit.toLowerCase()}${qty === 1 ? '' : 's'}`;
  if (!packQty || packQty <= 1 || qty === 0) return `${qty.toLocaleString()} ${unit}`;
  const packs = qty / packQty;
  const packText = Number.isInteger(packs) ? `${packs} ${packName}${packs === 1 ? '' : 's'}` : `${packs.toFixed(1)} ${packName}s`;
  return `${qty.toLocaleString()} ${unit} (${packText})`;
};

export const PO_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  APPROVED: 'blue',
  SENT: 'geekblue',
  PARTIAL: 'orange',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

export const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'default' },
  PENDING_CREDIT_APPROVAL: { label: 'Awaiting credit approval', color: 'gold' },
  CONFIRMED: { label: 'Confirmed', color: 'blue' },
  PICKING: { label: 'Invoiced – to deliver', color: 'geekblue' },
  LOADED_ON_VAN: { label: 'On van', color: 'purple' },
  DELIVERED: { label: 'Delivered – unpaid', color: 'orange' },
  OVERDUE: { label: 'Overdue', color: 'red' },
  PAID: { label: 'Paid', color: 'green' },
  RETURNED: { label: 'Returned', color: 'magenta' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
};

export const PAYMENT_METHODS: Record<string, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
};

// Shared display helpers.

export const cedi = (n: number | null | undefined) =>
  n == null ? '—' : `GH₵ ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const date = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const dateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

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

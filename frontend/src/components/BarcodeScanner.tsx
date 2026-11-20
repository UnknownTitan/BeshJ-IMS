// Barcode scanning (FR2, NFR4).
//
// Two ways to scan, both ending in onScan(code):
//  1. A USB or Bluetooth scanner. These type the digits like a keyboard and press
//     Enter, so the ScanBar's text box catches them. Typing the number works too.
//  2. The device camera. The camera button opens CameraScanner, which reads EAN,
//     UPC and Code 128 barcodes with the html5-qrcode library. Browsers only allow
//     the camera on HTTPS pages (or localhost), which the hosted system is.
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import { BarcodeOutlined, CameraOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';

type OnScan = (code: string) => void;

/** Short buzz on phones that support it, so the user knows a code was read. */
const feedback = () => {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* not supported */
  }
};

let nextId = 0;

/**
 * Camera barcode reader in a modal. With `continuous`, it stays open for counting
 * several items: the same barcode counts again only after it has left the picture
 * for a moment, so holding the camera on one crate counts it once.
 */
export function CameraScanner({
  open,
  onClose,
  onScan,
  continuous = false,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  onScan: OnScan;
  continuous?: boolean;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const elementId = useRef(`scan-view-${++nextId}`);
  const scanner = useRef<any>(null);
  const recent = useRef<{ code: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLast(null);

    (async () => {
      try {
        // Loaded only when someone scans, so the library does not slow down every page.
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
        if (cancelled) return;
        const s = new Html5Qrcode(elementId.current, {
          verbose: false,
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39],
        });
        scanner.current = s;
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w: number, h: number) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.45) }) },
          (code: string) => {
            const now = Date.now();
            const seen = recent.current;
            recent.current = { code, at: now };
            // Still the same barcode in view (seen within the last second): not a new item.
            if (seen && seen.code === code && now - seen.at < 1000) return;
            feedback();
            setLast(code);
            onScanRef.current(code);
            if (!continuous) onClose();
          },
          () => {
            /* no barcode in this frame: keep looking */
          },
        );
        if (cancelled) await s.stop().catch(() => {});
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        setError(
          /permission|notallowed/i.test(msg)
            ? 'Camera access was blocked. Allow the camera for this site in the browser settings, or type the barcode instead.'
            : /notfound|no camera|requested device/i.test(msg)
              ? 'No camera was found on this device. Use a USB scanner or type the barcode instead.'
              : `The camera could not start: ${msg}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      const s = scanner.current;
      scanner.current = null;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
    };
  }, [open, continuous]);

  return (
    <Modal open={open} onCancel={onClose} footer={<Button onClick={onClose}>{continuous ? 'Done' : 'Cancel'}</Button>} title="Scan a barcode" destroyOnClose width={520}>
      {error ? (
        <Alert type="warning" showIcon message={error} />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">{hint ?? 'Point the camera at the barcode and hold it steady.'}</Typography.Text>
          <div id={elementId.current} style={{ width: '100%', minHeight: 260, background: '#0F1B2D', borderRadius: 8, overflow: 'hidden' }} />
          {continuous && last && <Typography.Text>Last scanned: {last}</Typography.Text>}
        </Space>
      )}
    </Modal>
  );
}

/**
 * Text box plus camera button. A USB scanner types into the box and presses Enter;
 * the camera button opens CameraScanner. Either way, onScan gets the code.
 */
export function ScanBar({
  onScan,
  continuous = false,
  placeholder = 'Scan or type a barcode',
  hint,
  width = 320,
}: {
  onScan: OnScan;
  continuous?: boolean;
  placeholder?: string;
  hint?: string;
  width?: number | string;
}) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);

  const submit = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setValue('');
    feedback();
    onScan(code);
  };

  return (
    <>
      <Space.Compact style={{ width, maxWidth: '100%' }}>
        <Input
          prefix={<BarcodeOutlined />}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={() => submit(value)}
          inputMode="numeric"
          aria-label="Barcode"
          allowClear
        />
        <Button icon={<CameraOutlined />} onClick={() => setCamera(true)} aria-label="Scan with camera">
          Camera
        </Button>
      </Space.Compact>
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={submit} continuous={continuous} hint={hint} />
    </>
  );
}

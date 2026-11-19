// The company logo. The mark is public/logo-mark.svg: replace that file to change the
// logo on the sign-in page, the menu, the browser tab, invoices and PDF reports.
export const LOGO_SRC = '/logo-mark.svg';

interface Props {
  /** height of the mark in px */
  size?: number;
  /** white text, for the dark menu */
  onDark?: boolean;
  /** second line under the name */
  tagline?: string;
}

export default function Logo({ size = 32, onDark = false, tagline }: Props) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size / 3.2), minWidth: 0 }}>
      <img src={LOGO_SRC} width={size} height={size} alt="" style={{ flex: 'none', display: 'block' }} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: Math.max(15, size * 0.5), letterSpacing: 0.2, color: onDark ? '#fff' : undefined, whiteSpace: 'nowrap' }}>
          BESH. J Limited
        </span>
        {tagline && (
          <span style={{ fontSize: Math.max(11, size * 0.32), color: onDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}

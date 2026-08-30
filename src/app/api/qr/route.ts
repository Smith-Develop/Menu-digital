import { NextResponse, type NextRequest } from 'next/server';
import QRCode from 'qrcode';

/**
 * Genera el QR de una mesa como PNG o SVG.
 *
 *   /api/qr?data=<url>&size=512&format=png
 *
 * Sólo acepta URLs del propio sitio: así este endpoint no puede usarse para
 * fabricar códigos que apunten a cualquier destino externo.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const data = params.get('data');
  const format = params.get('format') === 'svg' ? 'svg' : 'png';
  const size = Math.min(Math.max(Number(params.get('size') ?? 512), 128), 2048);

  if (!data) {
    return NextResponse.json({ error: 'MISSING_DATA' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(data);
  } catch {
    return NextResponse.json({ error: 'INVALID_URL' }, { status: 400 });
  }

  const allowedHost = request.nextUrl.host;
  const siteHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '').host;
    } catch {
      return null;
    }
  })();

  if (target.host !== allowedHost && target.host !== siteHost) {
    return NextResponse.json({ error: 'HOST_NOT_ALLOWED' }, { status: 400 });
  }

  const options = {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M' as const,
    color: { dark: '#1A1817', light: '#FFFFFF' },
  };

  if (format === 'svg') {
    const svg = await QRCode.toString(target.toString(), { ...options, type: 'svg' });
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  }

  const buffer = await QRCode.toBuffer(target.toString(), { ...options, type: 'png' });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Disposition': `inline; filename="qr.png"`,
    },
  });
}

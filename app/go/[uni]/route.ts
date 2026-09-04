import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, context: { params: Promise<{ uni: string }> }) {
  const { uni } = await context.params;
  const { searchParams } = new URL(request.url);
  const classNbr = searchParams.get('classNbr');
  const term = searchParams.get('term');

  if (!classNbr || !term) {
    return NextResponse.json(
      {
        error: 'Missing required parameters',
        message: 'Both classNbr and term are required',
        example: '/go/asu?classNbr=29941&term=2261',
      },
      { status: 400 }
    );
  }

  switch (uni.toLowerCase()) {
    case 'asu':
      return redirectToASU(classNbr, term);

    default:
      return NextResponse.json(
        {
          error: 'University not supported',
          message: `University "${uni}" is not currently supported`,
          supported: ['asu'],
        },
        { status: 404 }
      );
  }
}

function redirectToASU(classNbr: string, term: string): NextResponse {
  const safeClassNbr = classNbr.replace(/[^0-9]/g, '');
  const safeTerm = term.replace(/[^0-9]/g, '');

  const asuUrl = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${safeClassNbr}&term=${safeTerm}`;

  return NextResponse.redirect(asuUrl, 302);
}

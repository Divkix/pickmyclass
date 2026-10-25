export async function GET(request: Request, context: { params: Promise<{ uni: string }> }) {
  const { uni } = await context.params;
  const { searchParams } = new URL(request.url);
  const classNbr = searchParams.get("classNbr");
  const term = searchParams.get("term");

  if (!classNbr || !term) {
    return Response.json(
      {
        error: "Missing required parameters",
        message: "Both classNbr and term are required",
        example: "/go/asu?classNbr=29941&term=2261",
      },
      { status: 400 },
    );
  }

  switch (uni.toLowerCase()) {
    case "asu":
      return redirectToASU(classNbr, term);

    default:
      return Response.json(
        {
          error: "University not supported",
          message: `University "${uni}" is not currently supported`,
          supported: ["asu"],
        },
        { status: 404 },
      );
  }
}

function redirectToASU(classNbr: string, term: string): Response {
  const safeClassNbr = classNbr.replace(/[^0-9]/g, "");
  const safeTerm = term.replace(/[^0-9]/g, "");

  const asuUrl = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${safeClassNbr}&term=${safeTerm}`;

  return Response.redirect(asuUrl, 302);
}

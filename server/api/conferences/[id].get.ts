export default defineEventHandler(async (event) => {
  const { id } = event.context.params as { id: string };

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "ID is required",
    });
  }

  const conference = await prisma.conference.findUnique({
    where: { id },
  });

  if (!conference) {
    throw createError({
      statusCode: 404,
      statusMessage: `Conference with ID ${id} not found`,
    });
  }

  return conference;
});

import { z } from "zod";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  term: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => querySchema.safeParse(q));

  if (!query.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing search term",
    });
  }

  const { limit, term } = query.data;

  const conferences = await prisma.conference.findMany({
    omit: {
      conferenceText: true,
    },
    orderBy: {
      conferenceStartDate: { nulls: "last", sort: "desc" },
    },
    take: limit,
    where: {
      conferenceName: {
        contains: term,
        mode: "insensitive",
      },
    },
  });

  if (conferences.length === 0) {
    return [];
  }

  return conferences;
});

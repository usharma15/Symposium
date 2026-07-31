export type NextCompatibilityMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type NextCompatibilityContract = {
  id: string;
  methods: readonly NextCompatibilityMethod[];
};

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, Cookie"
};

export const compatibilityNotFoundResponse = () =>
  Response.json(
    { error: "Not found." },
    { status: 404, headers: privateNoStoreHeaders }
  );

export const compatibilityMethodNotAllowedResponse = (
  methods: readonly NextCompatibilityMethod[]
) =>
  Response.json(
    { error: "Method not allowed." },
    {
      status: 405,
      headers: {
        ...privateNoStoreHeaders,
        Allow: methods.join(", ")
      }
    }
  );

export const compatibilityRequestMethod = (request: Request) =>
  request.method.toUpperCase() as NextCompatibilityMethod;

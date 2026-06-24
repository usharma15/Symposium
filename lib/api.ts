export const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

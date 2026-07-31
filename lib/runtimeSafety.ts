export const liveBackendUnavailableMessage =
  "The SYMPOSIUM live service is unavailable. Try again once the live service is healthy.";

export type NextPersistenceMode = "canonical-api" | "local-preview" | "unavailable";

export const selectNextPersistenceMode = (input: {
  backendUrl: string | null;
  localPreviewAllowed: boolean;
}): NextPersistenceMode => {
  if (input.backendUrl) return "canonical-api";
  return input.localPreviewAllowed ? "local-preview" : "unavailable";
};

export const localPreviewRuntimeAllowed = (nodeEnv: string | undefined = process.env.NODE_ENV) =>
  nodeEnv !== "production";

export const assertLocalPreviewPersistenceAvailable = (input: {
  databaseBackedModeConfigured: boolean;
  nodeEnv?: string;
}) => {
  if (!localPreviewRuntimeAllowed(input.nodeEnv)) {
    throw new Error(
      "Local preview persistence is unavailable in production. Configure SYMPOSIUM_API_URL and use the canonical API."
    );
  }
  if (input.databaseBackedModeConfigured) {
    throw new Error(
      "Direct Postgres access from the local preview store has been retired. Configure SYMPOSIUM_API_URL and run the canonical API for database-backed development."
    );
  }
};

export const liveBackendUnavailableResponse = () =>
  Response.json(
    { error: liveBackendUnavailableMessage },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );

export const localPreviewRouteUnavailableResponse = () =>
  Response.json(
    { error: "Not found." },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );

export const liveBackendUnavailableMessage =
  "The SYMPOSIUM live service is unavailable. Try again once the live service is healthy.";

export const localDataFallbackAllowed = (nodeEnv = process.env.NODE_ENV) => nodeEnv !== "production";

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

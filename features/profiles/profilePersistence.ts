export const profileAvatarForPersistence = (avatarUrl: string | undefined) => {
  const normalized = avatarUrl?.trim();
  if (!normalized || normalized.startsWith("data:") || normalized.startsWith("blob:")) return undefined;
  return normalized;
};

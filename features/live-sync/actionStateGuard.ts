export type ActionStateProtection<MetricState> = {
  desired?: boolean;
  metric?: MetricState;
};

export type ActionStateGuard<MetricState> = Map<string, ActionStateProtection<MetricState>>;

export const createActionStateGuard = <MetricState>(): ActionStateGuard<MetricState> => new Map();

export const protectActionState = <MetricState>(
  guard: ActionStateGuard<MetricState>,
  key: string,
  desired: boolean | undefined,
  metric?: MetricState
) => {
  if (desired === undefined && metric === undefined) {
    guard.delete(key);
    return;
  }
  guard.set(key, { desired, metric });
};

export const clearActionStateProtection = <MetricState>(
  guard: ActionStateGuard<MetricState>,
  key: string
) => {
  guard.delete(key);
};

export const protectedActionState = <MetricState>(
  guard: ActionStateGuard<MetricState>,
  key: string
) => guard.get(key);

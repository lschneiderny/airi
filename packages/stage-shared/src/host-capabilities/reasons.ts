export const HostReasons = Object.freeze({
  WaylandCursorUnreported: 'wayland-cursor-unreported',
  WaylandWindowOriginHidden: 'wayland-window-origin-hidden',
  WaylandDisplayOriginUnverified: 'wayland-display-origin-unverified',
  XwaylandIdleConstantZero: 'xwayland-idle-constant-zero',
  WaylandIdleUnverified: 'wayland-idle-unverified',
  LinuxLockEventsUndocumented: 'linux-lock-events-undocumented',
  PlatformNoForegroundBinding: 'platform-no-foreground-binding',
  ForegroundBindingLoadFailed: 'foreground-binding-load-failed',
  WaylandNoGlobalInputHook: 'wayland-no-global-input-hook',
  GlobalInputHookLoadFailed: 'global-input-hook-load-failed',
  GlobalInputHookStartFailed: 'global-input-hook-start-failed',
  MacosAccessibilityDenied: 'macos-accessibility-denied',
  MacosWindowTitlesUntrusted: 'macos-window-titles-untrusted',
  LinuxNoClickThroughForward: 'linux-no-click-through-forward',
  WaylandNoZOrder: 'wayland-no-z-order',
  LinuxCaptureAudioUnverified: 'linux-capture-audio-unverified',
  MacosCaptureAudioRequires14_2: 'macos-capture-audio-requires-14-2',
  WebSandbox: 'web-sandbox',
  WebPagePointerOnly: 'web-page-pointer-only',
  LinuxBridgeStarting: 'linux-bridge-starting',
  LinuxBridgeFailed: 'linux-bridge-failed',
  LinuxForegroundVerifying: 'linux-foreground-verifying',
  LinuxCursorVerifying: 'linux-cursor-verifying',
  LinuxGeometryVerifying: 'linux-geometry-verifying',
  LinuxKeepAboveVerifying: 'linux-keep-above-verifying',
  LinuxClickThroughEmulated: 'linux-click-through-emulated',
  GnomeNeedsExtension: 'gnome-needs-extension',
  SwayCursorUnreported: 'sway-cursor-unreported',
  LinuxDesktopUnsupported: 'linux-desktop-unsupported',
  KwinApiUnsupported: 'kwin-api-unsupported',
  LinuxPortalShortcutUnbound: 'linux-portal-shortcut-unbound',
} as const)

export type HostReason = typeof HostReasons[keyof typeof HostReasons]

/** Every reason code, for schemas that validate one. */
export const HOST_REASONS: readonly HostReason[] = Object.values(HostReasons)

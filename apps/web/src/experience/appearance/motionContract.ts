/** Motion vocabulary shared by first-party Skin adapters. */
export const motionContractVersion = "sensa-motion-v1" as const;

export const motionProfileCatalog = ["gentle", "direct"] as const;
export const motionTokenCatalog = [
  "duration-instant",
  "duration-component",
  "duration-screen",
  "duration-overlay",
  "easing-standard",
  "easing-enter",
  "easing-exit",
  "distance-overlay",
] as const;

export type MotionProfile = (typeof motionProfileCatalog)[number];
export type MotionToken = (typeof motionTokenCatalog)[number];

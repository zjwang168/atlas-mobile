const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Drops the `aps-environment` entitlement that `expo-notifications` adds.
 *
 * The app only schedules *local* notifications — "Your places are ready" when
 * an import finishes. Those need no entitlement at all. `aps-environment` is
 * for remote push, and requesting it makes Apple refuse a provisioning profile
 * to any personal (free) development team, so a device build cannot be signed:
 *
 *   Cannot create a iOS App Development provisioning profile for
 *   "com.ouratlas.app". Personal development teams do not support the Push
 *   Notifications capability.
 *
 * Removing the `expo-notifications` dependency would also clear the
 * entitlement, but it would take the import notification with it. This keeps
 * the feature and removes only the capability nothing uses.
 *
 * Delete this plugin if remote push is ever added — at which point the team
 * needs a paid Apple Developer membership anyway.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults['aps-environment'];
    return entitlementsConfig;
  });
};

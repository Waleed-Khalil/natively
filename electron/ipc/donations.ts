import { safeHandle } from "./helpers";

export function registerDonationHandlers(): void {
  safeHandle("get-donation-status", async () => {
    const { DonationManager } = require('../DonationManager');
    const manager = DonationManager.getInstance();
    return {
      shouldShow: manager.shouldShowToaster(),
      hasDonated: manager.getDonationState().hasDonated,
      lifetimeShows: manager.getDonationState().lifetimeShows,
    };
  });

  safeHandle("mark-donation-toast-shown", async () => {
    const { DonationManager } = require('../DonationManager');
    DonationManager.getInstance().markAsShown();
    return { success: true };
  });

  safeHandle("set-donation-complete", async () => {
    const { DonationManager } = require('../DonationManager');
    DonationManager.getInstance().setHasDonated(true);
    return { success: true };
  });
}

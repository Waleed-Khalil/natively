import { safeHandle } from "./helpers";

export function registerCalendarHandlers(): void {
  safeHandle("calendar-connect", async () => {
    try {
      const { CalendarManager } = require('../services/CalendarManager');
      await CalendarManager.getInstance().startAuthFlow();
      return { success: true };
    } catch (error: any) {
      console.error("Calendar auth error:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("calendar-disconnect", async () => {
    const { CalendarManager } = require('../services/CalendarManager');
    await CalendarManager.getInstance().disconnect();
    return { success: true };
  });

  safeHandle("get-calendar-status", async () => {
    const { CalendarManager } = require('../services/CalendarManager');
    return CalendarManager.getInstance().getConnectionStatus();
  });

  safeHandle("get-upcoming-events", async () => {
    const { CalendarManager } = require('../services/CalendarManager');
    return CalendarManager.getInstance().getUpcomingEvents();
  });

  safeHandle("calendar-refresh", async () => {
    const { CalendarManager } = require('../services/CalendarManager');
    await CalendarManager.getInstance().refreshState();
    return { success: true };
  });
}

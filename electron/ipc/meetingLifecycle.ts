import { AppState } from "../main";
import { safeHandle } from "./helpers";

export function registerMeetingLifecycleHandlers(appState: AppState): void {
  safeHandle("start-meeting", async (_event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      // Live meeting context is session-scoped — clear on every end-meeting path.
      try {
        const { MeetingContextStore } = require('../services/MeetingContextStore');
        MeetingContextStore.getInstance().clear();
      } catch (_e) { /* non-fatal */ }
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });
}

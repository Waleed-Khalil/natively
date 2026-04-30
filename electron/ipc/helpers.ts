import { ipcMain } from "electron";

type IpcListener = (event: any, ...args: any[]) => Promise<any> | any;

export function safeHandle(channel: string, listener: IpcListener): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

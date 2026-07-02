import { ipcMain } from "electron";
import { closeGovWindowAndReturnHome } from "../services/govWindow";
import { assertTrustedRendererUrl } from "../security/trustedOrigins";

export function registerGovWindowIpc() {
  ipcMain.handle("totem-gov-close", async (event, action?: string) => {
    assertTrustedRendererUrl(event.senderFrame?.url || "", "fechar janela gov");
    closeGovWindowAndReturnHome(action === "back" ? "back" : "exit");
    return { success: true };
  });
}
